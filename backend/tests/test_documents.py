from sqlalchemy import func, select

from app.db.base import get_sessionmaker
from app.models import DocumentChunk, ProcessingJob
from tests.conftest import PHOTO, TRANSFORMER, make_blank_pdf, make_docx, make_pdf, process_all, upload, upload_and_process


async def test_upload_process_ready(alice):
    r = await upload(alice, "photosynthesis.txt", PHOTO.encode())
    assert r.status_code == 201
    doc = r.json()["items"][0]["document"]
    assert doc["status"] == "queued" and doc["title"] == "photosynthesis"
    await process_all()
    doc = (await alice.get(f"/api/v1/documents/{doc['id']}")).json()
    assert doc["status"] == "ready" and doc["progress"] == 100 and doc["chunk_count"] >= 1 and doc["error_message"] is None
    chunks = (await alice.get(f"/api/v1/documents/{doc['id']}/chunks")).json()
    assert chunks and chunks[0]["text"].startswith("Photosynthesis")


async def test_pdf_pages_recorded(alice):
    doc = await upload_and_process(alice, "paper.pdf", make_pdf([PHOTO, TRANSFORMER]), "application/pdf")
    assert doc["page_count"] == 2
    chunks = (await alice.get(f"/api/v1/documents/{doc['id']}/chunks")).json()
    assert {c["page_number"] for c in chunks} == {1, 2}
    page2 = (await alice.get(f"/api/v1/documents/{doc['id']}/chunks", params={"page_number": 2})).json()
    assert all("Transformer" in c["text"] for c in page2)


async def test_docx_upload(alice):
    data = make_docx(
        [("h1", "Climate Report"), ("p", "Global temperatures have risen by about one degree since the preindustrial era.")]
    )
    doc = await upload_and_process(
        alice, "report.docx", data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert doc["status"] == "ready"
    chunks = (await alice.get(f"/api/v1/documents/{doc['id']}/chunks")).json()
    assert chunks[0]["section"] == "Climate Report"


async def test_scanned_pdf_fails_with_clear_message_and_no_retry(alice):
    doc = await upload_and_process(alice, "scan.pdf", make_blank_pdf(), "application/pdf")
    assert doc["status"] == "failed" and "OCR" in doc["error_message"]
    async with get_sessionmaker()() as db:
        job = (await db.execute(select(ProcessingJob))).scalar_one()
    assert job.status == "failed" and job.attempts == 1  # permanent errors are not retried


async def test_rejects_bad_uploads(alice):
    r = await upload(alice, "virus.exe", b"MZ....", "application/octet-stream")
    assert r.status_code == 422 and r.json()["items"][0]["error_code"] == "unsupported_type"
    r = await upload(alice, "fake.pdf", b"just text pretending", "application/pdf")
    assert r.json()["items"][0]["error_code"] == "bad_signature"
    r = await upload(alice, "empty.txt", b"", "text/plain")
    assert r.json()["items"][0]["error_code"] == "empty_file"
    r = await upload(alice, "x.txt", b"hello hello hello hello", "image/png")
    assert r.json()["items"][0]["error_code"] == "mime_mismatch"


async def test_size_limit(alice, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_MB", "1")
    from app.core.config import reset_settings_cache

    reset_settings_cache()
    r = await upload(alice, "big.txt", b"a " * (1024 * 1024), "text/plain")
    assert r.status_code == 422 and r.json()["items"][0]["error_code"] == "file_too_large"
    reset_settings_cache()


async def test_duplicate_detection(alice):
    first = await upload(alice, "a.txt", PHOTO.encode())
    again = await upload(alice, "renamed-copy.txt", PHOTO.encode())
    assert again.status_code == 409
    item = again.json()["items"][0]
    assert item["status"] == "duplicate" and item["existing_document_id"] == first.json()["items"][0]["document"]["id"]


async def test_multi_file_upload_mixed(alice):
    r = await alice.post(
        "/api/v1/documents/upload",
        files=[
            ("files", ("a.txt", PHOTO.encode(), "text/plain")),
            ("files", ("b.md", b"# Title\n\n" + TRANSFORMER.encode(), "text/markdown")),
            ("files", ("c.exe", b"MZ", "application/octet-stream")),
        ],
    )
    assert r.status_code == 201
    assert [i["status"] for i in r.json()["items"]] == ["created", "created", "rejected"]
    await process_all()
    total = (await alice.get("/api/v1/documents")).json()["total"]
    assert total == 2


async def test_storage_uses_unique_internal_names(alice, tmp_path):
    await upload(alice, "../../evil name.txt", PHOTO.encode())
    files = [p for p in (tmp_path / "uploads").rglob("*") if p.is_file()]
    assert len(files) == 1 and "evil" not in files[0].name and files[0].suffix == ".txt"
    doc = (await alice.get("/api/v1/documents")).json()["items"][0]
    assert doc["original_filename"] == "evil name.txt"


async def test_rename_list_filter_pagination(alice):
    for i in range(5):
        await upload(alice, f"doc{i}.txt", f"Document number {i} discussing subject {i} in detail here.".encode())
    await process_all()
    page = (await alice.get("/api/v1/documents", params={"page_size": 2, "page": 3, "sort": "title"})).json()
    assert page["total"] == 5 and len(page["items"]) == 1
    doc_id = page["items"][0]["id"]
    r = await alice.patch(f"/api/v1/documents/{doc_id}", json={"title": "Renamed Doc"})
    assert r.json()["title"] == "Renamed Doc"
    found = (await alice.get("/api/v1/documents", params={"q": "renamed"})).json()
    assert found["total"] == 1
    assert (await alice.get("/api/v1/documents", params={"status": "ready"})).json()["total"] == 5
    assert (await alice.get("/api/v1/documents", params={"status": "bogus"})).status_code == 422


async def test_delete_cleans_up_everything(alice, tmp_path):
    doc = await upload_and_process(alice, "gone.txt", PHOTO.encode())
    assert any((tmp_path / "uploads").rglob("*.txt"))
    assert (await alice.delete(f"/api/v1/documents/{doc['id']}")).status_code == 204
    assert not any(p.is_file() for p in (tmp_path / "uploads").rglob("*"))
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(func.count()).select_from(DocumentChunk))).scalar_one() == 0
        assert (await db.execute(select(func.count()).select_from(ProcessingJob))).scalar_one() == 0
    assert (await alice.get(f"/api/v1/documents/{doc['id']}")).status_code == 404


