from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.constants import REDIS_KEY_USER_SETTINGS
from app.core.config import get_settings
from app.models.db_models.user import UserSettings
from pydantic import BaseModel

from app.models.schemas.settings import (
    CustomAgent,
    CustomSkill,
    CustomSlashCommand,
    UserSettingsResponse,
)
from app.models.types import InstalledPluginDict
from app.services.claude_folder_sync import CLAUDE_DIR, ClaudeFolderSync
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import UserException
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

        if ClaudeFolderSync.is_active():
            self._merge_claude_folder_resources(response)

        if cache:
            await cache.setex(
                cache_key,
                settings.USER_SETTINGS_CACHE_TTL_SECONDS,
                response.model_dump_json(),
            )

        return response

    @staticmethod
    def _merge_claude_folder_resources(response: UserSettingsResponse) -> None:
        if not CLAUDE_DIR.is_dir():
            return

        plugin_paths = ClaudeFolderSync.get_active_plugin_paths()
        merge_specs: list[tuple[str, Any, type[BaseModel]]] = [
            ("custom_agents", ClaudeFolderSync.merge_agents, CustomAgent),
            (
                "custom_slash_commands",
                ClaudeFolderSync.merge_commands,
                CustomSlashCommand,
            ),
            ("custom_skills", ClaudeFolderSync.merge_skills, CustomSkill),
        ]
        for attr, merge_fn, model_cls in merge_specs:
            current = getattr(response, attr) or []
            db_items = [x.model_dump() for x in current]
            merged = merge_fn(db_items, plugin_paths=plugin_paths)
            if len(merged) > len(db_items):
                new_items = [
                    model_cls.model_validate(x) for x in merged[len(current) :]
                ]
                setattr(response, attr, list(current) + new_items)

    async def update_user_settings(
        self, user_id: UUID, settings_update: dict[str, Any], db: AsyncSession
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
