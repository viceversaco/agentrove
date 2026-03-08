from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.schemas.settings import CustomAgent, CustomSkill, CustomSlashCommand


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    source_type: Literal["git", "local", "empty"] = "empty"
    workspace_path: str | None = Field(None, max_length=2048)
    git_url: str | None = Field(None, max_length=2048)
    sandbox_provider: Literal["docker", "host"] | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)


class Workspace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    user_id: UUID
    sandbox_id: str
    sandbox_provider: str
    workspace_path: str
    source_type: str | None = None
    source_url: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkspaceResources(BaseModel):
    agents: list[CustomAgent] = Field(default_factory=list)
    commands: list[CustomSlashCommand] = Field(default_factory=list)
    skills: list[CustomSkill] = Field(default_factory=list)
