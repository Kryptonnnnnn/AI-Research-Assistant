from __future__ import annotations

from app.core.config import get_settings
from app.embeddings.base import EmbeddingProvider

_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        s = get_settings()
        if s.embedding_provider == "hash":
            from app.embeddings.hash_provider import HashEmbeddingProvider

            _provider = HashEmbeddingProvider(s.embedding_dim, "hash-bow-v1")
        elif s.embedding_provider == "ollama":
            from app.embeddings.ollama_provider import OllamaEmbeddingProvider

            _provider = OllamaEmbeddingProvider(s.ollama_base_url, s.embedding_ollama_model, s.embedding_dim)
        else:
            from app.embeddings.sentence_provider import SentenceTransformerProvider

            _provider = SentenceTransformerProvider(s.embedding_model, s.embedding_dim, s.embedding_batch_size)
    return _provider


def set_embedding_provider(p: EmbeddingProvider | None) -> None:
    global _provider
    _provider = p
