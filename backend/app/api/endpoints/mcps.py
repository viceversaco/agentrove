import re

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints._shared import (
    find_named_item_index,
    load_settings_list_or_404,
    save_settings_list,
)
from app.core.deps import get_db, get_user_service
from app.core.security import get_current_user
from app.models.db_models.enums import DeleteResponseStatus
from app.models.db_models.user import User
from app.models.schemas.mcps import (
    McpCreateRequest,
    McpDeleteResponse,
    McpResponse,
    McpUpdateRequest,
)
from app.models.types import CustomMcpDict
from app.services.user import UserService

SAFE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\.]+$")
MAX_MCPS_PER_USER = 20

router = APIRouter()


@router.post("/", response_model=McpResponse, status_code=status.HTTP_201_CREATED)
async def create_mcp(
    request: McpCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> CustomMcpDict:
    if not SAFE_NAME_PATTERN.match(request.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid MCP name format",
        )

    user_settings, raw_mcps = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_mcps",
    )
    current_mcps = cast(list[CustomMcpDict], raw_mcps)

    if len(current_mcps) >= MAX_MCPS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {MAX_MCPS_PER_USER} MCPs per user",
        )

    if any(m.get("name") == request.name for m in current_mcps):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"MCP '{request.name}' already exists",
        )

    mcp_data: CustomMcpDict = {
        "name": request.name,
        "description": request.description,
        "command_type": request.command_type,
        "package": request.package,
        "url": request.url,
        "env_vars": request.env_vars,
        "args": request.args,
        "enabled": request.enabled,
    }

    current_mcps.append(mcp_data)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_mcps",
        items=current_mcps,
    )

    return mcp_data


@router.put("/{mcp_name}", response_model=McpResponse)
async def update_mcp(
    mcp_name: str,
    request: McpUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> CustomMcpDict:
    if not SAFE_NAME_PATTERN.match(mcp_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid MCP name format",
        )

    user_settings, raw_mcps = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_mcps",
    )
    current_mcps = cast(list[CustomMcpDict], raw_mcps)
    mcp_index = find_named_item_index(current_mcps, mcp_name)

    if mcp_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MCP '{mcp_name}' not found",
        )

    mcp = current_mcps[mcp_index]
    update_data = request.model_dump(exclude_unset=True)
    mcp.update(update_data)

    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_mcps",
        items=current_mcps,
    )

    return mcp


@router.delete("/{mcp_name}", response_model=McpDeleteResponse)
async def delete_mcp(
    mcp_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> McpDeleteResponse:
    if not SAFE_NAME_PATTERN.match(mcp_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid MCP name format",
        )

    user_settings, raw_mcps = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_mcps",
    )
    current_mcps = cast(list[CustomMcpDict], raw_mcps)
    mcp_index = find_named_item_index(current_mcps, mcp_name)

    if mcp_index is None:
        return McpDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    current_mcps.pop(mcp_index)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_mcps",
        items=current_mcps,
        installed_component=f"mcp:{mcp_name}",
    )

    return McpDeleteResponse(status=DeleteResponseStatus.DELETED.value)
