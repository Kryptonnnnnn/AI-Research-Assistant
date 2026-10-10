from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.db.base import get_sessionmaker
from app.embeddings.factory import get_embedding_provider, set_embedding_provider
from app.jobs import queue
from app.models import Document, DocumentChunk, ProcessingJob
from tests.conftest import PHOTO, process_all, upload, upload_and_process


class FlakyEmbedder:
    name, model, dim = "flaky", "flaky-1", 384

    def __init__(self, fail_times: int, always: bool = False):
        self.fail_times, self.always, self.calls = fail_times, always, 0
        self.inner = get_embedding_provider()

    def embed_documents(self, texts):
        self.calls += 1
        if self.always or self.calls <= self.fail_times:
            raise ConnectionError("embedding backend down")
        return self.inner.embed_documents(texts)

    def embed_query(self, text):
        return self.inner.embed_query(text)


async def _job():
    async with get_sessionmaker()() as db:
        return (await db.execute(select(ProcessingJob))).scalar_one()


async def test_transient_failure_is_retried_then_succeeds(alice):
    set_embedding_provider(FlakyEmbedder(fail_times=2))
    r = await upload(alice, "a.txt", PHOTO.encode())
    doc_id = r.json()["items"][0]["document"]["id"]
    await process_all()
    doc = (await alice.get(f"/api/v1/documents/{doc_id}")).json()
    job = await _job()
    assert doc["status"] == "ready" and job.status == "succeeded" and job.attempts == 3


async def test_retries_exhausted_marks_failed_with_safe_error(alice):
    set_embedding_provider(FlakyEmbedder(0, always=True))
    r = await upload(alice, "a.txt", PHOTO.encode())
    doc_id = r.json()["items"][0]["document"]["id"]
    await process_all()
    doc = (await alice.get(f"/api/v1/documents/{doc_id}")).json()
    job = await _job()
    assert doc["status"] == "failed" and job.attempts == job.max_attempts == 3
    assert "ConnectionError" in doc["error_message"] and "embedding backend down" not in doc["error_message"]


async def test_failed_document_can_be_reprocessed(alice):
    flaky = FlakyEmbedder(0, always=True)
    set_embedding_provider(flaky)
    r = await upload(alice, "a.txt", PHOTO.encode())
    doc_id = r.json()["items"][0]["document"]["id"]
    await process_all()
    flaky.always = False
    assert (await alice.post(f"/api/v1/documents/{doc_id}/reprocess")).status_code == 202
    await process_all()
    assert (await alice.get(f"/api/v1/documents/{doc_id}")).json()["status"] == "ready"


async def test_partial_failure_keeps_previous_chunks(alice):
    doc = await upload_and_process(alice, "a.txt", PHOTO.encode())
    set_embedding_provider(FlakyEmbedder(0, always=True))
    await alice.post(f"/api/v1/documents/{doc['id']}/reprocess")
    await process_all()
    async with get_sessionmaker()() as db:
        n = len((await db.execute(select(DocumentChunk))).scalars().all())
    assert n == doc["chunk_count"]  # old index not destroyed by a failed re-index


async def test_stale_running_job_is_recovered(alice):
    await upload(alice, "a.txt", PHOTO.encode())
    sm = get_sessionmaker()
    claimed = await queue.claim_next(sm)  # worker "crashes" right after claiming
    assert claimed is not None
    assert await queue.claim_next(sm) is None  # nobody else can take it while it's fresh
    async with sm() as db:
        await db.execute(update(ProcessingJob).values(locked_at=datetime.now(UTC) - timedelta(hours=1)))
        await db.commit()
    assert await queue.recover_stale(sm) == 1
    await process_all()
    assert (await alice.get("/api/v1/documents")).json()["items"][0]["status"] == "ready"


async def test_no_duplicate_active_jobs(alice):
    await upload(alice, "a.txt", PHOTO.encode())
    async with get_sessionmaker()() as db:
        doc = (await db.execute(select(Document))).scalar_one()
        j1 = await queue.enqueue_ingest(db, doc)
        j2 = await queue.enqueue_ingest(db, doc)
        assert j1.id == j2.id


async def test_document_deleted_while_queued(alice):
    r = await upload(alice, "a.txt", PHOTO.encode())
    await alice.delete(f"/api/v1/documents/{r.json()['items'][0]['document']['id']}")
    assert await process_all() == 0  # job was cascaded away with the document


async def test_job_status_endpoint(alice):
    r = await upload(alice, "a.txt", PHOTO.encode())
    doc_id = r.json()["items"][0]["document"]["id"]
    jobs = (await alice.get("/api/v1/jobs", params={"status": "queued"})).json()
    assert jobs["total"] == 1 and jobs["items"][0]["document_id"] == doc_id and jobs["items"][0]["document_title"] == "a"
    await process_all()
    job = (await alice.get(f"/api/v1/jobs/{jobs['items'][0]['id']}")).json()
    assert job["status"] == "succeeded" and job["progress"] == 100