async def test_reprocess_replaces_chunks_without_duplicates(alice):
    doc = await upload_and_process(alice, "r.txt", PHOTO.encode())
    n = doc["chunk_count"]
    r = await alice.post(f"/api/v1/documents/{doc['id']}/reprocess")
    assert r.status_code == 202
    again = await alice.post(f"/api/v1/documents/{doc['id']}/reprocess")
    assert again.status_code == 409  # already queued: no duplicate processing
    await process_all()
    doc2 = (await alice.get(f"/api/v1/documents/{doc['id']}")).json()
    assert doc2["status"] == "ready" and doc2["chunk_count"] == n
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(func.count()).select_from(DocumentChunk))).scalar_one() == n


async def test_file_download_and_pdf_inline(alice):
    pdf = make_pdf([PHOTO])
    doc = await upload_and_process(alice, "p.pdf", pdf, "application/pdf")
    r = await alice.get(f"/api/v1/documents/{doc['id']}/file")
    assert r.content == pdf and r.headers["content-type"] == "application/pdf" and "inline" in r.headers["content-disposition"]
    assert r.headers["x-content-type-options"] == "nosniff"


async def test_collections_crud_and_filter(alice):
    d1 = await upload_and_process(alice, "a.txt", PHOTO.encode())
    d2 = await upload_and_process(alice, "b.txt", TRANSFORMER.encode())
    col = (await alice.post("/api/v1/collections", json={"name": "Biology", "description": "bio papers"})).json()
    assert (await alice.post("/api/v1/collections", json={"name": "Biology"})).status_code == 409
    r = await alice.post(f"/api/v1/collections/{col['id']}/documents", json={"document_ids": [d1["id"]]})
    assert r.json()["document_count"] == 1
    listed = (await alice.get("/api/v1/documents", params={"collection_id": col["id"]})).json()
    assert [d["id"] for d in listed["items"]] == [d1["id"]] and listed["items"][0]["collection_ids"] == [col["id"]]
    assert (await alice.patch(f"/api/v1/collections/{col['id']}", json={"name": "Life Sciences"})).json()[
        "name"
    ] == "Life Sciences"
    # assignment through the document endpoint
    r = await alice.patch(f"/api/v1/documents/{d2['id']}", json={"collection_ids": [col["id"]]})
    assert r.json()["collection_ids"] == [col["id"]]
    await alice.request("DELETE", f"/api/v1/collections/{col['id']}/documents", json={"document_ids": [d2["id"]]})
    assert (await alice.get("/api/v1/collections")).json()[0]["document_count"] == 1
    assert (await alice.delete(f"/api/v1/collections/{col['id']}")).status_code == 204
    assert (await alice.get(f"/api/v1/documents/{d1['id']}")).status_code == 200  # documents survive collection deletion


async def test_storage_failure_is_a_clear_503_and_ready_reports_it(alice, monkeypatch):
    from app.storage.factory import get_storage

    async def boom(*a, **k):
        raise ConnectionError("bucket unreachable")

    monkeypatch.setattr(get_storage(), "save", boom)
    r = await upload(alice, "a.txt", PHOTO.encode())
    assert r.status_code == 503 and r.json()["error"]["code"] == "storage_unavailable"
    monkeypatch.setattr(get_storage(), "check", boom)
    ready = await alice.get("/ready")
    assert ready.status_code == 503 and ready.json()["checks"]["storage"] == {
        "ok": False,
        "backend": "local",
        "error": "ConnectionError",
    }
