"""pgvector (cosine distance, `<=>`) plus PostgreSQL full-text search for the keyword side of hybrid retrieval."""

from __future__ import annotations

import uuid

import numpy as np
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.vectorstore.base import Candidate, query_terms


class PgVectorStore:
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
        vec = "[" + ",".join(f"{x:.7g}" for x in np.asarray(query_vec, dtype=np.float32)) + "]"
        params = {"u": user_id, "docs": list(document_ids), "m": embedding_model, "q": vec, "n": limit}
        base_filter = "user_id = :u AND document_id = ANY(:docs) AND embedding_model = :m AND embedding IS NOT NULL"
        vec_rows = (
            await db.execute(
                text(
                    f"SELECT id, 1 - (embedding <=> CAST(:q AS vector)) AS vs FROM document_chunks "
                    f"WHERE {base_filter} ORDER BY embedding <=> CAST(:q AS vector) LIMIT :n"
                ),
                params,
            )
        ).all()
        found: dict[uuid.UUID, Candidate] = {r.id: Candidate(r.id, float(r.vs), 0.0) for r in vec_rows}

        terms = query_terms(query_text)
        if hybrid and terms:
            tsq = " | ".join(terms)
            kw_rows = (
                await db.execute(
                    text(
                        "SELECT id, 1 - (embedding <=> CAST(:q AS vector)) AS vs, "
                        "ts_rank_cd(to_tsvector('english', text), to_tsquery('english', :tsq), 32) AS ks "
                        f"FROM document_chunks WHERE {base_filter} "
                        "AND to_tsvector('english', text) @@ to_tsquery('english', :tsq) "
                        "ORDER BY ks DESC LIMIT :n"
                    ),
                    {**params, "tsq": tsq},
                )
            ).all()
            for r in kw_rows:
                cand = found.get(r.id) or Candidate(r.id, float(r.vs), 0.0)
                cand.keyword_score = float(r.ks)
                found[r.id] = cand
        return list(found.values())
