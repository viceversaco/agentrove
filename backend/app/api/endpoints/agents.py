from typing import cast

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.endpoints._shared import (
    load_settings_list_or_404,
    raise_bad_request_from_service,
    save_settings_list,
    validate_name_or_400,
)
from app.core.deps import get_db, get_agent_service, get_user_service
from app.core.security import get_current_user
from app.models.db_models.enums import DeleteResponseStatus
from app.models.db_models.user import User
from app.models.schemas.agents import (
    AgentDeleteResponse,
    AgentResponse,
    AgentUpdateRequest,
)
from app.models.types import CustomAgentDict
from app.services.exceptions import AgentException
from app.services.agent import AgentService
from app.services.user import UserService

router = APIRouter()


@router.post(
    "/upload", response_model=AgentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_agent(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomAgentDict:
    user_settings, raw_agents = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_agents",
    )
    current_agents = cast(list[CustomAgentDict], raw_agents)

    try:
        agent_data = await agent_service.upload(
            str(current_user.id), file, current_agents
        )
    except AgentException as e:
        raise_bad_request_from_service(e)

    current_agents.append(agent_data)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_agents",
        items=current_agents,
    )

    return agent_data


@router.put("/{agent_name}", response_model=AgentResponse)
async def update_agent(
    agent_name: str,
    request: AgentUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomAgentDict:
    validate_name_or_400(agent_service.validate_exact_sanitized_name, agent_name)

    user_settings, raw_agents = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_agents",
    )
    current_agents = cast(list[CustomAgentDict], raw_agents)
    agent_index = agent_service.find_item_index_by_name(current_agents, agent_name)

    if agent_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{agent_name}' not found",
        )

    try:
        updated_agent = await agent_service.update(
            str(current_user.id), agent_name, request.content, current_agents
        )
    except AgentException as e:
        raise_bad_request_from_service(e)

    current_agents[agent_index] = updated_agent
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_agents",
        items=current_agents,
    )

    return updated_agent


@router.delete("/{agent_name}", response_model=AgentDeleteResponse)
async def delete_agent(
    agent_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> AgentDeleteResponse:
    validate_name_or_400(agent_service.validate_exact_sanitized_name, agent_name)

    user_settings, raw_agents = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_agents",
    )
    current_agents = cast(list[CustomAgentDict], raw_agents)
    agent_index = agent_service.find_item_index_by_name(current_agents, agent_name)

    if agent_index is None:
        return AgentDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await agent_service.delete(str(current_user.id), agent_name)

    current_agents.pop(agent_index)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_agents",
        items=current_agents,
        installed_component=f"agent:{agent_name}",
    )

    return AgentDeleteResponse(status=DeleteResponseStatus.DELETED.value)
