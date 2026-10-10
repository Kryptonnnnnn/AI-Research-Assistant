"""Provider failure modes: missing credentials, invalid models, rate limits, timeouts, malformed responses."""

import json

import httpx
import pytest

from app.core.errors import ProviderError
from app.llm.base import ChatMessage
from app.llm.factory import llm_status
from app.llm.groq_provider import GroqProvider
from app.llm.ollama_provider import OllamaProvider
from tests.test_features import patch_httpx

MSGS = [ChatMessage("user", "hi")]
KEY = "gsk_FAKE_KEY_FOR_TESTS_0123456789"


def groq() -> GroqProvider:
    return GroqProvider(KEY, "some-model", "https://api.groq.com/openai/v1", 5)


async def expect(provider, code, needle=None):
    with pytest.raises(ProviderError) as e:
        await provider.complete(MSGS, temperature=0, max_tokens=5)
    assert e.value.code == code, e.value.message
    if needle:
        assert needle.lower() in e.value.message.lower()
    assert KEY not in e.value.message
    return e.value


async def test_invalid_model_upstream_message_is_shown_but_key_is_redacted(monkeypatch):
    body = {"error": {"message": f"The model `old-model` has been decommissioned (key {KEY})", "type": "invalid_request_error"}}
    patch_httpx(monkeypatch, lambda req: httpx.Response(400, json=body))
    err = await expect(groq(), "provider_http_error", "decommissioned")
    assert "[redacted]" in err.message


async def test_404_means_unknown_model(monkeypatch):
    patch_httpx(monkeypatch, lambda req: httpx.Response(404, json={"error": {"message": "model_not_found"}}))
    await expect(groq(), "provider_model_not_found", "model id")


async def test_rate_limit_is_429_with_retry_hint(monkeypatch):
    patch_httpx(
        monkeypatch, lambda req: httpx.Response(429, headers={"retry-after": "17"}, json={"error": {"message": "slow down"}})
    )
    err = await expect(groq(), "provider_rate_limited", "17 s")
    assert err.status_code == 429


@pytest.mark.parametrize("status", [500, 502, 503])
async def test_upstream_5xx(monkeypatch, status):
    patch_httpx(monkeypatch, lambda req: httpx.Response(status, text="boom"))
    await expect(groq(), "provider_http_error", "server error")


@pytest.mark.parametrize(
    "payload",
    [
        b"not json at all",
        b"{}",
        b'{"choices": []}',
        b'{"choices": [{"message": {}}]}',
        b'{"choices": [{"message": {"content": 123}}]}',
    ],
)
async def test_malformed_success_responses(monkeypatch, payload):
    patch_httpx(monkeypatch, lambda req: httpx.Response(200, content=payload))
    await expect(groq(), "provider_bad_response", "unexpected format")


async def test_timeout_and_unreachable(monkeypatch):
    def slow(req):
        raise httpx.ReadTimeout("slow", request=req)

    patch_httpx(monkeypatch, slow)
    await expect(groq(), "provider_timeout")

    def down(req):
        raise httpx.ConnectError("no route", request=req)

    patch_httpx(monkeypatch, down)
    await expect(groq(), "provider_unreachable")


async def test_stream_tolerates_junk_and_surfaces_midstream_errors(monkeypatch):
    sse = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\n: keep-alive\n\ndata: {not json}\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n'
    patch_httpx(monkeypatch, lambda req: httpx.Response(200, content=sse))
    assert [t async for t in groq().stream(MSGS, temperature=0, max_tokens=5)] == ["A", "B"]
    err = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"error":{"message":"overloaded"}}\n\n'
    patch_httpx(monkeypatch, lambda req: httpx.Response(200, content=err))
    got = []
    with pytest.raises(ProviderError):
        async for t in groq().stream(MSGS, temperature=0, max_tokens=5):
            got.append(t)
    assert got == ["A"]  # partial output was delivered before the failure


async def test_stream_http_error_before_first_token(monkeypatch):
    patch_httpx(monkeypatch, lambda req: httpx.Response(401, json={"error": {"message": "bad key"}}))
    with pytest.raises(ProviderError) as e:
        _ = [t async for t in groq().stream(MSGS, temperature=0, max_tokens=5)]
    assert e.value.code == "provider_auth_error"


