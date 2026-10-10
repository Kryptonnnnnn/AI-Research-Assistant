"""Token-aware, sentence-respecting overlapping chunker.

Tokens are approximated with a regex tokenizer (words + punctuation, long words counted
as multiple sub-tokens). It needs no model download and tracks real subword tokenizers
closely enough for budgeting. Swap `count_tokens` for a model tokenizer if you need exactness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.ingestion.extractors import Segment

_TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)
_SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])|\n+")


def count_tokens(text: str) -> int:
    n = 0
    for tok in _TOKEN_RE.findall(text):
        n += 1 + (len(tok) - 1) // 7 if tok[0].isalnum() else 1  # long words split into subwords
    return n


@dataclass
class Chunk:
    index: int
    text: str
    token_count: int
    page: int | None
    section: str | None


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT_RE.split(text)]
    return [p for p in parts if p]


def _hard_split(sentence: str, max_tokens: int) -> list[str]:
    """Split a single over-long 'sentence' on whitespace so no unit exceeds max_tokens."""
    words, out, cur_t = sentence.split(), [], 0
    cur: list[str] = []
    for w in words:
        t = count_tokens(w)
        if cur and cur_t + t > max_tokens:
            out.append(" ".join(cur))
            cur, cur_t = [], 0
        cur.append(w)
        cur_t += t
    if cur:
        out.append(" ".join(cur))
    return out


def chunk_text(text: str, size: int, overlap: int) -> list[tuple[str, int]]:
    """Pack sentences into chunks of <= size tokens; each chunk starts with ~overlap tokens
    carried over from the end of the previous one."""
    if size <= 0:
        raise ValueError("chunk size must be positive")
    overlap = max(0, min(overlap, size // 2))
    units: list[tuple[str, int]] = []
    for s in split_sentences(text):
        t = count_tokens(s)
        if t > size:
            units.extend((p, count_tokens(p)) for p in _hard_split(s, size))
        else:
            units.append((s, t))

    chunks: list[tuple[str, int]] = []
    cur: list[tuple[str, int]] = []
    cur_t = 0
    for unit in units:
        if cur and cur_t + unit[1] > size:
            chunks.append((" ".join(u[0] for u in cur), cur_t))
            # carry over trailing sentences up to the overlap budget
            carry: list[tuple[str, int]] = []
            carry_t = 0
            for u in reversed(cur):
                if carry_t + u[1] > overlap:
                    break
                carry.insert(0, u)
                carry_t += u[1]
            cur, cur_t = carry, carry_t
            if cur_t + unit[1] > size:  # overlap + new unit too big: drop overlap
                cur, cur_t = [], 0
        cur.append(unit)
        cur_t += unit[1]
    # Emit the tail unless it's purely overlap that was already emitted.
    if cur and (not chunks or cur_t > 0 and " ".join(u[0] for u in cur) not in chunks[-1][0]):
        chunks.append((" ".join(u[0] for u in cur), cur_t))
    return chunks


def chunk_segments(segments: list[Segment], size: int, overlap: int) -> list[Chunk]:
    """Chunk each segment independently so a chunk never straddles a page boundary or heading,
    which keeps citations (page / section) exact."""
    result: list[Chunk] = []
    for seg in segments:
        for text, tokens in chunk_text(seg.text, size, overlap):
            if text.strip():
                result.append(Chunk(len(result), text, tokens, seg.page, seg.heading))
    return result
