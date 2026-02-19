from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from claude_agent_sdk import ClaudeSDKClient
from claude_agent_sdk.types import ClaudeAgentOptions

from app.services.transports import SandboxTransport

logger = logging.getLogger(__name__)

TASK_CANCEL_TIMEOUT_SECONDS = 5.0

REAPER_INTERVAL_SECONDS = 60.0

EPHEMERAL_MCP_ENV_KEYS = frozenset({"CHAT_TOKEN"})


@dataclass
class ChatSession:
    chat_id: str
    sandbox_id: str
    provider: str
    transport: SandboxTransport
    client: ClaudeSDKClient
    max_thinking_tokens: int | None
    config_fingerprint: str
    active_generation_task: asyncio.Task[Any] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_used_at: float = field(default_factory=time.monotonic)


class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, ChatSession] = {}
        self._pending_cancels: set[str] = set()
        self._lock = asyncio.Lock()

    async def get_or_create(
        self,
        *,
        chat_id: str,
        sandbox_id: str,
        provider: str,
        max_thinking_tokens: int | None,
        options: ClaudeAgentOptions,
        transport_factory: Callable[[], SandboxTransport],
    ) -> ChatSession:
        async with self._lock:
            session = self._sessions.get(chat_id)

            fingerprint = self._options_fingerprint(options)

            if session is not None:
                needs_restart = (
                    session.sandbox_id != sandbox_id
                    or session.provider != provider
                    or session.max_thinking_tokens != max_thinking_tokens
                    or session.config_fingerprint != fingerprint
                )
                if needs_restart:
                    await self._close_session(session)
                    session = None

            if session is None:
                session = await self._create_session(
                    chat_id=chat_id,
                    sandbox_id=sandbox_id,
                    provider=provider,
                    max_thinking_tokens=max_thinking_tokens,
                    config_fingerprint=fingerprint,
                    options=options,
                    transport_factory=transport_factory,
                )
                self._sessions[chat_id] = session

            session.last_used_at = time.monotonic()
            return session

    async def cancel_generation(self, chat_id: str) -> None:
        self._pending_cancels.add(chat_id)
        session = self._sessions.get(chat_id)
        if session is None:
            return
        session.cancel_event.set()
        try:
            await session.client.interrupt()
        except Exception as exc:
            logger.debug("Interrupt failed for chat %s: %s", chat_id, exc)

    def consume_pending_cancel(self, chat_id: str) -> bool:
        if chat_id in self._pending_cancels:
            self._pending_cancels.discard(chat_id)
            return True
        return False

    async def terminate(self, chat_id: str) -> None:
        async with self._lock:
            session = self._sessions.pop(chat_id, None)
            if session is not None:
                await self._close_session(session)

    async def terminate_all(self) -> None:
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            await self._close_session(session)

    async def reap_idle(self, ttl_seconds: float) -> None:
        now = time.monotonic()
        expired: list[str] = []

        async with self._lock:
            for chat_id, session in self._sessions.items():
                task = session.active_generation_task
                if task is not None and not task.done():
                    continue
                if (now - session.last_used_at) >= ttl_seconds:
                    expired.append(chat_id)

            removed = [self._sessions.pop(cid) for cid in expired]

        for session in removed:
            await self._close_session(session)

        if expired:
            logger.info("Reaped %d idle chat session(s)", len(expired))

    @staticmethod
    def _stable_mcp_key(mcp_servers: Any) -> Any:
        if not isinstance(mcp_servers, dict):
            return mcp_servers
        stable: dict[str, Any] = {}
        for name, cfg in mcp_servers.items():
            if not isinstance(cfg, dict):
                stable[name] = cfg
                continue
            env = cfg.get("env")
            if isinstance(env, dict):
                filtered_env = {
                    k: v for k, v in env.items() if k not in EPHEMERAL_MCP_ENV_KEYS
                }
                stable[name] = {**cfg, "env": filtered_env}
            else:
                stable[name] = cfg
        return stable

    @staticmethod
    def _options_fingerprint(options: ClaudeAgentOptions) -> str:
        # Persistent sessions reuse the underlying CLI subprocess across messages.
        # Only model and permission_mode can be updated at runtime via SDK setters
        # (set_model / set_permission_mode). All other ClaudeAgentOptions fields
        # (system_prompt, env, mcp_servers, disallowed_tools) are baked into the
        # subprocess at spawn time. If any of these change between messages — e.g.
        # the user edits custom instructions, rotates API keys, switches to a
        # different provider, or adds an MCP server — we must tear down the session
        # and start a new CLI process. This fingerprint captures those immutable
        # fields so get_or_create can detect the drift and restart.
        #
        # Ephemeral MCP env keys (e.g. CHAT_TOKEN from create_chat_scoped_token)
        # are excluded because they change on every request, which would defeat
        # session reuse. Other MCP env values (user-configured credentials) are
        # kept so that credential changes trigger a session restart.
        data = json.dumps(
            {
                "system_prompt": options.system_prompt,
                "env": options.env,
                "mcp_servers": SessionRegistry._stable_mcp_key(options.mcp_servers),
                "disallowed_tools": options.disallowed_tools,
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(data.encode()).hexdigest()

    @staticmethod
    async def _create_session(
        *,
        chat_id: str,
        sandbox_id: str,
        provider: str,
        max_thinking_tokens: int | None,
        config_fingerprint: str,
        options: ClaudeAgentOptions,
        transport_factory: Callable[[], SandboxTransport],
    ) -> ChatSession:
        transport: SandboxTransport = transport_factory()
        client = ClaudeSDKClient(options=options, transport=transport)
        try:
            await client.connect()
        except Exception:
            await client.disconnect()
            await transport.close()
            raise

        return ChatSession(
            chat_id=chat_id,
            sandbox_id=sandbox_id,
            provider=provider,
            transport=transport,
            client=client,
            max_thinking_tokens=max_thinking_tokens,
            config_fingerprint=config_fingerprint,
        )

    @staticmethod
    async def _close_session(session: ChatSession) -> None:
        task = session.active_generation_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=TASK_CANCEL_TIMEOUT_SECONDS)
            except BaseException:
                pass

        try:
            await session.client.disconnect()
        except Exception as exc:
            logger.debug(
                "Error disconnecting session for chat %s: %s",
                session.chat_id,
                exc,
            )

        try:
            await session.transport.close()
        except Exception as exc:
            logger.debug(
                "Error closing transport for chat %s: %s",
                session.chat_id,
                exc,
            )


session_registry = SessionRegistry()
