"""Local Ollama server (https://github.com/ollama/ollama/blob/main/docs/api.md), /api/chat NDJSON streaming."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.core.errors import ProviderError


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float):
        if not model:
            raise ProviderError(
                "No model configured. Set LLM_MODEL (e.g. a model from `ollama list`).", code="provider_not_configured"
            )
        self.base_url, self.model, self.timeout = base_url.rstrip("/"), model, timeout

    def _payload(self, messages, temperature, max_tokens, stream: bool) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": stream,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }

    async def complete(self, messages, *, temperature, max_tokens) -> str:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=self._payload(messages, temperature, max_tokens, False))
        except httpx.TimeoutException as exc:
            raise ProviderError("The Ollama request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Ollama. Is it running (`ollama serve`)?", code="provider_unreachable") from exc
        if r.status_code == 404:
            raise ProviderError(
                f"Ollama model '{self.model}' not found. Run `ollama pull {self.model}`.", code="provider_http_error"
            )
        if r.status_code >= 400:
            raise ProviderError(f"Ollama returned HTTP {r.status_code}.", code="provider_http_error")
        try:
            return r.json()["message"]["content"] or ""
        except (KeyError, ValueError) as exc:
            raise ProviderError("Unexpected response format from Ollama.") from exc

    async def stream(self, messages, *, temperature, max_tokens) -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/api/chat", json=self._payload(messages, temperature, max_tokens, True)
                ) as r:
                    if r.status_code == 404:
                        await r.aread()
                        raise ProviderError(
                            f"Ollama model '{self.model}' not found. Run `ollama pull {self.model}`.", code="provider_http_error"
                        )
                    if r.status_code >= 400:
                        await r.aread()
                        raise ProviderError(f"Ollama returned HTTP {r.status_code}.", code="provider_http_error")
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            obj = json.loads(line)
                        except ValueError:
                            continue
                        if obj.get("error"):
                            raise ProviderError("Ollama reported an error while generating.")
                        piece = (obj.get("message") or {}).get("content")
                        if piece:
                            yield piece
                        if obj.get("done"):
                            return
        except httpx.TimeoutException as exc:
            raise ProviderError("The Ollama request timed out.", code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Ollama. Is it running (`ollama serve`)?", code="provider_unreachable") from exc

    async def check(self) -> str:
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 10)) as client:
                r = await client.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach Ollama. Is it running (`ollama serve`)?", code="provider_unreachable") from exc
        names = {m.get("name", "") for m in r.json().get("models", [])}
        if not any(n == self.model or n.split(":")[0] == self.model.split(":")[0] and ":" not in self.model for n in names):
            raise ProviderError(
                f"Ollama is running but model '{self.model}' is not installed. Run `ollama pull {self.model}`.",
                code="provider_not_configured",
            )
        return f"Ollama reachable; model '{self.model}' is installed."
