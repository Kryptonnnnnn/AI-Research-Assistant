from __future__ import annotations

from app.core.config import get_settings
from app.core.errors import ProviderError
from app.llm.base import LLMProvider

_override: LLMProvider | None = None


def set_llm_override(provider: LLMProvider | None) -> None:
    """Tests inject a provider here."""
    global _override
    _override = provider


def get_llm(provider: str | None = None, model: str | None = None) -> LLMProvider:
    if _override is not None:
        return _override
    s = get_settings()
    provider = provider or s.llm_provider
    model = model or s.llm_model
    if provider == "groq":
        from app.llm.groq_provider import GroqProvider

        return GroqProvider(s.groq_api_key, model, s.groq_base_url, s.llm_timeout_seconds)
    if provider == "ollama":
        from app.llm.ollama_provider import OllamaProvider

        return OllamaProvider(s.ollama_base_url, model, s.llm_timeout_seconds)
    if provider == "mock":
        if not s.allow_mock_provider:
            raise ProviderError("The mock provider is disabled on this server.", code="provider_not_configured")
        from app.llm.mock_provider import MockProvider

        return MockProvider(model or "mock-1")
    raise ProviderError(f"Unknown LLM provider '{provider}'.", code="provider_not_configured")


def available_providers() -> list[dict]:
    s = get_settings()
    out = [
        {"id": "groq", "label": "Groq (hosted)", "configured": bool(s.groq_api_key)},
        {"id": "ollama", "label": "Ollama (local)", "configured": True},
    ]
    if s.allow_mock_provider:
        out.append({"id": "mock", "label": "Mock (offline demo)", "configured": True})
    return out
