import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SQLAlchemyEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base, PG_GEN_UUID
from app.db.types import GUID, enum_values

from .enums import RecurrenceType, TaskExecutionStatus, TaskStatus


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_message: Mapped[str] = mapped_column(Text, nullable=False)
    recurrence_type: Mapped[RecurrenceType] = mapped_column(
        SQLAlchemyEnum(
            RecurrenceType,
            name="recurrencetype",
            values_callable=enum_values,
        ),
        nullable=False,
    )
    scheduled_time: Mapped[str] = mapped_column(String(8), nullable=False)
    scheduled_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_execution: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    status: Mapped[TaskStatus] = mapped_column(
        SQLAlchemyEnum(
            TaskStatus,
            name="taskstatus",
            values_callable=enum_values,
        ),
        nullable=False,
        default=TaskStatus.ACTIVE,
        server_default="active",
    )
    model_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    executions = relationship(
        "TaskExecution", back_populates="task", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_scheduled_tasks_user_next", "user_id", "next_execution"),
        Index("idx_scheduled_tasks_status_next", "status", "next_execution"),
    )


class TaskExecution(Base):
    __tablename__ = "task_executions"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=PG_GEN_UUID,
    )
    task_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("scheduled_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[TaskExecutionStatus] = mapped_column(
        SQLAlchemyEnum(
            TaskExecutionStatus,
            name="taskexecutionstatus",
            values_callable=enum_values,
        ),
        nullable=False,
    )
    chat_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    task = relationship("ScheduledTask", back_populates="executions")

    __table_args__ = (
        Index("idx_task_executions_task_created", "task_id", "created_at"),
        Index("idx_task_executions_status", "status"),
    )
