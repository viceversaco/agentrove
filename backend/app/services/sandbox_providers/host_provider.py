import asyncio
import contextlib
import fcntl
import fnmatch
import logging
import os
import pty
import re
import shlex
import shutil
import signal
import subprocess
import sys
import termios
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.constants import (
    CHECKPOINT_BASE_DIR,
    EXCLUDED_PREVIEW_PORTS,
    OPENVSCODE_PORT,
    SANDBOX_BASHRC_PATH,
    SANDBOX_BINARY_EXTENSIONS,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    SANDBOX_EXCLUDED_PATHS,
    SANDBOX_HOME_DIR,
    TERMINAL_TYPE,
    VNC_WEBSOCKET_PORT,
)
from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.types import (
    CheckpointInfo,
    CommandResult,
    FileContent,
    FileMetadata,
    PreviewLink,
    PtyDataCallbackType,
    PtySession,
    PtySize,
)

logger = logging.getLogger(__name__)

CHECKPOINT_RELATIVE_DIR = Path(CHECKPOINT_BASE_DIR).relative_to(SANDBOX_HOME_DIR)

VIRTUAL_PATH_PATTERN = re.compile(
    rf"(?:(?<=^)|(?<=[\s\"'=(])){re.escape(SANDBOX_HOME_DIR)}(?=(?:/|$|[\s\"')]))"
)

LISTENING_PORTS_COMMAND = (
    (
        "lsof -iTCP -sTCP:LISTEN -nP"
        " | awk 'NR>1 {split($9,a,\":\"); print a[length(a)]}'"
        " | grep -E '^[0-9]+$' | sort -u"
    )
    if sys.platform == "darwin"
    else (
        "ss -tuln | grep LISTEN | awk '{print $5}' | sed 's/.*://g'"
        " | grep -E '^[0-9]+$' | sort -u"
    )
)
HOST_REQUIRED_PATH_PREFIX = f"{Path.home()}/.local/bin:/opt/homebrew/bin:/usr/local/bin"


