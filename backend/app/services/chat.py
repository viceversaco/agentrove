import asyncio
import json
import logging
import math
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import selectinload

from app.constants import REDIS_KEY_CHAT_STREAM_LIVE
from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.enums import MessageRole, MessageStreamStatus, StreamEventKind
from app.models.db_models.user import User, UserSettings
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import Chat as ChatSchema
from app.models.schemas.chat import ChatCreate, ChatRequest, ChatUpdate
from app.models.schemas.chat import Message as MessageSchema
from app.models.schemas.pagination import (
    CursorPaginatedResponse,
    PaginatedResponse,
    PaginationParams,
)
from app.models.schemas.settings import ProviderType
from app.models.types import ChatCompletionResult, MessageAttachmentDict
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.claude_session_registry import session_registry
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException, ErrorCode
from app.services.message import MessageService
from app.services.provider import ProviderService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import LocalDockerProvider, SandboxProviderType
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.storage import StorageService
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChatStreamRequest, StreamEnvelope
from app.services.user import UserService
from app.utils.attachment_urls import AttachmentURL
from app.utils.cache import CachePubSub, cache_connection, cache_pubsub
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

settings = get_settings()
logger = logging.getLogger(__name__)

TERMINAL_STREAM_EVENT_TYPES = {"cancelled", "complete", "error"}


