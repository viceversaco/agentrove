from collections.abc import Callable, Mapping, Sequence
from typing import Any, NoReturn, TypeVar
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models.user import UserSettings
from app.services.exceptions import ServiceException, UserException
from app.services.user import UserService
from app.utils.cache import cache_connection


async def load_user_settings_or_404(
    user_service: UserService, user_id: UUID, db: AsyncSession
) -> UserSettings:
    try:
        return await user_service.get_user_settings(user_id, db=db)
    except UserException as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


async def load_settings_list_or_404(
    *,
    user_service: UserService,
    user_id: UUID,
    db: AsyncSession,
    field_name: str,
) -> tuple[UserSettings, list[Any]]:
    user_settings = await load_user_settings_or_404(user_service, user_id, db)
    items = getattr(user_settings, field_name)
    return user_settings, list(items or [])


NamedItemT = TypeVar("NamedItemT", bound=Mapping[str, object])


def find_named_item_index(
    items: Sequence[Mapping[str, object]], name: str
) -> int | None:
    return next((i for i, item in enumerate(items) if item.get("name") == name), None)


def append_named_item_if_missing(items: list[NamedItemT], item: NamedItemT) -> None:
    if find_named_item_index(items, str(item.get("name"))) is None:
        items.append(item)


def raise_bad_request_from_service(exc: ServiceException) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(exc),
    ) from exc


def validate_name_or_400(
    validate_name: Callable[[str], None],
    name: str,
) -> None:
    try:
        validate_name(name)
    except ServiceException as exc:
        raise_bad_request_from_service(exc)


async def prune_installed_component(
    *,
    user_service: UserService,
    user_id: UUID,
    db: AsyncSession,
    component_id: str,
) -> None:
    user_settings = await load_user_settings_or_404(user_service, user_id, db)
    if user_service.remove_installed_component(user_settings, component_id):
        flag_modified(user_settings, "installed_plugins")
        await user_service.save_settings(user_settings, db, user_id)
    else:
        async with cache_connection() as cache:
            await user_service.invalidate_settings_cache(cache, user_id)


async def save_settings_list(
    *,
    user_service: UserService,
    user_settings: UserSettings,
    db: AsyncSession,
    user_id: UUID,
    field_name: str,
    items: list[Any],
    installed_component: str | None = None,
) -> None:
    setattr(user_settings, field_name, items)
    flag_modified(user_settings, field_name)
    if installed_component and user_service.remove_installed_component(
        user_settings, installed_component
    ):
        flag_modified(user_settings, "installed_plugins")
    await user_service.save_settings(user_settings, db, user_id)
