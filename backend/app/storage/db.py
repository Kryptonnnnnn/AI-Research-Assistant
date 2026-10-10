from __future__ import annotations

from sqlalchemy import delete, select, text

from app.db.base import get_sessionmaker
from app.models import StoredFile


class DatabaseStorage:
    """Stores file bytes in the application database. Convenient on hosts with an ephemeral disk and no object
    storage; mind your database size quota (every upload counts against it)."""

    name = "db"

    async def save(self, key: str, data: bytes, content_type: str = "") -> None:
        async with get_sessionmaker()() as db:
            await db.execute(delete(StoredFile).where(StoredFile.key == key))
            db.add(StoredFile(key=key, content_type=content_type, size_bytes=len(data), content=data))
            await db.commit()

    async def read(self, key: str) -> bytes:
        async with get_sessionmaker()() as db:
            row = (await db.execute(select(StoredFile.content).where(StoredFile.key == key))).scalar_one_or_none()
        if row is None:
            raise FileNotFoundError(key)
        return bytes(row)

    async def delete(self, key: str) -> None:
        async with get_sessionmaker()() as db:
            await db.execute(delete(StoredFile).where(StoredFile.key == key))
            await db.commit()

    async def exists(self, key: str) -> bool:
        async with get_sessionmaker()() as db:
            return (await db.execute(select(StoredFile.key).where(StoredFile.key == key))).first() is not None

    async def check(self) -> None:
        async with get_sessionmaker()() as db:
            await db.execute(text("SELECT 1 FROM stored_files LIMIT 1"))
