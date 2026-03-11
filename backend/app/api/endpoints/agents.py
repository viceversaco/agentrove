from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints._shared import (
    prune_installed_component,
    raise_bad_request_from_service,
    validate_name_or_400,
)
from app.core.deps import get_agent_service, get_user_service
from app.core.security import get_current_user
from app.db.session import get_db
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
from app.utils.cache import cache_connection

router = APIRouter()


@router.post(
    "/upload", response_model=AgentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_agent(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomAgentDict:
    try:
        agent_data = await agent_service.upload(file)
    except AgentException as e:
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return agent_data


@router.put("/{agent_name}", response_model=AgentResponse)
async def update_agent(
    agent_name: str,
    request: AgentUpdateRequest,
    current_user: User = Depends(get_current_user),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomAgentDict:
    validate_name_or_400(agent_service.validate_exact_sanitized_name, agent_name)

    if not agent_service.resource_exists(agent_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{agent_name}' not found",
        )

    try:
        updated_agent = await agent_service.update(agent_name, request.content)
    except AgentException as e:
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return updated_agent


@router.delete("/{agent_name}", response_model=AgentDeleteResponse)
async def delete_agent(
    agent_name: str,
    current_user: User = Depends(get_current_user),
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
    db: AsyncSession = Depends(get_db),
) -> AgentDeleteResponse:
    validate_name_or_400(agent_service.validate_exact_sanitized_name, agent_name)

    if not agent_service.resource_exists(agent_name):
        return AgentDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await agent_service.delete(agent_name)

    await prune_installed_component(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        component_id=f"agent:{agent_name}",
    )

    return AgentDeleteResponse(status=DeleteResponseStatus.DELETED.value)
