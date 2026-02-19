import asyncio
import json
import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.exc import SQLAlchemyError
from sse_starlette.sse import EventSourceResponse

from app.constants import (
    REDIS_KEY_CHAT_CONTEXT_USAGE,
)
from app.core.config import get_settings
from app.core.deps import get_chat_service
from app.core.security import get_current_user
from app.models.db_models import User, MessageStreamStatus
from app.models.types import MessageAttachmentDict
from app.models.schemas import (
    Chat as ChatSchema,
    ChatCompletionResponse,
    ChatCreate,
    ChatStatusResponse,
    ChatUpdate,
    ChatRequest,
    ContextUsage,
    CursorPaginatedMessages,
    CursorPaginationParams,
    EnhancePromptResponse,
    ForkChatRequest,
    ForkChatResponse,
    MessageEvent,
    PaginatedChats,
    PaginationParams,
    PermissionRespondResponse,
    QueuedMessage,
    QueueMessageUpdate,
    QueueUpsertResponse,
    RestoreRequest,
)
from app.services.chat import ChatService
from app.services.claude_agent import ClaudeAgentService
from app.services.exceptions import (
    ChatException,
    ClaudeAgentException,
    MessageException,
    SandboxException,
)
from app.services.permission_manager import PermissionManager
from app.services.queue import QueueService
from app.services.claude_session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import CacheError, cache_connection

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

INACTIVE_TASK_RESPONSE = {
    "has_active_task": False,
    "stream_id": None,
    "last_seq": 0,
}


async def _ensure_chat_access(
    chat_id: UUID, chat_service: ChatService, current_user: User
) -> None:
    try:
        await chat_service.get_chat(chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )


def _parse_non_negative_seq(value: str | None) -> int:
    if value is None:
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed >= 0 else 0


