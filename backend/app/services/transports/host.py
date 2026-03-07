import asyncio
import logging
import os
import pwd
import shlex
from contextlib import suppress
from functools import partial
from pathlib import Path

from claude_agent_sdk._errors import CLIConnectionError, ProcessError
from claude_agent_sdk.types import ClaudeAgentOptions

from app.constants import (
    HOST_REQUIRED_PATH_PREFIX,
    SANDBOX_HOME_DIR,
    SANDBOX_WORKSPACE_DIR,
)
from app.core.config import get_settings
from app.services.transports.base import BaseSandboxTransport

logger = logging.getLogger(__name__)
settings = get_settings()


class HostSandboxTransport(BaseSandboxTransport):
    def __init__(
        self,
        *,
        sandbox_id: str,
        workspace_path: str | None,
        options: ClaudeAgentOptions,
    ) -> None:
        super().__init__(sandbox_id=sandbox_id, options=options)
        self._process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._home_dir = (
            Path(settings.get_host_sandbox_base_dir()).expanduser().resolve()
            / sandbox_id
        )
        if workspace_path:
            self._workspace_dir = Path(workspace_path).expanduser().resolve()
        else:
            self._workspace_dir = self._home_dir

    def _resolve_virtual_env_paths(self, envs: dict[str, str]) -> dict[str, str]:
        return {
            key: str(self._resolve_cwd(value))
            if value.startswith(SANDBOX_HOME_DIR)
            else value
            for key, value in envs.items()
        }

    def _resolve_cwd(self, cwd: str) -> Path:
        if cwd == SANDBOX_HOME_DIR:
            return self._home_dir
        if cwd == SANDBOX_WORKSPACE_DIR:
            return self._workspace_dir

        workspace_prefix = f"{SANDBOX_WORKSPACE_DIR}/"
        if cwd.startswith(workspace_prefix):
            return (self._workspace_dir / cwd.removeprefix(workspace_prefix)).resolve()

        relative = cwd.removeprefix(f"{SANDBOX_HOME_DIR}/")
        if relative != cwd:
            return (self._home_dir / relative).resolve()

        path = Path(cwd)
        if path.is_absolute():
            return path
        return (self._workspace_dir / path).resolve()

    def _resolve_run_user(self, requested_user: str) -> tuple[int, int] | None:
        if os.geteuid() != 0:
            return None

        for candidate in [requested_user, "appuser", "nobody"]:
            try:
                user_info = pwd.getpwnam(candidate)
                return user_info.pw_uid, user_info.pw_gid
            except KeyError:
                continue
        return None

    @staticmethod
    def _set_process_ids(uid: int, gid: int) -> None:
        os.setgid(gid)
        os.setuid(uid)

    async def connect(self) -> None:
        if self._ready:
            return
        self._stdin_closed = False

        if not self._workspace_dir.exists():
            raise CLIConnectionError(
                f"Host sandbox {self._sandbox_id} not found at {self._workspace_dir}"
            )

        command_args = shlex.split(self._build_command())
        envs, cwd, requested_user = self._prepare_environment()
        envs = self._resolve_virtual_env_paths(envs)
        current_path = os.environ.get("PATH", "")
        env = {
            **os.environ,
            **envs,
            "PATH": f"{HOST_REQUIRED_PATH_PREFIX}:{current_path}",
        }
        # Web mode: override HOME so tools (Codex, Gmail MCP) find auth files in the sandbox dir.
        # Desktop mode: keep real HOME so Claude Code finds its existing login credentials.
        if not settings.DESKTOP_MODE:
            env["HOME"] = str(self._home_dir)
        env["GIT_CONFIG_GLOBAL"] = settings.GIT_CONFIG_GLOBAL
        env["GNUPGHOME"] = settings.GNUPGHOME
        run_user = self._resolve_run_user(requested_user)

        try:
            self._process = await asyncio.create_subprocess_exec(
                *command_args,
                cwd=str(self._resolve_cwd(cwd)),
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=(
                    partial(self._set_process_ids, *run_user) if run_user else None
                ),
            )
        except Exception as exc:
            raise CLIConnectionError(f"Failed to start Claude CLI: {exc}") from exc

        loop = asyncio.get_running_loop()
        self._stdout_task = loop.create_task(self._read_stdout())
        self._stderr_task = loop.create_task(self._read_stderr())
        self._monitor_task = loop.create_task(self._monitor_process())
        self._ready = True

    def _is_connection_ready(self) -> bool:
        return self._process is not None and self._process.stdin is not None

    async def _cleanup_resources(self) -> None:
        await self._cancel_task(self._stdout_task)
        await self._cancel_task(self._stderr_task)
        self._stdout_task = None
        self._stderr_task = None

        if self._process and self._process.returncode is None:
            self._process.terminate()
            with suppress(Exception):
                await asyncio.wait_for(self._process.wait(), timeout=2)
            if self._process.returncode is None:
                with suppress(Exception):
                    self._process.kill()
                    await self._process.wait()
        self._process = None

    async def _send_data(self, data: str) -> None:
        if not self._process or not self._process.stdin:
            raise CLIConnectionError("Host transport process stdin unavailable")
        self._process.stdin.write(data.encode("utf-8"))
        await self._process.stdin.drain()

    async def _send_eof(self) -> None:
        if not self._process or not self._process.stdin:
            return
        self._process.stdin.write_eof()
        await self._process.stdin.drain()

    async def _read_stdout(self) -> None:
        if not self._process or not self._process.stdout:
            return
        try:
            while True:
                chunk = await self._process.stdout.read(4096)
                if not chunk:
                    break
                await self._stdout_queue.put(chunk.decode("utf-8", errors="replace"))
        except asyncio.CancelledError:
            pass
        finally:
            await self._put_sentinel()

    async def _read_stderr(self) -> None:
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                chunk = await self._process.stderr.read(4096)
                if not chunk:
                    break
                if self._options.stderr:
                    try:
                        self._options.stderr(chunk.decode("utf-8", errors="replace"))
                    except Exception:
                        pass
        except asyncio.CancelledError:
            pass

    async def _monitor_process(self) -> None:
        if not self._process:
            return
        try:
            exit_code = await self._process.wait()
            if exit_code != 0:
                self._exit_error = ProcessError(
                    "Claude CLI exited with an error",
                    exit_code=exit_code,
                    stderr="",
                )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self._exit_error = CLIConnectionError(
                f"Claude CLI stopped unexpectedly: {exc}"
            )
        finally:
            self._ready = False
            await self._put_sentinel()
