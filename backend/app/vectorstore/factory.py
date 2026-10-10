from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.vectorstore.numpy_store import NumpyVectorStore
from app.vectorstore.pgvector_store import PgVectorStore


def get_vector_store(db: AsyncSession):
    """pgvector on PostgreSQL, NumPy brute force otherwise."""
    return PgVectorStore() if db.get_bind().dialect.name == "postgresql" else NumpyVectorStore()
