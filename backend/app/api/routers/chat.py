from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import PlainTextResponse, StreamingResponse

from app.api.deps import DB, SM, CurrentUser
from app.core.ratelimit import rate_limit
from app.rag import research
from app.rag.pipeline import ChatInput, collect_chat, run_chat
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationOut,
    ConversationUpdate,
    FollowUps,
)
from app.schemas.common import Page
from app.services import conversation_service as svc

router = APIRouter(tags=["chat"])
chat_limit = Depends(rate_limit("chat", "rate_limit_chat_per_minute"))


def _input(body: ChatRequest, user_id: uuid.UUID) -> ChatInput:
    return ChatInput(
        user_id=user_id,
        question=body.question,
        mode=body.mode,
        conversation_id=body.conversation_id,
        document_ids=body.document_ids,
        collection_id=body.collection_id,
    )


async def _sse(events: AsyncIterator[dict]) -> AsyncIterator[str]:
    try:
        async for ev in events:
            yield f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n"
    except Exception as exc:  # noqa: BLE001 - validation errors raised before the first event
        from app.core.errors import AppError

        code, msg = (exc.code, exc.message) if isinstance(exc, AppError) else ("internal_error", "Internal server error")
        yield f"event: error\ndata: {json.dumps({'type': 'error', 'code': code, 'message': msg})}\n\n"
    finally:
        await events.aclose()  # type: ignore[attr-defined]  # propagate client disconnect -> partial answer saved


async def _primed(events: AsyncIterator[dict]) -> AsyncIterator[dict]:
    """Run the pipeline up to its first event (validation, ownership checks, saving the user message) so that
    those failures surface as proper HTTP errors instead of an in-stream error event."""
    try:
        first = await events.__anext__()  # type: ignore[attr-defined]
    except StopAsyncIteration:
        first = None

    async def rest() -> AsyncIterator[dict]:
        try:
            if first is not None:
                yield first
            async for ev in events:
                yield ev
        finally:
            await events.aclose()  # type: ignore[attr-defined]

    return rest()


STREAM_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


@router.post("/chat", response_model=ChatResponse, dependencies=[chat_limit])
async def chat(body: ChatRequest, user: CurrentUser, sm: SM):
    conv_id, user_msg, answer = await collect_chat(sm, _input(body, user.id))
    return ChatResponse(conversation_id=conv_id, user_message=user_msg, message=answer)


@router.post("/chat/stream", dependencies=[chat_limit])
async def chat_stream(body: ChatRequest, user: CurrentUser, sm: SM):
    """Server-Sent Events: meta, sources, token*, done | error."""
    return StreamingResponse(
        _sse(await _primed(run_chat(sm, _input(body, user.id)))), media_type="text/event-stream", headers=STREAM_HEADERS
    )


@router.post("/conversations/{cid}/regenerate", dependencies=[chat_limit])
async def regenerate(cid: uuid.UUID, user: CurrentUser, sm: SM):
    inp = ChatInput(user_id=user.id, question="", conversation_id=cid, regenerate=True)
    return StreamingResponse(_sse(await _primed(run_chat(sm, inp))), media_type="text/event-stream", headers=STREAM_HEADERS)


@router.get("/conversations", response_model=Page[ConversationOut])
async def list_conversations(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    q: str | None = Query(None, max_length=200),
):
    items, total = await svc.list_conversations(db, user.id, page=page, page_size=page_size, q=q)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/conversations/{cid}", response_model=ConversationDetail)
async def get_conversation(cid: uuid.UUID, user: CurrentUser, db: DB):
    return await svc.get_detail(db, user.id, cid)


@router.patch("/conversations/{cid}", response_model=ConversationOut)
async def update_conversation(cid: uuid.UUID, body: ConversationUpdate, user: CurrentUser, db: DB):
    return await svc.update_conversation(db, user.id, cid, body)


@router.delete("/conversations/{cid}", status_code=204)
async def delete_conversation(cid: uuid.UUID, user: CurrentUser, db: DB):
    await svc.delete_conversation(db, user.id, cid)
    return Response(status_code=204)


@router.get("/conversations/{cid}/export", response_class=PlainTextResponse)
async def export_conversation(cid: uuid.UUID, user: CurrentUser, db: DB):
    title, md = await svc.export_markdown(db, user.id, cid)
    from app.services.note_service import safe_filename

    return PlainTextResponse(
        md, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{safe_filename(title)}"'}
    )


@router.post("/conversations/{cid}/followups", response_model=FollowUps)
async def followups(cid: uuid.UUID, user: CurrentUser, sm: SM):
    return FollowUps(suggestions=await research.suggest_followups(sm, user.id, cid))
