"""The RAG chat pipeline as one async generator of events, used by both streaming and non-streaming endpoints.

Events: meta -> sources -> token* -> done | error.
DB sessions are short-lived and never held open while waiting on the LLM.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError, ProviderError, ValidationFailed
from app.db.base import utcnow
from app.embeddings.factory import retrieval_mode
from app.llm.base import ChatMessage
from app.llm.factory import get_llm
from app.models import Conversation, Document, Message, MessageCitation, QueryLog
from app.rag import prompts
from app.rag.citations import process_answer
from app.rag.retriever import RetrievalResult, RetrievedChunk, retrieve
from app.rag.scope import count_stale_in_scope, resolve_scope
from app.repositories.ownership import get_conversation
from app.schemas.chat import MessageOut, SourceOut
from app.services import settings_service

logger = logging.getLogger("app.rag")

NO_DOCS_TEXT = (
    "You don't have any processed documents in this scope yet. Upload a document (and wait for it to finish "
    "processing) or adjust the selected documents/collection, then ask again."
)
INSUFFICIENT_TEXT = (
    "**Insufficient evidence:** I couldn't find passages in the selected documents that are relevant enough to "
    "answer this question, so I won't guess. Try rephrasing, selecting different documents, or lowering the "
    "relevance threshold in Settings."
)


@dataclass
class ChatInput:
    user_id: uuid.UUID
    question: str
    mode: str = "qa"
    conversation_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = field(default_factory=list)
    collection_id: uuid.UUID | None = None
    regenerate: bool = False  # re-answer the last user message of the conversation
    stream: bool = True


def source_from_chunk(c: RetrievedChunk, cited: bool) -> SourceOut:
    return SourceOut(
        label=c.label,
        chunk_id=c.chunk_id,
        document_id=c.document_id,
        document_title=c.document_title,
        page_number=c.page,
        section=c.section,
        chunk_index=c.chunk_index,
        excerpt=c.excerpt,
        chunk_text=c.text,
        score=round(c.score, 4),
        vector_score=round(c.vector_score, 4),
        keyword_score=round(c.keyword_score, 4),
        cited=cited,
    )


def message_to_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        conversation_id=m.conversation_id,
        role=m.role,
        content=m.content,
        status=m.status,
        mode=m.mode,
        provider=m.provider,
        model=m.model,
        error=m.error,
        retrieval_meta=m.retrieval_meta or {},
        created_at=m.created_at,
        citations=[
            SourceOut(
                id=c.id,
                label=c.label,
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                document_title=c.document_title,
                page_number=c.page_number,
                section=c.section,
                chunk_index=c.chunk_index,
                excerpt=c.excerpt,
                chunk_text=c.chunk_text,
                score=c.score,
                vector_score=c.vector_score,
                keyword_score=c.keyword_score,
                cited=c.cited,
            )
            for c in m.citations
        ],
    )


async def load_message_out(db: AsyncSession, message_id: uuid.UUID) -> MessageOut:
    from sqlalchemy.orm import selectinload

    m = (await db.execute(select(Message).options(selectinload(Message.citations)).where(Message.id == message_id))).scalar_one()
    return message_to_out(m)


def derive_title(question: str) -> str:
    t = " ".join(question.split())
    return (t[:57] + "...") if len(t) > 60 else t


def retrieval_query(question: str, history: list[tuple[str, str]]) -> str:
    """Short follow-ups ("what about its limitations?") borrow the previous user question for retrieval only."""
    if len(question.split()) < 7:
        prev = [c for r, c in history if r == "user"]
        if prev:
            return f"{prev[-1]} {question}"
    return question


async def _prepare(sm: async_sessionmaker[AsyncSession], inp: ChatInput):
    """Validate, persist the user message, return (conversation_id, user_msg_id, history, scope, eff)."""
    async with sm() as db:
        conv = await get_conversation(db, inp.user_id, inp.conversation_id) if inp.conversation_id else None
        # Scope sent with the request replaces the conversation's saved scope; otherwise the saved one is reused.
        if inp.document_ids or inp.collection_id or conv is None:
            doc_ids, collection_id = [str(d) for d in inp.document_ids], inp.collection_id
        else:
            doc_ids, collection_id = list(conv.document_ids or []), conv.collection_id
        # Validate ownership BEFORE touching the conversation row (404 on someone else's / missing ids).
        scope = await resolve_scope(db, inp.user_id, [uuid.UUID(d) for d in doc_ids], collection_id)
        if conv is None:
            conv = Conversation(user_id=inp.user_id, title=derive_title(inp.question))
            db.add(conv)
        conv.document_ids, conv.collection_id = doc_ids, collection_id
        await db.flush()

        history_rows = (
            (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conv.id, Message.status != "error")
                    .order_by(Message.created_at)
                )
            )
            .scalars()
            .all()
        )

        if inp.regenerate:
            last_user = next((m for m in reversed(history_rows) if m.role == "user"), None)
            if last_user is None:
                raise ValidationFailed("There is no question to regenerate an answer for.")
            stale = [m.id for m in history_rows if m.created_at > last_user.created_at]
            await db.execute(delete(Message).where(Message.conversation_id == conv.id, Message.created_at > last_user.created_at))
            history_rows = [m for m in history_rows if m.id not in stale and m.id != last_user.id]
            user_msg_id, question, mode = last_user.id, last_user.content, last_user.mode
        else:
            question, mode = inp.question, inp.mode
            um = Message(conversation_id=conv.id, user_id=inp.user_id, role="user", content=question, mode=mode)
            db.add(um)
            await db.flush()
            user_msg_id = um.id
        history = [(m.role, m.content) for m in history_rows if m.status in ("complete", "stopped") and m.content][
            -settings_turns() :
        ]
        eff = await settings_service.effective(db, inp.user_id)
        conv.updated_at = utcnow()
        await db.commit()
        return conv.id, user_msg_id, question, mode, history, scope, eff


def settings_turns() -> int:
    return get_settings().history_turns * 2


async def _save_assistant(
    sm,
    *,
    conv_id,
    user_id,
    content: str,
    status: str,
    mode: str,
    provider: str | None,
    model: str | None,
    error: str | None,
    meta: dict,
    chunks: list[RetrievedChunk],
    used: list[str],
) -> uuid.UUID:
    async with sm() as db:
        msg = Message(
            conversation_id=conv_id,
            user_id=user_id,
            role="assistant",
            content=content,
            status=status,
            mode=mode,
            provider=provider,
            model=model,
            error=error,
            retrieval_meta=meta,
        )
        db.add(msg)
        await db.flush()
        for pos, c in enumerate(chunks):
            db.add(
                MessageCitation(
                    message_id=msg.id,
                    user_id=user_id,
                    chunk_id=c.chunk_id,
                    document_id=c.document_id,
                    label=c.label,
                    position=pos,
                    cited=c.label in used,
                    document_title=c.document_title,
                    page_number=c.page,
                    section=c.section,
                    chunk_index=c.chunk_index,
                    excerpt=c.excerpt,
                    chunk_text=c.text,
                    score=c.score,
                    vector_score=c.vector_score,
                    keyword_score=c.keyword_score,
                )
            )
        if used:
            await db.execute(
                update(Document)
                .where(Document.user_id == user_id, Document.id.in_({c.document_id for c in chunks if c.label in used}))
                .values(access_count=Document.access_count + 1, last_accessed_at=utcnow())
            )
        await db.execute(update(Conversation).where(Conversation.id == conv_id).values(updated_at=utcnow()))
        await db.commit()
        return msg.id


async def log_query(sm, user_id: uuid.UUID, kind: str, count: int, latency_ms: float) -> None:
    try:
        async with sm() as db:
            db.add(QueryLog(user_id=user_id, kind=kind, result_count=count, latency_ms=latency_ms))
            await db.commit()
    except Exception:  # noqa: BLE001 - analytics must never break chat
        logger.warning("Failed to write query log", exc_info=True)


def label_chunks(chunks: list[RetrievedChunk]) -> None:
    for i, c in enumerate(chunks, start=1):
        c.label = f"S{i}"


async def run_chat(sm: async_sessionmaker[AsyncSession], inp: ChatInput) -> AsyncIterator[dict]:
    t0 = time.perf_counter()
    s = get_settings()
    conv_id, user_msg_id, question, mode, history, scope, eff = await _prepare(sm, inp)
    yield {"type": "meta", "conversation_id": str(conv_id), "user_message_id": str(user_msg_id)}

    meta: dict = {"scope_documents": len(scope), "mode": mode}
    chunks: list[RetrievedChunk] = []
    result = RetrievalResult()
    if scope:
        async with sm() as db:
            result = await retrieve(db, inp.user_id, retrieval_query(question, history), scope, eff.retrieval)
        chunks = result.chunks
        label_chunks(chunks)
    async with sm() as db:
        stale = await count_stale_in_scope(db, scope)
    meta.update(
        retrieval_mode=retrieval_mode(),
        stale_documents=stale,
        candidates=result.candidates,
        retrieved=len(chunks),
        top_k=eff.retrieval.top_k,
        score_threshold=eff.retrieval.score_threshold,
        hybrid=eff.retrieval.hybrid,
        retrieval_ms=round(result.latency_ms, 1),
    )

    if not chunks:
        meta["insufficient_evidence"] = True
        text = INSUFFICIENT_TEXT if scope else NO_DOCS_TEXT
        mid = await _save_assistant(
            sm,
            conv_id=conv_id,
            user_id=inp.user_id,
            content=text,
            status="complete",
            mode=mode,
            provider=None,
            model=None,
            error=None,
            meta=meta,
            chunks=[],
            used=[],
        )
        await log_query(sm, inp.user_id, "chat", 0, (time.perf_counter() - t0) * 1000)
        async with sm() as db:
            yield {"type": "done", "message": (await load_message_out(db, mid)).model_dump(mode="json")}
        return

    yield {"type": "sources", "sources": [source_from_chunk(c, cited=False).model_dump(mode="json") for c in chunks]}

    try:
        llm = get_llm(eff.llm_provider, eff.llm_model)
    except AppError as exc:
        mid = await _save_assistant(
            sm,
            conv_id=conv_id,
            user_id=inp.user_id,
            content="",
            status="error",
            mode=mode,
            provider=eff.llm_provider,
            model=eff.llm_model,
            error=exc.message,
            meta=meta,
            chunks=[],
            used=[],
        )
        yield {"type": "error", "code": exc.code, "message": exc.message, "status": exc.status_code, "message_id": str(mid)}
        return

    messages = prompts.build_chat_messages(mode, history, question, chunks)
    parts: list[str] = []
    gen_start = time.perf_counter()

    async def _persist_partial(status: str, error: str | None) -> uuid.UUID:
        content = "".join(parts)
        cleaned, used, _ = process_answer(content, {c.label for c in chunks})
        return await _save_assistant(
            sm,
            conv_id=conv_id,
            user_id=inp.user_id,
            content=cleaned,
            status=status,
            mode=mode,
            provider=llm.name,
            model=llm.model,
            error=error,
            meta=meta,
            chunks=chunks,
            used=used,
        )

    try:
        if inp.stream:
            async for piece in llm.stream(messages, temperature=s.llm_temperature, max_tokens=s.llm_max_output_tokens):
                parts.append(piece)
                yield {"type": "token", "text": piece}
        else:
            parts.append(await llm.complete(messages, temperature=s.llm_temperature, max_tokens=s.llm_max_output_tokens))
    except (asyncio.CancelledError, GeneratorExit):
        # Client pressed "stop" / disconnected: keep what was generated so far.
        await asyncio.shield(_persist_partial("stopped", None))
        raise
    except ProviderError as exc:
        mid = await _persist_partial("error", exc.message)
        yield {"type": "error", "code": exc.code, "message": exc.message, "status": exc.status_code, "message_id": str(mid)}
        return
    except Exception:  # noqa: BLE001
        logger.exception("Unexpected generation failure")
        mid = await _persist_partial("error", "The model failed unexpectedly. Please retry.")
        yield {
            "type": "error",
            "code": "provider_error",
            "message": "The model failed unexpectedly. Please retry.",
            "message_id": str(mid),
        }
        return

    raw = "".join(parts)
    cleaned, used, invalid = process_answer(raw, {c.label for c in chunks})
    meta.update(
        generation_ms=round((time.perf_counter() - gen_start) * 1000, 1),
        citations_used=used,
        invalid_citations_removed=invalid,
        citation_check="ok" if used else "no_citations",
    )
    if not cleaned.strip():
        mid = await _save_assistant(
            sm,
            conv_id=conv_id,
            user_id=inp.user_id,
            content="",
            status="error",
            mode=mode,
            provider=llm.name,
            model=llm.model,
            error="The model returned an empty answer. Please retry.",
            meta=meta,
            chunks=[],
            used=[],
        )
        yield {
            "type": "error",
            "code": "empty_answer",
            "message": "The model returned an empty answer. Please retry.",
            "message_id": str(mid),
        }
        return
    mid = await _save_assistant(
        sm,
        conv_id=conv_id,
        user_id=inp.user_id,
        content=cleaned,
        status="complete",
        mode=mode,
        provider=llm.name,
        model=llm.model,
        error=None,
        meta=meta,
        chunks=chunks,
        used=used,
    )
    await log_query(sm, inp.user_id, "chat", len(chunks), (time.perf_counter() - t0) * 1000)
    async with sm() as db:
        yield {"type": "done", "message": (await load_message_out(db, mid)).model_dump(mode="json")}


async def collect_chat(sm, inp: ChatInput) -> tuple[uuid.UUID, MessageOut, MessageOut]:
    """Non-streaming helper: run the pipeline to completion, return (conversation_id, user_msg, assistant_msg)."""
    inp.stream = False
    conv_id = user_id = None
    final = None
    async for ev in run_chat(sm, inp):
        if ev["type"] == "meta":
            conv_id, user_id = uuid.UUID(ev["conversation_id"]), uuid.UUID(ev["user_message_id"])
        elif ev["type"] == "done":
            final = ev["message"]
        elif ev["type"] == "error":
            raise ProviderError(ev["message"], code=ev["code"], status_code=ev.get("status"))
    assert conv_id and user_id and final
    async with sm() as db:
        um = await load_message_out(db, user_id)
    return conv_id, um, MessageOut.model_validate(final)


async def count_messages(db: AsyncSession, conv_id: uuid.UUID) -> int:
    return (await db.execute(select(func.count()).select_from(Message).where(Message.conversation_id == conv_id))).scalar_one()


__all__ = ["ChatInput", "run_chat", "collect_chat", "NotFoundError", "ChatMessage"]
