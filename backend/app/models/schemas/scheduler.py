from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.db_models.enums import RecurrenceType, TaskExecutionStatus, TaskStatus


TIME_PATTERN = r"^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"


class ScheduledTaskBase(BaseModel):
    task_name: str = Field(..., min_length=1, max_length=255)
    prompt_message: str = Field(..., min_length=1)
    recurrence_type: RecurrenceType
    scheduled_time: str = Field(..., pattern=TIME_PATTERN)
    scheduled_day: int | None = Field(None, ge=0, le=31)
    model_id: str | None = None


class ScheduledTaskUpdate(BaseModel):
    task_name: str | None = Field(None, min_length=1, max_length=255)
    prompt_message: str | None = Field(None, min_length=1)
    recurrence_type: RecurrenceType | None = None
    scheduled_time: str | None = Field(None, pattern=TIME_PATTERN)
    scheduled_day: int | None = Field(None, ge=0, le=31)
    model_id: str | None = None
    status: TaskStatus | None = None


class ScheduledTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    task_name: str
    prompt_message: str
    recurrence_type: RecurrenceType
    scheduled_time: str
    scheduled_day: int | None
    next_execution: datetime | None
    status: TaskStatus
    model_id: str | None
    created_at: datetime
    updated_at: datetime


class TaskExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    executed_at: datetime
    completed_at: datetime | None
    status: TaskExecutionStatus
    chat_id: UUID | None
    error_message: str | None
    created_at: datetime


class TaskToggleResponse(BaseModel):
    id: UUID
    enabled: bool
    message: str
