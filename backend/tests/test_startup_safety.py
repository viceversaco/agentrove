from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

import app.main as main_module
import migrate as migrate_module


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    app = main_module.create_application()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        health_response = await client.get("/health")
        assert health_response.status_code == 200
        assert health_response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_readyz_returns_ready_when_dependencies_are_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def mock_db_check() -> tuple[bool, str | None]:
        return True, None

    async def mock_redis_check() -> tuple[bool, str | None]:
        return True, None

    monkeypatch.setattr(main_module, "_check_database_ready", mock_db_check)
    monkeypatch.setattr(main_module, "_check_redis_ready", mock_redis_check)

    app = main_module.create_application()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"{main_module.settings.API_V1_STR}/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"]["ok"] is True
    assert body["checks"]["redis"]["ok"] is True


@pytest.mark.asyncio
async def test_readyz_returns_503_when_dependency_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def mock_db_check() -> tuple[bool, str | None]:
        return False, "database unavailable"

    async def mock_redis_check() -> tuple[bool, str | None]:
        return True, None

    monkeypatch.setattr(main_module, "_check_database_ready", mock_db_check)
    monkeypatch.setattr(main_module, "_check_redis_ready", mock_redis_check)

    app = main_module.create_application()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"{main_module.settings.API_V1_STR}/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"]["ok"] is False
    assert body["checks"]["database"]["error"] == "database unavailable"


def _setup_migration_mocks(
    monkeypatch: pytest.MonkeyPatch,
    *,
    environment: str,
    upgrade_side_effect: Exception,
) -> MagicMock:
    settings = SimpleNamespace(
        DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/agentrove",
        ENVIRONMENT=environment,
    )
    monkeypatch.setattr(migrate_module, "get_settings", lambda: settings)

    engine = MagicMock()
    connection = MagicMock()
    query_result = MagicMock()
    query_result.scalar.return_value = "head"
    connection.execute.return_value = query_result

    context_manager = MagicMock()
    context_manager.__enter__.return_value = connection
    context_manager.__exit__.return_value = False
    engine.connect.return_value = context_manager

    monkeypatch.setattr(migrate_module, "create_engine", lambda _url: engine)

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["alembic_version"]
    monkeypatch.setattr(migrate_module, "inspect", lambda _engine: inspector)

    config = MagicMock()
    monkeypatch.setattr(migrate_module, "Config", lambda _path: config)

    script = MagicMock()
    script.get_current_head.return_value = "head"
    script.walk_revisions.return_value = []

    class MockScriptDirectory:
        @staticmethod
        def from_config(_config: object) -> MagicMock:
            return script

    monkeypatch.setattr(migrate_module, "ScriptDirectory", MockScriptDirectory)

    command_mock = SimpleNamespace(
        stamp=MagicMock(),
        upgrade=MagicMock(side_effect=upgrade_side_effect),
    )
    monkeypatch.setattr(migrate_module, "command", command_mock)

    return engine


def test_migrations_fail_fast_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _setup_migration_mocks(
        monkeypatch,
        environment="production",
        upgrade_side_effect=RuntimeError("boom"),
    )

    with pytest.raises(RuntimeError, match="boom"):
        migrate_module.check_and_run_migrations()

    engine.dispose.assert_called_once()


def test_migrations_continue_in_non_production(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _setup_migration_mocks(
        monkeypatch,
        environment="development",
        upgrade_side_effect=RuntimeError("boom"),
    )

    migrate_module.check_and_run_migrations()

    engine.dispose.assert_called_once()
