from __future__ import annotations

import httpx
import numpy as np

from app.embeddings.base import normalize


class OllamaEmbeddingProvider:
    """Embeddings from a local Ollama server (`/api/embed`). Pick a model whose dimension
    matches EMBEDDING_DIM (e.g. `nomic-embed-text` is 768)."""

    name = "ollama"

    def __init__(self, base_url: str, model: str, dim: int, timeout: float = 120.0):
        if not model:
            raise RuntimeError("EMBEDDING_OLLAMA_MODEL must be set when EMBEDDING_PROVIDER=ollama")
        self.base_url, self.model, self.dim, self.timeout = base_url.rstrip("/"), model, dim, timeout

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        r = httpx.post(f"{self.base_url}/api/embed", json={"model": self.model, "input": texts}, timeout=self.timeout)
        r.raise_for_status()
        arr = np.asarray(r.json()["embeddings"], dtype=np.float32)
        if arr.shape[1] != self.dim:
            raise RuntimeError(f"Ollama model returned {arr.shape[1]} dims but EMBEDDING_DIM={self.dim}")
        return normalize(arr)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]
