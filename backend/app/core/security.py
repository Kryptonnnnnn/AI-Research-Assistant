"""Password hashing (Argon2id) and session JWTs (PyJWT)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_hasher = PasswordHasher()  # argon2id with library defaults (RFC 9106 low-memory profile)
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# A real hash used to equalise timing when the email is unknown.
DUMMY_HASH = _hasher.hash("not-a-real-password")


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, expires_at: datetime) -> str:
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "iat": datetime.now(UTC),
        "exp": expires_at,
    }
    return jwt.encode(payload, get_settings().secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    try:
        data = jwt.decode(
            token, get_settings().secret_key, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub", "sid"]}
        )
        return uuid.UUID(data["sub"]), uuid.UUID(data["sid"])
    except (jwt.PyJWTError, ValueError):
        return None


def session_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=get_settings().session_expire_minutes)
