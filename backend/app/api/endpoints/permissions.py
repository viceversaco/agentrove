import asyncio
import json
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.constants import REDIS_KEY_CHAT_STREAM_LIVE
from app.core.config import get_settings
from app.core.deps import get_chat_service
from app.core.security import validate_chat_scoped_token
from app.models.schemas.permissions import (
    PermissionRequest,
    PermissionRequestResponse,
    PermissionResult,
)
from app.services.chat import ChatService
from app.services.permission_manager import PermissionManager
from app.services.streaming.types import StreamEnvelope
from app.utils.cache import CacheError, cache_connection

router = APIRouter()
settings = get_settings()


async def _validate_token_for_chat(authorization: str, chat_id: UUID) -> None:
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )

    token = authorization.removeprefix("Bearer ").strip()
    if not validate_chat_scoped_token(token, str(chat_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired token for this chat",
        )


@router.post(
    "/chats/{chat_id}/permissions/request",
    response_model=PermissionRequestResponse,
)
async def create_permission_request(
    chat_id: UUID,
    request: PermissionRequest,
    authorization: str = Header(...),
    chat_service: ChatService = Depends(get_chat_service),
) -> PermissionRequestResponse:
    await _validate_token_for_chat(authorization, chat_id)
    chat_id_str = str(chat_id)
    request_id = str(uuid.uuid4())

    request_data = {
        "chat_id": chat_id_str,
        "tool_name": request.tool_name,
        "tool_input": request.tool_input,
        "timestamp": asyncio.get_running_loop().time(),
    }
    PermissionManager.create_request(request_id, request_data)

    message_service = chat_service.message_service
    try:
        latest_assistant = await message_service.get_latest_assistant_message(chat_id)
        if latest_assistant and latest_assistant.active_stream_id:
            render_payload = {
                "request_id": request_id,
                "tool_name": request.tool_name,
                "tool_input": request.tool_input,
            }
            seq = await message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=latest_assistant.id,
                stream_id=latest_assistant.active_stream_id,
                event_type="permission_request",
                render_payload=render_payload,
                audit_payload={
                    "payload": StreamEnvelope.sanitize_payload(render_payload)
                },
            )
            envelope = StreamEnvelope.build(
                chat_id=chat_id,
                message_id=latest_assistant.id,
                stream_id=latest_assistant.active_stream_id,
                seq=seq,
                kind="permission_request",
                payload=render_payload,
            )
            async with cache_connection() as cache:
                await cache.publish(
                    REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id_str),
                    json.dumps(envelope, ensure_ascii=False),
                )
    except (CacheError, SQLAlchemyError) as exc:
        PermissionManager.remove(request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create permission request",
        ) from exc

    return PermissionRequestResponse(request_id=request_id)


@router.get(
    "/chats/{chat_id}/permissions/response/{request_id}",
    response_model=PermissionResult,
)
async def get_permission_response(
    chat_id: UUID,
    request_id: str,
    authorization: str = Header(...),
    timeout: int = Query(default=300, ge=1, le=600),
) -> PermissionResult:
    await _validate_token_for_chat(authorization, chat_id)
    request_data = PermissionManager.get_request_data(request_id)
    if request_data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission request not found or expired",
        )

    if request_data.get("chat_id") != str(chat_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission request does not belong to this chat",
        )

    response = await PermissionManager.wait_for_response(request_id, timeout=timeout)
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT,
            detail="Permission request timed out",
        )

    try:
        return PermissionResult(**response)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid response payload",
        ) from exc