@router.post(
    "/chats",
    response_model=ChatSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_chat(
    chat_data: ChatCreate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        chat = await chat_service.create_chat(current_user, chat_data)
        return chat
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error creating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating chat",
        )
    except CacheError as e:
        logger.error("Redis error creating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.post("/chat", response_model=ChatCompletionResponse)
async def send_message(
    prompt: str = Form(...),
    chat_id: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    selected_prompt_name: str | None = Form(None),
    attached_files: list[UploadFile] | None = File(None),
    chat_service: ChatService = Depends(get_chat_service),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    files = attached_files or []
    try:
        result = await chat_service.initiate_chat_completion(
            ChatRequest(
                prompt=prompt,
                chat_id=UUID(chat_id),
                model_id=model_id,
                attached_files=files,
                permission_mode=permission_mode,
                thinking_mode=thinking_mode,
                selected_prompt_name=selected_prompt_name,
            ),
            current_user,
        )

        return {
            "chat_id": result["chat_id"],
            "message_id": result["message_id"],
            "last_seq": result.get("last_seq", 0),
        }
    except ChatException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/enhance-prompt", response_model=EnhancePromptResponse)
async def enhance_prompt(
    prompt: str = Form(...),
    model_id: str = Form(...),
    chat_service: ChatService = Depends(get_chat_service),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        ai_service = ClaudeAgentService(session_factory=chat_service.session_factory)
        enhanced_prompt = await ai_service.enhance_prompt(
            prompt, model_id, current_user
        )
        return {"enhanced_prompt": enhanced_prompt}
    except ClaudeAgentException as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/chats", response_model=PaginatedChats)
async def get_chats(
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> PaginatedChats:
    return await chat_service.get_user_chats(current_user, pagination)


@router.get(
    "/chats/{chat_id}",
    response_model=ChatSchema,
)
async def get_chat_detail(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        chat = await chat_service.get_chat(chat_id, current_user)
        return chat
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error retrieving chat %s: %s", chat_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while retrieving chat",
        )


@router.get("/chats/{chat_id}/context-usage", response_model=ContextUsage)
async def get_chat_context_usage(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ContextUsage:
    chat = await chat_service.get_chat(chat_id, current_user)

    try:
        async with cache_connection() as cache:
            cache_key = REDIS_KEY_CHAT_CONTEXT_USAGE.format(chat_id=str(chat_id))
            cached = await cache.get(cache_key)
            if cached:
                data = json.loads(cached)
                return ContextUsage(
                    tokens_used=data.get("tokens_used", 0),
                    context_window=data.get(
                        "context_window", settings.CONTEXT_WINDOW_TOKENS
                    ),
                    percentage=data.get("percentage", 0.0),
                )
    except (CacheError, json.JSONDecodeError, KeyError) as e:
        logger.warning("Failed to get context usage from cache: %s", e)

    tokens_used = chat.context_token_usage or 0
    context_window = settings.CONTEXT_WINDOW_TOKENS
    percentage = 0.0
    if context_window > 0:
        percentage = min((tokens_used / context_window) * 100, 100.0)

    return ContextUsage(
        tokens_used=tokens_used,
        context_window=context_window,
        percentage=percentage,
    )


@router.patch("/chats/{chat_id}", response_model=ChatSchema)
async def update_chat(
    chat_id: UUID,
    chat_update: ChatUpdate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        chat = await chat_service.update_chat(chat_id, chat_update, current_user)
        return chat
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error updating chat %s: %s", chat_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while updating chat",
        )


@router.delete("/chats/all", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_chats(
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await chat_service.delete_all_chats(current_user)


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await chat_service.delete_chat(chat_id, current_user)


@router.get("/chats/{chat_id}/messages", response_model=CursorPaginatedMessages)
async def get_chat_messages(
    chat_id: UUID,
    pagination: CursorPaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> CursorPaginatedMessages:
    return await chat_service.get_chat_messages(
        chat_id, current_user, pagination.cursor, pagination.limit
    )


@router.post("/chats/{chat_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_chat(
    chat_id: UUID,
    request: RestoreRequest,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    try:
        await chat_service.restore_to_checkpoint(
            chat_id, request.message_id, current_user
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error restoring chat %s: %s", chat_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while restoring chat",
        )


@router.post(
    "/chats/{chat_id}/fork",
    response_model=ForkChatResponse,
    status_code=status.HTTP_201_CREATED,
)
async def fork_chat(
    chat_id: UUID,
    request: ForkChatRequest,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ForkChatResponse:
    try:
        new_chat, messages_copied = await chat_service.fork_chat(
            chat_id, request.message_id, current_user
        )
        return ForkChatResponse(chat=new_chat, messages_copied=messages_copied)
    except (ChatException, MessageException, SandboxException) as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error forking chat %s: %s", chat_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while forking chat",
        )
    except FileNotFoundError as e:
        logger.error(
            "Checkpoint not found forking chat %s: %s", chat_id, e, exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checkpoint not found",
        )


@router.get("/chats/{chat_id}/stream")
async def stream_events(
    chat_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> EventSourceResponse:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    # Browser EventSource reconnects send the current cursor via Last-Event-ID.
    # Keep query-param baseline support and use whichever is more advanced.
    after_seq = max(
        _parse_non_negative_seq(request.query_params.get("after_seq")),
        _parse_non_negative_seq(request.headers.get("Last-Event-ID")),
    )

    return EventSourceResponse(
        chat_service.create_event_stream(chat_id, after_seq),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chats/{chat_id}/status", response_model=ChatStatusResponse)
async def get_stream_status(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> dict[str, Any]:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    try:
        latest_assistant_message = (
            await chat_service.message_service.get_latest_assistant_message(chat_id)
        )

        if (
            not latest_assistant_message
            or latest_assistant_message.stream_status != MessageStreamStatus.IN_PROGRESS
        ):
            return INACTIVE_TASK_RESPONSE.copy()

        if not ChatStreamRuntime.has_active_chat(str(chat_id)):
            return INACTIVE_TASK_RESPONSE.copy()

        return {
            "has_active_task": True,
            "message_id": latest_assistant_message.id,
            "stream_id": latest_assistant_message.active_stream_id,
            "last_seq": latest_assistant_message.last_seq,
        }
    except SQLAlchemyError as e:
        logger.error(
            "Database error checking chat status %s: %s", chat_id, e, exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to check chat status",
        )


@router.get("/messages/{message_id}/events", response_model=list[MessageEvent])
async def get_message_events(
    message_id: UUID,
    after_seq: int = 0,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> list[MessageEvent]:
    message = await chat_service.message_service.get_message(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    await _ensure_chat_access(message.chat_id, chat_service, current_user)
    return await chat_service.message_service.get_message_events_after_seq(
        message_id, after_seq, limit=5000
    )


@router.delete("/chats/{chat_id}/stream", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_stream(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    if not ChatStreamRuntime.has_active_chat(str(chat_id)):
        return

    await session_registry.cancel_generation(str(chat_id))


@router.post(
    "/chats/{chat_id}/permissions/{request_id}/respond",
    response_model=PermissionRespondResponse,
    status_code=status.HTTP_200_OK,
)
async def respond_to_permission(
    chat_id: UUID,
    request_id: str,
    approved: bool = Form(...),
    alternative_instruction: str | None = Form(None),
    user_answers: str | None = Form(None, max_length=50000),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> PermissionRespondResponse:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    parsed_answers = None
    if user_answers:
        try:
            parsed_answers = json.loads(user_answers)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in user_answers: %s", e)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON format for user_answers",
            )
        if not isinstance(parsed_answers, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="user_answers must be a JSON object",
            )

    success = await PermissionManager.respond(
        request_id, approved, alternative_instruction, parsed_answers
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission request not found or expired",
        )

    return PermissionRespondResponse(success=True)


@router.post(
    "/chats/{chat_id}/queue",
    response_model=QueueUpsertResponse,
    status_code=status.HTTP_201_CREATED,
)
async def queue_message(
    chat_id: UUID,
    content: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    attached_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> QueueUpsertResponse:
    try:
        chat = await chat_service.get_chat(chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )

    attachments: list[MessageAttachmentDict] | None = None
    files = attached_files or []
    if files:
        attachments = list(
            await asyncio.gather(
                *[
                    chat_service.storage_service.save_file(
                        file,
                        sandbox_id=chat.sandbox_id,
                        user_id=str(current_user.id),
                    )
                    for file in files
                ]
            )
        )
    queue_attachments = [dict(item) for item in attachments] if attachments else None

    try:
        async with cache_connection() as cache:
            queue_service = QueueService(cache)
            return await queue_service.upsert_message(
                str(chat_id),
                content,
                model_id,
                permission_mode=permission_mode,
                thinking_mode=thinking_mode,
                attachments=queue_attachments,
            )
    except CacheError as e:
        logger.error("Redis error queueing message: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get(
    "/chats/{chat_id}/queue",
    response_model=QueuedMessage | None,
)
async def get_queue(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> QueuedMessage | None:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    try:
        async with cache_connection() as cache:
            queue_service = QueueService(cache)
            return await queue_service.get_message(str(chat_id))
    except CacheError as e:
        logger.error("Redis error getting queue: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.patch(
    "/chats/{chat_id}/queue",
    response_model=QueuedMessage,
)
async def update_queued_message(
    chat_id: UUID,
    update: QueueMessageUpdate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> QueuedMessage:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    try:
        async with cache_connection() as cache:
            queue_service = QueueService(cache)
            result = await queue_service.update_message(str(chat_id), update.content)
            if result is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No queued message found",
                )
            return result
    except CacheError as e:
        logger.error("Redis error updating queued message: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.delete(
    "/chats/{chat_id}/queue",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_queue(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    try:
        async with cache_connection() as cache:
            queue_service = QueueService(cache)
            success = await queue_service.clear_queue(str(chat_id))
            if not success:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No queued message found",
                )
    except CacheError as e:
        logger.error("Redis error clearing queue: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )
