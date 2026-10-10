from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.api.deps import DB, SM, CurrentUser
from app.core.ratelimit import rate_limit
from app.rag import research
from app.rag.pipeline import label_chunks, log_query, source_from_chunk
from app.rag.retriever import RetrievalParams, retrieve
from app.rag.scope import resolve_scope
from app.schemas.chat import SearchRequest, SearchResponse, TaskRequest, TaskResponse
from app.services import settings_service

router = APIRouter(tags=["research"])
limit = Depends(rate_limit("chat", "rate_limit_chat_per_minute"))


@router.post("/search", response_model=SearchResponse)
async def semantic_search(body: SearchRequest, user: CurrentUser, db: DB, sm: SM):
    t0 = time.perf_counter()
    scope = await resolve_scope(db, user.id, body.document_ids, body.collection_id)
    eff = await settings_service.effective(db, user.id)
    params = RetrievalParams(
        top_k=body.top_k or max(eff.retrieval.top_k, 10),
        score_threshold=body.score_threshold if body.score_threshold is not None else eff.retrieval.score_threshold,
        hybrid=eff.retrieval.hybrid,
        context_token_budget=10**9,
    )
    res = await retrieve(db, user.id, body.query, scope, params, fit_budget=False)
    label_chunks(res.chunks)
    await log_query(sm, user.id, "search", len(res.chunks), (time.perf_counter() - t0) * 1000)
    return SearchResponse(
        query=body.query,
        results=[source_from_chunk(c, cited=False) for c in res.chunks],
        candidates=res.candidates,
        latency_ms=round(res.latency_ms, 1),
    )


def _task(name: str):
    async def endpoint(body: TaskRequest, user: CurrentUser, sm: SM) -> TaskResponse:
        return await research.run_task(sm, user.id, name, body)

    return endpoint


for _name, _path in (
    ("summarize", "/research/summarize"),
    ("questions", "/research/questions"),
    ("findings", "/research/findings"),
    ("compare", "/research/compare"),
):
    router.add_api_route(
        _path, _task(_name), methods=["POST"], response_model=TaskResponse, dependencies=[limit], name=f"research_{_name}"
    )
