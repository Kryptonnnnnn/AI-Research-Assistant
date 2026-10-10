"""Brute-force cosine search in NumPy. Used for SQLite (local dev / tests); fine up to ~100k chunks."""

from __future__ import annotations

import math
import re
import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DocumentChunk
from app.vectorstore.base import Candidate, query_terms


class NumpyVectorStore:
    async def search(
        self,
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        document_ids: list[uuid.UUID],
        query_vec: np.ndarray,
        query_text: str,
        limit: int,
        hybrid: bool,
        embedding_model: str,
    ) -> list[Candidate]:
        rows = (
            await db.execute(
                select(DocumentChunk.id, DocumentChunk.text, DocumentChunk.embedding).where(
                    DocumentChunk.user_id == user_id,  # ownership enforced in the query itself
                    DocumentChunk.document_id.in_(document_ids),
                    DocumentChunk.embedding_model == embedding_model,
                    DocumentChunk.embedding.is_not(None),
                )
            )
        ).all()
        if not rows:
            return []
        matrix = np.stack([r.embedding for r in rows])
        sims = matrix @ np.asarray(query_vec, dtype=np.float32)

        kw = np.zeros(len(rows), dtype=np.float32)
        if hybrid:
            kw = self._keyword_scores([r.text for r in rows], query_terms(query_text))

        vec_top = set(np.argsort(-sims)[:limit].tolist())
        kw_top = set(np.argsort(-kw)[:limit].tolist()) if kw.max() > 0 else set()
        return [Candidate(rows[i].id, float(sims[i]), float(kw[i])) for i in sorted(vec_top | {i for i in kw_top if kw[i] > 0})]

    @staticmethod
    def _keyword_scores(texts: list[str], terms: list[str]) -> np.ndarray:
        if not terms:
            return np.zeros(len(texts), dtype=np.float32)
        token_sets = [set(re.findall(r"[a-z0-9]+", t.lower())) for t in texts]
        n = len(texts)
        idf = {}
        for term in terms:
            df = sum(1 for ts in token_sets if term in ts)
            idf[term] = math.log(1 + (n - df + 0.5) / (df + 0.5))
        total = sum(idf.values()) or 1.0
        return np.array([sum(idf[t] for t in terms if t in ts) / total for ts in token_sets], dtype=np.float32)
