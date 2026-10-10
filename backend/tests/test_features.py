import httpx
import pytest

from app.core.errors import ProviderError
from app.llm.base import ChatMessage
from app.llm.groq_provider import GroqProvider
from app.llm.ollama_provider import OllamaProvider
from tests.conftest import PHOTO, TRANSFORMER, upload_and_process


async def two_docs(c):
    return await upload_and_process(c, "bio.txt", PHOTO.encode()), await upload_and_process(c, "ml.txt", TRANSFORMER.encode())


# ---------- research tasks ----------
async def test_summarize_with_citations(alice):
    a, _ = await two_docs(alice)
    r = await alice.post("/api/v1/research/summarize", json={"document_ids": [a["id"]], "length": "short"})
    assert r.status_code == 200
    body = r.json()
    assert body["task"] == "summarize" and "[S1]" in body["content"]
    assert all(c["document_id"] == a["id"] for c in body["citations"])
    assert all(c["excerpt"] in c["chunk_text"] for c in body["citations"])


async def test_compare_requires_two_and_cites_both(alice):
    a, b = await two_docs(alice)
    assert (await alice.post("/api/v1/research/compare", json={"document_ids": [a["id"]]})).status_code == 422
    r = (await alice.post("/api/v1/research/compare", json={"document_ids": [a["id"], b["id"]]})).json()
    assert {c["document_id"] for c in r["citations"]} == {a["id"], b["id"]}
    assert "## Agreements" in r["content"]


async def test_questions_and_findings(alice):
    a, _ = await two_docs(alice)
    q = (await alice.post("/api/v1/research/questions", json={"document_ids": [a["id"]], "count": 3})).json()
    assert q["content"].startswith("1.")
    f = (await alice.post("/api/v1/research/findings", json={"document_ids": [a["id"]], "focus": "light reactions"})).json()
    assert f["citations"]


async def test_task_rejects_unprocessed_or_foreign_documents(alice, bob):
    a, _ = await two_docs(alice)
    assert (await bob.post("/api/v1/research/summarize", json={"document_ids": [a["id"]]})).status_code == 404
    from tests.conftest import upload

    r = await upload(alice, "pending.txt", b"Not yet processed document text goes here for the queue.")
    pid = r.json()["items"][0]["document"]["id"]
    resp = await alice.post("/api/v1/research/summarize", json={"document_ids": [pid]})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "documents_not_ready"


async def test_search_endpoint_logs_activity(alice):
    await two_docs(alice)
    await alice.post("/api/v1/search", json={"query": "self-attention transformer"})
    d = (await alice.get("/api/v1/dashboard")).json()
    assert d["queries_by_kind"].get("search") == 1


