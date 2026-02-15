import asyncio
import logging
import os
import shlex
import uuid
from typing import Any

import modal

from app.constants import (
    DOCKER_AVAILABLE_PORTS,
    EXCLUDED_PREVIEW_PORTS,
    OPENVSCODE_PORT,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    SANDBOX_DEFAULT_TIMEOUT,
    SANDBOX_HOME_DIR,
    SANDBOX_SYSTEM_VARIABLES,
    TERMINAL_TYPE,
    VNC_WEBSOCKET_PORT,
)
from app.core.config import get_settings
from app.services.exceptions import ErrorCode, SandboxException
from app.services.sandbox_providers.base import LISTENING_PORTS_COMMAND, SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    PreviewLink,
    PtyDataCallbackType,
    PtySession,
    PtySize,
)

logger = logging.getLogger(__name__)

settings = get_settings()

MODAL_APP_NAME = "claudex-sandbox"

MODAL_SYSTEM_VARIABLES = SANDBOX_SYSTEM_VARIABLES + ["MODAL_SANDBOX"]


def setup_modal_auth(api_key: str) -> None:
    if ":" in api_key:
        token_id, token_secret = api_key.split(":", 1)
        os.environ["MODAL_TOKEN_ID"] = token_id
        os.environ["MODAL_TOKEN_SECRET"] = token_secret
    else:
        os.environ["MODAL_TOKEN_ID"] = api_key


