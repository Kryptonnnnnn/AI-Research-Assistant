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

        return GroqProvider(s.groq_api_key, model, s.groq_base_url, s.llm_timeout_seconds, s.groq_reasoning_effort)
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


def llm_status(provider: str | None = None, model: str | None = None) -> dict:
    """Secret-free diagnosis of whether chat can work: never includes keys, only which setting is missing."""
    s = get_settings()
    provider = provider or s.llm_provider
    model = s.llm_model if model is None else model
    if provider == "mock":
        return {"status": "ok" if s.allow_mock_provider else "unknown_provider", "hint": "Mock provider (offline demo)."}
    if provider == "groq":
        if not s.groq_api_key:
            return {
                "status": "missing_api_key",
                "hint": "Set GROQ_API_KEY on the API service (create a key at console.groq.com).",
            }
        if not model:
            return {
                "status": "missing_model",
                "hint": "Set LLM_MODEL on the API service to a current model id (Settings → AI provider → Refresh models lists them).",
            }
        return {"status": "ok", "hint": "Configured. Use Settings → Test connection to validate the model id against Groq."}
    if provider == "ollama":
        if not model:
            return {"status": "missing_model", "hint": "Set LLM_MODEL to an installed Ollama model (see `ollama list`)."}
        return {"status": "ok", "hint": "Configured. Use Settings → Test connection to confirm Ollama is running."}
    return {"status": "unknown_provider", "hint": f"Unknown provider '{provider}'."}


async def list_provider_models(provider: str) -> list[str]:
    s = get_settings()
    if provider == "groq":
        from app.llm.groq_provider import GroqProvider

        return await GroqProvider(s.groq_api_key, "model-listing", s.groq_base_url, s.llm_timeout_seconds).list_models()
    if provider == "ollama":
        from app.llm.ollama_provider import OllamaProvider

        return await OllamaProvider(s.ollama_base_url, "model-listing", s.llm_timeout_seconds).list_models()
    raise ProviderError("Model listing is only available for groq and ollama.", code="provider_not_configured", status_code=422)
