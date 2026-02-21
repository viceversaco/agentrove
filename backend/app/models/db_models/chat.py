import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import Enum as SQLAlchemyEnum
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base, PG_GEN_UUID
from app.db.types import GUID, enum_values

from .enums import AttachmentType, MessageRole, MessageStreamStatus


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    sandbox_id: Mapped[str] = mapped_column(String(128), nullable=False)
    sandbox_provider: Mapped[str] = mapped_column(
        String(32), default="docker", server_default="docker", nullable=False
    )
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    context_token_usage: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    last_event_seq: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pinned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user = relationship("User", back_populates="chats")
    messages = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_chats_user_id_sandbox_id", "user_id", "sandbox_id"),
        Index("idx_chats_user_id_deleted_at", "user_id", "deleted_at"),
        Index("idx_chats_user_id_updated_at_desc", "user_id", "updated_at"),
    )

    @classmethod
    def from_dict(cls, data: dict[str, str | None]) -> "Chat":
        return cls(
            id=UUID(str(data["id"])),
            user_id=UUID(str(data["user_id"])),
            title=str(data["title"]),
            sandbox_id=data.get("sandbox_id"),
            session_id=data.get("session_id"),
        )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    content_text: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    content_render: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {"events": []},
        server_default='{"events": []}',
    )
    last_seq: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    active_stream_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    role: Mapped[MessageRole] = mapped_column(
        SQLAlchemyEnum(
            MessageRole,
            name="messagerole",
            values_callable=enum_values,
        ),
        nullable=False,
    )
    model_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    checkpoint_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    total_cost_usd: Mapped[float | None] = mapped_column(
        Float, nullable=True, default=0.0, server_default="0.0"
    )
    stream_status: Mapped[MessageStreamStatus] = mapped_column(
        SQLAlchemyEnum(
            MessageStreamStatus,
            name="messagestreamstatus",
            values_callable=enum_values,
        ),
        nullable=False,
        default=MessageStreamStatus.IN_PROGRESS,
        server_default="in_progress",
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    chat = relationship("Chat", back_populates="messages")
    attachments = relationship(
        "MessageAttachment", back_populates="message", cascade="all, delete-orphan"
    )
    events = relationship(
        "MessageEvent", back_populates="message", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_messages_chat_id_created_at", "chat_id", "created_at"),
        Index("idx_messages_role_created", "role", "created_at"),
        Index("idx_messages_chat_id_deleted_at", "chat_id", "deleted_at"),
        Index("idx_messages_chat_id_role_deleted", "chat_id", "role", "deleted_at"),
    )


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    message_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_type: Mapped[AttachmentType] = mapped_column(
        SQLAlchemyEnum(
            AttachmentType,
            name="attachmenttype",
            values_callable=enum_values,
        ),
        nullable=False,
        default=AttachmentType.IMAGE,
        server_default="image",
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)

    message = relationship("Message", back_populates="attachments")


class MessageEvent(Base):
    __tablename__ = "message_events"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    message_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    stream_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    render_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    audit_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    message = relationship("Message", back_populates="events")
    chat = relationship("Chat")

    __table_args__ = (
        Index("idx_message_events_message_id_seq", "message_id", "seq"),
        Index("idx_message_events_chat_id_created_at", "chat_id", "created_at"),
        Index(
            "idx_message_events_chat_id_stream_id_seq", "chat_id", "stream_id", "seq"
        ),
        Index("uq_message_events_stream_seq", "stream_id", "seq", unique=True),
    )
