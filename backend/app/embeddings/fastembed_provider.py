from __future__ import annotations

import threading
from typing import Any

import numpy as np

from app.embeddings.base import normalize


class FastEmbedProvider:
    """Sentence-Transformers models executed with ONNX Runtime (no PyTorch): same vectors for the same model
    (verified for all-MiniLM-L6-v2), ~200 MB RAM instead of ~1 GB+, which is what makes it viable on small hosts.
    Keep EMBEDDING_BATCH_SIZE small (4-8) on 512 MB instances: activation memory grows with batch size."""

    name = "fastembed"

    def __init__(self, model: str, dim: int, batch_size: int = 8, cache_dir: str | None = None, threads: int | None = 1):
        self.model, self.dim, self.batch_size = model, dim, batch_size
        self.cache_dir, self.threads = cache_dir or None, threads
        self._model: Any = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        from fastembed import TextEmbedding
                    except ImportError as exc:
                        raise RuntimeError(
                            "fastembed is not installed. Run `pip install -r requirements-fastembed.txt` "
                            "or set EMBEDDING_PROVIDER=sentence-transformers|ollama|hash."
                        ) from exc
                    m = TextEmbedding(self.model, cache_dir=self.cache_dir, threads=self.threads)
                    probe = np.asarray(list(m.embed(["dimension probe"])))
                    if probe.shape[1] != self.dim:
                        raise RuntimeError(
                            f"Embedding model '{self.model}' outputs {probe.shape[1]} dims but EMBEDDING_DIM={self.dim}. "
                            "Set EMBEDDING_DIM to match and re-run migrations / reindex."
                        )
                    self._model = m
        return self._model

    def warmup(self) -> None:
        self._load()

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        out = np.asarray(list(self._load().embed(texts, batch_size=self.batch_size)), dtype=np.float32)
        return normalize(out)

    def embed_query(self, text: str) -> np.ndarray:
        out = np.asarray(list(self._load().query_embed([text])), dtype=np.float32)
        return normalize(out)[0]
