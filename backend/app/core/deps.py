import logging
from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.core.user_manager import optional_current_active_user
from app.db.session import SessionLocal, get_db
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.services.agent import AgentService
from app.services.chat import ChatService
from app.services.command import CommandService
from app.services.exceptions import UserException
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.provider import ProviderService
from app.services.refresh_token import RefreshTokenService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.scheduler import SchedulerService
from app.services.skill import SkillService
from app.services.storage import StorageService
from app.services.user import UserService

logger = logging.getLogger(__name__)


def get_provider_service() -> ProviderService:
    return ProviderService()


def get_user_service() -> UserService:
    return UserService(session_factory=SessionLocal)


def get_refresh_token_service() -> RefreshTokenService:
    return RefreshTokenService(session_factory=SessionLocal)


def get_skill_service() -> SkillService:
    return SkillService()


def get_command_service() -> CommandService:
    return CommandService()


def get_agent_service() -> AgentService:
    return AgentService()


async def get_github_token(
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> str | None:
    if user is None:
        return None
    try:
        user_settings = await user_service.get_user_settings(user.id, db=db)
        token = user_settings.github_personal_access_token
        return token if token else None
    except UserException:
        return None


async def get_marketplace_service(
    github_token: str | None = Depends(get_github_token),
) -> MarketplaceService:
    return MarketplaceService(github_token=github_token)


async def get_plugin_installer_service(
    github_token: str | None = Depends(get_github_token),
) -> PluginInstallerService:
    return PluginInstallerService(github_token=github_token)


def get_scheduler_service() -> SchedulerService:
    return SchedulerService(session_factory=SessionLocal)


async def validate_sandbox_ownership(
    sandbox_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    query = select(Chat.sandbox_id).where(
        Chat.sandbox_id == sandbox_id,
        Chat.user_id == current_user.id,
        Chat.deleted_at.is_(None),
    )
    result = await db.execute(query)
    if not result.one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sandbox not found",
        )
    return sandbox_id


async def get_sandbox_service(
    request: Request,
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[SandboxService]:
    provider_type = SandboxProviderType.DOCKER
    e2b_api_key = None
    modal_api_key = None

    sandbox_id = request.path_params.get("sandbox_id")
    if sandbox_id:
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        query = select(Chat.sandbox_provider).where(
            Chat.sandbox_id == sandbox_id,
            Chat.user_id == user.id,
            Chat.deleted_at.is_(None),
        )
        result = await db.execute(query)
        row = result.one_or_none()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sandbox not found",
            )
        sandbox_provider = row.sandbox_provider
    else:
        sandbox_provider = None

    if user:
        try:
            user_settings = await user_service.get_user_settings(user.id, db=db)
            if user_settings.sandbox_provider:
                provider_type = SandboxProviderType(user_settings.sandbox_provider)
            if user_settings.e2b_api_key:
                e2b_api_key = user_settings.e2b_api_key
            if user_settings.modal_api_key:
                modal_api_key = user_settings.modal_api_key
        except UserException as e:
            logger.warning("Failed to load user settings for sandbox: %s", e)

    if sandbox_provider:
        provider_type = SandboxProviderType(sandbox_provider)

    api_key = None
    if provider_type == SandboxProviderType.E2B:
        api_key = e2b_api_key
    elif provider_type == SandboxProviderType.MODAL:
        api_key = modal_api_key

    provider = SandboxProviderFactory.create(
        provider_type=provider_type,
        api_key=api_key,
    )
    try:
        yield SandboxService(provider)
    finally:
        await provider.cleanup()


async def get_storage_service(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> StorageService:
    return StorageService(sandbox_service)


async def get_chat_service(
    file_service: StorageService = Depends(get_storage_service),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[ChatService]:
    yield ChatService(
        file_service,
        sandbox_service,
        user_service,
        session_factory=SessionLocal,
    )
