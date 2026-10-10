"""Deterministic, dependency-free embeddings (hashed bag-of-words + bigrams).

Not semantically deep, but stable and fast: used for tests, CI and zero-download demos.
"""

from __future__ import annotations

import hashlib
import re

import numpy as np

from app.embeddings.base import normalize

_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "is",
    "are",
    "was",
    "were",
    "for",
    "on",
    "with",
    "as",
    "by",
    "at",
    "it",
    "this",
    "that",
}


class HashEmbeddingProvider:
    name = "hash"

    def __init__(self, dim: int = 384, model: str = "hash-bow-v1"):
        self.dim = dim
        self.model = model

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP]
        feats = words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]
        for f in feats:
            h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
            v[h % self.dim] += 1.0 if "_" not in f else 0.5
            v[(h >> 20) % self.dim] += 0.5 if "_" not in f else 0.25
        return v

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return normalize(np.stack([self._vec(t) for t in texts])) if texts else np.zeros((0, self.dim), np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]
