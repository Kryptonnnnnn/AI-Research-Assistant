from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Conversation, Message
from app.rag.pipeline import message_to_out
from app.repositories.ownership import get_collection, get_conversation
from app.schemas.chat import ConversationDetail, ConversationOut, ConversationUpdate


def _out(c: Conversation, count: int, preview: str) -> ConversationOut:
    return ConversationOut(
        id=c.id,
        title=c.title,
        collection_id=c.collection_id,
        document_ids=[uuid.UUID(d) for d in c.document_ids or []],
        created_at=c.created_at,
        updated_at=c.updated_at,
        message_count=count,
        last_message_preview=preview,
    )


async def list_conversations(db: AsyncSession, user_id: uuid.UUID, *, page: int, page_size: int, q: str | None):
    cond = [Conversation.user_id == user_id]
    if q:
        like = f"%{q.lower()}%"
        in_messages = select(Message.conversation_id).where(Message.user_id == user_id, func.lower(Message.content).like(like))
        cond.append(or_(func.lower(Conversation.title).like(like), Conversation.id.in_(in_messages)))
    total = (await db.execute(select(func.count()).select_from(Conversation).where(*cond))).scalar_one()
    convs = (
        (
            await db.execute(
                select(Conversation)
                .where(*cond)
                .order_by(Conversation.updated_at.desc(), Conversation.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    ids = [c.id for c in convs]
    counts = (
        dict(
            (
                await db.execute(
                    select(Message.conversation_id, func.count())
                    .where(Message.conversation_id.in_(ids))
                    .group_by(Message.conversation_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    previews: dict[uuid.UUID, str] = {}
    for cid in ids:
        last = (
            await db.execute(
                select(Message.content)
                .where(Message.conversation_id == cid, Message.content != "")
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        previews[cid] = (last or "")[:140]
    return [_out(c, counts.get(c.id, 0), previews[c.id]) for c in convs], total


async def get_detail(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID) -> ConversationDetail:
    await get_conversation(db, user_id, cid)
    conv = (
        await db.execute(
            select(Conversation)
            .options(selectinload(Conversation.messages).selectinload(Message.citations))
            .where(Conversation.id == cid, Conversation.user_id == user_id)
        )
    ).scalar_one()
    base = _out(conv, len(conv.messages), "")
    return ConversationDetail(**base.model_dump(), messages=[message_to_out(m) for m in conv.messages])


async def update_conversation(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID, data: ConversationUpdate) -> ConversationOut:
    conv = await get_conversation(db, user_id, cid)
    if data.title is not None:
        conv.title = data.title.strip()
    fields = data.model_fields_set
    if "document_ids" in fields and data.document_ids is not None:
        from app.rag.scope import resolve_scope

        await resolve_scope(db, user_id, data.document_ids, None)  # validates ownership
        conv.document_ids = [str(d) for d in data.document_ids]
    if "collection_id" in fields:
        if data.collection_id:
            await get_collection(db, user_id, data.collection_id)
        conv.collection_id = data.collection_id
    await db.commit()
    count = (await db.execute(select(func.count()).select_from(Message).where(Message.conversation_id == cid))).scalar_one()
    return _out(conv, count, "")


async def delete_conversation(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID) -> None:
    conv = await get_conversation(db, user_id, cid)
    await db.delete(conv)
    await db.commit()


async def export_markdown(db: AsyncSession, user_id: uuid.UUID, cid: uuid.UUID) -> tuple[str, str]:
    detail = await get_detail(db, user_id, cid)
    lines = [f"# {detail.title}", "", f"_Exported from AI Research Assistant · {detail.created_at:%Y-%m-%d}_", ""]
    for m in detail.messages:
        if m.role == "user":
            lines += ["## Question", "", m.content, ""]
        else:
            lines += ["## Answer", "", m.content or f"_({m.status})_", ""]
            cited = [c for c in m.citations if c.cited]
            if cited:
                lines += ["### Sources", ""]
                for c in cited:
                    page = f", p. {c.page_number}" if c.page_number else ""
                    quote = c.excerpt.replace("\n", " ")
                    lines.append(f"- **[{c.label}]** {c.document_title}{page} — “{quote}”")
                lines.append("")
    return detail.title, "\n".join(lines).strip() + "\n"