class ModalSandboxProvider(SandboxProvider):
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self._active_sandboxes: dict[str, modal.Sandbox] = {}
        self._pty_sessions: dict[str, dict[str, Any]] = {}
        self._app: modal.App | None = None
        setup_modal_auth(api_key)

    def _get_system_variables(self) -> list[str]:
        return MODAL_SYSTEM_VARIABLES

    async def _get_app(self) -> modal.App:
        if self._app is None:
            self._app = await modal.App.lookup.aio(
                MODAL_APP_NAME, create_if_missing=True
            )
        return self._app

    async def create_sandbox(self) -> str:
        try:
            app = await self._get_app()
            image = modal.Image.from_registry(settings.DOCKER_IMAGE)

            sandbox = await self._retry_operation(
                modal.Sandbox.create.aio,
                app=app,
                image=image,
                timeout=SANDBOX_DEFAULT_TIMEOUT,
                cpu=2,
                memory=4096,
                encrypted_ports=DOCKER_AVAILABLE_PORTS,
            )
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "rate limit" in error_msg.lower():
                raise SandboxException(
                    error_msg,
                    error_code=ErrorCode.RATE_LIMIT_EXCEEDED,
                    status_code=429,
                )
            if (
                "401" in error_msg
                or "403" in error_msg
                or "authentication" in error_msg.lower()
            ):
                raise SandboxException(
                    f"Modal authentication failed: {error_msg}",
                    error_code=ErrorCode.SANDBOX_CREATE_FAILED,
                    status_code=401,
                )
            raise SandboxException(
                f"Failed to create sandbox: {error_msg}",
                error_code=ErrorCode.SANDBOX_CREATE_FAILED,
            )

        sandbox_id = str(sandbox.object_id)
        self._active_sandboxes[sandbox_id] = sandbox
        return sandbox_id

    async def connect_sandbox(self, sandbox_id: str) -> bool:
        if sandbox_id in self._active_sandboxes:
            return True

        try:
            sandbox = await self._retry_operation(
                modal.Sandbox.from_id.aio,
                sandbox_id,
            )
            self._active_sandboxes[sandbox_id] = sandbox
            return True
        except Exception as e:
            logger.warning("Failed to connect to sandbox %s: %s", sandbox_id, e)
            return False

    async def delete_sandbox(self, sandbox_id: str) -> None:
        if not sandbox_id:
            return

        sandbox = self._active_sandboxes.get(sandbox_id)
        if not sandbox:
            try:
                sandbox = await modal.Sandbox.from_id.aio(sandbox_id)
            except Exception as e:
                logger.warning(
                    "Failed to connect to sandbox %s for cleanup: %s", sandbox_id, e
                )
                return

        if sandbox:
            try:
                await self._retry_operation(sandbox.terminate.aio)
            except Exception as e:
                logger.warning("Failed to terminate sandbox %s: %s", sandbox_id, e)

        if sandbox_id in self._active_sandboxes:
            del self._active_sandboxes[sandbox_id]

        logger.info("Successfully deleted sandbox %s", sandbox_id)

    async def is_running(self, sandbox_id: str) -> bool:
        sandbox = self._active_sandboxes.get(sandbox_id)
        if not sandbox:
            return False
        try:
            poll_result = sandbox.poll()
            return poll_result is None
        except Exception:
            return False

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        sandbox = await self._get_sandbox(sandbox_id)
        effective_timeout = timeout or SANDBOX_DEFAULT_COMMAND_TIMEOUT
        env_map = envs or {}

        try:
            process = await self._retry_operation(
                sandbox.exec.aio,
                "bash",
                "-c",
                command,
                timeout=None if background else effective_timeout,
                env=env_map,
            )

            if background:
                return CommandResult(
                    stdout="Background process started",
                    stderr="",
                    exit_code=0,
                )

            stdout_lines = []
            stderr_lines = []

            async for line in process.stdout:
                stdout_lines.append(line)

            async for line in process.stderr:
                stderr_lines.append(line)

            await process.wait.aio()

            return CommandResult(
                stdout="".join(stdout_lines),
                stderr="".join(stderr_lines),
                exit_code=process.returncode or 0,
            )
        except Exception as e:
            if "timeout" in str(e).lower():
                raise TimeoutError(
                    f"Command execution timed out after {effective_timeout}s"
                )
            raise

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        sandbox = await self._get_sandbox(sandbox_id)
        normalized_path = self.normalize_path(path)

        content_bytes = (
            content if isinstance(content, bytes) else content.encode("utf-8")
        )

        with sandbox.open(normalized_path, "wb") as f:
            f.write(content_bytes)

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        sandbox = await self._get_sandbox(sandbox_id)
        normalized_path = self.normalize_path(path)

        with sandbox.open(normalized_path, "rb") as f:
            content_bytes = f.read()

        content, is_binary = self._encode_file_content(path, content_bytes)

        return FileContent(
            path=path,
            content=content,
            type="file",
            is_binary=is_binary,
        )

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        sandbox = await self._get_sandbox(sandbox_id)
        session_id = str(uuid.uuid4())

        process = await self._retry_operation(
            sandbox.exec.aio,
            "bash",
            "-c",
            f"command -v tmux >/dev/null && tmux new -A -s {shlex.quote(tmux_session)} \\; set -g status off || exec bash",
            pty=True,
            env={"TERM": TERMINAL_TYPE},
        )

        self._register_pty_session(
            sandbox_id,
            session_id,
            {
                "process": process,
                "sandbox": sandbox,
                "on_data": on_data,
                "tmux_session": tmux_session,
            },
        )

        if on_data:
            asyncio.create_task(self._pty_reader(process, on_data))

        return PtySession(
            id=session_id,
            pid=None,
            rows=rows,
            cols=cols,
        )

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        try:
            process = session["process"]
            text_data = data.decode("utf-8", errors="replace")
            process.stdin.write(text_data)
            await process.stdin.drain.aio()
        except Exception as e:
            logger.error("Failed to send PTY input: %s", e)
            await self.kill_pty(sandbox_id, pty_id)

    async def _pty_reader(
        self,
        process: Any,
        on_data: PtyDataCallbackType,
    ) -> None:
        try:
            async for data in process.stdout:
                data_bytes = data.encode("utf-8") if isinstance(data, str) else data
                await on_data(data_bytes)
        except Exception as e:
            logger.error("Error reading PTY output: %s", e)

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        tmux_session = session.get("tmux_session")
        if not tmux_session:
            return

        rows = max(size.rows, 1)
        cols = max(size.cols, 1)
        try:
            sandbox = await self._get_sandbox(sandbox_id)
            resize_proc = await sandbox.exec.aio(
                "tmux",
                "resize-window",
                "-t",
                tmux_session,
                "-x",
                str(cols),
                "-y",
                str(rows),
            )
            await resize_proc.wait.aio()
        except Exception:
            pass

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        self._cleanup_pty_session_tracking(sandbox_id, pty_id)

        try:
            process = session.get("process")
            if process:
                process.stdin.write_eof()
                await process.stdin.drain.aio()
        except Exception as e:
            logger.error(
                "Error killing PTY process for session %s: %s", pty_id, e, exc_info=True
            )

    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        sandbox = await self._get_sandbox(sandbox_id)

        result = await self.execute_command(
            sandbox_id,
            LISTENING_PORTS_COMMAND,
            timeout=5,
        )
        listening_ports = self._parse_listening_ports(result.stdout)

        try:
            tunnels = sandbox.tunnels()
            preview_links = []
            for port, tunnel in tunnels.items():
                if port in listening_ports and port not in EXCLUDED_PREVIEW_PORTS:
                    preview_links.append(
                        PreviewLink(
                            preview_url=tunnel.url,
                            port=port,
                        )
                    )
            return preview_links
        except Exception as e:
            logger.warning("Failed to get tunnels for sandbox %s: %s", sandbox_id, e)
            return self._build_preview_links(
                listening_ports=listening_ports,
                url_builder=lambda port: f"https://{sandbox_id}-{port}.modal.run",
                excluded_ports=EXCLUDED_PREVIEW_PORTS,
            )

    async def get_ide_url(self, sandbox_id: str) -> str | None:
        sandbox = await self._get_sandbox(sandbox_id)

        try:
            tunnels = sandbox.tunnels()
            if OPENVSCODE_PORT in tunnels:
                return f"{tunnels[OPENVSCODE_PORT].url}/?folder={SANDBOX_HOME_DIR}"
        except Exception as e:
            logger.warning("Failed to get IDE URL for sandbox %s: %s", sandbox_id, e)

        return None

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        sandbox = await self._get_sandbox(sandbox_id)

        try:
            tunnels = sandbox.tunnels()
            if VNC_WEBSOCKET_PORT in tunnels:
                url: str = tunnels[VNC_WEBSOCKET_PORT].url.replace("https://", "wss://")
                return url
        except Exception as e:
            logger.warning("Failed to get VNC URL for sandbox %s: %s", sandbox_id, e)

        return None

    async def _get_sandbox(self, sandbox_id: str) -> modal.Sandbox:
        if sandbox_id in self._active_sandboxes:
            return self._active_sandboxes[sandbox_id]

        sandbox = await self._retry_operation(
            modal.Sandbox.from_id.aio,
            sandbox_id,
        )
        self._active_sandboxes[sandbox_id] = sandbox
        return sandbox
