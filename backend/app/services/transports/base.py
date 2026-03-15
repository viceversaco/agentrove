import asyncio
import json
import logging
import re
import shlex
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import asdict
from types import TracebackType
from typing import Any, Self

from claude_agent_sdk._errors import CLIConnectionError, CLIJSONDecodeError
from claude_agent_sdk._internal.transport import Transport
from claude_agent_sdk._version import __version__ as sdk_version
from claude_agent_sdk.types import ClaudeAgentOptions

from app.constants import TERMINAL_TYPE

logger = logging.getLogger(__name__)

# Safety cap on the JSON accumulation buffer — if the CLI emits a single
# un-terminated JSON value larger than this, we abort rather than OOM.
DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024 * 10  # 10MB

# Bounds the in-memory queue between the stdout reader task and the JSON
# parser; back-pressure stalls the reader when the parser falls behind.
STDOUT_QUEUE_MAXSIZE = 32

# Claude CLI output may contain ANSI escape sequences (colors, cursor moves)
# that must be stripped before JSON parsing.
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


class BaseSandboxTransport(Transport, ABC):
    _SENTINEL = object()
    _json_decoder = json.JSONDecoder()

    def __init__(
        self,
        *,
        sandbox_id: str,
        options: ClaudeAgentOptions,
    ) -> None:
        self._sandbox_id = sandbox_id
        self._options = options
        self._max_buffer_size = (
            DEFAULT_MAX_BUFFER_SIZE
            if options.max_buffer_size is None
            else options.max_buffer_size
        )
        self._monitor_task: asyncio.Task[None] | None = None
        self._stdout_queue: asyncio.Queue[str | object] = asyncio.Queue(
            maxsize=STDOUT_QUEUE_MAXSIZE
        )
        self._ready = False
        self._exit_error: Exception | None = None
        self._stdin_closed = False

    async def __aenter__(self) -> Self:
        # Connection is lazy — callers must explicitly call connect() after
        # entering the context manager, so __aenter__ just returns self.
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        _exc_val: BaseException | None,
        _exc_tb: TracebackType | None,
    ) -> bool:
        # Always attempts cleanup; if close() fails and there was no original
        # exception we re-raise the cleanup error, otherwise we log it and let
        # the original exception propagate to avoid masking it.
        try:
            await self.close()
        except Exception as cleanup_error:
            logger.error(
                f"Error during {self.__class__.__name__} cleanup: {cleanup_error}",
                exc_info=True,
            )
            if exc_type is None:
                raise
        return False

    def _prepare_environment(self) -> tuple[dict[str, str], str, str]:
        # Build the env/cwd/user triple used by both Docker exec and host
        # subprocess. User-provided env vars are merged last so they can
        # override any of the built-in defaults.
        envs = {
            "CLAUDE_CODE_ENTRYPOINT": "sdk-py",
            "CLAUDE_AGENT_SDK_VERSION": sdk_version,
            "CLAUDE_CODE_SANDBOX": "1",
            "PYTHONUNBUFFERED": "1",
            "TERM": TERMINAL_TYPE,
            **(self._options.env or {}),
        }
        # Enable fine-grained tool streaming when partial messages are requested.
        # --include-partial-messages emits stream_event messages, but tool input
        # parameters are still buffered unless eager_input_streaming is also
        # enabled at the per-tool level via this env var.
        if self._options.include_partial_messages:
            envs.setdefault("CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING", "1")
        return (
            envs,
            str(self._options.cwd or "/home/user"),
            self._options.user or "user",
        )

    async def _cancel_task(self, task: asyncio.Task[Any] | None) -> None:
        # Cancel and await the task so it finishes before we continue teardown.
        # Awaiting is required to avoid "task destroyed but pending" warnings;
        # CancelledError is suppressed because the cancellation is intentional.
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    def _put_sentinel(self) -> None:
        # Signal the JSON parser (_parse_cli_output) that no more data is
        # coming so it exits its queue-read loop. Uses put_nowait because this
        # runs in cleanup paths where blocking would delay teardown; if the
        # queue is full the sentinel is dropped, but the reader tasks also push
        # their own sentinel when the stream ends, so the parser still unblocks.
        try:
            self._stdout_queue.put_nowait(self._SENTINEL)
        except asyncio.QueueFull:
            pass

    @abstractmethod
    async def connect(self) -> None:
        # Establish the underlying connection (Docker exec or local subprocess)
        # and start the background reader/monitor tasks.
        pass

    @abstractmethod
    async def _cleanup_resources(self) -> None:
        # Tear down transport-specific resources (kill processes, close streams).
        # Called by close() after the monitor task has already been cancelled.
        pass

    @abstractmethod
    def _is_connection_ready(self) -> bool:
        # Quick liveness check used by write() and end_input() to guard against
        # sending data after the underlying stream/process has disappeared.
        pass

    @abstractmethod
    async def _send_data(self, data: str) -> None:
        # Write raw string data to the CLI process's stdin. Raises
        # CLIConnectionError if the underlying transport is unavailable.
        pass

    @abstractmethod
    async def _send_eof(self) -> None:
        # Close the stdin side of the connection to signal the CLI that no more
        # input is coming, allowing it to finalize and exit.
        pass

    async def close(self) -> None:
        # Ordered teardown: send EOF, mark closed, stop monitor, release
        # transport resources, reset state for potential reconnection, then
        # unblock the parser. Monitor must stop before resource cleanup to
        # avoid inspecting already-killed processes.
        if self._ready:
            await self.end_input()
        self._ready = False
        await self._cancel_task(self._monitor_task)
        self._monitor_task = None
        await self._cleanup_resources()
        self._stdin_closed = False
        self._put_sentinel()

    async def write(self, data: str) -> None:
        # Send data to the CLI's stdin. Non-CLIConnectionError failures are
        # wrapped and stored in _exit_error so the parser can surface them
        # after the stream ends, in addition to raising immediately here.
        if not self._ready or not self._is_connection_ready():
            raise CLIConnectionError("Transport is not ready for writing")
        if self._stdin_closed:
            raise CLIConnectionError("Cannot write after input has been closed")
        try:
            await self._send_data(data)
        except CLIConnectionError:
            raise
        except Exception as exc:
            self._exit_error = CLIConnectionError(
                f"Failed to send data to Claude CLI: {exc}"
            )
            raise self._exit_error

    async def end_input(self) -> None:
        # Best-effort EOF — called by close() and also available to SDK
        # consumers directly, so it must be idempotent. Errors are swallowed
        # because a broken pipe means the process already exited.
        if not self._ready or not self._is_connection_ready() or self._stdin_closed:
            return
        try:
            await self._send_eof()
            self._stdin_closed = True
        except (OSError, CLIConnectionError):
            pass

    def read_messages(self) -> AsyncIterator[dict[str, Any]]:
        return self._parse_cli_output()

    def is_ready(self) -> bool:
        return self._ready

    def _build_command(self) -> str:
        # Translate ClaudeAgentOptions into a shell-escaped CLI invocation
        # string. Used by Docker (passed to `bash -c`) and host (split back
        # with shlex.split). Always bookended by --output-format and
        # --input-format stream-json for bidirectional JSON streaming.
        cmd = [
            str(self._options.cli_path or "claude"),
            "--output-format",
            "stream-json",
            "--verbose",
        ]

        if isinstance(self._options.system_prompt, str):
            cmd.extend(["--system-prompt", self._options.system_prompt])
        elif (
            self._options.system_prompt.get("type") == "preset"
            and "append" in self._options.system_prompt
        ):
            cmd.extend(
                ["--append-system-prompt", self._options.system_prompt["append"]]
            )

        if self._options.allowed_tools:
            cmd.extend(["--allowedTools", ",".join(self._options.allowed_tools)])

        if self._options.max_turns:
            cmd.extend(["--max-turns", str(self._options.max_turns)])

        if self._options.disallowed_tools:
            cmd.extend(["--disallowedTools", ",".join(self._options.disallowed_tools)])

        if self._options.model:
            cmd.extend(["--model", self._options.model])

        if self._options.permission_prompt_tool_name:
            cmd.extend(
                ["--permission-prompt-tool", self._options.permission_prompt_tool_name]
            )

        if self._options.permission_mode:
            cmd.extend(["--permission-mode", self._options.permission_mode])

        if self._options.continue_conversation:
            cmd.append("--continue")

        if self._options.resume:
            cmd.extend(["--resume", self._options.resume])

        if self._options.settings:
            cmd.extend(["--settings", self._options.settings])

        for directory in self._options.add_dirs:
            cmd.extend(["--add-dir", str(directory)])

        if self._options.mcp_servers:
            if isinstance(self._options.mcp_servers, dict):
                # SDK-type MCP servers carry a live Python "instance" object
                # that can't be JSON-serialized — strip it before passing
                # the config to the CLI.
                servers_for_cli = {
                    name: {k: v for k, v in config.items() if k != "instance"}
                    if isinstance(config, dict) and config.get("type") == "sdk"
                    else config
                    for name, config in self._options.mcp_servers.items()
                }
                cmd.extend(
                    ["--mcp-config", json.dumps({"mcpServers": servers_for_cli})]
                )
            else:
                cmd.extend(["--mcp-config", str(self._options.mcp_servers)])

        if self._options.include_partial_messages:
            cmd.append("--include-partial-messages")

        if self._options.fork_session:
            cmd.append("--fork-session")

        if self._options.max_thinking_tokens:
            cmd.extend(
                ["--max-thinking-tokens", str(self._options.max_thinking_tokens)]
            )

        if self._options.agents:
            cmd.extend(
                [
                    "--agents",
                    json.dumps(
                        {
                            name: {
                                k: v
                                for k, v in asdict(agent_def).items()
                                if v is not None
                            }
                            for name, agent_def in self._options.agents.items()
                        }
                    ),
                ]
            )

        cmd.extend(["--setting-sources", ",".join(self._options.setting_sources or [])])

        if self._options.worktree:
            if isinstance(self._options.worktree, str):
                cmd.extend(["--worktree", self._options.worktree])
            else:
                cmd.append("--worktree")

        for flag, value in self._options.extra_args.items():
            if value is None:
                cmd.append(f"--{flag}")
            else:
                cmd.extend([f"--{flag}", str(value)])

        cmd.extend(["--input-format", "stream-json"])
        return shlex.join(cmd)

    def _parse_json_buffer(self, buffer: str) -> tuple[str, list[Any]]:
        # Greedy JSON extractor: uses raw_decode to pull as many complete JSON
        # values as possible from the buffer, returning any trailing incomplete
        # fragment so the caller can accumulate it across chunks.
        messages: list[Any] = []
        while buffer:
            buffer = buffer.lstrip()
            try:
                data, offset = self._json_decoder.raw_decode(buffer)
            except json.JSONDecodeError:
                break
            messages.append(data)
            buffer = buffer[offset:]
        return buffer, messages

    async def _parse_cli_output(self) -> AsyncIterator[dict[str, Any]]:
        # Core streaming parser: reads raw stdout chunks from the queue, strips
        # ANSI escapes, skips non-JSON preamble until the first { or [, then
        # accumulates lines into a buffer and greedily extracts complete JSON
        # values via _parse_json_buffer. A "result" message acts as a hard
        # boundary that resets the parser state. After the sentinel signals
        # end-of-stream, any buffered remainder is drained and _exit_error
        # (set by write() or _monitor_process) is raised so consumers see all
        # available data before the error.
        if not self._ready and not self._monitor_task:
            raise CLIConnectionError("Transport is not connected")

        json_buffer = ""
        json_started = False

        while True:
            chunk = await self._stdout_queue.get()

            if chunk is self._SENTINEL:
                break
            if not isinstance(chunk, str):
                continue

            if "\x1b" in chunk:
                chunk = ANSI_ESCAPE_RE.sub("", chunk)
            if "\r" in chunk:
                chunk = chunk.replace("\r", "")

            for json_line in chunk.split("\n"):
                json_line = json_line.strip()
                if not json_line:
                    continue

                if not json_started:
                    start = json_line.find("{")
                    array_start = json_line.find("[")
                    if array_start != -1 and (start == -1 or array_start < start):
                        start = array_start
                    if start == -1:
                        continue
                    json_line = json_line[start:]
                    json_started = True

                json_buffer += json_line
                if len(json_buffer) > self._max_buffer_size:
                    json_buffer = ""
                    raise CLIJSONDecodeError(
                        json_line,
                        ValueError(
                            f"CLI output exceeded max buffer size of {self._max_buffer_size}"
                        ),
                    )

                json_buffer, parsed_messages = self._parse_json_buffer(json_buffer)
                for data in parsed_messages:
                    yield data
                    if isinstance(data, dict) and data.get("type") == "result":
                        json_buffer = ""
                if not json_buffer:
                    json_started = False

        if json_buffer:
            leftover, parsed_messages = self._parse_json_buffer(json_buffer)
            for data in parsed_messages:
                yield data
            if leftover.strip():
                try:
                    json.loads(leftover)
                except json.JSONDecodeError as exc:
                    raise CLIJSONDecodeError(leftover, exc) from exc

        if self._exit_error:
            raise self._exit_error
