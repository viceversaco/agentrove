import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Response, status
from fastapi.staticfiles import StaticFiles
from granian.utils.proxies import wrap_asgi_with_proxy_headers
from sqlalchemy import text

from app.api.docs import custom_openapi
from app.api.endpoints import (
    agents,
    ai_model,
    attachments,
    auth,
    chat,
    commands,
    integrations,
    marketplace,
    mcps,
    permissions,
    sandbox,
    scheduler,
)
from app.api.endpoints import settings as settings_router
from app.api.endpoints import skills, websocket
from app.core.config import get_settings
from app.core.middleware import setup_middleware
from app.db.base_class import Base
from app.db.session import SessionLocal, engine
from app.models.db_models import chat as chat_model
from app.models.db_models import refresh_token, scheduled_tasks, user
from app.services.claude_session_registry import session_registry
from app.services.maintenance import MaintenanceService
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import cache_connection

try:
    from prometheus_fastapi_instrumentator import Instrumentator

    _instrumentator_available = True
except ImportError:
    _instrumentator_available = False

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.DESKTOP_MODE:
        await _create_sqlite_tables()
    maintenance_service = MaintenanceService()
    await maintenance_service.start()
    try:
        yield
    finally:
        await maintenance_service.stop()
        await ChatStreamRuntime.stop_background_chats()
        await session_registry.terminate_all()
        await engine.dispose()


async def _create_sqlite_tables() -> None:
    _ = (chat_model, refresh_token, scheduled_tasks, user)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("SQLite tables created via metadata.create_all()")


async def _check_database_ready() -> tuple[bool, str | None]:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:
        logger.warning("Readiness database check failed: %s", exc)
        return False, str(exc)


async def _check_redis_ready() -> tuple[bool, str | None]:
    try:
        async with cache_connection() as cache:
            pong = await cache.ping()
        if pong:
            return True, None
        return False, "Redis ping returned false"
    except Exception as exc:
        logger.warning("Readiness Redis check failed: %s", exc)
        return False, str(exc)


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url=(
            None
            if settings.ENVIRONMENT == "production"
            else f"{settings.API_V1_STR}/docs"
        ),
        openapi_url=(
            None
            if settings.ENVIRONMENT == "production"
            else f"{settings.API_V1_STR}/openapi.json"
        ),
        lifespan=lifespan,
    )

    try:
        application.mount("/static", StaticFiles(directory="static"), name="static")
    except RuntimeError as e:
        logger.debug("Static files directory not found, skipping mount: %s", e)

    try:
        storage_path = Path(settings.STORAGE_PATH)
        storage_path.mkdir(exist_ok=True)
    except OSError as e:
        logger.warning(
            "Failed to create storage directory at %s: %s", settings.STORAGE_PATH, e
        )

    setup_middleware(application)

    application.include_router(
        auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"]
    )
    application.include_router(
        chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"]
    )
    application.include_router(
        sandbox.router, prefix=f"{settings.API_V1_STR}/sandbox", tags=["Sandbox"]
    )
    application.include_router(
        websocket.router, prefix=f"{settings.API_V1_STR}/ws", tags=["WebSocket"]
    )
    application.include_router(
        settings_router.router,
        prefix=f"{settings.API_V1_STR}/settings",
        tags=["Settings"],
    )
    application.include_router(
        skills.router,
        prefix=f"{settings.API_V1_STR}/skills",
        tags=["Skills"],
    )
    application.include_router(
        commands.router,
        prefix=f"{settings.API_V1_STR}/commands",
        tags=["Commands"],
    )
    application.include_router(
        agents.router,
        prefix=f"{settings.API_V1_STR}/agents",
        tags=["Agents"],
    )
    application.include_router(
        mcps.router,
        prefix=f"{settings.API_V1_STR}/mcps",
        tags=["MCPs"],
    )
    application.include_router(
        attachments.router,
        prefix=f"{settings.API_V1_STR}",
        tags=["Attachments"],
    )
    application.include_router(
        permissions.router,
        prefix=f"{settings.API_V1_STR}",
        tags=["Permissions"],
    )
    application.include_router(
        scheduler.router,
        prefix=f"{settings.API_V1_STR}/scheduler",
        tags=["Scheduler"],
    )
    application.include_router(
        ai_model.router,
        prefix=f"{settings.API_V1_STR}/models",
        tags=["Models"],
    )
    application.include_router(
        marketplace.router,
        prefix=f"{settings.API_V1_STR}/marketplace",
        tags=["Marketplace"],
    )
    application.include_router(
        integrations.router,
        prefix=f"{settings.API_V1_STR}/integrations",
        tags=["Integrations"],
    )
    application.openapi = lambda: custom_openapi(application)

    _mount_admin(application)

    application.add_api_route("/health", health_check, methods=["GET"])
    application.add_api_route(f"{settings.API_V1_STR}/readyz", readyz, methods=["GET"])

    return application


async def health_check() -> dict[str, str]:
    return {"status": "healthy"}


async def readyz(response: Response) -> dict[str, Any]:
    db_ok, db_error = await _check_database_ready()

    checks: dict[str, dict[str, str | bool]] = {
        "database": {"ok": db_ok},
    }
    if db_error:
        checks["database"]["error"] = db_error

    all_ok = db_ok

    if not settings.DESKTOP_MODE:
        redis_ok, redis_error = await _check_redis_ready()
        checks["redis"] = {"ok": redis_ok}
        if redis_error:
            checks["redis"]["error"] = redis_error
        all_ok = all_ok and redis_ok

    if all_ok:
        return {"status": "ready", "checks": checks}

    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "not_ready", "checks": checks}


def _mount_admin(application: FastAPI) -> None:
    if settings.DESKTOP_MODE:
        return
    from app.admin.config import create_admin
    from app.admin.views import (
        ChatAdmin,
        MessageAdmin,
        MessageAttachmentAdmin,
        UserAdmin,
        UserSettingsAdmin,
    )

    admin = create_admin(application, engine, SessionLocal)
    admin.add_view(UserAdmin)
    admin.add_view(ChatAdmin)
    admin.add_view(MessageAdmin)
    admin.add_view(MessageAttachmentAdmin)
    admin.add_view(UserSettingsAdmin)


def _mount_instrumentator(application: FastAPI) -> None:
    if settings.DESKTOP_MODE or not _instrumentator_available:
        return

    Instrumentator().instrument(application).expose(application)


app = create_application()
_mount_instrumentator(app)

if not settings.DISABLE_PROXY_HEADERS:
    app = wrap_asgi_with_proxy_headers(app, trusted_hosts=settings.TRUSTED_PROXY_HOSTS)
