from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

STOPWORDS = {
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
    "be",
    "from",
    "what",
    "which",
    "who",
    "how",
    "why",
    "when",
    "does",
    "do",
    "did",
    "about",
    "into",
    "than",
    "then",
    "there",
    "their",
    "its",
    "can",
    "could",
    "should",
    "would",
    "me",
    "my",
    "i",
    "you",
    "your",
    "we",
    "our",
    "have",
    "has",
    "had",
    "not",
    "but",
    "if",
    "so",
    "any",
    "all",
}


def query_terms(text: str, limit: int = 12) -> list[str]:
    seen: list[str] = []
    for w in re.findall(r"[a-z0-9]+", text.lower()):
        if len(w) > 2 and w not in STOPWORDS and w not in seen:
            seen.append(w)
    return seen[:limit]


@dataclass
class Candidate:
    chunk_id: uuid.UUID
    vector_score: float  # cosine similarity in [-1, 1]
    keyword_score: float  # normalised to [0, 1]
