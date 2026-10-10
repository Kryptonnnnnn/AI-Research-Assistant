from __future__ import annotations

import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Message, ResearchNote
from app.repositories.ownership import get_message, get_note
from app.schemas.chat import NoteIn, NoteUpdate


async def create_note(db: AsyncSession, user_id: uuid.UUID, data: NoteIn) -> ResearchNote:
    citations: list[dict] = []
    if data.source_message_id:
        await get_message(db, user_id, data.source_message_id)  # must be the user's own message
        msg = (
            await db.execute(select(Message).options(selectinload(Message.citations)).where(Message.id == data.source_message_id))
        ).scalar_one()
        citations = [
            {
                "label": c.label,
                "document_id": str(c.document_id) if c.document_id else None,
                "document_title": c.document_title,
                "page_number": c.page_number,
                "excerpt": c.excerpt,
            }
            for c in msg.citations
            if c.cited
        ]
    note = ResearchNote(
        user_id=user_id,
        title=data.title.strip(),
        content=data.content,
        source_message_id=data.source_message_id,
        citations=citations,
        tags=[t.strip()[:40] for t in data.tags if t.strip()],
    )
    db.add(note)
    await db.commit()
    return note


async def list_notes(db: AsyncSession, user_id: uuid.UUID, page: int, page_size: int, q: str | None):
    cond = [ResearchNote.user_id == user_id]
    if q:
        like = f"%{q.lower()}%"
        cond.append(or_(func.lower(ResearchNote.title).like(like), func.lower(ResearchNote.content).like(like)))
    total = (await db.execute(select(func.count()).select_from(ResearchNote).where(*cond))).scalar_one()
    rows = (
        (
            await db.execute(
                select(ResearchNote)
                .where(*cond)
                .order_by(ResearchNote.updated_at.desc(), ResearchNote.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def update_note(db: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID, data: NoteUpdate) -> ResearchNote:
    note = await get_note(db, user_id, note_id)
    if data.title is not None:
        note.title = data.title.strip()
    if data.content is not None:
        note.content = data.content
    if data.tags is not None:
        note.tags = [t.strip()[:40] for t in data.tags if t.strip()]
    await db.commit()
    return note


async def delete_note(db: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    await db.delete(await get_note(db, user_id, note_id))
    await db.commit()


def note_markdown(note: ResearchNote) -> str:
    lines = [f"# {note.title}", "", note.content.strip(), ""]
    if note.tags:
        lines += [f"Tags: {', '.join(note.tags)}", ""]
    if note.citations:
        lines += ["## Sources", ""]
        for c in note.citations:
            page = f", p. {c['page_number']}" if c.get("page_number") else ""
            lines.append(f"- **[{c['label']}]** {c['document_title']}{page} — “{c['excerpt'].replace(chr(10), ' ')}”")
        lines.append("")
    return "\n".join(lines)


def safe_filename(title: str) -> str:
    return (re.sub(r"[^a-z0-9._-]+", "-", title.lower()).strip("-")[:60] or "note") + ".md"