class LocalHostProvider(SandboxProvider):
    def __init__(
        self, base_dir: str, preview_base_url: str = "http://localhost"
    ) -> None:
        self._base_dir = Path(base_dir).expanduser().resolve()
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._preview_base_url = preview_base_url.rstrip("/")
        self._sandboxes: dict[str, Path] = {}
        self._pty_sessions: dict[str, dict[str, Any]] = {}

    def bind_workspace(self, sandbox_id: str, workspace_path: str) -> None:
        self._sandboxes[sandbox_id] = Path(workspace_path).expanduser().resolve()

    def _resolve_sandbox_dir(self, sandbox_id: str) -> Path:
        sandbox_dir = self._sandboxes.get(sandbox_id)
        if sandbox_dir:
            return sandbox_dir

        candidate = (self._base_dir / sandbox_id).resolve()
        if candidate.exists() and candidate.is_dir():
            self._sandboxes[sandbox_id] = candidate
            return candidate

        raise SandboxException(f"Host sandbox {sandbox_id} not found")

    def _resolve_path(self, sandbox_id: str, path: str) -> Path:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        requested = Path(path)

        if requested.is_absolute():
            requested_str = str(requested)
            if requested_str == SANDBOX_HOME_DIR:
                resolved = sandbox_dir
            else:
                home_prefix = f"{SANDBOX_HOME_DIR}/"
                if not requested_str.startswith(home_prefix):
                    raise SandboxException(f"Path must be inside sandbox root: {path}")
                relative = requested_str[len(home_prefix) :]
                resolved = (sandbox_dir / relative).resolve()
        else:
            resolved = (sandbox_dir / requested).resolve()

        try:
            resolved.relative_to(sandbox_dir)
        except ValueError as exc:
            raise SandboxException(f"Path escapes sandbox root: {path}") from exc

        return resolved

    def _map_virtual_paths(self, sandbox_id: str, command: str) -> str:
        sandbox_dir = str(self._resolve_sandbox_dir(sandbox_id))
        return VIRTUAL_PATH_PATTERN.sub(sandbox_dir, command)

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        sandbox_id = str(uuid.uuid4())[:12]
        if workspace_path:
            self._sandboxes[sandbox_id] = Path(workspace_path).expanduser().resolve()
            return sandbox_id

        sandbox_dir = (self._base_dir / sandbox_id).resolve()
        sandbox_dir.mkdir(parents=True, exist_ok=True)
        bashrc_content = f'export PS1="user@{sandbox_id}:\\w$ "\n'
        (sandbox_dir / ".bashrc").write_text(bashrc_content)
        (sandbox_dir / ".bash_profile").write_text(
            "[ -f ~/.bashrc ] && source ~/.bashrc\n"
        )
        self._sandboxes[sandbox_id] = sandbox_dir
        return sandbox_id

    async def connect_sandbox(self, sandbox_id: str) -> bool:
        try:
            self._resolve_sandbox_dir(sandbox_id)
            return True
        except SandboxException:
            return False

    async def delete_sandbox(self, sandbox_id: str) -> None:
        for pty_id in list(self._pty_sessions.get(sandbox_id, {}).keys()):
            try:
                await self.kill_pty(sandbox_id, pty_id)
            except Exception:
                pass

        sandbox_dir = self._sandboxes.pop(sandbox_id, None)
        if not sandbox_dir:
            candidate = (self._base_dir / sandbox_id).resolve()
            if candidate.exists() and candidate.is_dir():
                sandbox_dir = candidate

        if sandbox_dir and sandbox_dir.is_relative_to(self._base_dir):
            await asyncio.to_thread(shutil.rmtree, sandbox_dir, ignore_errors=True)

    async def is_running(self, sandbox_id: str) -> bool:
        try:
            return self._resolve_sandbox_dir(sandbox_id).exists()
        except SandboxException:
            return False

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        command_to_run = self._map_virtual_paths(sandbox_id, command)
        command_with_path = (
            f"export PATH={HOST_REQUIRED_PATH_PREFIX}:$PATH; {command_to_run}"
        )
        process_env = os.environ.copy()
        if envs:
            process_env.update(envs)
        process_env["HOME"] = str(sandbox_dir)
        process_env["USER"] = "user"
        process_env["HOSTNAME"] = sandbox_id
        process_env["TERM"] = process_env.get("TERM", TERMINAL_TYPE)

        if background:
            await asyncio.to_thread(
                subprocess.Popen,
                ["bash", "-lc", command_with_path],
                cwd=str(sandbox_dir),
                env=process_env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return CommandResult(
                stdout="Background process started",
                stderr="",
                exit_code=0,
            )

        effective_timeout = timeout or SANDBOX_DEFAULT_COMMAND_TIMEOUT
        process = await asyncio.create_subprocess_exec(
            "bash",
            "-lc",
            command_with_path,
            cwd=str(sandbox_dir),
            env=process_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=effective_timeout + 5
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise TimeoutError(
                f"Command execution timed out after {effective_timeout}s"
            )

        sandbox_dir_str = str(sandbox_dir)
        stdout_str = stdout.decode("utf-8", errors="replace").replace(
            sandbox_dir_str, SANDBOX_HOME_DIR
        )
        stderr_str = stderr.decode("utf-8", errors="replace").replace(
            sandbox_dir_str, SANDBOX_HOME_DIR
        )

        return CommandResult(
            stdout=stdout_str,
            stderr=stderr_str,
            exit_code=process.returncode or 0,
        )

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        resolved = self._resolve_path(sandbox_id, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        payload = content.encode("utf-8") if isinstance(content, str) else content
        await asyncio.to_thread(resolved.write_bytes, payload)

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        resolved = self._resolve_path(sandbox_id, path)
        if not resolved.exists() or not resolved.is_file():
            raise SandboxException(f"File not found: {path}")

        content_bytes = await asyncio.to_thread(resolved.read_bytes)
        content, is_binary = self._encode_file_content(path, content_bytes)
        return FileContent(path=path, content=content, type="file", is_binary=is_binary)

    @staticmethod
    def _walk_files(sandbox_dir: Path, patterns: list[str]) -> list[FileMetadata]:
        items: list[FileMetadata] = []
        for entry in sandbox_dir.rglob("*"):
            rel = str(entry.relative_to(sandbox_dir))
            full = f"{SANDBOX_HOME_DIR}/{rel}"
            if any(
                fnmatch.fnmatch(full, p)
                or fnmatch.fnmatch(rel, p)
                or fnmatch.fnmatch(entry.name, p)
                for p in patterns
            ):
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            if entry.is_file():
                ext = entry.suffix.lstrip(".").lower()
                is_binary = ext in SANDBOX_BINARY_EXTENSIONS
                items.append(
                    FileMetadata(
                        path=rel,
                        type="file",
                        is_binary=is_binary,
                        size=stat.st_size,
                        modified=stat.st_mtime,
                    )
                )
            elif entry.is_dir():
                items.append(
                    FileMetadata(
                        path=rel,
                        type="directory",
                        size=0,
                        modified=stat.st_mtime,
                    )
                )
        return items

    async def list_files(
        self,
        sandbox_id: str,
        path: str = SANDBOX_HOME_DIR,
        excluded_patterns: list[str] | None = None,
    ) -> list[FileMetadata]:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        patterns = excluded_patterns or SANDBOX_EXCLUDED_PATHS
        return await asyncio.to_thread(self._walk_files, sandbox_dir, patterns)

    @staticmethod
    def _resize_fd(fd: int, rows: int, cols: int) -> None:
        size = rows.to_bytes(2, "little") + cols.to_bytes(2, "little") + b"\x00" * 4
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        session_id = str(uuid.uuid4())
        master_fd, slave_fd = pty.openpty()
        self._resize_fd(slave_fd, rows, cols)

        env = os.environ.copy()
        env["HOME"] = str(sandbox_dir)
        env["USER"] = "user"
        env["HOSTNAME"] = sandbox_id
        env["TERM"] = TERMINAL_TYPE

        cmd = (
            f"export PATH={HOST_REQUIRED_PATH_PREFIX}:$PATH; "
            "command -v tmux >/dev/null && "
            f"tmux new -A -s {shlex.quote(tmux_session)} \\; set -g status off || exec bash"
        )
        process = await asyncio.to_thread(
            subprocess.Popen,
            ["bash", "-lc", cmd],
            cwd=str(sandbox_dir),
            env=env,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave_fd)

        self._register_pty_session(
            sandbox_id,
            session_id,
            {
                "process": process,
                "master_fd": master_fd,
                "reader_task": None,
                "on_data": on_data,
            },
        )

        if on_data:
            reader_task = asyncio.create_task(
                self._pty_reader(sandbox_id, session_id, master_fd, on_data)
            )
            self._pty_sessions[sandbox_id][session_id]["reader_task"] = reader_task

        return PtySession(id=session_id, pid=process.pid, rows=rows, cols=cols)

    async def _pty_reader(
        self,
        sandbox_id: str,
        session_id: str,
        master_fd: int,
        on_data: PtyDataCallbackType,
    ) -> None:
        try:
            while True:
                chunk = await asyncio.to_thread(os.read, master_fd, 4096)
                if not chunk:
                    break
                await on_data(chunk)
        except asyncio.CancelledError:
            pass
        except OSError as e:
            logger.error("PTY reader error for session %s: %s", session_id, e)

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return
        master_fd = session.get("master_fd")
        if master_fd is None:
            return
        await asyncio.to_thread(os.write, master_fd, data)

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return
        master_fd = session.get("master_fd")
        process = session.get("process")
        if master_fd is None:
            return
        await asyncio.to_thread(self._resize_fd, master_fd, size.rows, size.cols)
        if process and process.pid:
            with contextlib.suppress(ProcessLookupError):
                os.kill(process.pid, signal.SIGWINCH)

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        reader_task = session.get("reader_task")
        if reader_task:
            reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reader_task

        process = session.get("process")
        if process and process.poll() is None:
            process.terminate()
            with contextlib.suppress(Exception):
                await asyncio.to_thread(process.wait, 2)
            if process.poll() is None:
                with contextlib.suppress(Exception):
                    process.kill()

        master_fd = session.get("master_fd")
        if master_fd is not None:
            with contextlib.suppress(OSError):
                os.close(master_fd)

        self._cleanup_pty_session_tracking(sandbox_id, pty_id)

    @staticmethod
    def _scan_checkpoints(
        checkpoint_base: Path,
    ) -> list[CheckpointInfo]:
        if not checkpoint_base.is_dir():
            return []
        items: list[CheckpointInfo] = []
        for entry in checkpoint_base.iterdir():
            if not entry.is_dir():
                continue
            ts = int(entry.stat().st_mtime)
            created = datetime.fromtimestamp(ts).isoformat()
            items.append(
                CheckpointInfo(
                    message_id=entry.name,
                    created_at=created,
                )
            )
        items.sort(key=lambda x: x.created_at, reverse=True)
        return items

    async def list_checkpoints(self, sandbox_id: str) -> list[CheckpointInfo]:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        checkpoint_base = sandbox_dir / CHECKPOINT_RELATIVE_DIR
        return await asyncio.to_thread(self._scan_checkpoints, checkpoint_base)

    async def delete_secret(
        self,
        sandbox_id: str,
        key: str,
    ) -> None:
        bashrc = self._resolve_path(sandbox_id, SANDBOX_BASHRC_PATH)
        lines = await asyncio.to_thread(bashrc.read_text)
        prefix = f"export {key}="
        filtered = [
            line
            for line in lines.splitlines(keepends=True)
            if not line.startswith(prefix)
        ]
        await asyncio.to_thread(bashrc.write_text, "".join(filtered))

    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        result = await self.execute_command(
            sandbox_id, LISTENING_PORTS_COMMAND, timeout=5
        )
        listening_ports = self._parse_listening_ports(result.stdout)
        return self._build_preview_links(
            listening_ports=listening_ports,
            url_builder=lambda port: f"{self._preview_base_url}:{port}",
            excluded_ports=EXCLUDED_PREVIEW_PORTS,
        )

    async def get_ide_url(self, sandbox_id: str) -> str | None:
        sandbox_dir = self._resolve_sandbox_dir(sandbox_id)
        folder = quote(str(sandbox_dir), safe="/")
        return f"{self._preview_base_url}:{OPENVSCODE_PORT}/?folder={folder}"

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        self._resolve_sandbox_dir(sandbox_id)
        base_url = self._preview_base_url.replace("http://", "ws://", 1).replace(
            "https://", "wss://", 1
        )
        return f"{base_url}:{VNC_WEBSOCKET_PORT}"

    async def cleanup(self) -> None:
        await super().cleanup()
        self._sandboxes.clear()
