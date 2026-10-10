from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import get_settings
from app.core.errors import ConflictError, ForbiddenError, UnauthorizedError, ValidationFailed
from app.models import User, UserSession, UserSettings


def validate_password_strength(password: str) -> None:
    s = get_settings()
    if len(password) < s.min_password_length:
        raise ValidationFailed(f"Password must be at least {s.min_password_length} characters.", code="weak_password")
    if password.lower() == password or not any(ch.isdigit() for ch in password):
        raise ValidationFailed(
            "Password must mix upper- and lower-case letters and include at least one number.", code="weak_password"
        )


async def register(db: AsyncSession, email: str, password: str, display_name: str) -> User:
    if not get_settings().registration_enabled:
        raise ForbiddenError("Registration is disabled on this server.", code="registration_disabled")
    validate_password_strength(password)
    user = User(
        email=email, password_hash=security.hash_password(password), display_name=display_name.strip() or email.split("@")[0]
    )
    user.settings = UserSettings()
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("An account with this email already exists.", code="email_taken") from exc
    return user


async def create_session(db: AsyncSession, user: User, user_agent: str) -> tuple[str, datetime]:
    expires = security.session_expiry()
    sess = UserSession(user_id=user.id, created_at=datetime.now(UTC), expires_at=expires, user_agent=user_agent[:300])
    db.add(sess)
    await db.commit()
    return security.create_access_token(user.id, sess.id, expires), expires


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    # Always run a hash verification so response time doesn't reveal whether the email exists.
    ok = security.verify_password(user.password_hash if user else security.DUMMY_HASH, password)
    if not user or not ok or not user.is_active:
        raise UnauthorizedError("Invalid email or password.", code="invalid_credentials")
    if security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
        await db.commit()
    return user


async def user_from_token(db: AsyncSession, token: str) -> User | None:
    decoded = security.decode_access_token(token)
    if not decoded:
        return None
    user_id, session_id = decoded
    row = (
        await db.execute(
            select(User, UserSession)
            .join(UserSession, UserSession.user_id == User.id)
            .where(User.id == user_id, UserSession.id == session_id)
        )
    ).first()
    if not row:
        return None
    user, sess = row
    exp = sess.expires_at if sess.expires_at.tzinfo else sess.expires_at.replace(tzinfo=UTC)
    if sess.revoked_at is not None or exp < datetime.now(UTC) or not user.is_active:
        return None
    return user


async def revoke_session(db: AsyncSession, token: str) -> None:
    decoded = security.decode_access_token(token)
    if decoded:
        await db.execute(
            update(UserSession)
            .where(UserSession.id == decoded[1], UserSession.user_id == decoded[0])
            .values(revoked_at=datetime.now(UTC))
        )
        await db.commit()


async def change_password(db: AsyncSession, user: User, current: str, new: str, keep_session: uuid.UUID | None) -> None:
    if not security.verify_password(user.password_hash, current):
        raise UnauthorizedError("Current password is incorrect.", code="invalid_credentials")
    validate_password_strength(new)
    user.password_hash = security.hash_password(new)
    # Sign out every other session after a password change.
    q = update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
    if keep_session:
        q = q.where(UserSession.id != keep_session)
    await db.execute(q.values(revoked_at=datetime.now(UTC)))
    await db.commit()
