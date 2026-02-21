import asyncio
import logging
import shlex
from dataclasses import dataclass
from functools import partial
from typing import Any, Callable

from fastapi import WebSocket

from app.constants import PTY_INPUT_QUEUE_SIZE
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.utils.queue import drain_queue, put_with_overflow

logger = logging.getLogger(__name__)


def build_terminal_session_key(user_id: str, sandbox_id: str, terminal_id: str) -> str:
    return f"{user_id}:{sandbox_id}:{terminal_id}"


@dataclass
class TerminalSessionRecord:
    user_id: str
    sandbox_id: str
    terminal_id: str
    sandbox_service: SandboxService
    on_close: Callable[[], Any]
    pty_id: str | None = None
    size: dict[str, int] | None = None
    output_task: asyncio.Task[None] | None = None
    input_task: asyncio.Task[None] | None = None
    input_queue: asyncio.Queue[bytes] | None = None
    active_websocket: WebSocket | None = None

    async def ensure_started(self, rows: int, cols: int) -> dict[str, int]:
        if self.pty_id is None:
            tmux_session = self._get_tmux_session_name()
            pty_session = await self.sandbox_service.create_pty_session(
                self.sandbox_id, rows, cols, tmux_session
            )
            self.pty_id = pty_session["id"]
            self.size = {"rows": pty_session["rows"], "cols": pty_session["cols"]}
            self.input_queue = asyncio.Queue(maxsize=PTY_INPUT_QUEUE_SIZE)
            self.input_task = asyncio.create_task(self._input_worker(self.pty_id))
            self.input_task.add_done_callback(self._handle_input_task_done)
            return self.size

        if self.size and (self.size["rows"] != rows or self.size["cols"] != cols):
            await self.resize(rows, cols)
        return self.size or {"rows": rows, "cols": cols}

    def enqueue_input(self, data: Any) -> None:
        if not self.input_queue or not isinstance(data, (bytes, bytearray)):
            return
        put_with_overflow(self.input_queue, bytes(data))

    async def resize(self, rows: int, cols: int) -> None:
        if not self.pty_id:
            return
        await self.sandbox_service.resize_pty_session(
            self.sandbox_id,
            self.pty_id,
            rows,
            cols,
        )
        self.size = {"rows": rows, "cols": cols}

    async def attach(self, websocket: WebSocket) -> None:
        if self.active_websocket and self.active_websocket is not websocket:
            try:
                await self.active_websocket.close()
            except Exception:
                pass

        self.active_websocket = websocket

        if not self.pty_id:
            return

        if self.output_task:
            self.output_task.cancel()

        self.output_task = asyncio.create_task(
            self.sandbox_service.forward_pty_output(
                self.sandbox_id, self.pty_id, websocket
            )
        )

    async def detach(self) -> None:
        if self.output_task:
            self.output_task.cancel()
            self.output_task = None

        self.active_websocket = None
        await self.close()

    async def close(self) -> None:
        if self.output_task:
            self.output_task.cancel()
            self.output_task = None

        if self.input_task:
            self.input_task.cancel()
            try:
                await self.input_task
            except asyncio.CancelledError:
                pass
            self.input_task = None

        self.input_queue = None

        if self.pty_id:
            await self.sandbox_service.cleanup_pty_session(self.sandbox_id, self.pty_id)
            self.pty_id = None

        await self.sandbox_service.cleanup()

        self.on_close()

    async def kill_tmux_session(self) -> None:
        session_name = self._get_tmux_session_name()
        try:
            await self.sandbox_service.execute_command(
                self.sandbox_id, f"tmux kill-session -t {shlex.quote(session_name)}"
            )
        except Exception:
            pass

    def _get_tmux_session_name(self) -> str:
        safe_terminal = "".join(
            char if char.isalnum() or char in ("-", "_") else "_"
            for char in self.terminal_id
        )
        return f"claudex_{safe_terminal}"

    async def _input_worker(self, session_id: str) -> None:
        if self.input_queue is None:
            return

        try:
            while True:
                buffer = await drain_queue(self.input_queue)
                payload = b"".join(buffer)
                await self.sandbox_service.send_pty_input(
                    self.sandbox_id, session_id, payload
                )
        except asyncio.CancelledError:
            raise

    @staticmethod
    def _handle_input_task_done(task: asyncio.Task[None]) -> None:
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Error in input task: %s", exc)


class TerminalSessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSessionRecord] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(
        self,
        *,
        user_id: str,
        sandbox_id: str,
        terminal_id: str,
        provider_type: SandboxProviderType,
        api_key: str | None,
    ) -> TerminalSessionRecord:
        key = build_terminal_session_key(user_id, sandbox_id, terminal_id)
        async with self._lock:
            existing = self._sessions.get(key)
            if existing:
                return existing

            provider = SandboxProviderFactory.create(provider_type, api_key)
            service = SandboxService(provider)

            record = TerminalSessionRecord(
                user_id=user_id,
                sandbox_id=sandbox_id,
                terminal_id=terminal_id,
                sandbox_service=service,
                on_close=partial(self._remove, key),
            )
            self._sessions[key] = record
            return record

    def _remove(self, key: str) -> None:
        self._sessions.pop(key, None)


terminal_session_registry = TerminalSessionRegistry()
