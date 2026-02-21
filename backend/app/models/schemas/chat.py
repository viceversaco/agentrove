from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.models.db_models.enums import AttachmentType, MessageRole, MessageStreamStatus


class MessageAttachmentBase(BaseModel):
    file_url: str
    file_type: AttachmentType
    filename: str | None = None


class MessageAttachment(MessageAttachmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    created_at: datetime


class ChatRequest(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    prompt: str = Field(..., min_length=1, max_length=100000)
    chat_id: UUID | None = None
    model_id: str = Field(..., min_length=1, max_length=255)
    attached_files: list[UploadFile] | None = None
    permission_mode: Literal["plan", "ask", "auto"] = "auto"
    thinking_mode: str | None = Field(None, max_length=50)
    selected_prompt_name: str | None = Field(None, max_length=100)


class MessageBase(BaseModel):
    content_text: str = ""
    content_render: dict[str, Any] = Field(default_factory=lambda: {"events": []})
    last_seq: int = 0
    active_stream_id: UUID | None = None
    role: MessageRole


class Message(MessageBase):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    id: UUID
    chat_id: UUID
    created_at: datetime
    model_id: str | None = None
    stream_status: MessageStreamStatus | None = None
    attachments: list[MessageAttachment] = Field(default_factory=list)


class ChatBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class ChatCreate(ChatBase):
    model_id: str = Field(..., min_length=1, max_length=255)


class ChatUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    pinned: bool | None = None


class Chat(ChatBase):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    sandbox_id: str | None = None
    context_token_usage: int | None = None
    pinned_at: datetime | None = None


class ContextUsage(BaseModel):
    tokens_used: int
    context_window: int
    percentage: float


class PortPreviewLink(BaseModel):
    preview_url: str
    port: int


class PreviewLinksResponse(BaseModel):
    links: list[PortPreviewLink]


class RestoreRequest(BaseModel):
    message_id: UUID


class ForkChatRequest(BaseModel):
    message_id: UUID


class ForkChatResponse(BaseModel):
    chat: Chat
    messages_copied: int


class ChatCompletionResponse(BaseModel):
    chat_id: UUID
    message_id: UUID
    last_seq: int = 0


class EnhancePromptResponse(BaseModel):
    enhanced_prompt: str


class ChatStatusResponse(BaseModel):
    has_active_task: bool
    message_id: UUID | None = None
    stream_id: UUID | None = None
    last_seq: int = 0


class MessageEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    chat_id: UUID
    stream_id: UUID
    seq: int
    event_type: str
    render_payload: dict[str, Any]
    audit_payload: dict[str, Any] | None = None
    created_at: datetime


class PermissionRespondResponse(BaseModel):
    success: bool
