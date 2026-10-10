"""Research features: summaries, question generation, key findings, multi-document comparison, follow-ups."""

from __future__ import annotations

import asyncio
import re
import time
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.errors import NotFoundError, ValidationFailed
from app.ingestion.chunking import count_tokens
from app.llm.factory import get_llm
from app.models import Document, DocumentChunk, Message
from app.models.document import DOC_READY
from app.rag import prompts
from app.rag.citations import process_answer
from app.rag.pipeline import INSUFFICIENT_TEXT, label_chunks, log_query, source_from_chunk
from app.rag.retriever import RetrievalParams, RetrievedChunk, best_excerpt, retrieve
from app.repositories.ownership import get_conversation
from app.schemas.chat import TaskRequest, TaskResponse
from app.services import settings_service

LENGTHS = {
    "short": "in 3-5 sentences",
    "medium": "in 2-3 short paragraphs plus a bulleted list of key points",
    "detailed": "in a detailed, sectioned write-up",
}


async def _owned_ready_docs(db: AsyncSession, user_id: uuid.UUID, ids: list[uuid.UUID]) -> list[Document]:
    ids = list(dict.fromkeys(ids))
    docs = (await db.execute(select(Document).where(Document.user_id == user_id, Document.id.in_(ids)))).scalars().all()
    if len(docs) != len(ids):
        raise NotFoundError("Document not found")
    not_ready = [d.title for d in docs if d.status != DOC_READY]
    if not_ready:
        raise ValidationFailed(f"Not processed yet: {', '.join(not_ready)}", code="documents_not_ready")
    order = {d: i for i, d in enumerate(ids)}
    return sorted(docs, key=lambda d: order[d.id])


async def sample_document(db: AsyncSession, user_id: uuid.UUID, doc: Document, budget: int) -> list[RetrievedChunk]:
    """Evenly spaced chunks covering the whole document within a token budget (for summaries etc.)."""
    rows = (
        (
            await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == doc.id, DocumentChunk.user_id == user_id)
                .order_by(DocumentChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    total = sum(r.token_count for r in rows)
    if total > budget and rows:
        avg = max(1, total // len(rows))
        keep = max(1, budget // avg)
        step = len(rows) / keep
        rows = [rows[int(i * step)] for i in range(keep)]
    return [
        RetrievedChunk(
            r.id,
            doc.id,
            doc.title,
            r.chunk_index,
            r.page_number,
            r.section,
            r.text,
            1.0,
            1.0,
            0.0,
            excerpt=best_excerpt(r.text, ""),
        )
        for r in rows
    ]


async def _gather(db, user_id, docs: list[Document], focus: str | None, budget: int) -> list[RetrievedChunk]:
    per_doc = max(500, budget // max(1, len(docs)))
    chunks: list[RetrievedChunk] = []
    for d in docs:
        if focus:
            res = await retrieve(
                db,
                user_id,
                focus,
                [d.id],
                RetrievalParams(top_k=8, score_threshold=0.0, hybrid=True, context_token_budget=per_doc),
            )
            got = res.chunks
        else:
            got = await sample_document(db, user_id, d, per_doc)
        chunks.extend(got)
    label_chunks(chunks)
    return chunks


async def run_task(sm: async_sessionmaker[AsyncSession], user_id: uuid.UUID, task: str, req: TaskRequest) -> TaskResponse:
    t0 = time.perf_counter()
    s = get_settings()
    if task == "compare" and len(req.document_ids) < 2:
        raise ValidationFailed("Select at least two documents to compare.")
    async with sm() as db:
        docs = await _owned_ready_docs(db, user_id, req.document_ids)
        eff = await settings_service.effective(db, user_id)
        chunks = await _gather(db, user_id, docs, req.focus, min(eff.retrieval.context_token_budget, 6000))
    llm = get_llm(eff.llm_provider, eff.llm_model)
    if not chunks:
        return TaskResponse(
            task=task, content=INSUFFICIENT_TEXT, citations=[], provider=llm.name, model=llm.model, insufficient_evidence=True
        )

    titles = ", ".join(f'"{d.title}"' for d in docs)
    focus = f"\nFocus on: {req.focus}" if req.focus else ""
    if task == "summarize":
        instruction = f"Summarize the document {titles} {LENGTHS[req.length]}. Cite claims.{focus}"
    elif task == "questions":
        instruction = (
            f"QUESTIONS_TASK\nGenerate {req.count} insightful research questions that the document {titles} raises or leaves open "
            f"(e.g. about methods, generalisability, limitations, follow-up work). Output a numbered list. Cite the passage that motivates each question.{focus}"
        )
    elif task == "findings":
        instruction = (
            f"Extract from {titles} the following as Markdown sections: ## Research Question, ## Methods, ## Key Findings, "
            f"## Results, ## Limitations, ## Conclusions. Use 'Insufficient evidence' where the text does not say. Cite every bullet.{focus}"
        )
    elif task == "compare":
        instruction = (
            f"Compare these documents: {titles}. Produce Markdown sections: ## Overview, ## Agreements, ## Contradictions, "
            f"## Key Differences (a table if helpful), ## Gaps. Attribute every point to its document with citations.{focus}"
        )
    else:
        raise ValidationFailed(f"Unknown task '{task}'")

    messages = prompts.build_task_messages(task, instruction, chunks)
    raw = await llm.complete(messages, temperature=s.llm_temperature, max_tokens=s.llm_max_output_tokens)
    cleaned, used, _ = process_answer(raw, {c.label for c in chunks})
    await log_query(sm, user_id, "research", len(chunks), (time.perf_counter() - t0) * 1000)
    return TaskResponse(
        task=task,
        content=cleaned,
        citations=[source_from_chunk(c, cited=c.label in used) for c in chunks],
        provider=llm.name,
        model=llm.model,
    )


async def suggest_followups(sm: async_sessionmaker[AsyncSession], user_id: uuid.UUID, conversation_id: uuid.UUID) -> list[str]:
    async with sm() as db:
        await get_conversation(db, user_id, conversation_id)
        msgs = (
            (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conversation_id, Message.status == "complete")
                    .order_by(Message.created_at.desc())
                    .limit(4)
                )
            )
            .scalars()
            .all()
        )
        eff = await settings_service.effective(db, user_id)
        titles: list[str] = []
        last_a = next((m for m in msgs if m.role == "assistant"), None)
        last_q = next((m for m in msgs if m.role == "user"), None)
        if last_a is not None:
            from sqlalchemy.orm import selectinload

            full = (
                await db.execute(select(Message).options(selectinload(Message.citations)).where(Message.id == last_a.id))
            ).scalar_one()
            titles = list(dict.fromkeys(c.document_title for c in full.citations))
    if not (last_a and last_q) or not last_a.content.strip():
        return []
    try:
        llm = get_llm(eff.llm_provider, eff.llm_model)
        raw = await asyncio.wait_for(
            llm.complete(
                prompts.build_followup_messages(last_q.content, last_a.content, titles), temperature=0.4, max_tokens=250
            ),
            timeout=get_settings().llm_timeout_seconds,
        )
    except Exception:  # noqa: BLE001 - suggestions are best-effort
        return []
    out = []
    for line in raw.splitlines():
        m = re.match(r"^\s*(?:\d+[.)]|[-*])\s*(.+\?)\s*$", line)
        if m and count_tokens(m.group(1)) < 60:
            out.append(m.group(1).strip())
    return out[:3]
