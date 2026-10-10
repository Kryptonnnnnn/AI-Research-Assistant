from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.llm.factory import available_providers
from app.models import UserSettings
from app.rag.retriever import RetrievalParams
from app.schemas.settings import SettingsOut, SettingsUpdate

OVERRIDABLE = ("llm_provider", "llm_model", "top_k", "score_threshold", "context_token_budget", "hybrid_search")


@dataclass
class EffectiveSettings:
    llm_provider: str
    llm_model: str
    retrieval: RetrievalParams
    theme: str


async def get_or_create(db: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    row = (await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))).scalar_one_or_none()
    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)
        await db.flush()
    return row


async def effective(db: AsyncSession, user_id: uuid.UUID) -> EffectiveSettings:
    s = get_settings()
    row = (await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))).scalar_one_or_none()
    g = lambda name, default: getattr(row, name) if row is not None and getattr(row, name) is not None else default  # noqa: E731
    # A user-chosen model only applies together with a user-chosen provider; otherwise it could
    # be sent to a different provider that does not know it.
    provider = g("llm_provider", s.llm_provider)
    model = (row.llm_model if row is not None and row.llm_provider and row.llm_model else None) or (
        s.llm_model if provider == s.llm_provider else ""
    )
    return EffectiveSettings(
        llm_provider=provider,
        llm_model=model,
        retrieval=RetrievalParams(
            top_k=g("top_k", s.retrieval_top_k),
            score_threshold=g("score_threshold", s.retrieval_score_threshold),
            hybrid=g("hybrid_search", s.retrieval_hybrid),
            context_token_budget=g("context_token_budget", s.context_token_budget),
        ),
        theme=row.theme if row is not None else "system",
    )


async def to_out(db: AsyncSession, user_id: uuid.UUID) -> SettingsOut:
    s = get_settings()
    eff = await effective(db, user_id)
    row = (await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))).scalar_one_or_none()
    return SettingsOut(
        theme=eff.theme,
        llm_provider=eff.llm_provider,
        llm_model=eff.llm_model,
        top_k=eff.retrieval.top_k,
        score_threshold=eff.retrieval.score_threshold,
        context_token_budget=eff.retrieval.context_token_budget,
        hybrid_search=eff.retrieval.hybrid,
        embedding_provider=s.embedding_provider,
        embedding_model=s.embedding_model
        if s.embedding_provider == "sentence-transformers"
        else (s.embedding_ollama_model if s.embedding_provider == "ollama" else "hash-bow-v1"),
        embedding_dim=s.embedding_dim,
        chunk_size_tokens=s.chunk_size_tokens,
        chunk_overlap_tokens=s.chunk_overlap_tokens,
        providers=available_providers(),
        overrides={n: (row is not None and getattr(row, n) is not None) for n in OVERRIDABLE},
    )


async def update(db: AsyncSession, user_id: uuid.UUID, data: SettingsUpdate) -> SettingsOut:
    row = await get_or_create(db, user_id)
    payload = data.model_dump(exclude_unset=True, exclude={"reset"})
    for k, v in payload.items():
        if k == "theme":
            row.theme = v or "system"
        else:
            setattr(row, k, v)
    for name in data.reset:
        if name in OVERRIDABLE:
            setattr(row, name, None)
    if "llm_provider" in payload and payload["llm_provider"] is None:
        row.llm_model = None
    await db.commit()
    return await to_out(db, user_id)
