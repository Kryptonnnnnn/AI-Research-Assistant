from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Collection, Conversation, Document, Message, QueryLog, ResearchNote


async def metrics(db: AsyncSession, user_id: uuid.UUID) -> dict:
    status_rows = (
        await db.execute(select(Document.status, func.count()).where(Document.user_id == user_id).group_by(Document.status))
    ).all()
    by_status = {s: n for s, n in status_rows}
    storage = (
        await db.execute(select(func.coalesce(func.sum(Document.size_bytes), 0)).where(Document.user_id == user_id))
    ).scalar_one()
    convs = (await db.execute(select(func.count()).select_from(Conversation).where(Conversation.user_id == user_id))).scalar_one()
    questions = (
        await db.execute(select(func.count()).select_from(Message).where(Message.user_id == user_id, Message.role == "user"))
    ).scalar_one()
    notes = (await db.execute(select(func.count()).select_from(ResearchNote).where(ResearchNote.user_id == user_id))).scalar_one()
    collections = (
        await db.execute(select(func.count()).select_from(Collection).where(Collection.user_id == user_id))
    ).scalar_one()

    popular = (
        await db.execute(
            select(Document.id, Document.title, Document.access_count)
            .where(Document.user_id == user_id, Document.access_count > 0)
            .order_by(Document.access_count.desc())
            .limit(5)
        )
    ).all()

    since = datetime.now(UTC) - timedelta(days=13)
    logs = (
        await db.execute(
            select(QueryLog.created_at, QueryLog.kind, QueryLog.latency_ms).where(
                QueryLog.user_id == user_id, QueryLog.created_at >= since
            )
        )
    ).all()
    per_day: dict[str, int] = {}
    for i in range(14):
        per_day[(since + timedelta(days=i)).strftime("%Y-%m-%d")] = 0
    for created, _, _ in logs:
        key = created.strftime("%Y-%m-%d")
        if key in per_day:
            per_day[key] += 1
    by_kind: dict[str, int] = {}
    for _, kind, _ in logs:
        by_kind[kind] = by_kind.get(kind, 0) + 1
    avg_latency = round(sum(lat for *_, lat in logs) / len(logs), 1) if logs else None

    recent: list[dict] = []
    for d in (
        await db.execute(select(Document).where(Document.user_id == user_id).order_by(Document.created_at.desc()).limit(5))
    ).scalars():
        recent.append({"type": "document", "id": str(d.id), "title": d.title, "detail": d.status, "at": d.created_at.isoformat()})
    for c in (
        await db.execute(
            select(Conversation).where(Conversation.user_id == user_id).order_by(Conversation.updated_at.desc()).limit(5)
        )
    ).scalars():
        recent.append(
            {"type": "conversation", "id": str(c.id), "title": c.title, "detail": "conversation", "at": c.updated_at.isoformat()}
        )
    recent.sort(key=lambda r: r["at"], reverse=True)

    return {
        "documents": {
            "total": sum(by_status.values()),
            "ready": by_status.get("ready", 0),
            "processing": by_status.get("processing", 0) + by_status.get("queued", 0),
            "failed": by_status.get("failed", 0),
        },
        "conversations": convs,
        "questions_asked": questions,
        "notes": notes,
        "collections": collections,
        "storage_bytes": int(storage),
        "popular_documents": [{"id": str(i), "title": t, "access_count": n} for i, t, n in popular],
        "queries_last_14_days": [{"date": d, "count": n} for d, n in per_day.items()],
        "queries_by_kind": by_kind,
        "avg_query_latency_ms": avg_latency,
        "recent_activity": recent[:8],
    }
