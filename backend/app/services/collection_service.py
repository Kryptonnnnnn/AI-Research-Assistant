from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models import Collection, CollectionDocument, Document
from app.repositories.ownership import get_collection
from app.schemas.documents import CollectionOut


async def _out(db: AsyncSession, cols: list[Collection]) -> list[CollectionOut]:
    counts = (
        dict(
            (
                await db.execute(
                    select(CollectionDocument.collection_id, func.count())
                    .where(CollectionDocument.collection_id.in_([c.id for c in cols]))
                    .group_by(CollectionDocument.collection_id)
                )
            ).all()
        )
        if cols
        else {}
    )
    return [
        CollectionOut(
            id=c.id, name=c.name, description=c.description, created_at=c.created_at, document_count=counts.get(c.id, 0)
        )
        for c in cols
    ]


async def list_collections(db: AsyncSession, user_id: uuid.UUID) -> list[CollectionOut]:
    cols = (
        (await db.execute(select(Collection).where(Collection.user_id == user_id).order_by(func.lower(Collection.name))))
        .scalars()
        .all()
    )
    return await _out(db, list(cols))


async def create_collection(db: AsyncSession, user_id: uuid.UUID, name: str, description: str) -> CollectionOut:
    col = Collection(user_id=user_id, name=name.strip(), description=description.strip())
    db.add(col)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("A collection with this name already exists.", code="name_taken") from exc
    return (await _out(db, [col]))[0]


async def update_collection(
    db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID, name: str | None, description: str | None
) -> CollectionOut:
    col = await get_collection(db, user_id, cid)
    if name is not None:
        col.name = name.strip()
    if description is not None:
        col.description = description.strip()
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("A collection with this name already exists.", code="name_taken") from exc
    return (await _out(db, [col]))[0]


async def delete_collection(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID) -> None:
    col = await get_collection(db, user_id, cid)
    await db.delete(col)  # links cascade; documents themselves are kept
    await db.commit()


async def assign_documents(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID, doc_ids: list[uuid.UUID]) -> CollectionOut:
    col = await get_collection(db, user_id, cid)
    ids = list(dict.fromkeys(doc_ids))
    owned = set((await db.execute(select(Document.id).where(Document.user_id == user_id, Document.id.in_(ids)))).scalars())
    if owned != set(ids):
        from app.core.errors import NotFoundError

        raise NotFoundError("Document not found")
    existing = set(
        (await db.execute(select(CollectionDocument.document_id).where(CollectionDocument.collection_id == cid))).scalars()
    )
    db.add_all(CollectionDocument(collection_id=cid, document_id=d) for d in ids if d not in existing)
    await db.commit()
    return (await _out(db, [col]))[0]


async def remove_documents(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID, doc_ids: list[uuid.UUID]) -> CollectionOut:
    col = await get_collection(db, user_id, cid)
    await db.execute(
        delete(CollectionDocument).where(CollectionDocument.collection_id == cid, CollectionDocument.document_id.in_(doc_ids))
    )
    await db.commit()
    return (await _out(db, [col]))[0]
