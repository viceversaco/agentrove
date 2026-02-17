import asyncio
import errno
import json
import logging

from fastapi import APIRouter, WebSocket
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.constants import (
    DEFAULT_PTY_COLS,
    DEFAULT_PTY_ROWS,
    WS_CLOSE_API_KEY_REQUIRED,
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_SANDBOX_NOT_FOUND,
    WS_MSG_AUTH,
    WS_MSG_CLOSE,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_PING,
    WS_MSG_RESIZE,
)
from app.core.config import get_settings
from app.core.security import get_user_from_token
from app.db.session import SessionLocal
from app.models.db_models import Chat, User
from app.services.exceptions import UserException
from app.services.sandbox_providers import (
    SandboxProviderType,
)
from app.services.terminal import terminal_session_registry
from app.services.user import UserService

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_dimension(
    value: object,
    *,
    default: int,
    min_value: int,
    max_value: int,
) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return default
    return max(min_value, min(value, max_value))


async def _authenticate_user(
    token: str,
) -> tuple[User | None, str | None, str | None, str]:
    try:
        async with SessionLocal() as db:
            user = await get_user_from_token(token, db)
            if not user:
                return None, None, None, SandboxProviderType.DOCKER.value

            user_service = UserService(session_factory=SessionLocal)
            try:
                user_settings = await user_service.get_user_settings(user.id, db=db)
                e2b_api_key = user_settings.e2b_api_key
                modal_api_key = user_settings.modal_api_key
                sandbox_provider = user_settings.sandbox_provider
            except UserException:
                e2b_api_key = None
                modal_api_key = None
                sandbox_provider = SandboxProviderType.DOCKER.value

        return user, e2b_api_key, modal_api_key, sandbox_provider
    except Exception as e:
        logger.warning("WebSocket authentication failed: %s", e)
        return None, None, None, SandboxProviderType.DOCKER.value


async def _wait_for_auth(
    websocket: WebSocket, timeout: float = 10.0
) -> tuple[User | None, str | None, str | None, str]:
    no_user = (None, None, None, SandboxProviderType.DOCKER.value)

    try:
        message = await asyncio.wait_for(websocket.receive(), timeout=timeout)
        data = json.loads(message["text"])
    except (asyncio.TimeoutError, json.JSONDecodeError, KeyError):
        return no_user

    if not isinstance(data, dict) or data.get("type") != WS_MSG_AUTH:
        return no_user

    token = data.get("token")
    if not isinstance(token, str) or not token:
        return no_user

    return await _authenticate_user(token)


@router.websocket("/{sandbox_id}/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    sandbox_id: str,
) -> None:
    await websocket.accept()

    user, e2b_api_key, modal_api_key, user_sandbox_provider = await _wait_for_auth(
        websocket
    )
    if not user:
        await websocket.close(code=WS_CLOSE_AUTH_FAILED, reason="Authentication failed")
        return

    async with SessionLocal() as db:
        query = select(Chat.sandbox_provider).where(
            Chat.sandbox_id == sandbox_id,
            Chat.user_id == user.id,
            Chat.deleted_at.is_(None),
        )
        result = await db.execute(query)
        row = result.one_or_none()
        if not row:
            await websocket.close(
                code=WS_CLOSE_SANDBOX_NOT_FOUND, reason="Sandbox not found"
            )
            return
        sandbox_provider_type = row.sandbox_provider or user_sandbox_provider

    try:
        provider_type = SandboxProviderType(sandbox_provider_type)
    except ValueError:
        await websocket.close(
            code=WS_CLOSE_SANDBOX_NOT_FOUND, reason="Invalid sandbox provider"
        )
        return
    if provider_type == SandboxProviderType.E2B and not e2b_api_key:
        await websocket.close(
            code=WS_CLOSE_API_KEY_REQUIRED,
            reason="E2B API key is required. Please configure your E2B API key in Settings.",
        )
        return

    if provider_type == SandboxProviderType.MODAL and not modal_api_key:
        await websocket.close(
            code=WS_CLOSE_API_KEY_REQUIRED,
            reason="Modal API key is required. Please configure your Modal API key in Settings.",
        )
        return

    api_key = None
    if provider_type == SandboxProviderType.E2B:
        api_key = e2b_api_key
    elif provider_type == SandboxProviderType.MODAL:
        api_key = modal_api_key

    terminal_id = websocket.query_params.get("terminalId") or "terminal-1"
    session = await terminal_session_registry.get_or_create(
        user_id=str(user.id),
        sandbox_id=sandbox_id,
        terminal_id=terminal_id,
        provider_type=provider_type,
        api_key=api_key,
    )

    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": WS_MSG_PING}))
                continue

            if "bytes" in message:
                session.enqueue_input(message["bytes"])
                continue

            if "text" not in message:
                continue

            text_payload = message["text"]
            if not isinstance(text_payload, str):
                continue

            try:
                data = json.loads(text_payload)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            data_type = data.get("type")
            if not isinstance(data_type, str):
                continue

            if data_type == WS_MSG_INIT:
                rows = _parse_dimension(
                    data.get("rows"),
                    default=DEFAULT_PTY_ROWS,
                    min_value=1,
                    max_value=500,
                )
                cols = _parse_dimension(
                    data.get("cols"),
                    default=DEFAULT_PTY_COLS,
                    min_value=1,
                    max_value=500,
                )

                size = await session.ensure_started(rows, cols)
                await session.attach(websocket)

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": WS_MSG_INIT,
                            "id": session.pty_id,
                            "rows": size["rows"],
                            "cols": size["cols"],
                        }
                    )
                )

            elif data_type == WS_MSG_RESIZE:
                rows = _parse_dimension(
                    data.get("rows"),
                    default=0,
                    min_value=0,
                    max_value=500,
                )
                cols = _parse_dimension(
                    data.get("cols"),
                    default=0,
                    min_value=0,
                    max_value=500,
                )
                if rows > 0 and cols > 0:
                    await session.resize(rows, cols)
            elif data_type == WS_MSG_CLOSE:
                await session.kill_tmux_session()
                await session.close()
                break
            elif data_type == WS_MSG_DETACH:
                await session.detach()
                break
    except WebSocketDisconnect:
        await session.detach()
    except Exception as e:
        logger.error("Error in terminal websocket: %s", e, exc_info=True)
    finally:
        if session.active_websocket is websocket and session.pty_id:
            await session.detach()
        try:
            await websocket.close()
        except OSError as exc:
            if exc.errno != errno.EPIPE:
                logger.error("Failed to close websocket cleanly: %s", exc)
