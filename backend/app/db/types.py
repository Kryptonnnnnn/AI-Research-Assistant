"""Column types that work on both PostgreSQL (pgvector) and SQLite (dev/tests)."""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, LargeBinary
from sqlalchemy.types import TypeDecorator

from app.core.config import get_settings


class EmbeddingType(TypeDecorator):
    """pgvector `vector(N)` on PostgreSQL; packed float32 bytes elsewhere.

    The SQLite fallback exists so the whole app (and the test-suite) runs with zero
    infrastructure. Similarity search for it is done in NumPy (see vectorstore/).
    """

    impl = LargeBinary
    cache_ok = True

    def __init__(self, dim: int | None = None):
        super().__init__()
        self.dim = dim or get_settings().embedding_dim

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(self.dim))
        return dialect.type_descriptor(LargeBinary())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        arr = np.asarray(value, dtype=np.float32)
        if dialect.name == "postgresql":
            return arr.tolist()
        return arr.tobytes()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return np.asarray(value, dtype=np.float32)
        return np.frombuffer(value, dtype=np.float32)


class UTCDateTime(TypeDecorator):
    """timezone-aware UTC datetimes on every backend (SQLite drops tzinfo; this restores it)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC)
        return value

    def process_result_value(self, value: datetime | None, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
