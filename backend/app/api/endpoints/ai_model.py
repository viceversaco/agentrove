from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints._shared import load_user_settings_or_404
from app.core.deps import get_db, get_provider_service, get_user_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.ai_model import AIModelResponse
from app.services.provider import ProviderService
from app.services.user import UserService

router = APIRouter()


@router.get("/", response_model=list[AIModelResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    provider_service: ProviderService = Depends(get_provider_service),
    user_service: UserService = Depends(get_user_service),
) -> list[AIModelResponse]:
    user_settings = await load_user_settings_or_404(user_service, current_user.id, db)
    models = provider_service.get_all_models(user_settings)
    return [AIModelResponse(**model) for model in models]
