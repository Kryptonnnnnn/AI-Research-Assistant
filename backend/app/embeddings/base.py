from __future__ import annotations

from typing import Protocol

import numpy as np


class EmbeddingProvider(Protocol):
    name: str
    model: str
    dim: int

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        """Blocking. Returns (n, dim) L2-normalised float32. Call via asyncio.to_thread."""
        ...

    def embed_query(self, text: str) -> np.ndarray: ...


def normalize(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float32)
    norms = np.linalg.norm(m, axis=-1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms
