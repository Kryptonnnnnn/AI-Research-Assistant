from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SettingsOut(BaseModel):
    theme: str
    llm_provider: str
    llm_model: str
    top_k: int
    score_threshold: float
    context_token_budget: int
    hybrid_search: bool
    # Server-level (read-only here; changed through environment variables)
    embedding_provider: str
    embedding_model: str
    embedding_dim: int
    chunk_size_tokens: int
    chunk_overlap_tokens: int
    providers: list[dict]
    overrides: dict[str, bool]


class SettingsUpdate(BaseModel):
    theme: Literal["light", "dark", "system"] | None = None
    llm_provider: Literal["groq", "ollama", "mock"] | None = None
    llm_model: str | None = Field(default=None, max_length=200)
    top_k: int | None = Field(default=None, ge=1, le=30)
    score_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    context_token_budget: int | None = Field(default=None, ge=500, le=32000)
    hybrid_search: bool | None = None
    reset: list[str] = Field(default_factory=list)  # field names to reset to server default


class ProviderTestIn(BaseModel):
    llm_provider: Literal["groq", "ollama", "mock"] | None = None
    llm_model: str | None = Field(default=None, max_length=200)


class ProviderTestOut(BaseModel):
    ok: bool
    provider: str
    model: str
    detail: str
    latency_ms: float
