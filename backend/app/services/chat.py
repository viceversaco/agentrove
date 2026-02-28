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
from app.models.schemas.chat import ChatCreate, ChatRequest, ChatUpdate
from app.models.schemas.pagination import (
    CursorPaginatedResponse,
    PaginatedResponse,
    PaginationParams,
)
from app.models.schemas.settings import ProviderType
from app.models.schemas.chat import Chat as ChatSchema, Message as MessageSchema
from app.models.types import ChatCompletionResult, MessageAttachmentDict
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.db import BaseDbService, SessionFactoryType
from app.services.provider import ProviderService
from app.services.exceptions import ChatException, ErrorCode
from app.services.message import MessageService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import (
    LocalDockerProvider,
    SandboxProviderType,
)
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChatStreamRequest
from app.services.claude_session_registry import session_registry
from app.services.storage import StorageService
from app.services.user import UserService

from app.utils.cache import CachePubSub
from app.utils.cache import cache_connection, cache_pubsub
from app.utils.attachment_urls import AttachmentURL
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

settings = get_settings()
logger = logging.getLogger(__name__)

TERMINAL_STREAM_EVENT_TYPES = {"cancelled", "complete", "error"}


class ChatService(BaseDbService[Chat]):
    def __init__(
        self,
        storage_service: StorageService,
        sandbox_service: SandboxService,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.sandbox_service = sandbox_service
        self.storage_service = storage_service
        self.user_service = user_service
        self.message_service = MessageService(session_factory=self._session_factory)
        self._provider_service = ProviderService()

    @staticmethod
    def _sandbox_for_workspace(workspace: Workspace) -> SandboxService:
        provider = SandboxProviderFactory.create_bound(
            workspace.sandbox_provider,
            sandbox_id=workspace.sandbox_id,
            workspace_path=workspace.workspace_path,
        )
        return SandboxService(provider)

    @property
    def session_factory(self) -> SessionFactoryType:
        return self._session_factory

    @session_factory.setter
    def session_factory(self, value: SessionFactoryType) -> None:
        self._session_factory = value
        self.message_service.session_factory = value

    async def get_user_chats(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedResponse[ChatSchema]:
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
        user_settings = await self.user_service.get_user_settings(user.id)
        self._validate_api_keys(user_settings, chat_data.model_id)

        # Verify workspace exists and belongs to user
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
                .options(selectinload(Chat.messages), selectinload(Chat.workspace))
                .filter(Chat.id == chat.id)
            )
            result = await db.execute(query)
            loaded_chat: Chat = result.scalar_one()

            return loaded_chat

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
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

    async def get_chat_sandbox_id(self, chat_id: UUID, user: User) -> str | None:
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
        async with self.session_factory() as db:
            chat_query = select(Chat.id).filter(
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(chat_query)
            chat_ids = [str(row[0]) for row in result.fetchall()]

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

            await db.commit()

            for cid in chat_ids:
                asyncio.create_task(session_registry.terminate(cid))

            return len(chat_ids)

    async def get_chat_messages(
        self, chat_id: UUID, user: User, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedResponse[MessageSchema]:
        has_access = await self._verify_chat_access(chat_id, user.id)
        if not has_access:
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
                envelope = {
                    "chatId": str(event.chat_id),
                    "messageId": str(event.message_id),
                    "streamId": str(event.stream_id),
                    "seq": event.seq,
                    "kind": event.event_type,
                    "payload": event.render_payload,
                    "ts": event.created_at.isoformat() if event.created_at else None,
                }
                yield {
                    "id": str(event.seq),
                    "event": StreamEventKind.STREAM.value,
                    "data": json.dumps(envelope, ensure_ascii=False),
                }

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
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any],
        ts: str | None = None,
    ) -> dict[str, Any]:
        envelope = {
            "chatId": str(chat_id),
            "messageId": str(message_id),
            "streamId": str(stream_id),
            "seq": seq,
            "kind": kind,
            "payload": payload,
            "ts": ts or datetime.now(timezone.utc).isoformat(),
        }
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
        payload = {"error": error_message}
        resolved_message_id = message_id
        resolved_stream_id = stream_id

        if resolved_message_id is None:
            latest_assistant = await self.message_service.get_latest_assistant_message(
                chat_id
            )
            if latest_assistant is not None:
                resolved_message_id = latest_assistant.id
                if resolved_stream_id is None:
                    resolved_stream_id = latest_assistant.active_stream_id

        if resolved_message_id is None:
            synthetic_message_id = uuid4()
            synthetic_stream_id = resolved_stream_id or uuid4()
            synthetic_seq = max(int(fallback_seq), 0) + 1
            return self._build_stream_sse_event(
                chat_id=chat_id,
                message_id=synthetic_message_id,
                stream_id=synthetic_stream_id,
                seq=synthetic_seq,
                kind="error",
                payload=payload,
            )

        if resolved_stream_id is None:
            resolved_stream_id = uuid4()

        try:
            error_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=resolved_message_id,
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
            message_id=resolved_message_id,
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
        while True:
            message = await live_pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if not message:
                continue
            if message.get("type") != "message":
                continue

            # Always read from persisted event log so delivery stays sequence-ordered
            # even when multiple producers publish out of order on Redis Pub/Sub.
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
                    ts=event.created_at.isoformat() if event.created_at else None,
                )
                last_seq = int(event.seq)

                if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                    return

    async def _get_active_stream_targets(
        self, chat_id: UUID
    ) -> tuple[UUID | None, UUID | None]:
        latest_assistant_message = (
            await self.message_service.get_latest_assistant_message(chat_id)
        )
        if (
            latest_assistant_message
            and latest_assistant_message.stream_status
            == MessageStreamStatus.IN_PROGRESS
        ):
            return (
                latest_assistant_message.active_stream_id,
                latest_assistant_message.id,
            )
        return None, None

    async def create_event_stream(
        self, chat_id: UUID, after_seq: int
    ) -> AsyncIterator[dict[str, Any]]:
        active_stream_id, active_message_id = await self._get_active_stream_targets(
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
                        envelope = json.loads(item["data"])
                        if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                            return

                    async for event in self._stream_live_redis_events(
                        chat_id,
                        last_seq,
                        live_pubsub,
                    ):
                        yield event
                        event_seq = int(event["id"])
                        if event_seq > last_seq:
                            last_seq = event_seq
                        envelope = json.loads(event["data"])
                        if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                            return

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
        if not request.chat_id:
            raise ChatException(
                "chat_id is required for chat completion",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        user_settings = await self.user_service.get_user_settings(current_user.id)
        self._validate_api_keys(user_settings, request.model_id)

        chat = await self.get_chat(request.chat_id, current_user)

        chat_id = chat.id

        ws_sandbox = self._sandbox_for_workspace(chat.workspace)

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
                chat.id, request.model_id, current_user.id
            ):
                await ws_sandbox.clean_session_thinking_blocks(
                    chat.workspace.sandbox_id, session_id
                )

        user_prompt = self._extract_user_prompt(request.prompt)
        ai_prompt = user_prompt

        await self.message_service.create_message(
            chat_id,
            user_prompt,
            MessageRole.USER,
            attachments=attachments,
        )

        assistant_message = await self._create_assistant_message(chat, request.model_id)

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
                prompt=ai_prompt,
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
                ws_sandbox = self._sandbox_for_workspace(chat.workspace)
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
        source_chat = await self.get_chat(source_chat_id, user)
        source_workspace = source_chat.workspace

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

        if source_workspace.sandbox_provider != SandboxProviderType.DOCKER.value:
            raise ChatException(
                "Fork is only supported with Docker sandbox provider",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        user_settings = await self.user_service.get_user_settings(user.id)

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

    async def _verify_chat_access(self, chat_id: UUID, user_id: UUID) -> bool:
        async with self.session_factory() as db:
            query = select(
                exists().where(
                    Chat.id == chat_id,
                    Chat.user_id == user_id,
                    Chat.deleted_at.is_(None),
                )
            )
            result = await db.execute(query)
            return bool(result.scalar())

    def _validate_api_keys(self, user_settings: UserSettings, model_id: str) -> None:
        try:
            validate_model_api_keys(user_settings, model_id)
        except APIKeyValidationError as e:
            raise ChatException(
                str(e), error_code=ErrorCode.API_KEY_MISSING, status_code=400
            ) from e

    async def _create_assistant_message(self, chat: Chat, model_id: str) -> Message:
        return await self.message_service.create_message(
            chat.id,
            "",
            MessageRole.ASSISTANT,
            model_id=model_id,
            stream_status=MessageStreamStatus.IN_PROGRESS,
        )

    async def _enqueue_chat_task(
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

    @staticmethod
    def _extract_user_prompt(message_content: str | None) -> str:
        if not message_content:
            return ""
        return MessageService.extract_user_text_content(message_content)

    async def _needs_session_cleaning(
        self, chat_id: UUID, new_model_id: str, user_id: UUID
    ) -> bool:
        user_settings = await self.user_service.get_user_settings(user_id)
        if not user_settings:
            return False

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
