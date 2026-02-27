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

IDLE_CHECK_INTERVAL_SECONDS = 60.0

# Env vars excluded from the session fingerprint because they change every
# request (e.g. CHAT_TOKEN is a short-lived JWT) but don't affect SDK behavior.
EPHEMERAL_MCP_ENV_KEYS = frozenset({"CHAT_TOKEN"})


@dataclass
class ChatSession:
    chat_id: str
    transport: SandboxTransport
    client: ClaudeSDKClient
    fingerprint: str
    active_generation_task: asyncio.Task[Any] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    last_used_at: float = field(default_factory=time.monotonic)


class SessionRegistry:
    def __init__(self) -> None:
        # One long-lived SDK session per chat, keyed by chat_id. Reused
        # across messages and torn down when the config fingerprint changes.
        self._sessions: dict[str, ChatSession] = {}
        # Tracks cancel requests that arrive before the generation loop starts
        # (e.g. during transport setup). consume_pending_cancel() checks this
        # set right before streaming begins so the cancel isn't lost.
        self._pending_cancels: set[str] = set()

    async def get_or_create(
        self,
        *,
        chat_id: str,
        options: ClaudeAgentOptions,
        transport_factory: Callable[[], SandboxTransport],
    ) -> ChatSession:
        # Return the existing session if its config still matches, otherwise
        # tear it down and create a fresh one.
        session = self._sessions.get(chat_id)
        fingerprint = self._compute_fingerprint(options)

        if session is not None and session.fingerprint != fingerprint:
            await self._close_session(session)
            session = None

        if session is None:
            session = await self._create_session(
                chat_id=chat_id,
                fingerprint=fingerprint,
                options=options,
                transport_factory=transport_factory,
            )
            self._sessions[chat_id] = session

        session.last_used_at = time.monotonic()
        return session

    def get_session(self, chat_id: str) -> ChatSession | None:
        return self._sessions.get(chat_id)

    async def cancel_generation(self, chat_id: str) -> None:
        # Signal the running generation to stop and send an interrupt to the
        # SDK client. The cancel is also recorded in _pending_cancels so the
        # runtime can detect it even if the session hasn't started streaming yet.
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
        # Check and clear a pending cancel flag — returns True if a cancel
        # was requested before the generation loop had a chance to observe it.
        if chat_id in self._pending_cancels:
            self._pending_cancels.discard(chat_id)
            return True
        return False

    async def terminate(self, chat_id: str) -> None:
        # Remove a single session from the registry and close it.
        session = self._sessions.pop(chat_id, None)
        if session is not None:
            await self._close_session(session)

    async def terminate_all(self) -> None:
        # Shut down all sessions — called during application shutdown.
        sessions = list(self._sessions.values())
        self._sessions.clear()
        for session in sessions:
            await self._close_session(session)

    async def close_idle_sessions(self, ttl_seconds: float) -> None:
        # Close sessions that have been idle longer than ttl_seconds and
        # have no active generation task running.
        now = time.monotonic()
        expired: list[str] = []

        for chat_id, session in self._sessions.items():
            task = session.active_generation_task
            if task is not None and not task.done():
                continue
            if (now - session.last_used_at) >= ttl_seconds:
                expired.append(chat_id)

        for chat_id in expired:
            await self._close_session(self._sessions.pop(chat_id))

        if expired:
            logger.info("Closed %d idle chat session(s)", len(expired))

    @staticmethod
    def _remove_per_request_mcp_env(mcp_servers: dict[str, Any]) -> dict[str, Any]:
        # Remove per-request env vars (like CHAT_TOKEN) from MCP configs
        # so the fingerprint only reflects stable configuration.
        filtered: dict[str, Any] = {}
        for name, cfg in mcp_servers.items():
            env = cfg.get("env")
            if isinstance(env, dict):
                filtered_env = {
                    k: v for k, v in env.items() if k not in EPHEMERAL_MCP_ENV_KEYS
                }
                filtered[name] = {**cfg, "env": filtered_env}
            else:
                filtered[name] = cfg
        return filtered

    @staticmethod
    def _compute_fingerprint(options: ClaudeAgentOptions) -> str:
        # Hash the options that are immutable on a live session. The SDK has
        # no set_system_prompt() / set_env() — these are baked in at creation
        # time, so any change requires tearing down and recreating the session.
        # Model and permission_mode are excluded because the SDK supports
        # updating those dynamically via set_model() / set_permission_mode().
        data = json.dumps(
            {
                "system_prompt": options.system_prompt,
                "env": options.env,
                "mcp_servers": SessionRegistry._remove_per_request_mcp_env(options.mcp_servers),
                "disallowed_tools": options.disallowed_tools,
                "max_thinking_tokens": options.max_thinking_tokens,
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(data.encode()).hexdigest()

    @staticmethod
    async def _create_session(
        *,
        chat_id: str,
        fingerprint: str,
        options: ClaudeAgentOptions,
        transport_factory: Callable[[], SandboxTransport],
    ) -> ChatSession:
        # Spin up a transport + SDK client and connect. If connect fails,
        # clean up both before propagating the error.
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
            transport=transport,
            client=client,
            fingerprint=fingerprint,
        )

    @staticmethod
    async def _close_session(session: ChatSession) -> None:
        # Gracefully tear down: cancel any in-flight generation, disconnect
        # the SDK client, then close the transport. Each step is guarded
        # independently so a failure in one doesn't skip the others.
        task = session.active_generation_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=TASK_CANCEL_TIMEOUT_SECONDS)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        try:
            await session.client.disconnect()
        except Exception as exc:
            logger.debug("Error disconnecting chat %s: %s", session.chat_id, exc)

        try:
            await session.transport.close()
        except Exception as exc:
            logger.debug("Error closing transport for chat %s: %s", session.chat_id, exc)


session_registry = SessionRegistry()
