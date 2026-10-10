"""Document processing: read -> extract -> chunk -> embed (batched) -> index. Runs inside a job."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.embeddings.factory import get_embedding_provider, index_signature
from app.ingestion.chunking import chunk_segments
from app.ingestion.extractors import ExtractionError, extract
from app.models import Document, DocumentChunk, ProcessingJob
from app.models.document import DOC_FAILED, DOC_PROCESSING, DOC_QUEUED, DOC_READY
from app.storage.factory import get_storage

logger = logging.getLogger("app.ingestion")


async def _progress(sm: async_sessionmaker[AsyncSession], job_id: uuid.UUID, doc_id: uuid.UUID, stage: str, pct: int) -> None:
    async with sm() as db:
        await db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id).values(stage=stage, progress=pct))
        await db.execute(update(Document).where(Document.id == doc_id).values(stage=stage, progress=pct, status=DOC_PROCESSING))
        await db.commit()


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, ExtractionError):
        return str(exc)
    if isinstance(exc, RuntimeError):  # our own configuration errors carry actionable, non-sensitive text
        return str(exc)[:300]
    return f"Unexpected error while processing ({type(exc).__name__}). It will be retried or can be reprocessed."


async def process_job(sm: async_sessionmaker[AsyncSession], job_id: uuid.UUID) -> None:
    """Execute one claimed job. Never raises: outcome is recorded on the job and document rows."""
    settings = get_settings()
    async with sm() as db:
        job = await db.get(ProcessingJob, job_id)
        if job is None:
            return
        doc = await db.get(Document, job.document_id)
        if doc is None:  # document deleted while queued
            job.status, job.finished_at = "failed", datetime.now(UTC)
            job.error_message = "Document no longer exists"
            await db.commit()
            return
        doc_id, user_id, key, ext = doc.id, doc.user_id, doc.storage_key, doc.file_ext

    try:
        await _progress(sm, job_id, doc_id, "reading", 5)
        data = await get_storage().read(key)

        await _progress(sm, job_id, doc_id, "extracting", 15)
        extracted = await asyncio.to_thread(extract, data, ext)

        await _progress(sm, job_id, doc_id, "chunking", 35)
        chunks = await asyncio.to_thread(
            chunk_segments, extracted.segments, settings.chunk_size_tokens, settings.chunk_overlap_tokens
        )
        if not chunks:
            raise ExtractionError("The document contains no readable text.")

        provider = get_embedding_provider()
        batch = max(1, settings.embedding_batch_size)
        vectors: list = []
        for i in range(0, len(chunks), batch):
            part = await asyncio.to_thread(provider.embed_documents, [c.text for c in chunks[i : i + batch]])
            vectors.extend(part)
            pct = 40 + int(50 * min(i + batch, len(chunks)) / len(chunks))
            await _progress(sm, job_id, doc_id, "embedding", pct)

        await _progress(sm, job_id, doc_id, "indexing", 92)
        async with sm() as db:
            # Atomic swap: old chunks are only removed once the new ones are fully computed.
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
            db.add_all(
                DocumentChunk(
                    document_id=doc_id,
                    user_id=user_id,
                    chunk_index=c.index,
                    text=c.text,
                    token_count=c.token_count,
                    page_number=c.page,
                    section=c.section,
                    embedding=vec,
                    embedding_model=provider.model,
                )
                for c, vec in zip(chunks, vectors, strict=True)
            )
            now = datetime.now(UTC)
            await db.execute(
                update(Document)
                .where(Document.id == doc_id)
                .values(
                    status=DOC_READY,
                    progress=100,
                    stage="done",
                    error_message=None,
                    chunk_count=len(chunks),
                    page_count=extracted.page_count,
                    index_signature=index_signature(),
                    meta={"extracted_title": extracted.title},
                    updated_at=now,
                )
            )
            await db.execute(
                update(ProcessingJob)
                .where(ProcessingJob.id == job_id)
                .values(status="succeeded", progress=100, stage="done", error_message=None, finished_at=now)
            )
            await db.commit()
        logger.info("Processed document %s (%d chunks)", doc_id, len(chunks))
    except Exception as exc:  # noqa: BLE001 - recorded, never propagated
        await _record_failure(sm, job_id, doc_id, exc)


async def _record_failure(sm, job_id: uuid.UUID, doc_id: uuid.UUID, exc: Exception) -> None:
    permanent = isinstance(exc, ExtractionError)
    logger.error("Job %s failed (%s)%s", job_id, type(exc).__name__, "" if permanent else " - may retry", exc_info=not permanent)
    msg = _safe_error(exc)
    settings = get_settings()
    async with sm() as db:
        job = await db.get(ProcessingJob, job_id)
        if job is None:
            return
        now = datetime.now(UTC)
        if not permanent and job.attempts < job.max_attempts:
            delay = settings.job_retry_backoff_seconds * (2 ** (job.attempts - 1))
            job.status, job.stage, job.run_after = "queued", "retrying", now + timedelta(seconds=delay)
            job.error_message = msg
            await db.execute(
                update(Document).where(Document.id == doc_id).values(status=DOC_QUEUED, stage="retrying", error_message=msg)
            )
        else:
            job.status, job.finished_at, job.error_message = "failed", now, msg
            await db.execute(
                update(Document)
                .where(Document.id == doc_id)
                .values(status=DOC_FAILED, stage="failed", error_message=msg, progress=0)
            )
        await db.commit()
