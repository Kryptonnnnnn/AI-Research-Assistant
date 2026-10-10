"""Groq via its OpenAI-compatible chat completions API (https://console.groq.com/docs)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.core.errors import ProviderError
from app.llm.base import ChatMessage

NON_CHAT_MARKERS = ("whisper", "tts", "guard", "embed", "orpheus", "playai")


def redact(text: str, *secrets: str) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "[redacted]")
    return text


def _upstream_message(resp: httpx.Response, api_key: str) -> str:
    """The provider's own error text (e.g. 'model has been decommissioned'), truncated and secret-redacted."""
    try:
        msg = resp.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        return ""
    return redact(str(msg), api_key)[:240]


def explain_http_error(resp: httpx.Response, api_key: str) -> ProviderError:
    status = resp.status_code
    if status in (401, 403):
        return ProviderError("Groq rejected the API key (check GROQ_API_KEY).", code="provider_auth_error")
    if status == 404:
        return ProviderError(
            "Groq does not recognise this model id (check LLM_MODEL against Settings → AI provider → Refresh models).",
            code="provider_model_not_found",
        )
    if status == 429:
        wait = resp.headers.get("retry-after")
        hint = f" Retry in about {wait} s." if wait and wait.replace(".", "", 1).isdigit() else " Wait a moment and retry."
        return ProviderError("Groq rate limit reached." + hint, code="provider_rate_limited", status_code=429)
    if status >= 500:
        return ProviderError(f"Groq had a server error (HTTP {status}). Try again shortly.", code="provider_http_error")
    detail = _upstream_message(resp, api_key)
    return ProviderError(
        f"Groq rejected the request (HTTP {status}){': ' + detail if detail else ''}.", code="provider_http_error"
    )


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float, reasoning_effort: str = ""):
        if not api_key:
            raise ProviderError("GROQ_API_KEY is not configured on the server.", code="provider_not_configured")
        if not model:
            raise ProviderError("No model configured. Set LLM_MODEL (or choose one in Settings).", code="provider_not_configured")
        self.api_key, self.model, self.base_url, self.timeout = api_key, model, base_url.rstrip("/"), timeout
        self.reasoning_effort = reasoning_effort

    def _payload(self, messages: list[ChatMessage], temperature: float, max_tokens: int, stream: bool) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if self.reasoning_effort:  # reasoning tokens count against max_tokens; "low" keeps room for the visible answer
            payload["reasoning_effort"] = self.reasoning_effort
        return payload

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def complete(self, messages, *, temperature, max_tokens) -> str:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers,
                    json=self._payload(messages, temperature, max_tokens, False),
                )
        except httpx.TimeoutException as exc:
            raise ProviderError("The Groq request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Groq.", code="provider_unreachable") from exc
        if r.status_code >= 400:
            raise explain_http_error(r, self.api_key)
        try:
            data = r.json()
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("Groq returned a response in an unexpected format.", code="provider_bad_response") from exc
        if not isinstance(content, str):
            raise ProviderError("Groq returned a response in an unexpected format.", code="provider_bad_response")
        return content

    async def stream(self, messages, *, temperature, max_tokens) -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=self._headers,
                    json=self._payload(messages, temperature, max_tokens, True),
                ) as r:
                    if r.status_code >= 400:
                        await r.aread()
                        raise explain_http_error(r, self.api_key)
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            return
                        try:
                            obj = json.loads(data)
                        except ValueError:
                            continue  # tolerate keep-alive / partial junk lines
                        if isinstance(obj, dict) and obj.get("error"):
                            raise ProviderError("Groq reported an error while generating.", code="provider_http_error")
                        try:
                            delta = obj["choices"][0]["delta"].get("content")
                        except (KeyError, IndexError, TypeError, AttributeError):
                            continue
                        if delta:
                            yield delta
        except httpx.TimeoutException as exc:
            raise ProviderError("The Groq request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Groq.", code="provider_unreachable") from exc

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 20)) as client:
                r = await client.get(f"{self.base_url}/models", headers=self._headers)
        except httpx.TimeoutException as exc:
            raise ProviderError("The Groq request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Groq.", code="provider_unreachable") from exc
        if r.status_code >= 400:
            raise explain_http_error(r, self.api_key)
        try:
            ids = [m["id"] for m in r.json()["data"] if isinstance(m.get("id"), str)]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("Groq returned a model list in an unexpected format.", code="provider_bad_response") from exc
        return sorted(i for i in ids if not any(mark in i.lower() for mark in NON_CHAT_MARKERS))

    async def check(self) -> str:
        models = await self.list_models()  # proves the key works
        if self.model not in models:
            sample = ", ".join(models[:6]) or "none"
            raise ProviderError(
                f"Model '{self.model}' is not available on Groq. Currently listed chat models include: {sample}.",
                code="provider_model_not_found",
            )
        out = await self.complete([ChatMessage("user", "Reply with the single word: ok")], temperature=0, max_tokens=5)
        return f"Groq reachable; model '{self.model}' is listed and responded ({len(out)} chars)."