async def test_groq_list_models_and_check(monkeypatch):
    def handler(req: httpx.Request):
        if req.url.path.endswith("/models"):
            return httpx.Response(
                200, json={"data": [{"id": "some-model"}, {"id": "whisper-large"}, {"id": "other-chat"}, {"id": "llama-guard"}]}
            )
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    patch_httpx(monkeypatch, handler)
    assert await groq().list_models() == ["other-chat", "some-model"]  # audio/guard models filtered out
    assert "listed" in await groq().check()
    bad = GroqProvider(KEY, "gone-model", "https://api.groq.com/openai/v1", 5)
    with pytest.raises(ProviderError) as e:
        await bad.check()
    assert e.value.code == "provider_model_not_found" and "other-chat" in e.value.message


async def test_ollama_malformed(monkeypatch):
    patch_httpx(monkeypatch, lambda req: httpx.Response(200, content=b'{"message": {"content": null}}'))
    with pytest.raises(ProviderError) as e:
        await OllamaProvider("http://localhost:11434", "m", 5).complete(MSGS, temperature=0, max_tokens=5)
    assert e.value.code == "provider_bad_response"


def test_llm_status_never_includes_secrets(monkeypatch):
    from app.core.config import reset_settings_cache

    monkeypatch.setenv("GROQ_API_KEY", "")
    reset_settings_cache()
    assert llm_status("groq", "m")["status"] == "missing_api_key"
    monkeypatch.setenv("GROQ_API_KEY", KEY)
    reset_settings_cache()
    assert llm_status("groq", "")["status"] == "missing_model"
    ok = llm_status("groq", "m")
    assert ok["status"] == "ok" and KEY not in json.dumps(ok)
    assert llm_status("ollama", "")["status"] == "missing_model"
    assert llm_status("nope", "m")["status"] == "unknown_provider"
    reset_settings_cache()


async def test_ready_reports_missing_model_without_secrets(client, monkeypatch):
    from app.core.config import reset_settings_cache

    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_MODEL", "")
    monkeypatch.setenv("GROQ_API_KEY", KEY)
    reset_settings_cache()
    r = await client.get("/ready")
    body = r.json()
    assert body["checks"]["llm"]["status"] == "missing_model" and "LLM_MODEL" in body["checks"]["llm"]["hint"]
    assert any("LLM not usable" in w for w in body["warnings"]) and KEY not in r.text
    assert body["checks"]["embeddings"]["retrieval_mode"] == "lexical"  # hash embedder is labelled honestly
    reset_settings_cache()


async def test_settings_models_endpoint_is_safe(alice, monkeypatch):
    from app.core.config import reset_settings_cache

    monkeypatch.setenv("GROQ_API_KEY", "")
    reset_settings_cache()
    r = (await alice.get("/api/v1/settings/models", params={"provider": "groq"})).json()
    assert r["models"] == [] and "GROQ_API_KEY" in r["error"]
    monkeypatch.setenv("GROQ_API_KEY", KEY)
    reset_settings_cache()
    patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"data": [{"id": "m1"}, {"id": "m2"}]}))
    ok = (await alice.get("/api/v1/settings/models", params={"provider": "groq"})).json()
    assert ok["models"] == ["m1", "m2"] and ok["error"] is None
    assert (await alice.get("/api/v1/settings/models", params={"provider": "mock"})).status_code == 422
    reset_settings_cache()


async def test_chat_surfaces_rate_limit_as_429(alice, monkeypatch):
    from app.llm.factory import set_llm_override
    from app.llm.mock_provider import MockProvider
    from tests.conftest import PHOTO, upload_and_process

    await upload_and_process(alice, "a.txt", PHOTO.encode())

    class Limited(MockProvider):
        async def complete(self, messages, **kw):
            raise ProviderError("Groq rate limit reached.", code="provider_rate_limited", status_code=429)

    set_llm_override(Limited())
    r = await alice.post("/api/v1/chat", json={"question": "What do chloroplasts absorb?"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "provider_rate_limited"
