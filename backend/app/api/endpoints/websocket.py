import asyncio
import errno
import json
import logging
from typing import NamedTuple

from fastapi import APIRouter, WebSocket
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from starlette.websockets import WebSocketDisconnect

from app.constants import (
    DEFAULT_PTY_COLS,
    DEFAULT_PTY_ROWS,
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_SANDBOX_NOT_FOUND,
    WS_MSG_AUTH,
    WS_MSG_CLOSE,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_PING,
    WS_MSG_RESIZE,
)
from app.core.security import get_user_from_token
from app.db.session import SessionLocal
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services.exceptions import UserException
from app.services.sandbox_providers import SandboxProviderType
from app.services.terminal import terminal_session_registry
from app.services.user import UserService

router = APIRouter()
logger = logging.getLogger(__name__)


class AuthResult(NamedTuple):
    user: User | None
    sandbox_provider: str


NO_AUTH_RESULT = AuthResult(None, SandboxProviderType.DOCKER.value)


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
) -> AuthResult:
    try:
        async with SessionLocal() as db:
            user = await get_user_from_token(token, db)
            if not user:
                return NO_AUTH_RESULT

            user_service = UserService(session_factory=SessionLocal)
            try:
                user_settings = await user_service.get_user_settings(user.id, db=db)
                sandbox_provider = user_settings.sandbox_provider
            except UserException:
                sandbox_provider = SandboxProviderType.DOCKER.value

        return AuthResult(user, sandbox_provider)
    except (ValueError, OSError, SQLAlchemyError) as e:
        logger.warning("WebSocket authentication failed: %s", e)
        return NO_AUTH_RESULT


async def _wait_for_auth(websocket: WebSocket, timeout: float = 10.0) -> AuthResult:
    try:
        message = await asyncio.wait_for(websocket.receive(), timeout=timeout)
        data = json.loads(message["text"])
    except (asyncio.TimeoutError, json.JSONDecodeError, KeyError):
        return NO_AUTH_RESULT

    if not isinstance(data, dict) or data.get("type") != WS_MSG_AUTH:
        return NO_AUTH_RESULT

    token = data.get("token")
    if not isinstance(token, str) or not token:
        return NO_AUTH_RESULT

    return await _authenticate_user(token)


@router.websocket("/{sandbox_id}/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    sandbox_id: str,
) -> None:
    await websocket.accept()

    user, user_sandbox_provider = await _wait_for_auth(websocket)
    if not user:
        await websocket.close(code=WS_CLOSE_AUTH_FAILED, reason="Authentication failed")
        return

    async with SessionLocal() as db:
        query = select(Workspace.sandbox_provider, Workspace.workspace_path).where(
            Workspace.sandbox_id == sandbox_id,
            Workspace.user_id == user.id,
            Workspace.deleted_at.is_(None),
        )
        result = await db.execute(query)
        row = result.one_or_none()
        if not row:
            await websocket.close(
                code=WS_CLOSE_SANDBOX_NOT_FOUND, reason="Sandbox not found"
            )
            return
        sandbox_provider_type = row.sandbox_provider or user_sandbox_provider
        workspace_path = row.workspace_path

    try:
        provider_type = SandboxProviderType(sandbox_provider_type)
    except ValueError:
        await websocket.close(
            code=WS_CLOSE_SANDBOX_NOT_FOUND, reason="Invalid sandbox provider"
        )
        return
    terminal_id = websocket.query_params.get("terminalId") or "terminal-1"
    session = await terminal_session_registry.get_or_create(
        user_id=str(user.id),
        sandbox_id=sandbox_id,
        terminal_id=terminal_id,
        provider_type=provider_type,
        workspace_path=workspace_path,
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

            try:
                data = json.loads(message["text"])
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            data_type = data.get("type")
            if not data_type:
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

                is_reattach = await session.ensure_started(rows, cols)
                await session.attach(websocket)

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": WS_MSG_INIT,
                            "id": session.pty_id,
                            "rows": rows,
                            "cols": cols,
                        }
                    )
                )

                if is_reattach and session.pty_id is not None:
                    await session.sandbox_service.send_pty_input(
                        session.sandbox_id, session.pty_id, b" \x0c"
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
                await session.terminate()
                break
            elif data_type == WS_MSG_DETACH:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if session.active_websocket is websocket:
            await session.detach()
        try:
            await websocket.close()
        except OSError as exc:
            if exc.errno != errno.EPIPE:
                logger.error("Failed to close websocket cleanly: %s", exc)
