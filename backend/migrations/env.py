from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import app.models  # noqa: F401  (register tables)
from app.core.config import get_settings
from app.db.base import Base, sync_url

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)
target_metadata = Base.metadata


POSTGRES_ONLY_INDEXES = {"ix_chunks_embedding_hnsw", "ix_chunks_text_fts"}  # created in raw SQL (pgvector / FTS)


def include_object(obj, name, type_, reflected, compare_to):
    return not (type_ == "index" and name in POSTGRES_ONLY_INDEXES)


def _url() -> str:
    return sync_url(get_settings().database_url)


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, render_as_batch=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=conn.dialect.name == "sqlite", include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
