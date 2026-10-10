from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import PurePosixPath

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError
from app.ingestion.validation import validate_content, validate_metadata
from app.jobs import queue
from app.models import CollectionDocument, Document, DocumentChunk, ProcessingJob
from app.repositories.ownership import get_collection, get_document
from app.schemas.documents import DocumentOut, DocumentUpdate, UploadItem
from app.storage.factory import get_storage

logger = logging.getLogger("app.documents")


async def attach_collections(db: AsyncSession, docs: list[Document]) -> list[DocumentOut]:
    ids = [d.id for d in docs]
    mapping: dict[uuid.UUID, list[uuid.UUID]] = {i: [] for i in ids}
    if ids:
        rows = (
            await db.execute(
                select(CollectionDocument.document_id, CollectionDocument.collection_id).where(
                    CollectionDocument.document_id.in_(ids)
                )
            )
        ).all()
        for doc_id, col_id in rows:
            mapping[doc_id].append(col_id)
    out = []
    for d in docs:
        o = DocumentOut.model_validate(d)
        o.collection_ids = mapping[d.id]
        out.append(o)
    return out


async def ingest_upload(db: AsyncSession, user_id: uuid.UUID, filename: str, content_type: str | None, data: bytes) -> UploadItem:
    settings = get_settings()
    try:
        meta = validate_metadata(filename, content_type)
        validate_content(data, meta.ext, settings.max_upload_bytes)
    except AppError as exc:
        return UploadItem(filename=filename[:200], status="rejected", error=exc.message, error_code=exc.code)

    digest = hashlib.sha256(data).hexdigest()
    existing = (
        await db.execute(select(Document.id).where(Document.user_id == user_id, Document.content_hash == digest))
    ).scalar_one_or_none()
    if existing:
        return UploadItem(
            filename=meta.display_name,
            status="duplicate",
            existing_document_id=existing,
            error="You have already uploaded this exact file.",
            error_code="duplicate",
        )

    key = f"{user_id}/{meta.internal_name}"
    storage = get_storage()
    await storage.save(key, data, meta.mime)
    doc = Document(
        user_id=user_id,
        title=PurePosixPath(meta.display_name).stem[:500] or "Untitled",
        original_filename=meta.display_name,
        storage_key=key,
        file_ext=meta.ext,
        mime_type=meta.mime,
        size_bytes=len(data),
        content_hash=digest,
    )
    db.add(doc)
    try:
        await db.flush()  # may violate (user_id, content_hash) if a concurrent upload won the race
        await queue.enqueue_ingest(db, doc)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await storage.delete(key)
        existing = (
            await db.execute(select(Document.id).where(Document.user_id == user_id, Document.content_hash == digest))
        ).scalar_one_or_none()
        return UploadItem(
            filename=meta.display_name,
            status="duplicate",
            existing_document_id=existing,
            error="You have already uploaded this exact file.",
            error_code="duplicate",
        )
    queue.notify()
    return UploadItem(filename=meta.display_name, status="created", document=(await attach_collections(db, [doc]))[0])


async def list_documents(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    page: int,
    page_size: int,
    status: str | None,
    collection_id: uuid.UUID | None,
    q: str | None,
    sort: str,
):
    cond = [Document.user_id == user_id]
    if status:
        cond.append(Document.status == status)
    if q:
        like = f"%{q.lower()}%"
        cond.append(or_(func.lower(Document.title).like(like), func.lower(Document.original_filename).like(like)))
    base = select(Document).where(*cond)
    if collection_id:
        await get_collection(db, user_id, collection_id)
        base = base.join(CollectionDocument, CollectionDocument.document_id == Document.id).where(
            CollectionDocument.collection_id == collection_id
        )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    order = {
        "newest": Document.created_at.desc(),
        "oldest": Document.created_at.asc(),
        "title": func.lower(Document.title).asc(),
        "size": Document.size_bytes.desc(),
        "popular": Document.access_count.desc(),
    }.get(sort, Document.created_at.desc())
    docs = (await db.execute(base.order_by(order, Document.id).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return await attach_collections(db, list(docs)), total


async def update_document(db: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID, data: DocumentUpdate) -> DocumentOut:
    doc = await get_document(db, user_id, doc_id)
    if data.title is not None:
        doc.title = data.title.strip() or doc.title
    if data.collection_ids is not None:
        wanted = set(data.collection_ids)
        for cid in wanted:
            await get_collection(db, user_id, cid)  # ownership check for each target collection
        await db.execute(delete(CollectionDocument).where(CollectionDocument.document_id == doc.id))
        db.add_all(CollectionDocument(collection_id=cid, document_id=doc.id) for cid in wanted)
    await db.commit()
    return (await attach_collections(db, [doc]))[0]


async def delete_document(db: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID) -> None:
    doc = await get_document(db, user_id, doc_id)
    key = doc.storage_key
    await db.delete(doc)  # chunks, jobs, collection links cascade; message citations are SET NULL (snapshots remain)
    await db.commit()
    try:
        await get_storage().delete(key)
    except Exception:  # noqa: BLE001 - row is gone; an orphaned blob is logged, not fatal
        logger.warning("Failed to delete stored file for document %s", doc_id, exc_info=True)


async def reprocess_document(db: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID) -> Document:
    doc = await get_document(db, user_id, doc_id)
    active = (
        await db.execute(
            select(ProcessingJob.id).where(ProcessingJob.document_id == doc.id, ProcessingJob.status.in_(("queued", "running")))
        )
    ).first()
    if active:
        raise ConflictError("This document is already being processed.", code="already_processing")
    await queue.enqueue_ingest(db, doc)
    await db.commit()
    queue.notify()
    return doc


async def reprocess_all(db: AsyncSession, user_id: uuid.UUID) -> int:
    docs = (await db.execute(select(Document).where(Document.user_id == user_id))).scalars().all()
    n = 0
    for d in docs:
        before = d.status
        job = await queue.enqueue_ingest(db, d)
        n += 1 if job is not None and before != "queued" else 0
    await db.commit()
    queue.notify()
    return n


async def document_chunks(
    db: AsyncSession, user_id: uuid.UUID, doc_id: uuid.UUID, page_number: int | None, limit: int, offset: int
):
    await get_document(db, user_id, doc_id)
    q = select(DocumentChunk).where(DocumentChunk.document_id == doc_id, DocumentChunk.user_id == user_id)
    if page_number is not None:
        q = q.where(DocumentChunk.page_number == page_number)
    return (await db.execute(q.order_by(DocumentChunk.chunk_index).offset(offset).limit(limit))).scalars().all()