# ---------- notes ----------
async def test_notes_crud_export_with_citations(alice):
    await two_docs(alice)
    chat = (await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?"})).json()
    n = (
        await alice.post(
            "/api/v1/notes",
            json={
                "title": "Chloroplast notes",
                "content": chat["message"]["content"],
                "source_message_id": chat["message"]["id"],
                "tags": ["bio", " "],
            },
        )
    ).json()
    assert n["tags"] == ["bio"] and n["citations"] and n["citations"][0]["document_title"] == "bio"
    assert (await alice.patch(f"/api/v1/notes/{n['id']}", json={"content": "Edited"})).json()["content"] == "Edited"
    assert (await alice.get("/api/v1/notes", params={"q": "edited"})).json()["total"] == 1
    md = await alice.get(f"/api/v1/notes/{n['id']}/export")
    assert (
        md.text.startswith("# Chloroplast notes")
        and "## Sources" in md.text
        and "chloroplast-notes.md" in md.headers["content-disposition"]
    )
    assert (await alice.delete(f"/api/v1/notes/{n['id']}")).status_code == 204
    assert (await alice.get(f"/api/v1/notes/{n['id']}")).status_code == 404


async def test_note_validation(alice):
    assert (await alice.post("/api/v1/notes", json={"title": "", "content": "x"})).status_code == 422


# ---------- dashboard ----------
async def test_dashboard_reflects_real_data(alice):
    d0 = (await alice.get("/api/v1/dashboard")).json()
    assert d0["documents"]["total"] == 0 and d0["conversations"] == 0 and d0["popular_documents"] == []
    a, b = await two_docs(alice)
    from tests.conftest import upload

    await upload(alice, "pending.txt", b"Queued document text that is long enough to pass.")
    await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?"})
    d = (await alice.get("/api/v1/dashboard")).json()
    assert d["documents"] == {"total": 3, "ready": 2, "processing": 1, "failed": 0}
    assert d["conversations"] == 1 and d["questions_asked"] == 1
    assert d["storage_bytes"] == len(PHOTO) + len(TRANSFORMER) + len(b"Queued document text that is long enough to pass.")
    assert d["popular_documents"][0]["title"] == "bio" and d["popular_documents"][0]["access_count"] == 1
    assert sum(x["count"] for x in d["queries_last_14_days"]) == 1 and len(d["queries_last_14_days"]) == 14
    assert d["recent_activity"]


# ---------- settings ----------
async def test_settings_defaults_update_reset(alice):
    s = (await alice.get("/api/v1/settings")).json()
    assert (
        s["llm_provider"] == "mock" and s["top_k"] == 8 and s["embedding_provider"] == "hash" and s["overrides"]["top_k"] is False
    )
    assert "api_key" not in str(s).lower()
    s = (await alice.put("/api/v1/settings", json={"top_k": 3, "theme": "dark", "score_threshold": 0.4})).json()
    assert s["top_k"] == 3 and s["theme"] == "dark" and s["overrides"]["top_k"] is True
    s = (await alice.put("/api/v1/settings", json={"reset": ["top_k"]})).json()
    assert s["top_k"] == 8 and s["score_threshold"] == 0.4
    assert (await alice.put("/api/v1/settings", json={"top_k": 0})).status_code == 422
    assert (await alice.put("/api/v1/settings", json={"theme": "neon"})).status_code == 422


async def test_user_retrieval_settings_are_applied(alice):
    await two_docs(alice)
    await alice.put("/api/v1/settings", json={"score_threshold": 0.95})
    msg = (await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?"})).json()["message"]
    assert msg["retrieval_meta"]["insufficient_evidence"] is True and msg["retrieval_meta"]["score_threshold"] == 0.95


async def test_settings_are_per_user(alice, bob):
    await alice.put("/api/v1/settings", json={"top_k": 2})
    assert (await bob.get("/api/v1/settings")).json()["top_k"] == 8


async def test_provider_connection_test_never_leaks_secrets(alice, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "fake-test-key-123")
    from app.core.config import reset_settings_cache

    reset_settings_cache()
    ok = (await alice.post("/api/v1/settings/test-provider", json={"llm_provider": "mock"})).json()
    assert ok["ok"] is True
    bad = (await alice.post("/api/v1/settings/test-provider", json={"llm_provider": "ollama"})).json()
    assert bad["ok"] is False and "model" in bad["detail"].lower()
    assert "fake-test-key-123" not in (await alice.get("/api/v1/settings")).text
    reset_settings_cache()


# ---------- health ----------
async def test_health_and_ready(client):
    assert (await client.get("/health")).json()["status"] == "ok"
    r = await client.get("/ready")
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ready" and body["checks"]["database"]["ok"] is True
    assert (await client.get("/api/v1/health")).status_code == 200
    assert "secret" not in r.text.lower()


async def test_request_latency_header_and_security_headers(client):
    r = await client.get("/health")
    assert float(r.headers["x-process-time-ms"]) >= 0 and r.headers["x-content-type-options"] == "nosniff"


async def test_error_handling_envelope(client):
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "http_404"
    r = await client.get("/api/v1/documents/not-a-uuid", headers={"Authorization": "Bearer x"})
    assert r.status_code in (401, 422)


async def test_unhandled_exception_returns_safe_500(app, alice, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("db password is hunter2")

    monkeypatch.setattr("app.services.dashboard_service.metrics", boom)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", cookies=alice.cookies) as c:
        r = await c.get("/api/v1/dashboard")
    assert r.status_code == 500 and "hunter2" not in r.text and r.json()["error"]["code"] == "internal_error"


async def test_cors_only_allows_configured_origin(client):
    ok = await client.options(
        "/api/v1/auth/login", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    bad = await client.options(
        "/api/v1/auth/login", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in bad.headers


def test_production_config_requires_real_secret():
    from pydantic import ValidationError

    from app.core.config import INSECURE_SECRET, Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production", secret_key=INSECURE_SECRET)
    with pytest.raises(ValidationError):
        Settings(app_env="production", secret_key="x" * 40, cors_origins="*")
    Settings(app_env="production", secret_key="x" * 40, cors_origins="https://app.example.com")


# ---------- provider wire formats (httpx MockTransport, no network) ----------
def patch_httpx(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


MSGS = [ChatMessage("system", "s"), ChatMessage("user", "hi")]


async def test_groq_complete_and_stream(monkeypatch):
    seen = {}

    def handler(req: httpx.Request):
        body = __import__("json").loads(req.content)
        seen.update(auth=req.headers["authorization"], url=str(req.url), body=body)
        if body["stream"]:
            sse = (
                "".join(f'data: {{"choices":[{{"delta":{{"content":"{w}"}}}}]}}\n\n' for w in ["Hel", "lo"]) + "data: [DONE]\n\n"
            )
            return httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello"}}]})

    patch_httpx(monkeypatch, handler)
    p = GroqProvider("k123", "some-model", "https://api.groq.com/openai/v1", 5)
    assert await p.complete(MSGS, temperature=0.1, max_tokens=50) == "Hello"
    assert seen["url"].endswith("/chat/completions") and seen["auth"] == "Bearer k123" and seen["body"]["model"] == "some-model"
    assert [t async for t in p.stream(MSGS, temperature=0.1, max_tokens=50)] == ["Hel", "lo"]


@pytest.mark.parametrize("status,needle", [(401, "GROQ_API_KEY"), (404, "model"), (429, "rate limit")])
async def test_groq_errors_are_explained(monkeypatch, status, needle):
    patch_httpx(monkeypatch, lambda req: httpx.Response(status, json={"error": {"message": "sk-leak"}}))
    p = GroqProvider("k", "m", "https://x/v1", 5)
    with pytest.raises(ProviderError) as e:
        await p.complete(MSGS, temperature=0, max_tokens=5)
    assert needle.lower() in e.value.message.lower() and "sk-leak" not in e.value.message


async def test_groq_timeout_and_unreachable(monkeypatch):
    def timeout(req):
        raise httpx.ReadTimeout("slow", request=req)

    patch_httpx(monkeypatch, timeout)
    p = GroqProvider("k", "m", "https://x/v1", 1)
    with pytest.raises(ProviderError) as e:
        await p.complete(MSGS, temperature=0, max_tokens=5)
    assert e.value.code == "provider_timeout"
    with pytest.raises(ProviderError) as e2:
        _ = [t async for t in p.stream(MSGS, temperature=0, max_tokens=5)]
    assert e2.value.code == "provider_timeout"


def test_groq_requires_key_and_model():
    with pytest.raises(ProviderError, match="GROQ_API_KEY"):
        GroqProvider("", "m", "https://x", 1)
    with pytest.raises(ProviderError, match="LLM_MODEL"):
        GroqProvider("k", "", "https://x", 1)


async def test_ollama_complete_stream_and_check(monkeypatch):
    def handler(req: httpx.Request):
        if req.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "llama3.2:latest"}]})
        body = __import__("json").loads(req.content)
        assert req.url.path == "/api/chat" and body["model"] == "llama3.2"
        if body["stream"]:
            lines = '{"message":{"content":"Hi"},"done":false}\n{"message":{"content":" there"},"done":false}\n{"message":{"content":""},"done":true}\n'
            return httpx.Response(200, content=lines)
        return httpx.Response(200, json={"message": {"content": "Hi there"}, "done": True})

    patch_httpx(monkeypatch, handler)
    p = OllamaProvider("http://localhost:11434", "llama3.2", 5)
    assert await p.complete(MSGS, temperature=0, max_tokens=5) == "Hi there"
    assert "".join([t async for t in p.stream(MSGS, temperature=0, max_tokens=5)]) == "Hi there"
    assert "installed" in await p.check()
    with pytest.raises(ProviderError, match="not installed"):
        await OllamaProvider("http://localhost:11434", "missing-model", 5).check()


async def test_ollama_unreachable(monkeypatch):
    def refuse(req):
        raise httpx.ConnectError("refused")

    patch_httpx(monkeypatch, refuse)
    with pytest.raises(ProviderError, match="ollama serve"):
        await OllamaProvider("http://localhost:11434", "m", 5).complete(MSGS, temperature=0, max_tokens=5)


def test_database_url_normalisation_for_hosted_postgres():
    from app.db.base import _normalise_url, sync_url

    neon = "postgres://u:p@ep-x.neon.tech/db?sslmode=require"
    assert _normalise_url(neon) == "postgresql+asyncpg://u:p@ep-x.neon.tech/db?ssl=require"
    assert sync_url(neon) == "postgresql+psycopg2://u:p@ep-x.neon.tech/db?sslmode=require"
    neon2 = "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert _normalise_url(neon2) == "postgresql+asyncpg://u:p@ep-x.neon.tech/db?ssl=require"  # asyncpg can't take channel_binding
    assert "channel_binding=require" in sync_url(neon2)  # psycopg2/libpq supports it
    assert sync_url("sqlite+aiosqlite:///./x.db") == "sqlite:///./x.db"


async def test_api_timestamps_are_timezone_aware(alice):
    me = (await alice.get("/api/v1/auth/me")).json()
    assert me["created_at"].endswith(("Z", "+00:00"))
