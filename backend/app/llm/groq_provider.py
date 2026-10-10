"""Groq via its OpenAI-compatible chat completions API (https://console.groq.com/docs)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.core.errors import ProviderError
from app.llm.base import ChatMessage


def _explain(status: int, body: str) -> str:
    if status in (401, 403):
        return "Groq rejected the API key (check GROQ_API_KEY)."
    if status == 404:
        return "Groq does not recognise this model id (check LLM_MODEL against the current model list)."
    if status == 429:
        return "Groq rate limit reached. Wait a moment and retry."
    return f"Groq returned HTTP {status}."


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float):
        if not api_key:
            raise ProviderError("GROQ_API_KEY is not configured on the server.", code="provider_not_configured")
        if not model:
            raise ProviderError("No model configured. Set LLM_MODEL (or choose one in Settings).", code="provider_not_configured")
        self.api_key, self.model, self.base_url, self.timeout = api_key, model, base_url.rstrip("/"), timeout

    def _payload(self, messages: list[ChatMessage], temperature: float, max_tokens: int, stream: bool) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }

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
            raise ProviderError(_explain(r.status_code, r.text), code="provider_http_error")
        try:
            return r.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, ValueError) as exc:
            raise ProviderError("Unexpected response format from Groq.") from exc

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
                        raise ProviderError(_explain(r.status_code, ""), code="provider_http_error")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            return
                        try:
                            delta = json.loads(data)["choices"][0]["delta"].get("content")
                        except (KeyError, IndexError, ValueError):
                            continue
                        if delta:
                            yield delta
        except httpx.TimeoutException as exc:
            raise ProviderError("The Groq request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Groq.", code="provider_unreachable") from exc

    async def check(self) -> str:
        out = await self.complete([ChatMessage("user", "Reply with the single word: ok")], temperature=0, max_tokens=5)
        return f"Groq reachable; model '{self.model}' responded ({len(out)} chars)."
