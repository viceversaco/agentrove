from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Literal, TypedDict
from uuid import UUID

from app.models.types import JSONDict, JSONValue

StreamEventType = Literal[
    "assistant_text",
    "assistant_thinking",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "user_text",
    "system",
    "permission_request",
    "prompt_suggestions",
]
MAX_AUDIT_STRING_LENGTH = 4096
SENSITIVE_KEY_PARTS = (
    "token",
    "api_key",
    "secret",
    "password",
    "authorization",
    "cookie",
)


@dataclass(kw_only=True)
class ChatStreamRequest:
    prompt: str
    system_prompt: str
    custom_instructions: str | None
    chat_data: dict[str, Any]
    model_id: str
    permission_mode: str
    session_id: str | None
    assistant_message_id: str | None
    thinking_mode: str | None
    attachments: list[dict[str, Any]] | None
    is_custom_prompt: bool = False


class ToolPayload(TypedDict, total=False):
    id: str
    name: str
    title: str
    status: Literal["started", "completed", "failed"]
    parent_id: str | None
    input: JSONDict | None
    result: JSONValue
    error: str


class StreamEvent(TypedDict, total=False):
    type: StreamEventType
    text: str
    thinking: str
    tool: ToolPayload
    data: JSONDict
    request_id: str
    tool_name: str
    tool_input: JSONDict
    suggestions: list[str]


@dataclass
class ActiveToolState:
    id: str
    name: str
    title: str
    parent_id: str | None
    input: JSONDict | None

    def to_payload(self) -> ToolPayload:
        payload: ToolPayload = {
            "id": self.id,
            "name": self.name,
            "title": self.title,
            "parent_id": self.parent_id,
            "input": self.input or None,
        }
        return payload


@dataclass
class StreamSnapshotAccumulator:
    events: list[dict[str, Any]] = field(default_factory=list)
    text_parts: list[str] = field(default_factory=list)

    def add_event(self, kind: str, payload: dict[str, Any]) -> None:
        if kind == "assistant_text":
            text = payload.get("text")
            if isinstance(text, str) and text:
                self.text_parts.append(text)

        self.events.append({"type": kind, **payload})

    def to_render(self) -> dict[str, Any]:
        return {"events": self.events}

    @property
    def content_text(self) -> str:
        return "".join(self.text_parts)


class StreamEnvelope:
    @staticmethod
    def build(
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "chatId": str(chat_id),
            "messageId": str(message_id),
            "streamId": str(stream_id),
            "seq": seq,
            "kind": kind,
            "payload": payload or {},
            "ts": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def sanitize_payload(value: Any) -> JSONValue:
        if isinstance(value, dict):
            redacted: JSONDict = {}
            for key, nested in value.items():
                lower = key.lower()
                if any(part in lower for part in SENSITIVE_KEY_PARTS):
                    redacted[key] = "[REDACTED]"
                    continue
                redacted[key] = StreamEnvelope.sanitize_payload(nested)
            return redacted

        if isinstance(value, list):
            return [StreamEnvelope.sanitize_payload(item) for item in value]

        if isinstance(value, (bytes, bytearray, memoryview)):
            return "[BINARY_OMITTED]"

        if isinstance(value, str):
            if len(value) > MAX_AUDIT_STRING_LENGTH:
                digest = sha256(value.encode("utf-8", errors="ignore")).hexdigest()
                return {
                    "value": value[:MAX_AUDIT_STRING_LENGTH],
                    "truncated": True,
                    "sha256": digest,
                    "original_length": len(value),
                }
            return value

        if isinstance(value, (int, float, bool)) or value is None:
            return value

        return str(value)
