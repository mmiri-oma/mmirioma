"""Alembic migration environment.

Migrations run over a synchronous psycopg connection derived from DATABASE_URL,
which keeps migration scripts simple while the application itself uses asyncpg.
"""

from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import get_settings
from app.core.models import Base

# Import each module's models here so autogenerate can see their tables.
from app.modules.auth import models as auth_models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Application tables live in "public"; PostGIS also creates spatial_ref_sys there.
APP_SCHEMA = "public"

# Tables created by the PostGIS extension, which migrations must never drop.
POSTGIS_TABLES = {"spatial_ref_sys"}


def include_object(
    obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any
) -> bool:
    """Tell autogenerate to ignore PostGIS-owned tables so it never drops them."""
    return not (type_ == "table" and reflected and name in POSTGIS_TABLES)


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting (``alembic upgrade head --sql``)."""
    context.configure(
        url=get_settings().sync_database_url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations over a live synchronous psycopg connection."""
    engine = create_engine(
        get_settings().sync_database_url,
        poolclass=pool.NullPool,
        # The postgis image adds the tiger/topology schemas to search_path; without
        # pinning it, autogenerate treats their tables as ours and tries to drop them.
        connect_args={"options": f"-c search_path={APP_SCHEMA}"},
    )
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
