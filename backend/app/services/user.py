from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.constants import REDIS_KEY_USER_SETTINGS
from app.core.config import get_settings
from app.models.db_models import Chat, Message, MessageRole, UserSettings
from app.models.schemas import UserSettingsResponse
from app.models.types import InstalledPluginDict, JSONValue
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ErrorCode, UserException
from app.utils.cache import CacheStore, cache_connection

settings = get_settings()


class DuplicateProviderNameError(ValueError):
    pass


class UserService(BaseDbService[UserSettings]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)

    @staticmethod
    def _validate_provider_names(providers: list[dict[str, Any]] | None) -> None:
        if not providers:
            return
        seen_names: set[str] = set()
        for provider in providers:
            name = provider.get("name", "").lower().strip()
            if name in seen_names:
                raise DuplicateProviderNameError(
                    f"A provider with the name '{provider.get('name')}' already exists"
                )
            seen_names.add(name)

    async def invalidate_settings_cache(self, cache: CacheStore, user_id: UUID) -> None:
        cache_key = REDIS_KEY_USER_SETTINGS.format(user_id=user_id)
        await cache.delete(cache_key)

    async def get_user_settings(
        self,
        user_id: UUID,
        db: AsyncSession | None = None,
    ) -> UserSettings:
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)

        user_settings: UserSettings | None
        if db is None:
            async with self.session_factory() as session:
                result = await session.execute(stmt)
                user_settings = result.scalar_one_or_none()
        else:
            result = await db.execute(stmt)
            user_settings = result.scalar_one_or_none()

        if not user_settings:
            raise UserException("User settings not found")

        return user_settings

    async def get_user_settings_response(
        self,
        user_id: UUID,
        db: AsyncSession | None = None,
        cache: CacheStore | None = None,
    ) -> UserSettingsResponse:
        cache_key = REDIS_KEY_USER_SETTINGS.format(user_id=user_id)
        if cache:
            cached = await cache.get(cache_key)
            if cached:
                cached_response: UserSettingsResponse = (
                    UserSettingsResponse.model_validate_json(cached)
                )
                return cached_response

        user_settings = await self.get_user_settings(user_id=user_id, db=db)
        response: UserSettingsResponse = UserSettingsResponse.model_validate(
            user_settings
        )
        if cache:
            await cache.setex(
                cache_key,
                settings.USER_SETTINGS_CACHE_TTL_SECONDS,
                response.model_dump_json(),
            )

        return response

    async def update_user_settings(
        self, user_id: UUID, settings_update: dict[str, JSONValue], db: AsyncSession
    ) -> UserSettings:
        user_settings: UserSettings | None = await db.scalar(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        if not user_settings:
            raise UserException("User settings not found")

        json_fields = {
            "custom_providers",
            "custom_agents",
            "custom_mcps",
            "custom_env_vars",
            "custom_skills",
            "custom_slash_commands",
            "custom_prompts",
        }

        if "custom_providers" in settings_update:
            self._validate_provider_names(
                cast(list[dict[str, Any]] | None, settings_update["custom_providers"])
            )

        for field, value in settings_update.items():
            setattr(user_settings, field, value)
            if field in json_fields:
                flag_modified(user_settings, field)

        await db.commit()
        await db.refresh(user_settings)

        return user_settings

    async def save_settings(
        self, user_settings: UserSettings, db: AsyncSession, user_id: UUID
    ) -> None:
        await db.commit()
        await db.refresh(user_settings)
        async with cache_connection() as cache:
            await self.invalidate_settings_cache(cache, user_id)

    async def save_settings_or_rollback(
        self,
        user_settings: UserSettings,
        db: AsyncSession,
        user_id: UUID,
        failure_message: str,
        rollback_side_effect: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        try:
            await self.save_settings(user_settings, db, user_id)
        except Exception as exc:
            if rollback_side_effect is not None:
                await rollback_side_effect()
            await db.rollback()
            raise UserException(
                failure_message,
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc

    def remove_installed_component(
        self, user_settings: UserSettings, component_id: str
    ) -> bool:
        if not user_settings.installed_plugins:
            return False

        modified = False
        updated_plugins: list[InstalledPluginDict] = []

        for plugin in user_settings.installed_plugins:
            components = list(plugin.get("components", []))
            if component_id in components:
                components = [c for c in components if c != component_id]
                modified = True
            if components:
                plugin["components"] = components
                updated_plugins.append(plugin)
            else:
                modified = True

        if modified:
            user_settings.installed_plugins = updated_plugins
        return modified

    async def get_user_daily_message_count(self, user_id: UUID) -> int:
        today = date.today()
        start_of_day = datetime.combine(today, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )
        end_of_day = datetime.combine(today, datetime.max.time()).replace(
            tzinfo=timezone.utc
        )

        async with self.session_factory() as db:
            query = select(func.count(Message.id)).filter(
                Message.role == MessageRole.USER,
                Message.created_at >= start_of_day,
                Message.created_at <= end_of_day,
                Message.chat_id.in_(select(Chat.id).filter(Chat.user_id == user_id)),
            )
            result = await db.execute(query)
            return result.scalar() or 0
