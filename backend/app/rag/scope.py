"""Resolve which documents a question/search may touch, validating ownership."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationFailed
from app.models import CollectionDocument, Document
from app.models.document import DOC_READY
from app.repositories.ownership import get_collection


async def resolve_scope(
    db: AsyncSession, user_id: uuid.UUID, document_ids: list[uuid.UUID] | None, collection_id: uuid.UUID | None
) -> list[uuid.UUID]:
    """Return ids of *ready, owned* documents in scope. Empty scope = all of the user's documents."""
    explicit = list(dict.fromkeys(document_ids or []))
    if explicit:
        rows = (
            await db.execute(select(Document.id, Document.status).where(Document.user_id == user_id, Document.id.in_(explicit)))
        ).all()
        if len(rows) != len(explicit):
            raise NotFoundError("Document not found")
        ready = [r.id for r in rows if r.status == DOC_READY]
        if not ready:
            raise ValidationFailed("The selected documents have not finished processing yet.", code="documents_not_ready")
        return ready
    if collection_id:
        await get_collection(db, user_id, collection_id)  # 404 if not owned
        q = (
            select(Document.id)
            .join(CollectionDocument, CollectionDocument.document_id == Document.id)
            .where(CollectionDocument.collection_id == collection_id, Document.user_id == user_id, Document.status == DOC_READY)
        )
    else:
        q = select(Document.id).where(Document.user_id == user_id, Document.status == DOC_READY)
    return list((await db.execute(q)).scalars().all())


async def count_stale_in_scope(db: AsyncSession, doc_ids: list[uuid.UUID]) -> int:
    """How many in-scope documents were indexed with a different embedding model/chunking (unsearchable until re-indexed)."""
    if not doc_ids:
        return 0
    from sqlalchemy import func, or_

    from app.embeddings.factory import index_signature

    sig = index_signature()
    q = (
        select(func.count())
        .select_from(Document)
        .where(Document.id.in_(doc_ids), or_(Document.index_signature.is_(None), Document.index_signature != sig))
    )
    return (await db.execute(q)).scalar_one()
