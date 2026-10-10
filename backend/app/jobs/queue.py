"""A durable job queue backed by the `processing_jobs` table (no Redis / paid broker needed)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.ingestion.pipeline import process_job
from app.models import Document, ProcessingJob
from app.models.document import DOC_FAILED, DOC_QUEUED

logger = logging.getLogger("app.jobs")
wakeup = asyncio.Event()


async def enqueue_ingest(db: AsyncSession, document: Document) -> ProcessingJob:
    """Create a job unless an active one already exists for the document (prevents duplicate processing)."""
    active = (
        (
            await db.execute(
                select(ProcessingJob).where(
                    ProcessingJob.document_id == document.id, ProcessingJob.status.in_(("queued", "running"))
                )
            )
        )
        .scalars()
        .first()
    )
    if active:
        return active
    job = ProcessingJob(user_id=document.user_id, document_id=document.id, max_attempts=get_settings().job_max_attempts)
    db.add(job)
    document.status, document.stage, document.progress, document.error_message = DOC_QUEUED, "queued", 0, None
    await db.flush()
    return job


def notify() -> None:
    try:
        wakeup.set()
    except RuntimeError:  # event bound to another loop (tests)
        pass


async def claim_next(sm: async_sessionmaker[AsyncSession]) -> uuid.UUID | None:
    async with sm() as db:
        now = datetime.now(UTC)
        q = (
            select(ProcessingJob)
            .where(ProcessingJob.status == "queued", ProcessingJob.run_after <= now)
            .order_by(ProcessingJob.run_after)
            .limit(1)
            .with_for_update(skip_locked=True)  # ignored by SQLite; safe multi-worker claim on PostgreSQL
        )
        job = (await db.execute(q)).scalars().first()
        if job is None:
            return None
        job.status, job.locked_at, job.attempts = "running", now, job.attempts + 1
        job.started_at = job.started_at or now
        await db.commit()
        return job.id


async def recover_stale(sm: async_sessionmaker[AsyncSession]) -> int:
    """Re-queue jobs whose worker died mid-run (e.g. free-tier instance restarted)."""
    cutoff = datetime.now(UTC) - timedelta(seconds=get_settings().job_stale_seconds)
    n = 0
    async with sm() as db:
        stale = (
            (await db.execute(select(ProcessingJob).where(ProcessingJob.status == "running", ProcessingJob.locked_at < cutoff)))
            .scalars()
            .all()
        )
        for job in stale:
            n += 1
            if job.attempts < job.max_attempts:
                job.status, job.stage, job.run_after = "queued", "recovered", datetime.now(UTC)
            else:
                job.status, job.finished_at = "failed", datetime.now(UTC)
                job.error_message = "Processing was interrupted repeatedly."
                await db.execute(
                    update(Document)
                    .where(Document.id == job.document_id)
                    .values(status=DOC_FAILED, error_message=job.error_message)
                )
        await db.commit()
    return n


async def run_next(sm: async_sessionmaker[AsyncSession]) -> bool:
    job_id = await claim_next(sm)
    if job_id is None:
        return False
    await process_job(sm, job_id)
    return True


async def drain(sm: async_sessionmaker[AsyncSession], max_jobs: int = 1000) -> int:
    """Process everything runnable right now (used by tests and `python -m app.jobs.worker --once`)."""
    n = 0
    while n < max_jobs and await run_next(sm):
        n += 1
    return n
