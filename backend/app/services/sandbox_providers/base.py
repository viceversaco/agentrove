import asyncio
import base64
import fnmatch
import logging
import posixpath
import shlex
import subprocess
from abc import ABC, abstractmethod
from pathlib import Path, PurePosixPath
from typing import Any, Awaitable, Callable, TypeVar

from app.constants import (
    SANDBOX_BASHRC_PATH,
    SANDBOX_BINARY_EXTENSIONS,
    SANDBOX_HOME_DIR,
    SANDBOX_SYSTEM_VARIABLES,
    SANDBOX_WORKSPACE_DIR,
)
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
    PreviewLink,
    PtyDataCallbackType,
    PtySession,
    PtySize,
    SecretEntry,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

LISTENING_PORTS_COMMAND = "ss -tuln | grep LISTEN | awk '{print $5}' | sed 's/.*://g' | grep -E '^[0-9]+$' | sort -u"
GITIGNORE_CMD = "cat .gitignore 2>/dev/null"


class SandboxProvider(ABC):
    _pty_sessions: dict[str, dict[str, Any]]

    @staticmethod
    def normalize_path(file_path: str, base: str = SANDBOX_HOME_DIR) -> str:
        path = PurePosixPath(file_path)

        if path.is_absolute():
            path_str = str(path)
            if path_str.startswith(base):
                return posixpath.normpath(path_str)
            return posixpath.normpath(f"{base}{path}")
        return posixpath.normpath(f"{base}/{path}")

    @staticmethod
    def format_export_command(key: str, value: str) -> str:
        escaped_value = value.replace("'", "'\"'\"'")
        return f"export {key}='{escaped_value}'"

    @staticmethod
    def _is_binary_file(path: str) -> bool:
        return Path(path).suffix.lstrip(".").lower() in SANDBOX_BINARY_EXTENSIONS

    @staticmethod
    def _encode_file_content(path: str, content_bytes: bytes) -> tuple[str, bool]:
        is_binary = SandboxProvider._is_binary_file(path)
        if is_binary:
            content = base64.b64encode(content_bytes).decode("utf-8")
        else:
            content = content_bytes.decode("utf-8", errors="replace")
        return content, is_binary

    @staticmethod
    async def _execute_with_timeout(
        coro: Awaitable[T],
        timeout: int,
        error_msg: str | None = None,
    ) -> T:
        try:
            return await asyncio.wait_for(coro, timeout=timeout + 5)
        except asyncio.TimeoutError:
            raise TimeoutError(error_msg or f"Operation timed out after {timeout}s")

    @staticmethod
    def _parse_listening_ports(stdout: str) -> set[int]:
        return {int(p) for p in stdout.strip().splitlines() if p.isdigit()}

    @staticmethod
    def _build_preview_links(
        listening_ports: set[int],
        url_builder: Callable[[int], str],
        excluded_ports: set[int] | None = None,
    ) -> list[PreviewLink]:
        excluded = excluded_ports or set()
        return [
            PreviewLink(preview_url=url_builder(port), port=port)
            for port in listening_ports
            if port not in excluded
        ]

    def _get_pty_session(
        self, sandbox_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self._pty_sessions.get(sandbox_id, {}).get(session_id)

    def _register_pty_session(
        self, sandbox_id: str, session_id: str, session_data: dict[str, Any]
    ) -> None:
        self._pty_sessions.setdefault(sandbox_id, {})[session_id] = session_data

    def _cleanup_pty_session_tracking(self, sandbox_id: str, session_id: str) -> None:
        try:
            del self._pty_sessions[sandbox_id][session_id]
            if not self._pty_sessions[sandbox_id]:
                del self._pty_sessions[sandbox_id]
        except KeyError:
            logger.error("Error cleaning up PTY session %s", session_id)

    @staticmethod
    def _build_gitignore_patterns(
        gitignore_content: str,
    ) -> tuple[list[str], list[str]]:
        # Gitignore-like (not strict Git) negation handling: we allow
        # negations to re-include children of excluded parent directories
        # (e.g. ".claude/" + "!.claude/plans/" shows plans/), which real
        # Git does not support without first un-ignoring the parent.
        # Directory-only semantics (trailing /) are also not enforced.
        rules: list[tuple[bool, str]] = []
        for raw_line in gitignore_content.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("!"):
                neg = line[1:].strip().lstrip("/").rstrip("/")
                if neg:
                    rules.append((True, neg))
            else:
                normalized = line.lstrip("/")
                if normalized:
                    rules.append((False, normalized))

        patterns = SandboxProvider._expand_ignore_rules(rules)
        exceptions = SandboxProvider._build_negation_exceptions(rules)
        return patterns, exceptions

    @staticmethod
    def _expand_ignore_rules(rules: list[tuple[bool, str]]) -> list[str]:
        patterns: list[str] = []
        for is_neg, rule in rules:
            if is_neg:
                continue
            if rule.startswith("*."):
                patterns.append(rule)
                continue
            if rule.endswith("/"):
                folder = rule.rstrip("/")
                if not folder:
                    continue
                patterns.extend([folder, f"{folder}/*", f"*/{folder}", f"*/{folder}/*"])
                continue
            patterns.extend([rule, f"{rule}/*", f"*/{rule}", f"*/{rule}/*"])
        return list(dict.fromkeys(patterns))

    @staticmethod
    def _build_negation_exceptions(rules: list[tuple[bool, str]]) -> list[str]:
        # A negation is only active if no later ignore rule
        # re-matches the negated path (last rule wins).
        active: list[str] = []
        for idx, (is_neg, rule) in enumerate(rules):
            if not is_neg:
                continue
            neg_basename = rule.rsplit("/", 1)[-1]
            overridden = False
            for later_is_neg, later in rules[idx + 1 :]:
                if later_is_neg:
                    continue
                later_norm = later.rstrip("/")
                if (
                    fnmatch.fnmatch(rule, later_norm)
                    or fnmatch.fnmatch(neg_basename, later_norm)
                    or rule.startswith(f"{later_norm}/")
                ):
                    overridden = True
                    break
            if not overridden:
                active.append(rule)

        exceptions: list[str] = []
        for neg in active:
            if "/" in neg:
                # Path negation: include ancestors so find can descend
                # into parent dirs before reaching the negated subtree.
                parts = neg.split("/")
                for i in range(len(parts)):
                    exceptions.append("/".join(parts[: i + 1]))
                exceptions.append(f"{neg}/*")
            else:
                # Basename negation: match in any subdirectory.
                exceptions.extend([neg, f"*/{neg}", f"{neg}/*", f"*/{neg}/*"])
        return exceptions

    @staticmethod
    def _read_global_gitignore() -> str:
        # Read from the API host, not the sandbox — sandbox containers
        # don't have the user's global git config, so this is the only
        # way to pick up global excludes like ~/.gitignore_global.
        try:
            result = subprocess.run(
                ["git", "config", "--global", "core.excludesFile"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            p = result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            p = ""
        # Fall back to XDG default location when core.excludesFile is not set
        if not p:
            p = str(Path.home() / ".config" / "git" / "ignore")
        # Expand ~ and resolve relative paths against $HOME (matching git behavior)
        path = Path(p).expanduser()
        if not path.is_absolute():
            path = Path.home() / path
        try:
            return path.read_text() if path.is_file() else ""
        except (OSError, UnicodeDecodeError):
            return ""

    async def _get_gitignore_patterns(
        self, sandbox_id: str, path: str = SANDBOX_HOME_DIR
    ) -> tuple[list[str], list[str]]:
        cmd = f"cd {shlex.quote(path)} && {GITIGNORE_CMD}"
        result = await self.execute_command(
            sandbox_id,
            cmd,
            timeout=5,
        )
        parts = result.stdout or ""
        global_ignore = await asyncio.to_thread(self._read_global_gitignore)
        if global_ignore:
            parts = f"{parts}\n{global_ignore}"
        if not parts.strip():
            return [], []
        return self._build_gitignore_patterns(parts)

    @abstractmethod
    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        pass

    @abstractmethod
    async def connect_sandbox(self, sandbox_id: str) -> bool:
        pass

    @abstractmethod
    async def delete_sandbox(self, sandbox_id: str) -> None:
        pass

    @abstractmethod
    async def is_running(self, sandbox_id: str) -> bool:
        pass

    @abstractmethod
    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        pass

    @abstractmethod
    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        pass

    @abstractmethod
    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        pass

    @staticmethod
    def _find_prune_condition(p: str) -> str:
        if p.startswith("*.") or p.startswith("."):
            return f"-name {shlex.quote(p)}"
        return f"-path {shlex.quote(p)}"

    async def list_files(
        self,
        sandbox_id: str,
        path: str = SANDBOX_HOME_DIR,
        excluded_patterns: list[str] | None = None,
    ) -> list[FileMetadata]:
        caller_patterns = list(dict.fromkeys(excluded_patterns or []))
        gitignore_patterns, exceptions = await self._get_gitignore_patterns(
            sandbox_id, path
        )

        prune_parts: list[str] = []
        if caller_patterns:
            caller_expr = " -o ".join(
                self._find_prune_condition(p) for p in caller_patterns
            )
            prune_parts.append(f"\\( {caller_expr} \\)")
        if gitignore_patterns:
            gi_expr = " -o ".join(
                self._find_prune_condition(p) for p in gitignore_patterns
            )
            exception_expr = ""
            if exceptions:
                exception_parts = [
                    f"! -path {shlex.quote(f'{path}/{e}')}" for e in exceptions
                ]
                exception_expr = " " + " ".join(exception_parts)
            prune_parts.append(f"\\( {gi_expr} \\){exception_expr}")

        if prune_parts:
            combined = " -o ".join(prune_parts)
            find_command = (
                f"find {shlex.quote(path)} "
                f"\\( {combined} \\) "
                f"-prune -o -printf '%p\\t%y\\t%s\\t%T@\\n'"
            )
        else:
            find_command = f"find {shlex.quote(path)} -printf '%p\\t%y\\t%s\\t%T@\\n'"

        result = await self.execute_command(sandbox_id, find_command, timeout=30)

        metadata_items = []
        home_dir_slash = f"{SANDBOX_HOME_DIR}/"
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) < 4:
                continue

            file_path, file_type, size, mtime = parts[:4]

            if not file_path or file_path == SANDBOX_HOME_DIR:
                continue

            if file_path.startswith(home_dir_slash):
                file_path = file_path[len(home_dir_slash) :]

            modified = float(mtime) if mtime.replace(".", "").isdigit() else 0

            if file_type == "f":
                is_binary = (
                    Path(file_path).suffix.lstrip(".").lower()
                    in SANDBOX_BINARY_EXTENSIONS
                )
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="file",
                        is_binary=is_binary,
                        size=int(size) if size.isdigit() else 0,
                        modified=modified,
                    )
                )
            elif file_type == "d":
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="directory",
                        size=0,
                        modified=modified,
                    )
                )

        return metadata_items

    async def list_children(
        self,
        sandbox_id: str,
        path: str = SANDBOX_HOME_DIR,
    ) -> list[FileMetadata]:
        if path != SANDBOX_HOME_DIR and not path.startswith("/"):
            path = f"{SANDBOX_WORKSPACE_DIR}/{path}"

        gitignore_patterns, exceptions = await self._get_gitignore_patterns(
            sandbox_id, path
        )

        prune_parts: list[str] = []
        if gitignore_patterns:
            gi_expr = " -o ".join(
                self._find_prune_condition(p) for p in gitignore_patterns
            )
            exception_expr = ""
            if exceptions:
                exception_parts = [
                    f"! -path {shlex.quote(f'{path}/{e}')}" for e in exceptions
                ]
                exception_expr = " " + " ".join(exception_parts)
            prune_parts.append(f"\\( {gi_expr} \\){exception_expr}")

        if prune_parts:
            combined = " -o ".join(prune_parts)
            find_command = (
                f"find {shlex.quote(path)} -maxdepth 1 "
                f"\\( {combined} \\) "
                f"-prune -o -printf '%p\\t%y\\t%s\\t%T@\\n'"
            )
        else:
            find_command = (
                f"find {shlex.quote(path)} -maxdepth 1 -printf '%p\\t%y\\t%s\\t%T@\\n'"
            )

        result = await self.execute_command(sandbox_id, find_command, timeout=10)

        metadata_items: list[FileMetadata] = []
        home_dir_slash = f"{SANDBOX_HOME_DIR}/"
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                continue

            file_path, file_type, size, mtime = parts[:4]
            if not file_path or file_path == path:
                continue

            if file_path.startswith(home_dir_slash):
                file_path = file_path[len(home_dir_slash) :]

            modified = float(mtime) if mtime.replace(".", "").isdigit() else 0

            if file_type == "f":
                is_binary = (
                    Path(file_path).suffix.lstrip(".").lower()
                    in SANDBOX_BINARY_EXTENSIONS
                )
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="file",
                        is_binary=is_binary,
                        size=int(size) if size.isdigit() else 0,
                        modified=modified,
                    )
                )
            elif file_type == "d":
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="directory",
                        size=0,
                        modified=modified,
                        has_children=True,
                    )
                )

        return metadata_items

    @abstractmethod
    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        pass

    @abstractmethod
    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        pass

    @abstractmethod
    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        pass

    @abstractmethod
    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        pass

    @abstractmethod
    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        pass

    async def get_secrets(self, sandbox_id: str) -> list[SecretEntry]:
        result = await self.execute_command(
            sandbox_id,
            f"grep '^export' {SANDBOX_BASHRC_PATH} | sed 's/^export //g'",
            timeout=5,
        )

        env_lines = result.stdout.strip().split("\n")
        secrets = []
        for line in env_lines:
            if "=" in line:
                key, value = line.split("=", 1)
                value = value.strip('"').strip("'")

                if key not in SANDBOX_SYSTEM_VARIABLES:
                    secrets.append(SecretEntry(key=key, value=value))

        return secrets

    async def add_secret(
        self,
        sandbox_id: str,
        key: str,
        value: str,
    ) -> None:
        export_command = self.format_export_command(key, value)
        await self.execute_command(
            sandbox_id, f'echo "{export_command}" >> {SANDBOX_BASHRC_PATH}'
        )

    async def delete_secret(
        self,
        sandbox_id: str,
        key: str,
    ) -> None:
        escaped_key = key.replace(".", r"\.").replace("*", r"\*")
        await self.execute_command(
            sandbox_id, f"sed -i '/^export {escaped_key}=/d' {SANDBOX_BASHRC_PATH}"
        )

    async def cleanup(self) -> None:
        for sandbox_id in list(self._pty_sessions.keys()):
            for session_id in list(self._pty_sessions[sandbox_id].keys()):
                try:
                    await self.kill_pty(sandbox_id, session_id)
                except Exception as e:
                    logger.warning(
                        "Failed to cleanup PTY session %s for sandbox %s: %s",
                        session_id,
                        sandbox_id,
                        e,
                    )

    @abstractmethod
    async def get_ide_url(self, sandbox_id: str) -> str | None:
        pass

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        return None

    async def __aenter__(self) -> "SandboxProvider":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        _exc_val: BaseException | None,
        _exc_tb: Any,
    ) -> bool:
        await self.cleanup()
        return False
