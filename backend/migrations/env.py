from logging.config import fileConfig
import asyncio
from sqlalchemy import pool
import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.dialects import postgresql

from alembic import context
from app.db.base_class import Base
from app.models.db_models import chat, refresh_token, scheduled_tasks, user  # noqa: F401
from app.core.config import get_settings
from app.db.types import GUID

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

settings = get_settings()
database_url = settings.DATABASE_URL
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://")


def render_item(type_, obj, autogen_context):
    if type_ == "type" and isinstance(obj, GUID):
        autogen_context.imports.add("from app.db.types import GUID")
        return "GUID()"
    return False


def compare_server_default(
    migration_context,
    inspected_column,
    metadata_column,
    rendered_column_default,
    metadata_default,
    rendered_metadata_default,
):
    json_types = (sa.JSON, postgresql.JSON, postgresql.JSONB)
    if isinstance(inspected_column.type, json_types) or isinstance(
        metadata_column.type, json_types
    ):
        return False
    return None


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
        compare_server_default=compare_server_default,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_item=render_item,
        compare_server_default=compare_server_default,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(
        database_url,
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
