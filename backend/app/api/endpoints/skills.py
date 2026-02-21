from typing import cast

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.endpoints._shared import (
    load_settings_list_or_404,
    raise_bad_request_from_service,
    save_settings_list,
    validate_name_or_400,
)
from app.core.deps import get_db, get_skill_service, get_user_service
from app.core.security import get_current_user
from app.models.db_models.enums import DeleteResponseStatus
from app.models.db_models.user import User
from app.models.schemas.skills import SkillDeleteResponse, SkillResponse
from app.models.types import CustomSkillDict
from app.services.exceptions import SkillException
from app.services.skill import SkillService
from app.services.user import UserService

router = APIRouter()


@router.post(
    "/upload", response_model=SkillResponse, status_code=status.HTTP_201_CREATED
)
async def upload_skill(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSkillDict:
    user_settings, raw_skills = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_skills",
    )
    current_skills = cast(list[CustomSkillDict], raw_skills)

    try:
        skill_data = await skill_service.upload(
            str(current_user.id), file, current_skills
        )
    except SkillException as e:
        raise_bad_request_from_service(e)

    current_skills.append(skill_data)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_skills",
        items=current_skills,
    )

    return skill_data


@router.delete("/{skill_name}", response_model=SkillDeleteResponse)
async def delete_skill(
    skill_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> SkillDeleteResponse:
    validate_name_or_400(skill_service.validate_exact_sanitized_name, skill_name)

    user_settings, raw_skills = await load_settings_list_or_404(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        field_name="custom_skills",
    )
    current_skills = cast(list[CustomSkillDict], raw_skills)
    skill_index = skill_service.find_item_index_by_name(current_skills, skill_name)

    if skill_index is None:
        return SkillDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await skill_service.delete(str(current_user.id), skill_name)

    current_skills.pop(skill_index)
    await save_settings_list(
        user_service=user_service,
        user_settings=user_settings,
        db=db,
        user_id=current_user.id,
        field_name="custom_skills",
        items=current_skills,
        installed_component=f"skill:{skill_name}",
    )

    return SkillDeleteResponse(status=DeleteResponseStatus.DELETED.value)
