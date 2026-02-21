import enum


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class AttachmentType(str, enum.Enum):
    IMAGE = "image"
    PDF = "pdf"
    XLSX = "xlsx"


class MessageStreamStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class RecurrenceType(str, enum.Enum):
    ONCE = "once"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskExecutionStatus(str, enum.Enum):
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class ToolStatus(str, enum.Enum):
    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"


class StreamEventKind(str, enum.Enum):
    STREAM = "stream"
    CONTENT = "content"
    COMPLETE = "complete"
    ERROR = "error"
    QUEUE_INJECTED = "queue_injected"
    QUEUE_PROCESSING = "queue_processing"


class DeleteResponseStatus(str, enum.Enum):
    DELETED = "deleted"
    NOT_FOUND = "not_found"
