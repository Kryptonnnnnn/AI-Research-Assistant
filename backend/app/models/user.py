from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk
from app.db.types import UTCDateTime


class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    settings: Mapped[UserSettings | None] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)


class UserSession(UUIDPk, Base):
    """Server-side record behind each JWT so logout/revocation is real."""

    __tablename__ = "user_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None)
    user_agent: Mapped[str] = mapped_column(String(300), default="")


class UserSettings(UUIDPk, Timestamps, Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    theme: Mapped[str] = mapped_column(String(16), default="system")
    llm_provider: Mapped[str | None] = mapped_column(String(32), default=None)
    llm_model: Mapped[str | None] = mapped_column(String(200), default=None)
    top_k: Mapped[int | None] = mapped_column(Integer, default=None)
    score_threshold: Mapped[float | None] = mapped_column(Float, default=None)
    context_token_budget: Mapped[int | None] = mapped_column(Integer, default=None)
    hybrid_search: Mapped[bool | None] = mapped_column(Boolean, default=None)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    user: Mapped[User] = relationship(back_populates="settings")
