"""Application settings, loaded from environment variables / .env."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET = "change-me-in-production-please-use-a-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore")

    # --- General ---
    app_name: str = "AI Research Assistant"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"
    secret_key: str = INSECURE_SECRET
    cors_origins: str = "http://localhost:3000"  # comma-separated list

    # --- Database ---
    database_url: str = "sqlite+aiosqlite:///./data/app.db"
    embedding_dim: int = 384  # fixed at migration time for the pgvector column

    # --- Auth ---
    session_expire_minutes: int = 60 * 24 * 7
    cookie_name: str = "ara_session"
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    registration_enabled: bool = True
    min_password_length: int = 10

    # --- Rate limiting (in-memory, per process) ---
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_upload_per_minute: int = 20
    rate_limit_chat_per_minute: int = 30

    # --- Storage ---
    storage_backend: Literal["local", "s3", "db"] = "local"
    storage_local_dir: str = "./data/uploads"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = "auto"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    max_upload_mb: int = 25
    max_files_per_upload: int = 10
    user_storage_quota_mb: int = 200  # per user, all backends
    db_storage_quota_mb: int = 300  # whole database-backed file store (protects small free DB plans)

    # --- Chunking ---
    chunk_size_tokens: int = 200  # see docs/RETRIEVAL_EVAL.md: MiniLM-class models read ~256 tokens; long chunks dilute scores
    chunk_overlap_tokens: int = 40

    # --- Embeddings ---
    embedding_provider: Literal["sentence-transformers", "fastembed", "ollama", "hash"] = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_batch_size: int = 32
    embedding_ollama_model: str = ""
    embedding_cache_dir: str = ""  # fastembed model cache (bake the model into the image here)
    auto_reindex: bool = True  # re-queue documents indexed with a different embedding model/chunking on startup

    # --- LLM ---
    llm_provider: Literal["groq", "ollama", "mock"] = "mock"
    llm_model: str = ""  # never hardcoded: set it for groq / ollama
    llm_timeout_seconds: float = 60.0
    llm_temperature: float = 0.2
    llm_max_output_tokens: int = 1500
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    ollama_base_url: str = "http://localhost:11434"
    allow_mock_provider: bool = True

    # --- Retrieval ---
    retrieval_top_k: int = 8
    retrieval_score_threshold: float = 0.25
    retrieval_hybrid: bool = True
    context_token_budget: int = 6000
    history_turns: int = 6

    # --- Background jobs ---
    job_runner: Literal["embedded", "external", "disabled"] = "embedded"
    job_max_attempts: int = 3
    job_poll_interval_seconds: float = 2.0
    job_stale_seconds: int = 600
    job_retry_backoff_seconds: int = 5

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")

    @model_validator(mode="after")
    def _check_production(self) -> Settings:
        if self.app_env == "production":
            if self.secret_key == INSECURE_SECRET or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be set to a random string of 32+ characters in production")
            if "*" in self.cors_origin_list:
                raise ValueError("CORS_ORIGINS must list explicit origins in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
