import pytest
from sqlalchemy import select

from app.core.config import reset_settings_cache
from app.db.base import dispose_engine, get_sessionmaker
from app.embeddings.factory import set_embedding_provider
from app.embeddings.hash_provider import HashEmbeddingProvider
from app.jobs import queue
from app.llm.factory import set_llm_override
from app.llm.mock_provider import MockProvider
from app.models import DocumentChunk
from app.storage.factory import get_storage, set_storage
from tests.conftest import PHOTO, TRANSFORMER, process_all, upload, upload_and_process


# ---------- indexing version / safe re-indexing ----------
async def test_documents_record_index_signature_and_are_fresh(alice):
    await upload_and_process(alice, "a.txt", PHOTO.encode())
    sm = get_sessionmaker()
    assert await queue.count_stale(sm) == 0
    d = (await alice.get("/api/v1/dashboard")).json()
    assert d["index_health"]["stale_documents"] == 0 and d["index_health"]["current_signature"].startswith("hash:")


async def test_changing_embedding_model_never_mixes_vectors_and_reindexes_safely(alice):
    doc = await upload_and_process(alice, "a.txt", PHOTO.encode())
    sm = get_sessionmaker()
    # switch to a different embedding model (same dimension, different identity)
    set_embedding_provider(HashEmbeddingProvider(384, "hash-bow-v2"))
    assert await queue.count_stale(sm) == 1
    # old vectors are from the old model: they must NOT be searched with the new model's query vectors
    r = (await alice.post("/api/v1/search", json={"query": "What do chloroplasts absorb?"})).json()
    assert r["results"] == [] and r["stale_documents"] == 1
    chat = (await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?"})).json()["message"]
    assert chat["retrieval_meta"]["stale_documents"] == 1 and chat["citations"] == []
    # startup scan queues the re-index; atomic swap leaves only new-model chunks
    assert await queue.enqueue_stale_reindex(sm) == 1
    assert await queue.enqueue_stale_reindex(sm) == 0  # idempotent: already queued
    await process_all()
    async with sm() as db:
        models = {c.embedding_model for c in (await db.execute(select(DocumentChunk))).scalars()}
    assert models == {"hash-bow-v2"}
    assert await queue.count_stale(sm) == 0
    r = (await alice.post("/api/v1/search", json={"query": "What do chloroplasts absorb?"})).json()
    assert r["results"] and r["stale_documents"] == 0 and r["results"][0]["document_id"] == doc["id"]


async def test_changing_chunking_triggers_reindex(alice, monkeypatch):
    await upload_and_process(alice, "a.txt", PHOTO.encode())
    monkeypatch.setenv("CHUNK_SIZE_TOKENS", "100")
    reset_settings_cache()
    assert await queue.count_stale(get_sessionmaker()) == 1
    reset_settings_cache()


async def test_failed_reindex_keeps_old_index_and_retries(alice):
    await upload_and_process(alice, "a.txt", PHOTO.encode())
    sm = get_sessionmaker()

    class Broken(HashEmbeddingProvider):
        def embed_documents(self, texts):
            raise ConnectionError("model server down")

    set_embedding_provider(Broken(384, "hash-bow-v3"))
    await queue.enqueue_stale_reindex(sm)
    await process_all()
    async with sm() as db:
        models = {c.embedding_model for c in (await db.execute(select(DocumentChunk))).scalars()}
    assert models == {"hash-bow-v1"}  # nothing was half-replaced


async def test_ready_reports_retrieval_mode_and_stale(client):
    body = (await client.get("/ready")).json()
    assert body["checks"]["embeddings"]["retrieval_mode"] == "lexical" and body["checks"]["embeddings"]["stale_documents"] == 0


# ---------- dashboard ----------
async def test_dashboard_recent_documents_and_active_jobs(alice):
    await upload_and_process(alice, "done.txt", PHOTO.encode())
    await upload(alice, "pending.txt", TRANSFORMER.encode())
    d = (await alice.get("/api/v1/dashboard")).json()
    assert [x["title"] for x in d["recent_documents"]] == ["pending", "done"]
    assert d["recent_documents"][0]["status"] == "queued" and d["recent_documents"][1]["file_ext"] == ".txt"
    assert (
        len(d["active_jobs"]) == 1
        and d["active_jobs"][0]["document_title"] == "pending"
        and d["active_jobs"][0]["status"] == "queued"
    )


# ---------- conflicts ----------
async def test_conflict_detection_requires_two_documents_and_cites_both(alice):
    a = await upload_and_process(alice, "a.txt", PHOTO.encode())
    b = await upload_and_process(alice, "b.txt", TRANSFORMER.encode())
    assert (await alice.post("/api/v1/research/conflicts", json={"document_ids": [a["id"]]})).status_code == 422
    r = (await alice.post("/api/v1/research/conflicts", json={"document_ids": [a["id"], b["id"]]})).json()
    assert "Position A" in r["content"] and "Position B" in r["content"]
    assert {c["document_id"] for c in r["citations"]} == {a["id"], b["id"]}


# ---------- citation integrity ----------
async def test_fabricated_titles_pages_and_quotes_in_answer_do_not_become_evidence(alice):
    from tests.conftest import make_pdf

    doc = await upload_and_process(alice, "real-paper.pdf", make_pdf(["Filler page about nothing.", PHOTO]), "application/pdf")

    class Fabricator(MockProvider):
        def _answer(self, messages):
            return (
                'Chloroplasts absorb light [S1] (see "Nature Plants 2031", page 99). Quote: "all plants are blue" [S5] [S1, S77].'
            )

    set_llm_override(Fabricator())
    msg = (
        await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?", "document_ids": [doc["id"]]})
    ).json()["message"]
    cited = [c for c in msg["citations"] if c["cited"]]
    assert [c["label"] for c in cited] == ["S1"]
    assert cited[0]["document_title"] == "real-paper" and cited[0]["page_number"] == 2  # from the database, not from the model
    assert cited[0]["excerpt"] in cited[0]["chunk_text"]
    assert set(msg["retrieval_meta"]["invalid_citations_removed"]) == {"S5", "S77"}
    assert "[S5]" not in msg["content"] and "[S77]" not in msg["content"]


# ---------- storage ----------
async def test_user_storage_quota_returns_507(alice, monkeypatch):
    monkeypatch.setenv("USER_STORAGE_QUOTA_MB", "0")
    reset_settings_cache()
    r = await upload(alice, "a.txt", PHOTO.encode())
    assert r.status_code == 507 and r.json()["items"][0]["error_code"] == "storage_quota_exceeded"
    reset_settings_cache()


async def test_db_storage_global_quota_and_ready_usage(alice, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "db")
    monkeypatch.setenv("DB_STORAGE_QUOTA_MB", "0")
    reset_settings_cache()
    set_storage(None)
    r = await upload(alice, "a.txt", PHOTO.encode())
    assert r.status_code == 507 and "storage is full" in r.json()["items"][0]["error"]
    monkeypatch.setenv("DB_STORAGE_QUOTA_MB", "5")
    reset_settings_cache()
    await upload_and_process(alice, "ok.txt", PHOTO.encode())
    st = (await alice.get("/ready")).json()["checks"]["storage"]
    assert st["backend"] == "db" and st["used_bytes"] == len(PHOTO) and st["quota_bytes"] == 5 * 1024 * 1024
    reset_settings_cache()
    set_storage(None)


async def test_files_survive_application_restart_db_backend(alice, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "db")
    reset_settings_cache()
    set_storage(None)
    doc = await upload_and_process(alice, "persist.txt", PHOTO.encode())
    # "restart": drop the engine and every cached singleton; the file must still be readable and re-processable
    await dispose_engine()
    set_storage(None)
    set_embedding_provider(None)
    assert (await alice.get(f"/api/v1/documents/{doc['id']}/file?download=true")).content == PHOTO.encode()
    assert (await alice.post(f"/api/v1/documents/{doc['id']}/reprocess")).status_code == 202
    await process_all()
    assert (await alice.get(f"/api/v1/documents/{doc['id']}")).json()["status"] == "ready"
    reset_settings_cache()
    set_storage(None)


async def test_files_survive_application_restart_local_backend(alice, tmp_path):
    doc = await upload_and_process(alice, "persist.txt", PHOTO.encode())
    set_storage(None)  # new storage instance pointing at the same directory
    assert (await alice.get(f"/api/v1/documents/{doc['id']}/file?download=true")).content == PHOTO.encode()


# S3 adapter against moto's S3 *emulator* (protocol-level), NOT a real bucket
@pytest.fixture
def moto_s3():
    pytest.importorskip("moto")
    from moto import mock_aws

    with mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-bucket")
        yield


async def test_s3_adapter_roundtrip_against_moto(moto_s3):
    from app.storage.s3 import S3Storage

    s = S3Storage("test-bucket", "", "us-east-1", "testing", "testing")
    await s.check()
    assert not await s.exists("u/a.txt")
    await s.save("u/a.txt", b"hello", "text/plain")
    assert await s.exists("u/a.txt") and await s.read("u/a.txt") == b"hello"
    await s.delete("u/a.txt")
    assert not await s.exists("u/a.txt")


async def test_s3_end_to_end_with_moto_and_missing_bucket_check(alice, moto_s3, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "testing")
    reset_settings_cache()
    set_storage(None)
    assert get_storage().name == "s3"
    doc = await upload_and_process(alice, "s3.txt", PHOTO.encode())
    assert doc["status"] == "ready"
    assert (await alice.get(f"/api/v1/documents/{doc['id']}/file?download=true")).content == PHOTO.encode()
    assert (await alice.get("/ready")).json()["checks"]["storage"] == {"ok": True, "backend": "s3"}
    await alice.delete(f"/api/v1/documents/{doc['id']}")
    assert not await get_storage().exists(
        f"{(await alice.get('/api/v1/auth/me')).json()['id']}/x"
    )  # no leftovers is checked below
    import boto3

    left = boto3.client("s3", region_name="us-east-1").list_objects_v2(Bucket="test-bucket").get("KeyCount", 0)
    assert left == 0  # deleting the document removed the object
    reset_settings_cache()
    set_storage(None)
