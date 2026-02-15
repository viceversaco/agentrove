import asyncio
import contextlib
import logging
import os
import pwd
import shlex
from functools import partial
from pathlib import Path
from typing import Any

from claude_agent_sdk._errors import CLIConnectionError, ProcessError
from claude_agent_sdk.types import ClaudeAgentOptions

from app.constants import SANDBOX_HOME_DIR, TERMINAL_TYPE
from app.core.config import get_settings
from app.services.transports.base import BaseSandboxTransport

logger = logging.getLogger(__name__)
settings = get_settings()


class HostSandboxTransport(BaseSandboxTransport):
    def __init__(
        self,
        *,
        sandbox_id: str,
        options: ClaudeAgentOptions,
    ) -> None:
        super().__init__(sandbox_id=sandbox_id, options=options)
        self._process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        host_base_dir = settings.get_host_sandbox_base_dir()
        self._sandbox_dir = Path(host_base_dir).expanduser().resolve() / sandbox_id

    def _get_logger(self) -> Any:
        return logger

    def _resolve_cwd(self, cwd: str) -> Path:
        sandbox_dir = self._sandbox_dir
        if cwd == SANDBOX_HOME_DIR:
            return sandbox_dir

        home_prefix = f"{SANDBOX_HOME_DIR}/"
        if cwd.startswith(home_prefix):
            return (sandbox_dir / cwd[len(home_prefix) :]).resolve()

        path = Path(cwd)
        if path.is_absolute():
            return path
        return (sandbox_dir / path).resolve()

    def _resolve_run_user(self, requested_user: str) -> tuple[int, int] | None:
        if os.geteuid() != 0:
            return None

        candidates = [requested_user, "appuser", "nobody"]
        seen: set[str] = set()
        for candidate in candidates:
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            try:
                user_info = pwd.getpwnam(candidate)
                return user_info.pw_uid, user_info.pw_gid
            except KeyError:
                continue
        return None

    @staticmethod
    def _preexec_drop_privileges(uid: int, gid: int) -> Any:
        return partial(HostSandboxTransport._set_process_ids, uid, gid)

    @staticmethod
    def _set_process_ids(uid: int, gid: int) -> None:
        os.setgid(gid)
        os.setuid(uid)

    async def connect(self) -> None:
        if self._ready:
            return
        self._stdin_closed = False

        if not self._sandbox_dir.exists():
            raise CLIConnectionError(
                f"Host sandbox {self._sandbox_id} not found at {self._sandbox_dir}"
            )

        command_line = self._build_command()
        command_args = shlex.split(command_line)
        envs, cwd, requested_user = self._prepare_environment()
        env = os.environ.copy()
        env.update(envs)
        env["HOME"] = str(self._sandbox_dir)
        env["USER"] = requested_user or env.get("USER", "user")
        env["TERM"] = TERMINAL_TYPE
        resolved_cwd = self._resolve_cwd(cwd)
        run_user = self._resolve_run_user(requested_user)

        try:
            self._process = await asyncio.create_subprocess_exec(
                *command_args,
                cwd=str(resolved_cwd),
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=(
                    self._preexec_drop_privileges(run_user[0], run_user[1])
                    if run_user
                    else None
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
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._process.wait(), timeout=2)
            if self._process.returncode is None:
                with contextlib.suppress(Exception):
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
                text = chunk.decode("utf-8", errors="replace")
                if self._options.stderr:
                    try:
                        self._options.stderr(text)
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
