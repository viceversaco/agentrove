import asyncio
import logging
from pathlib import Path
from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError

from app.core.deps import get_workspace_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.pagination import PaginatedResponse
from app.models.schemas.settings import CustomAgent, CustomSkill, CustomSlashCommand
from app.models.schemas.workspace import (
    Workspace as WorkspaceSchema,
    WorkspaceCreate,
    WorkspaceResources,
    WorkspaceUpdate,
)
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import WorkspaceException
from app.services.skill import SkillService
from app.services.workspace import WorkspaceService

router = APIRouter()
logger = logging.getLogger(__name__)


def _raise_workspace_http_exception(exc: WorkspaceException) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _discover_workspace_resources(claude_dir: Path) -> WorkspaceResources:
    agent_service = AgentService(base_path=claude_dir / "agents")
    command_service = CommandService(base_path=claude_dir / "commands")
    skill_service = SkillService(base_path=claude_dir / "skills")
    return WorkspaceResources(
        agents=[CustomAgent.model_validate(a) for a in agent_service.list_all()],
        commands=[
            CustomSlashCommand.model_validate(c) for c in command_service.list_all()
        ],
        skills=[CustomSkill.model_validate(s) for s in skill_service.list_all()],
    )


@router.post(
    "",
    response_model=WorkspaceSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace(
    data: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceSchema:
    try:
        return await workspace_service.create_workspace(current_user, data)
    except WorkspaceException as e:
        _raise_workspace_http_exception(e)
    except SQLAlchemyError as e:
        logger.error("Database error creating workspace: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating workspace",
        ) from e


@router.get("", response_model=PaginatedResponse[WorkspaceSchema])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> PaginatedResponse[WorkspaceSchema]:
    return await workspace_service.get_user_workspaces(current_user)


@router.get("/{workspace_id}", response_model=WorkspaceSchema)
async def get_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceSchema:
    try:
        return await workspace_service.get_workspace(workspace_id, current_user)
    except WorkspaceException as e:
        _raise_workspace_http_exception(e)


@router.patch("/{workspace_id}", response_model=WorkspaceSchema)
async def update_workspace(
    workspace_id: UUID,
    data: WorkspaceUpdate,
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceSchema:
    try:
        return await workspace_service.update_workspace(
            workspace_id, current_user, data
        )
    except WorkspaceException as e:
        _raise_workspace_http_exception(e)


@router.get("/{workspace_id}/resources", response_model=WorkspaceResources)
async def get_workspace_resources(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceResources:
    try:
        workspace = await workspace_service.get_workspace(workspace_id, current_user)
    except WorkspaceException as e:
        _raise_workspace_http_exception(e)
    project_claude_dir = Path(workspace.workspace_path) / ".claude"
    return await asyncio.to_thread(_discover_workspace_resources, project_claude_dir)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> None:
    try:
        await workspace_service.delete_workspace(workspace_id, current_user)
    except WorkspaceException as e:
        _raise_workspace_http_exception(e)
