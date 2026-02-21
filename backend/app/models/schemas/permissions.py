from typing import Any

from pydantic import BaseModel, Field


class PermissionRequest(BaseModel):
    tool_name: str = Field(..., min_length=1)
    tool_input: dict[str, Any]


class PermissionRequestResponse(BaseModel):
    request_id: str = Field(..., min_length=1)


class PermissionResult(BaseModel):
    approved: bool
    alternative_instruction: str | None = None
    user_answers: dict[str, Any] | None = None
