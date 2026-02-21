from typing import cast

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.endpoints._shared import (
    load_settings_list_or_404,
    raise_bad_request_from_service,
    save_settings_list,
    validate_name_or_400,
)
from app.core.deps import get_db, get_command_service, get_user_service
from app.core.security import get_current_user
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

router = APIRouter()


@router.post(
    "/upload", response_model=CommandResponse, status_code=status.HTTP_201_CREATED
)
async def upload_command(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSlashCommandDict:
    user_settings, raw_commands = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_slash_commands",
    )
    current_commands = cast(list[CustomSlashCommandDict], raw_commands)

    try:
        command_data = await command_service.upload(
            str(current_user.id), file, current_commands
        )
    except CommandException as e:
        raise_bad_request_from_service(e)

    current_commands.append(command_data)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_slash_commands",
        items=current_commands,
    )

    return command_data


@router.put("/{command_name}", response_model=CommandResponse)
async def update_command(
    command_name: str,
    request: CommandUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSlashCommandDict:
    validate_name_or_400(command_service.validate_exact_sanitized_name, command_name)

    user_settings, raw_commands = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_slash_commands",
    )
    current_commands = cast(list[CustomSlashCommandDict], raw_commands)
    command_index = command_service.find_item_index_by_name(
        current_commands, command_name
    )

    if command_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Command '{command_name}' not found",
        )

    try:
        updated_command = await command_service.update(
            str(current_user.id), command_name, request.content, current_commands
        )
    except CommandException as e:
        raise_bad_request_from_service(e)

    current_commands[command_index] = updated_command
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_slash_commands",
        items=current_commands,
    )

    return updated_command


@router.delete("/{command_name}", response_model=CommandDeleteResponse)
async def delete_command(
    command_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> CommandDeleteResponse:
    validate_name_or_400(command_service.validate_exact_sanitized_name, command_name)

    user_settings, raw_commands = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_slash_commands",
    )
    current_commands = cast(list[CustomSlashCommandDict], raw_commands)
    command_index = command_service.find_item_index_by_name(
        current_commands, command_name
    )

    if command_index is None:
        return CommandDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await command_service.delete(str(current_user.id), command_name)

    current_commands.pop(command_index)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_slash_commands",
        items=current_commands,
        installed_component=f"command:{command_name}",
    )

    return CommandDeleteResponse(status=DeleteResponseStatus.DELETED.value)
