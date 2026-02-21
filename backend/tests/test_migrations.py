from __future__ import annotations

import subprocess

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.db.base_class import Base
from app.models.db_models import chat, refresh_token, scheduled_tasks, user  # noqa: F401

settings = get_settings()


async def drop_all_objects(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        result = await conn.execute(
            text("""
                SELECT typname FROM pg_type
                WHERE typcategory = 'E'
                AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)
        )
        for row in result:
            await conn.execute(text(f'DROP TYPE IF EXISTS "{row[0]}" CASCADE'))


def get_alembic_config() -> Config:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
    return config


def run_alembic(args: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["alembic"] + args,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{result.stderr}")
    return result


class TestMigrations:
    @pytest.fixture(autouse=True)
    async def restore_schema(self):
        yield
        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        await drop_all_objects(engine)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    @pytest.fixture
    def alembic_config(self) -> Config:
        return get_alembic_config()

    def test_migrations_have_single_head(self, alembic_config: Config) -> None:
        script = ScriptDirectory.from_config(alembic_config)
        heads = script.get_heads()
        assert len(heads) == 1, f"Multiple migration heads found: {heads}"

    def test_migration_chain_is_valid(self, alembic_config: Config) -> None:
        script = ScriptDirectory.from_config(alembic_config)

        revisions = list(script.walk_revisions())
        assert len(revisions) > 0, "No migrations found"

        revision_ids = {r.revision for r in revisions}
        for revision in revisions:
            if revision.down_revision:
                down_revs = (
                    revision.down_revision
                    if isinstance(revision.down_revision, tuple)
                    else (revision.down_revision,)
                )
                for down_rev in down_revs:
                    assert down_rev in revision_ids, (
                        f"Migration {revision.revision} references "
                        f"non-existent down_revision {down_rev}"
                    )

    @pytest.mark.asyncio
    async def test_migrations_upgrade_to_head(self) -> None:
        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        await drop_all_objects(engine)
        await engine.dispose()

        run_alembic(["upgrade", "head"])

        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)

        async with engine.begin() as conn:
            tables = await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_table_names()
            )

        await engine.dispose()

        assert "alembic_version" in tables, "alembic_version table not found"
        assert "users" in tables, "users table not found after migration"

    @pytest.mark.asyncio
    async def test_migrations_match_models(self) -> None:
        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        await drop_all_objects(engine)
        await engine.dispose()

        run_alembic(["upgrade", "head"])

        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)

        async with engine.begin() as conn:
            migrated_tables = await conn.run_sync(
                lambda sync_conn: set(inspect(sync_conn).get_table_names())
            )

        await engine.dispose()

        model_tables = set(Base.metadata.tables.keys())
        migrated_tables.discard("alembic_version")

        missing_in_migration = model_tables - migrated_tables
        extra_in_migration = migrated_tables - model_tables

        assert not missing_in_migration, (
            f"Tables defined in models but missing from migrations: {missing_in_migration}"
        )
        assert not extra_in_migration, (
            f"Tables in migrations but not in models: {extra_in_migration}"
        )

    @pytest.mark.asyncio
    async def test_migrations_downgrade_to_base(self) -> None:
        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        await drop_all_objects(engine)
        await engine.dispose()

        run_alembic(["upgrade", "head"])
        run_alembic(["downgrade", "base"])

        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)

        async with engine.begin() as conn:
            tables = await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_table_names()
            )

        await engine.dispose()

        tables_without_alembic = [t for t in tables if t != "alembic_version"]
        assert not tables_without_alembic, (
            f"Tables remain after downgrade to base: {tables_without_alembic}"
        )
