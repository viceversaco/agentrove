from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints._shared import (
    prune_installed_component,
    raise_bad_request_from_service,
    validate_name_or_400,
)
from app.core.deps import get_command_service, get_user_service
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.db_models.enums import DeleteResponseStatus
from app.models.db_models.user import User
from app.models.schemas.commands import (
    CommandDeleteResponse,
    CommandResponse,
    CommandUpdateRequest,
)
from app.models.types import CustomSlashCommandDict
from app.services.exceptions import CommandException
from app.services.command import CommandService
from app.services.user import UserService
from app.utils.cache import cache_connection

router = APIRouter()


@router.post(
    "/upload", response_model=CommandResponse, status_code=status.HTTP_201_CREATED
)
async def upload_command(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSlashCommandDict:
    try:
        command_data = await command_service.upload(file)
    except CommandException as e:
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return command_data


@router.put("/{command_name}", response_model=CommandResponse)
async def update_command(
    command_name: str,
    request: CommandUpdateRequest,
    current_user: User = Depends(get_current_user),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSlashCommandDict:
    validate_name_or_400(command_service.validate_exact_sanitized_name, command_name)

    if not command_service.resource_exists(command_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Command '{command_name}' not found",
        )

    try:
        updated_command = await command_service.update(command_name, request.content)
    except CommandException as e:
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return updated_command


@router.delete("/{command_name}", response_model=CommandDeleteResponse)
async def delete_command(
    command_name: str,
    current_user: User = Depends(get_current_user),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
    db: AsyncSession = Depends(get_db),
) -> CommandDeleteResponse:
    validate_name_or_400(command_service.validate_exact_sanitized_name, command_name)

    if not command_service.resource_exists(command_name):
        return CommandDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await command_service.delete(command_name)

    await prune_installed_component(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        component_id=f"command:{command_name}",
    )

    return CommandDeleteResponse(status=DeleteResponseStatus.DELETED.value)
