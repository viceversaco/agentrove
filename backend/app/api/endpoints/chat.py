import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal, NoReturn
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
from app.models.db_models.chat import Chat
from app.models.db_models.enums import MessageStreamStatus
from app.models.db_models.user import User
from app.models.types import MessageAttachmentDict
from app.models.schemas.chat import (
    Chat as ChatSchema,
    ChatCompletionResponse,
    ChatCreate,
    ChatStatusResponse,
    ChatUpdate,
    ChatRequest,
    ContextUsage,
    EnhancePromptResponse,
    Message as MessageSchema,
    MessageEvent,
    PermissionRespondResponse,
)
from app.models.schemas.pagination import (
    CursorPaginatedResponse,
    CursorPaginationParams,
    PaginatedResponse,
    PaginationParams,
)
from app.models.schemas.queue import QueueAddResponse, QueuedMessage, QueueMessageUpdate
from app.services.chat import ChatService
from app.services.claude_agent import ClaudeAgentService
from app.services.exceptions import (
    ChatException,
    ClaudeAgentException,
)
from app.services.permission_manager import PermissionManager
from app.services.queue import QueueService
from app.services.claude_session_registry import session_registry
from app.services.storage import StorageService
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
) -> Chat:
    try:
        return await chat_service.get_chat(chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )


@asynccontextmanager
async def _queue_service_context(action: str) -> AsyncIterator[QueueService]:
    try:
        async with cache_connection() as cache:
            yield QueueService(cache)
    except CacheError as e:
        _raise_cache_http_exception(e, action)


def _parse_non_negative_seq(value: str | None) -> int:
    if value is None:
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed >= 0 else 0


def _raise_chat_http_exception(exc: ChatException) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _raise_database_http_exception(exc: SQLAlchemyError, action: str) -> NoReturn:
    logger.error("Database error %s: %s", action, exc, exc_info=True)
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Database error while {action}",
    ) from exc


def _raise_cache_http_exception(exc: Exception, action: str) -> NoReturn:
    logger.error("Redis error %s: %s", action, exc, exc_info=True)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Service temporarily unavailable",
    ) from exc


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
        return await chat_service.create_chat(current_user, chat_data)
    except ChatException as e:
        _raise_chat_http_exception(e)
    except SQLAlchemyError as e:
        _raise_database_http_exception(e, "creating chat")
    except CacheError as e:
        _raise_cache_http_exception(e, "creating chat")


@router.post("/chat", response_model=ChatCompletionResponse)
async def send_message(
    prompt: str = Form(...),
    chat_id: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    worktree: bool = Form(False),
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
                worktree=worktree,
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e


@router.post("/enhance-prompt", response_model=EnhancePromptResponse)
async def enhance_prompt(
    prompt: str = Form(...),
    model_id: str = Form(...),
    chat_service: ChatService = Depends(get_chat_service),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    ai_service = ClaudeAgentService(session_factory=chat_service.session_factory)
    try:
        enhanced_prompt = await ai_service.enhance_prompt(
            prompt, model_id, current_user
        )
    except ClaudeAgentException as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    return {"enhanced_prompt": enhanced_prompt}


@router.get("/chats", response_model=PaginatedResponse[ChatSchema])
async def get_chats(
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> PaginatedResponse[ChatSchema]:
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
        return await chat_service.get_chat(chat_id, current_user)
    except ChatException as e:
        _raise_chat_http_exception(e)
    except SQLAlchemyError as e:
        _raise_database_http_exception(e, "retrieving chat")


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
    except (CacheError, json.JSONDecodeError) as e:
        logger.warning("Failed to get context usage from cache: %s", e)

    tokens_used = chat.context_token_usage or 0
    context_window = (
        await chat_service.get_model_context_window(chat_id, current_user.id)
        or settings.CONTEXT_WINDOW_TOKENS
    )
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
        return await chat_service.update_chat(chat_id, chat_update, current_user)
    except ChatException as e:
        _raise_chat_http_exception(e)
    except SQLAlchemyError as e:
        _raise_database_http_exception(e, "updating chat")


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


@router.get(
    "/chats/{chat_id}/messages", response_model=CursorPaginatedResponse[MessageSchema]
)
async def get_chat_messages(
    chat_id: UUID,
    pagination: CursorPaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> CursorPaginatedResponse[MessageSchema]:
    return await chat_service.get_chat_messages(
        chat_id, current_user, pagination.cursor, pagination.limit
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
        _raise_database_http_exception(e, "checking chat status")


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
    response_model=QueueAddResponse,
    status_code=status.HTTP_201_CREATED,
)
async def queue_message(
    chat_id: UUID,
    content: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    worktree: bool = Form(False),
    attached_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> QueueAddResponse:
    chat = await _ensure_chat_access(chat_id, chat_service, current_user)

    attachments: list[MessageAttachmentDict] | None = None
    files = attached_files or []
    if files:
        ws_sandbox = ChatService.sandbox_for_workspace(chat.workspace)
        file_storage = StorageService(ws_sandbox)
        attachments = list(
            await asyncio.gather(
                *[
                    file_storage.save_file(
                        file,
                        sandbox_id=chat.workspace.sandbox_id,
                        user_id=str(current_user.id),
                    )
                    for file in files
                ]
            )
        )
    queue_attachments = [dict(item) for item in attachments] if attachments else None

    async with _queue_service_context("queueing message") as queue_service:
        return await queue_service.add_message(
            str(chat_id),
            content,
            model_id,
            permission_mode=permission_mode,
            thinking_mode=thinking_mode,
            worktree=worktree,
            attachments=queue_attachments,
        )


@router.get(
    "/chats/{chat_id}/queue",
    response_model=list[QueuedMessage],
)
async def get_queue(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> list[QueuedMessage]:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    async with _queue_service_context("getting queue") as queue_service:
        return await queue_service.get_queue(str(chat_id))


@router.patch(
    "/chats/{chat_id}/queue/{message_id}",
    response_model=QueuedMessage,
)
async def update_queued_message(
    chat_id: UUID,
    message_id: UUID,
    update: QueueMessageUpdate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> QueuedMessage:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    async with _queue_service_context("updating queued message") as queue_service:
        result = await queue_service.update_message(
            str(chat_id), str(message_id), update.content
        )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )
    return result


@router.delete(
    "/chats/{chat_id}/queue/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_queued_message(
    chat_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    async with _queue_service_context("deleting queued message") as queue_service:
        found = await queue_service.delete_message(str(chat_id), str(message_id))
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )


@router.post(
    "/chats/{chat_id}/queue/{message_id}/send-now",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def send_now_queued_message(
    chat_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await _ensure_chat_access(chat_id, chat_service, current_user)

    async with _queue_service_context("marking send-now") as queue_service:
        found = await queue_service.mark_send_now(str(chat_id), str(message_id))
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )

    if not ChatStreamRuntime.is_chat_streaming(str(chat_id)):
        try:
            await ChatStreamRuntime.process_send_now_idle(
                str(chat_id), chat_service.session_factory
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Failed to start idle send-now for chat %s: %s", chat_id, e)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failed to start send-now execution",
            ) from e


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

    async with _queue_service_context("clearing queue") as queue_service:
        await queue_service.clear_queue(str(chat_id))
