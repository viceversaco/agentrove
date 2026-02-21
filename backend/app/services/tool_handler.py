import json
import logging
from copy import deepcopy
from typing import Any, Literal, cast

from claude_agent_sdk.types import ToolUseBlock

from app.models.db_models.enums import ToolStatus
from app.services.streaming.types import ActiveToolState, StreamEvent

logger = logging.getLogger(__name__)


class ToolHandlerRegistry:
    def __init__(self) -> None:
        self._active: dict[str, ActiveToolState] = {}

    @staticmethod
    def _default_tool_title(tool_name: str) -> str:
        if tool_name.startswith("mcp__"):
            parts = tool_name.split("__", maxsplit=2)
            if len(parts) == 3:
                return parts[2].replace("_", " ")
        return tool_name

    def start_tool(
        self,
        content_block: ToolUseBlock,
        *,
        parent_tool_id: str | None = None,
    ) -> StreamEvent | None:
        if not content_block.id:
            return None

        input_copy = None
        if hasattr(content_block, "input") and isinstance(content_block.input, dict):
            try:
                input_copy = deepcopy(content_block.input)
            except Exception:
                input_copy = dict(content_block.input)

        tool_state = ActiveToolState(
            id=content_block.id,
            name=content_block.name,
            title=self._default_tool_title(content_block.name),
            parent_id=parent_tool_id,
            input=input_copy,
        )

        self._active[content_block.id] = tool_state

        payload = tool_state.to_payload()
        payload["status"] = ToolStatus.STARTED.value
        event: StreamEvent = {
            "type": "tool_started",
            "tool": payload,
        }
        return event

    def finish_tool(
        self,
        tool_use_id: str | None,
        raw_result: Any,
        *,
        is_error: bool = False,
    ) -> StreamEvent | None:
        if not tool_use_id:
            return None

        state = self._active.pop(tool_use_id, None)
        if not state:
            state = ActiveToolState(
                id=tool_use_id,
                name="unknown",
                title="Unknown tool",
                parent_id=None,
                input=None,
            )

        payload = state.to_payload()
        payload["status"] = (
            ToolStatus.FAILED.value if is_error else ToolStatus.COMPLETED.value
        )

        if is_error:
            payload["error"] = self._stringify_result(raw_result)
        else:
            normalized = self._normalize_result(raw_result)
            payload["result"] = normalized

        event_type: Literal["tool_failed", "tool_completed"] = (
            "tool_failed" if is_error else "tool_completed"
        )
        event: StreamEvent = {"type": event_type, "tool": payload}
        return event

    def _normalize_result(self, result: Any) -> Any:
        if result is None:
            return None

        if isinstance(result, list):
            return [self._normalize_result(item) for item in result]

        if isinstance(result, dict):
            return {key: self._normalize_result(value) for key, value in result.items()}

        if isinstance(result, str):
            text = result.strip()
            if not text:
                return ""
            try:
                return cast(Any, json.loads(text))
            except json.JSONDecodeError:
                return text

        return result

    def _stringify_result(self, result: Any) -> str:
        if isinstance(result, str):
            return result
        try:
            return json.dumps(result, ensure_ascii=False)
        except TypeError:
            return str(result)
