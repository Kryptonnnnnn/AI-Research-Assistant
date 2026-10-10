from __future__ import annotations

import threading
from typing import Any

import numpy as np

from app.embeddings.base import normalize


class SentenceTransformerProvider:
    """Local embeddings via sentence-transformers. The model is downloaded on first use
    (from the Hugging Face hub) and cached; afterwards it works offline."""

    name = "sentence-transformers"

    def __init__(self, model: str, dim: int, batch_size: int = 32):
        self.model = model
        self.dim = dim
        self.batch_size = batch_size
        self._model: Any = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        from sentence_transformers import SentenceTransformer
                    except ImportError as exc:
                        raise RuntimeError(
                            "sentence-transformers is not installed. Run `pip install -r requirements-ml.txt` "
                            "or set EMBEDDING_PROVIDER=ollama|hash."
                        ) from exc
                    m = SentenceTransformer(self.model)
                    actual = (getattr(m, "get_embedding_dimension", None) or m.get_sentence_embedding_dimension)()
                    if actual != self.dim:
                        raise RuntimeError(
                            f"Embedding model '{self.model}' outputs {actual} dims but EMBEDDING_DIM={self.dim}. "
                            "Set EMBEDDING_DIM to match and re-run migrations / reindex."
                        )
                    self._model = m
        return self._model

    def warmup(self) -> None:
        self._load()

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        out = self._load().encode(texts, batch_size=self.batch_size, convert_to_numpy=True, show_progress_bar=False)
        return normalize(out)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]
