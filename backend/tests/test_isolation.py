"""One user must never read, modify, delete, search, or cite another user's data."""

from tests.conftest import PHOTO, process_all, upload_and_process

SECRET = "The launch codes are swordfish-7781 and the secret project is named Bluebird."


async def test_cannot_access_other_users_documents(alice, bob):
    doc = await upload_and_process(alice, "secret.txt", SECRET.encode())
    did = doc["id"]
    assert (await bob.get(f"/api/v1/documents/{did}")).status_code == 404
    assert (await bob.get(f"/api/v1/documents/{did}/file")).status_code == 404
    assert (await bob.get(f"/api/v1/documents/{did}/chunks")).status_code == 404
    assert (await bob.patch(f"/api/v1/documents/{did}", json={"title": "pwned"})).status_code == 404
    assert (await bob.post(f"/api/v1/documents/{did}/reprocess")).status_code == 404
    assert (await bob.delete(f"/api/v1/documents/{did}")).status_code == 404
    assert (await bob.get("/api/v1/documents")).json()["total"] == 0
    # still intact for the owner
    assert (await alice.get(f"/api/v1/documents/{did}")).json()["title"] == "secret"


async def test_search_never_returns_other_users_chunks(alice, bob):
    await upload_and_process(alice, "secret.txt", SECRET.encode())
    await upload_and_process(bob, "bobs.txt", PHOTO.encode())
    r = await bob.post("/api/v1/search", json={"query": "launch codes swordfish Bluebird", "score_threshold": 0.0})
    assert all("swordfish" not in x["chunk_text"] for x in r.json()["results"])
    # explicitly naming Alice's document id is a 404, not an empty result
    alice_doc = (await alice.get("/api/v1/documents")).json()["items"][0]["id"]
    r = await bob.post("/api/v1/search", json={"query": "launch codes", "document_ids": [alice_doc]})
    assert r.status_code == 404


async def test_chat_cannot_cite_other_users_documents(alice, bob):
    await upload_and_process(alice, "secret.txt", SECRET.encode())
    alice_doc = (await alice.get("/api/v1/documents")).json()["items"][0]["id"]
    # Bob has no documents: asking about Alice's content gets no evidence and no citations
    r = await bob.post("/api/v1/chat", json={"question": "What are the launch codes for the secret project Bluebird?"})
    assert r.status_code == 200
    msg = r.json()["message"]
    assert msg["citations"] == [] and "swordfish" not in msg["content"]
    # Bob cannot scope a chat to Alice's document
    r = await bob.post("/api/v1/chat", json={"question": "launch codes?", "document_ids": [alice_doc]})
    assert r.status_code == 404
    r = await bob.post("/api/v1/chat/stream", json={"question": "launch codes?", "document_ids": [alice_doc]})
    assert r.status_code == 404 and "swordfish" not in r.text


async def test_conversations_notes_collections_isolated(alice, bob):
    await upload_and_process(alice, "a.txt", PHOTO.encode())
    chat = (await alice.post("/api/v1/chat", json={"question": "What does photosynthesis convert light into?"})).json()
    cid, mid = chat["conversation_id"], chat["message"]["id"]
    note = (await alice.post("/api/v1/notes", json={"title": "n", "content": "private", "source_message_id": mid})).json()
    col = (await alice.post("/api/v1/collections", json={"name": "Mine"})).json()

    for method, path in [
        ("get", f"/api/v1/conversations/{cid}"),
        ("delete", f"/api/v1/conversations/{cid}"),
        ("get", f"/api/v1/conversations/{cid}/export"),
        ("post", f"/api/v1/conversations/{cid}/followups"),
        ("post", f"/api/v1/conversations/{cid}/regenerate"),
        ("get", f"/api/v1/notes/{note['id']}"),
        ("delete", f"/api/v1/notes/{note['id']}"),
        ("get", f"/api/v1/notes/{note['id']}/export"),
        ("delete", f"/api/v1/collections/{col['id']}"),
    ]:
        r = await getattr(bob, method)(path)
        assert r.status_code == 404, (method, path, r.status_code)
    assert (await bob.patch(f"/api/v1/conversations/{cid}", json={"title": "x"})).status_code == 404
    assert (await bob.patch(f"/api/v1/notes/{note['id']}", json={"title": "x"})).status_code == 404
    assert (await bob.get("/api/v1/conversations")).json()["total"] == 0
    assert (await bob.get("/api/v1/notes")).json()["total"] == 0
    assert (await bob.get("/api/v1/collections")).json() == []
    # Bob cannot continue Alice's conversation or attach her message to a note
    assert (await bob.post("/api/v1/chat", json={"question": "hi there friend", "conversation_id": cid})).status_code == 404
    assert (await bob.post("/api/v1/notes", json={"title": "t", "content": "c", "source_message_id": mid})).status_code == 404
    # nor assign Alice's docs to his collection
    bcol = (await bob.post("/api/v1/collections", json={"name": "B"})).json()
    adoc = (await alice.get("/api/v1/documents")).json()["items"][0]["id"]
    assert (await bob.post(f"/api/v1/collections/{bcol['id']}/documents", json={"document_ids": [adoc]})).status_code == 404
    assert (await bob.patch(f"/api/v1/documents/{adoc}", json={"collection_ids": [bcol["id"]]})).status_code == 404


async def test_jobs_and_dashboard_isolated(alice, bob):
    await upload_and_process(alice, "a.txt", PHOTO.encode())
    jobs = (await alice.get("/api/v1/jobs")).json()
    assert jobs["total"] == 1
    jid = jobs["items"][0]["id"]
    assert (await bob.get(f"/api/v1/jobs/{jid}")).status_code == 404
    assert (await bob.get("/api/v1/jobs")).json()["total"] == 0
    d = (await bob.get("/api/v1/dashboard")).json()
    assert d["documents"]["total"] == 0 and d["storage_bytes"] == 0


async def test_same_file_by_two_users_is_not_a_duplicate(alice, bob):
    await upload_and_process(alice, "same.txt", PHOTO.encode())
    r = await bob.post("/api/v1/documents/upload", files=[("files", ("same.txt", PHOTO.encode(), "text/plain"))])
    assert r.status_code == 201
    await process_all()
