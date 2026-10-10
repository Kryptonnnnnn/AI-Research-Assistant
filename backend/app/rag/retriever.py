"""Hybrid retrieval: embed query -> vector (+keyword) candidates -> threshold -> dedupe -> rank -> budget."""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings.factory import get_embedding_provider
from app.ingestion.chunking import count_tokens
from app.models import Document, DocumentChunk
from app.vectorstore.base import query_terms
from app.vectorstore.factory import get_vector_store

KEYWORD_WEIGHT = 0.25
RESCUE_FACTOR = 0.6  # a keyword hit may rescue a chunk whose cosine is a bit under the threshold


@dataclass
class RetrievalParams:
    top_k: int = 8
    score_threshold: float = 0.25
    hybrid: bool = True
    context_token_budget: int = 6000


@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    chunk_index: int
    page: int | None
    section: str | None
    text: str
    score: float
    vector_score: float
    keyword_score: float
    excerpt: str = ""
    label: str = ""


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk] = field(default_factory=list)
    candidates: int = 0
    latency_ms: float = 0.0

    @property
    def insufficient(self) -> bool:
        return not self.chunks


def best_excerpt(text: str, query: str, max_chars: int = 360) -> str:
    """Return an *exact substring* of `text` most related to the query (so quotes are verifiable)."""
    spans = [(m.start(), m.end()) for m in re.finditer(r"[^.!?\n]+[.!?]*", text) if m.group().strip()]
    if not spans:
        return text[:max_chars].strip()
    terms = set(query_terms(query, limit=30))
    best_i, best_score = 0, -1
    for i, (a, b) in enumerate(spans):
        words = set(re.findall(r"[a-z0-9]+", text[a:b].lower()))
        s = len(words & terms)
        if s > best_score:
            best_i, best_score = i, s
    a, b = spans[best_i]
    j = best_i
    while j + 1 < len(spans) and spans[j + 1][1] - a <= max_chars:
        j += 1
    b = spans[j][1]
    excerpt = text[a:b].strip()
    return excerpt if len(excerpt) <= max_chars + 60 else text[a : a + max_chars].strip()


def _shingles(text: str, k: int = 5) -> set[str]:
    w = re.findall(r"\w+", text.lower())
    return {" ".join(w[i : i + k]) for i in range(max(1, len(w) - k + 1))}


def dedupe(chunks: list[RetrievedChunk], threshold: float = 0.8) -> list[RetrievedChunk]:
    """Drop near-duplicates (overlapping neighbours, repeated passages); chunks must be sorted best-first."""
    kept: list[tuple[RetrievedChunk, set[str]]] = []
    for c in chunks:
        sh = _shingles(c.text)
        dup = False
        for k, ks in kept:
            if k.chunk_id == c.chunk_id:
                dup = True
                break
            inter = len(sh & ks)
            if inter and inter / min(len(sh), len(ks)) >= threshold:
                dup = True
                break
        if not dup:
            kept.append((c, sh))
    return [c for c, _ in kept]


def select_diverse(ranked: list[RetrievedChunk], top_k: int, multi_doc: bool) -> list[RetrievedChunk]:
    """Best-first selection; in multi-document scope reserve one slot per represented document."""
    if not multi_doc:
        return ranked[:top_k]
    chosen: list[RetrievedChunk] = []
    seen_docs: set[uuid.UUID] = set()
    for c in ranked:
        if c.document_id not in seen_docs and len(chosen) < top_k:
            chosen.append(c)
            seen_docs.add(c.document_id)
    for c in ranked:
        if len(chosen) >= top_k:
            break
        if c not in chosen:
            chosen.append(c)
    return sorted(chosen, key=lambda c: -c.score)


async def hydrate(
    db: AsyncSession, user_id: uuid.UUID, scored: dict[uuid.UUID, tuple[float, float, float]]
) -> list[RetrievedChunk]:
    if not scored:
        return []
    rows = (
        await db.execute(
            select(DocumentChunk, Document.title)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.id.in_(list(scored)), DocumentChunk.user_id == user_id, Document.user_id == user_id)
        )
    ).all()
    out = []
    for chunk, title in rows:
        score, vs, ks = scored[chunk.id]
        out.append(
            RetrievedChunk(
                chunk.id, chunk.document_id, title, chunk.chunk_index, chunk.page_number, chunk.section, chunk.text, score, vs, ks
            )
        )
    return out


async def retrieve(
    db: AsyncSession,
    user_id: uuid.UUID,
    query: str,
    document_ids: list[uuid.UUID],
    params: RetrievalParams,
    *,
    fit_budget: bool = True,
) -> RetrievalResult:
    t0 = time.perf_counter()
    if not document_ids or not query.strip():
        return RetrievalResult()
    provider = get_embedding_provider()
    qvec = await asyncio.to_thread(provider.embed_query, query)
    store = get_vector_store(db)
    cands = await store.search(
        db,
        user_id=user_id,
        document_ids=document_ids,
        query_vec=qvec,
        query_text=query,
        limit=max(params.top_k * 4, 20),
        hybrid=params.hybrid,
        embedding_model=provider.model,
    )
    max_kw = max((c.keyword_score for c in cands), default=0.0) or 1.0
    scored: dict[uuid.UUID, tuple[float, float, float]] = {}
    for c in cands:
        kw_norm = c.keyword_score / max_kw if c.keyword_score > 0 else 0.0
        passes = c.vector_score >= params.score_threshold or (
            kw_norm > 0 and c.vector_score >= params.score_threshold * RESCUE_FACTOR
        )
        if passes:
            scored[c.chunk_id] = (c.vector_score + KEYWORD_WEIGHT * kw_norm, c.vector_score, c.keyword_score)
    chunks = sorted(await hydrate(db, user_id, scored), key=lambda c: -c.score)
    chunks = dedupe(chunks)
    chunks = select_diverse(chunks, params.top_k, multi_doc=len(document_ids) > 1)
    if fit_budget:
        chunks = fit_to_budget(chunks, params.context_token_budget)
    for c in chunks:
        c.excerpt = best_excerpt(c.text, query)
    return RetrievalResult(chunks, len(cands), (time.perf_counter() - t0) * 1000)


def fit_to_budget(chunks: list[RetrievedChunk], budget: int) -> list[RetrievedChunk]:
    out: list[RetrievedChunk] = []
    used = 0
    for c in chunks:
        t = count_tokens(c.text)
        if out and used + t > budget:
            continue
        out.append(c)
        used += t
    return out
