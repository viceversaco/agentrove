import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_user_service
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import UserSettingsBase, UserSettingsResponse
from app.services.exceptions import UserException
from app.services.user import DuplicateProviderNameError, UserService
from app.utils.cache import cache_connection

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserSettingsResponse:
    try:
        async with cache_connection() as cache:
            return await user_service.get_user_settings_response(
                current_user.id, cache=cache
            )
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.patch("/", response_model=UserSettingsResponse)
async def update_user_settings(
    settings_update: UserSettingsBase,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> UserSettingsResponse:
    try:
        update_data = settings_update.model_dump(exclude_unset=True)
        user_settings = await user_service.update_user_settings(
            user_id=current_user.id, settings_update=update_data, db=db
        )
        async with cache_connection() as cache:
            await user_service.invalidate_settings_cache(cache, current_user.id)
        response: UserSettingsResponse = UserSettingsResponse.model_validate(
            user_settings
        )
        return response
    except DuplicateProviderNameError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