class ChatService(BaseDbService[Chat]):
    def __init__(
        self,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.message_service = MessageService(session_factory=self._session_factory)
        self._user_service = user_service
        self._provider_service = ProviderService()

    @staticmethod
    def sandbox_for_workspace(workspace: Workspace) -> SandboxService:
        # Create a short-lived SandboxService bound to the workspace's
        # provider and container — used for file ops, checkpoints, and cleanup.
        provider = SandboxProviderFactory.create_bound(
            workspace.sandbox_provider,
            sandbox_id=workspace.sandbox_id,
            workspace_path=workspace.workspace_path,
        )
        return SandboxService(provider)

    async def get_user_chats(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedResponse[ChatSchema]:
        # Paginated list of non-deleted chats, pinned first, then by most recent.
        if pagination is None:
            pagination = PaginationParams()

        async with self.session_factory() as db:
            count_query = select(func.count(Chat.id)).filter(
                Chat.user_id == user.id, Chat.deleted_at.is_(None)
            )
            count_result = await db.execute(count_query)
            total = count_result.scalar()

            offset = (pagination.page - 1) * pagination.per_page

            query = (
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .order_by(Chat.pinned_at.desc().nulls_last(), Chat.updated_at.desc())
                .offset(offset)
                .limit(pagination.per_page)
            )
            result = await db.execute(query)
            chats = result.scalars().all()

            return PaginatedResponse[ChatSchema](
                items=chats,
                page=pagination.page,
                per_page=pagination.per_page,
                total=total,
                pages=math.ceil(total / pagination.per_page) if total > 0 else 0,
            )

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        # Validate API keys, verify workspace ownership, and create a new chat.
        user_settings = await self._user_service.get_user_settings(user.id)
        try:
            validate_model_api_keys(user_settings, chat_data.model_id)
        except APIKeyValidationError as e:
            raise ChatException(
                str(e), error_code=ErrorCode.API_KEY_MISSING, status_code=400
            ) from e

        async with self.session_factory() as db:
            ws_result = await db.execute(
                select(Workspace).filter(
                    Workspace.id == chat_data.workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspace = ws_result.scalar_one_or_none()
            if not workspace:
                raise ChatException(
                    "Workspace not found",
                    error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                    details={"workspace_id": str(chat_data.workspace_id)},
                    status_code=404,
                )

            chat = Chat(
                title=chat_data.title,
                user_id=user.id,
                workspace_id=workspace.id,
            )

            db.add(chat)
            await db.commit()

            query = (
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(Chat.id == chat.id)
            )
            result = await db.execute(query)
            loaded_chat: Chat = result.scalar_one()

            return loaded_chat

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
        # Update title and/or pin state for a chat owned by the user.
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to update it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            if chat_update.title is not None:
                chat.title = chat_update.title

            if chat_update.pinned is not None:
                chat.pinned_at = (
                    datetime.now(timezone.utc) if chat_update.pinned else None
                )

            chat.updated_at = datetime.now(timezone.utc)
            await db.commit()

            return chat

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        # Fetch a single chat with its messages (non-deleted) and workspace eagerly loaded.
        async with self.session_factory() as db:
            query = (
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .options(
                    selectinload(
                        Chat.messages.and_(Message.deleted_at.is_(None))
                    ).selectinload(Message.attachments),
                    selectinload(Chat.workspace),
                )
            )
            result = await db.execute(query)
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to access it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            return chat

    async def delete_chat(self, chat_id: UUID, user: User) -> None:
        # Soft-delete a chat and its messages, terminate the active session,
        # and destroy the workspace container if no other chats reference it.
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to delete it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            workspace_id = chat.workspace_id
            now = datetime.now(timezone.utc)
            chat.deleted_at = now

            messages_update = (
                update(Message)
                .where(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            asyncio.create_task(session_registry.terminate(str(chat_id)))

            # Destroy the workspace container if no chats remain
            remaining = await db.execute(
                select(func.count(Chat.id)).filter(
                    Chat.workspace_id == workspace_id,
                    Chat.deleted_at.is_(None),
                )
            )
            if remaining.scalar() == 0:
                ws_result = await db.execute(
                    select(Workspace).filter(
                        Workspace.id == workspace_id,
                        Workspace.deleted_at.is_(None),
                    )
                )
                workspace = ws_result.scalar_one_or_none()
                if workspace:
                    workspace.deleted_at = now
                    await db.commit()
                    if workspace.sandbox_id:
                        ws_sandbox = self.sandbox_for_workspace(workspace)
                        asyncio.create_task(
                            ws_sandbox.delete_sandbox(workspace.sandbox_id)
                        )

    async def get_chat_sandbox_id(self, chat_id: UUID, user: User) -> str | None:
        # Look up the sandbox ID for a chat via its workspace, without loading the full chat.
        async with self.session_factory() as db:
            result = await db.execute(
                select(Workspace.sandbox_id)
                .join(Chat, Chat.workspace_id == Workspace.id)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            row = result.one_or_none()

            if not row:
                raise ChatException(
                    "Chat not found or you don't have permission to access sandbox",
                    error_code=ErrorCode.CHAT_ACCESS_DENIED,
                    details={"chat_id": str(chat_id)},
                    status_code=403,
                )

            sandbox_id: str | None = row[0]
            return sandbox_id

    async def delete_all_chats(self, user: User) -> int:
        # Bulk soft-delete all chats, messages, and workspaces for a user,
        # then fire-and-forget session termination and sandbox cleanup.
        async with self.session_factory() as db:
            chat_query = select(Chat.id).filter(
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(chat_query)
            chat_ids = [str(row[0]) for row in result.fetchall()]

            ws_result = await db.execute(
                select(Workspace).filter(
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspaces = list(ws_result.scalars().all())

            now = datetime.now(timezone.utc)

            await db.execute(
                update(Chat)
                .where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )

            await db.execute(
                update(Message)
                .where(
                    Message.chat_id.in_(
                        select(Chat.id).filter(Chat.user_id == user.id)
                    ),
                    Message.deleted_at.is_(None),
                )
                .values(deleted_at=now)
            )

            for ws in workspaces:
                ws.deleted_at = now

            await db.commit()

            for cid in chat_ids:
                asyncio.create_task(session_registry.terminate(cid))

            for ws in workspaces:
                if ws.sandbox_id:
                    ws_sandbox = self.sandbox_for_workspace(ws)
                    asyncio.create_task(ws_sandbox.delete_sandbox(ws.sandbox_id))

            return len(chat_ids)

    async def get_chat_messages(
        self, chat_id: UUID, user: User, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedResponse[MessageSchema]:
        # Cursor-paginated message list — verify ownership then delegate to MessageService.
        async with self.session_factory() as db:
            result = await db.execute(
                select(
                    exists().where(
                        Chat.id == chat_id,
                        Chat.user_id == user.id,
                        Chat.deleted_at.is_(None),
                    )
                )
            )
            if not result.scalar():
                raise ChatException(
                    "Chat not found or you don't have permission to access messages",
                    error_code=ErrorCode.CHAT_ACCESS_DENIED,
                    details={"chat_id": str(chat_id)},
                    status_code=403,
                )

        return await self.message_service.get_chat_messages(chat_id, cursor, limit)

    async def _replay_stream_backlog(
        self,
        chat_id: UUID,
        after_seq: int,
    ) -> AsyncIterator[dict[str, Any]]:
        # Catch-up mechanism for SSE reconnection: when a client reconnects
        # (network blip, page refresh) it sends the last seq it saw, and this
        # method pages through all persisted events after that seq so the
        # client doesn't miss anything before switching to live Redis pub/sub.
        page_size = 5000
        cursor = after_seq

        while True:
            backlog = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=cursor,
                limit=page_size,
            )
            if not backlog:
                return

            for event in backlog:
                yield self._build_stream_sse_event(
                    chat_id=event.chat_id,
                    message_id=event.message_id,
                    stream_id=event.stream_id,
                    seq=int(event.seq),
                    kind=event.event_type,
                    payload=event.render_payload,
                )
                if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                    return

            next_cursor = int(backlog[-1].seq)
            if next_cursor <= cursor:
                logger.warning(
                    "Non-increasing backlog seq for chat %s (cursor=%s, next=%s)",
                    chat_id,
                    cursor,
                    next_cursor,
                )
                return
            cursor = next_cursor

            if len(backlog) < page_size:
                return

    @staticmethod
    def _build_stream_sse_event(
        # Single source of truth for the SSE envelope shape sent to the frontend —
        # every stream event (backlog replay, live Redis, errors) goes through here
        # so the client always receives a consistent {id, event, data} structure.
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        envelope = StreamEnvelope.build(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=stream_id,
            seq=seq,
            kind=kind,
            payload=payload,
        )
        return {
            "id": str(seq),
            "event": StreamEventKind.STREAM.value,
            "data": json.dumps(envelope, ensure_ascii=False),
        }

    async def _build_stream_error_event(
        self,
        *,
        chat_id: UUID,
        message_id: UUID | None,
        stream_id: UUID | None,
        fallback_seq: int,
        error_message: str,
    ) -> dict[str, Any]:
        # Build an error SSE event that the client can always display. The caller
        # (create_event_stream) already resolves message/stream IDs before entering
        # the try block — if they're None, no active stream existed so we synthesize
        # IDs. If they're set, we persist the error to DB for replay on reconnect.
        payload = {"error": error_message}

        if message_id is None:
            return self._build_stream_sse_event(
                chat_id=chat_id,
                message_id=uuid4(),
                stream_id=stream_id or uuid4(),
                seq=max(int(fallback_seq), 0) + 1,
                kind="error",
                payload=payload,
            )

        resolved_stream_id = stream_id or uuid4()

        try:
            error_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=resolved_stream_id,
                event_type="error",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist stream error event for chat %s: %s",
                chat_id,
                exc,
            )
            error_seq = max(int(fallback_seq), 0) + 1

        return self._build_stream_sse_event(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=resolved_stream_id,
            seq=error_seq,
            kind="error",
            payload=payload,
        )

    async def _stream_live_redis_events(
        self,
        chat_id: UUID,
        last_seq: int,
        live_pubsub: CachePubSub,
    ) -> AsyncIterator[dict[str, Any]]:
        # Real-time leg of the SSE connection: after the backlog replay catches
        # the client up, this loop waits for Redis pub/sub notifications and
        # reads new events from the DB. Terminates when a terminal event
        # (complete/cancelled/error) is encountered.
        while True:
            message = await live_pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if not message:
                continue
            if message.get("type") != "message":
                continue

            live_events = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=last_seq,
                limit=5000,
            )
            for event in live_events:
                yield self._build_stream_sse_event(
                    chat_id=event.chat_id,
                    message_id=event.message_id,
                    stream_id=event.stream_id,
                    seq=int(event.seq),
                    kind=event.event_type,
                    payload=event.render_payload,
                )
                last_seq = int(event.seq)

                if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                    return

    async def _get_active_stream_targets(
        self, chat_id: UUID
    ) -> tuple[UUID | None, UUID | None]:
        # Look up the in-progress assistant message so create_event_stream has
        # real IDs for error reporting if the stream fails unexpectedly.
        latest_assistant_message = (
            await self.message_service.get_latest_assistant_message(chat_id)
        )
        if (
            latest_assistant_message
            and latest_assistant_message.stream_status
            == MessageStreamStatus.IN_PROGRESS
        ):
            return (
                latest_assistant_message.id,
                latest_assistant_message.active_stream_id,
            )
        return None, None

    async def create_event_stream(
        self, chat_id: UUID, after_seq: int
    ) -> AsyncIterator[dict[str, Any]]:
        # Entry point for the SSE connection: replays missed events from the DB,
        # then switches to live Redis pub/sub. If anything fails, yields an error
        # event so the client always gets feedback instead of hanging.
        active_message_id, active_stream_id = await self._get_active_stream_targets(
            chat_id
        )
        last_seq = after_seq

        try:
            async with cache_connection() as cache:
                channel = REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id)
                async with cache_pubsub(cache, channel) as live_pubsub:
                    async for item in self._replay_stream_backlog(chat_id, after_seq):
                        yield item
                        last_seq = int(item["id"])

                    async for event in self._stream_live_redis_events(
                        chat_id,
                        last_seq,
                        live_pubsub,
                    ):
                        yield event
                        event_seq = int(event["id"])
                        if event_seq > last_seq:
                            last_seq = event_seq

        except Exception as exc:
            logger.error(
                "Error in event stream for chat %s: %s", chat_id, exc, exc_info=True
            )
            yield await self._build_stream_error_event(
                chat_id=chat_id,
                message_id=active_message_id,
                stream_id=active_stream_id,
                fallback_seq=last_seq,
                error_message=str(exc),
            )

    async def initiate_chat_completion(
        self,
        request: ChatRequest,
        current_user: User,
    ) -> ChatCompletionResult:
        # Main entry point for a user sending a message: validates keys, saves
        # the user message and an empty assistant message, uploads any attached
        # files to the sandbox, then kicks off the background stream task.
        # Returns the IDs the frontend needs to connect to the SSE stream.
        user_settings = await self._user_service.get_user_settings(current_user.id)
        try:
            validate_model_api_keys(user_settings, request.model_id)
        except APIKeyValidationError as e:
            raise ChatException(
                str(e), error_code=ErrorCode.API_KEY_MISSING, status_code=400
            ) from e

        chat = await self.get_chat(request.chat_id, current_user)

        chat_id = chat.id

        ws_sandbox = self.sandbox_for_workspace(chat.workspace)

        attachments: list[MessageAttachmentDict] | None = None
        if request.attached_files:
            file_storage = StorageService(ws_sandbox)
            attachments = list(
                await asyncio.gather(
                    *[
                        file_storage.save_file(
                            file,
                            sandbox_id=chat.workspace.sandbox_id,
                            user_id=str(current_user.id),
                        )
                        for file in request.attached_files
                    ]
                )
            )

        session_id = chat.session_id
        if session_id and chat.workspace.sandbox_id:
            if await self._needs_session_cleaning(
                chat.id, request.model_id, user_settings
            ):
                await ws_sandbox.clean_session_thinking_blocks(
                    chat.workspace.sandbox_id, session_id
                )

        user_prompt = MessageService.extract_user_text_content(request.prompt)

        await self.message_service.create_message(
            chat_id,
            user_prompt,
            MessageRole.USER,
            attachments=attachments,
        )

        assistant_message = await self.message_service.create_message(
            chat.id,
            "",
            MessageRole.ASSISTANT,
            model_id=request.model_id,
            stream_status=MessageStreamStatus.IN_PROGRESS,
        )

        system_prompt = build_system_prompt_for_chat(
            chat.workspace.sandbox_id,
            user_settings,
            selected_prompt_name=request.selected_prompt_name,
        )
        is_custom_prompt = bool(request.selected_prompt_name)
        custom_instructions = (
            user_settings.custom_instructions if user_settings else None
        )

        try:
            await self._enqueue_chat_task(
                prompt=user_prompt,
                system_prompt=system_prompt,
                custom_instructions=custom_instructions,
                chat=chat,
                permission_mode=request.permission_mode,
                model_id=request.model_id,
                session_id=session_id,
                assistant_message_id=str(assistant_message.id),
                thinking_mode=request.thinking_mode,
                attachments=attachments,
                is_custom_prompt=is_custom_prompt,
            )
        except Exception as e:
            logger.error("Failed to enqueue chat task: %s", e)
            await self.message_service.soft_delete_message(assistant_message.id)
            raise

        return {
            "message_id": str(assistant_message.id),
            "chat_id": str(chat_id),
            "last_seq": int(chat.last_event_seq or 0),
        }

    async def restore_to_checkpoint(
        self, chat_id: UUID, message_id: UUID, current_user: User
    ) -> None:
        # Roll back a chat to a previous state: restore the sandbox filesystem
        # from the checkpoint, delete all messages after the target, and reset
        # the session_id so the next completion resumes from that point.
        chat = await self.get_chat(chat_id, current_user)
        sandbox_id = chat.workspace.sandbox_id

        async with self.session_factory() as db:
            result = await db.execute(select(Message).filter(Message.id == message_id))
            message = result.scalar_one_or_none()

            if not message or message.chat_id != chat_id:
                raise ChatException(
                    "Message not found for this chat",
                    error_code=ErrorCode.MESSAGE_NOT_FOUND,
                    details={"message_id": str(message_id), "chat_id": str(chat_id)},
                    status_code=404,
                )

            if sandbox_id and message.checkpoint_id:
                ws_sandbox = self.sandbox_for_workspace(chat.workspace)
                await ws_sandbox.restore_checkpoint(sandbox_id, str(message.id))

            await self.message_service.delete_messages_after(chat_id, message)

            update_stmt = (
                update(Chat)
                .where(Chat.id == chat_id)
                .values(session_id=message.session_id)
            )
            await db.execute(update_stmt)
            await db.commit()

    async def fork_chat(
        self, source_chat_id: UUID, message_id: UUID, user: User
    ) -> tuple[Chat, int]:
        # Create an independent copy of a chat at a specific message: clones the
        # sandbox container from the checkpoint, duplicates the workspace/chat/
        # messages/attachments in a single transaction, and cleans up on failure.
        source_chat = await self.get_chat(source_chat_id, user)
        source_workspace = source_chat.workspace

        if source_workspace.sandbox_provider != SandboxProviderType.DOCKER.value:
            raise ChatException(
                "Fork is only supported with Docker sandbox provider",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        if not source_workspace.sandbox_id:
            raise ChatException(
                "Source chat has no sandbox",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        messages = await self.message_service.get_messages_up_to(
            source_chat_id, message_id
        )
        if not messages:
            raise ChatException(
                "No messages to fork",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        target_message = messages[-1]

        user_settings = await self._user_service.get_user_settings(user.id)

        provider = LocalDockerProvider(
            config=SandboxProviderFactory.create_docker_config()
        )
        fork_sandbox_service = SandboxService(provider)

        new_sandbox_id: str | None = None
        try:
            new_sandbox_id = await fork_sandbox_service.provider.clone_sandbox(
                source_workspace.sandbox_id,
                checkpoint_id=target_message.checkpoint_id,
            )

            await fork_sandbox_service.initialize_sandbox(
                sandbox_id=new_sandbox_id,
                custom_providers=user_settings.custom_providers,
                is_fork=True,
            )

            async with self.session_factory() as db:
                # Create a new workspace for the fork
                new_workspace = Workspace(
                    name=f"Fork of {source_workspace.name}"[:255],
                    user_id=user.id,
                    sandbox_id=new_sandbox_id,
                    sandbox_provider=SandboxProviderType.DOCKER.value,
                    workspace_path=source_workspace.workspace_path,
                    source_type=source_workspace.source_type,
                    source_url=source_workspace.source_url,
                )
                db.add(new_workspace)
                await db.flush()

                new_chat = Chat(
                    title=f"Fork of {source_chat.title}"[:255],
                    user_id=user.id,
                    workspace_id=new_workspace.id,
                    session_id=target_message.session_id,
                )
                db.add(new_chat)
                await db.flush()

                new_messages: list[Message] = []
                msg_to_attachments: list[tuple[Message, list[MessageAttachment]]] = []
                for msg in messages:
                    new_message = Message(
                        chat_id=new_chat.id,
                        content_text=msg.content_text,
                        content_render=msg.content_render,
                        last_seq=0,
                        active_stream_id=None,
                        role=msg.role,
                        model_id=msg.model_id,
                        session_id=msg.session_id,
                        checkpoint_id=msg.checkpoint_id,
                        stream_status=msg.stream_status,
                        total_cost_usd=msg.total_cost_usd,
                    )
                    new_messages.append(new_message)
                    msg_to_attachments.append((new_message, list(msg.attachments)))

                db.add_all(new_messages)
                await db.flush()

                all_attachments: list[MessageAttachment] = []
                for new_message, orig_attachments in msg_to_attachments:
                    for att in orig_attachments:
                        new_attachment = MessageAttachment(
                            message_id=new_message.id,
                            file_url="",
                            file_path=att.file_path,
                            file_type=att.file_type,
                            filename=att.filename,
                        )
                        all_attachments.append(new_attachment)

                if all_attachments:
                    db.add_all(all_attachments)
                    await db.flush()
                    for att in all_attachments:
                        att.file_url = AttachmentURL.build_preview_url(att.id)

                await db.commit()

                result = await db.execute(
                    select(Chat)
                    .options(selectinload(Chat.workspace))
                    .filter(Chat.id == new_chat.id)
                )
                loaded_chat = result.scalar_one()

            return (loaded_chat, len(messages))
        except Exception:
            if new_sandbox_id:
                try:
                    await fork_sandbox_service.delete_sandbox(new_sandbox_id)
                except Exception as cleanup_exc:
                    logger.warning(
                        "Failed to cleanup fork sandbox %s after error: %s",
                        new_sandbox_id,
                        cleanup_exc,
                    )
            raise
        finally:
            await provider.cleanup()

    async def _enqueue_chat_task(
        # Package the chat state into a ChatStreamRequest and kick off the
        # background streaming task. Separate method so tests can override it
        # to run synchronously without the background task machinery.
        self,
        *,
        prompt: str,
        system_prompt: str,
        custom_instructions: str | None,
        chat: Chat,
        permission_mode: str,
        model_id: str,
        session_id: str | None,
        assistant_message_id: str,
        thinking_mode: str | None,
        attachments: list[MessageAttachmentDict] | None,
        is_custom_prompt: bool = False,
    ) -> None:
        stream_attachments = (
            [dict(item) for item in attachments] if attachments else None
        )
        workspace = chat.workspace
        request = ChatStreamRequest(
            prompt=prompt,
            system_prompt=system_prompt,
            custom_instructions=custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "workspace_id": str(chat.workspace_id),
                "sandbox_id": workspace.sandbox_id,
                "workspace_path": workspace.workspace_path,
                "sandbox_provider": workspace.sandbox_provider,
                "session_id": chat.session_id,
            },
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=thinking_mode,
            attachments=stream_attachments,
            is_custom_prompt=is_custom_prompt,
        )
        ChatStreamRuntime.start_background_chat(request=request)

    async def _needs_session_cleaning(
        self, chat_id: UUID, new_model_id: str, user_settings: UserSettings
    ) -> bool:
        # When switching from a non-Anthropic provider to Anthropic, the session
        # file may contain thinking blocks that Anthropic's API rejects — this
        # detects that transition so the caller can strip them before resuming.
        new_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, new_model_id
        )
        new_provider_type = new_provider.get("provider_type") if new_provider else None

        if new_provider_type != ProviderType.ANTHROPIC.value:
            return False

        last_message = await self.message_service.get_latest_assistant_message(chat_id)
        if not last_message or not last_message.model_id:
            return False

        prev_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, last_message.model_id
        )
        prev_provider_type = (
            prev_provider.get("provider_type") if prev_provider else None
        )

        if prev_provider_type != ProviderType.ANTHROPIC.value:
            logger.info(
                "Session cleaning needed for chat %s: switching from %s to %s",
                chat_id,
                prev_provider_type,
                new_provider_type,
            )
            return True

        return False
