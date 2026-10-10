from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.errors import UnauthorizedError
from app.db.base import get_db, get_sessionmaker
from app.models import User
from app.services import auth_service

DB = Annotated[AsyncSession, Depends(get_db)]


def get_sm() -> async_sessionmaker[AsyncSession]:
    return get_sessionmaker()


SM = Annotated[async_sessionmaker[AsyncSession], Depends(get_sm)]


def extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(get_settings().cookie_name)


async def get_current_user(request: Request, db: DB) -> User:
    token = extract_token(request)
    user = await auth_service.user_from_token(db, token) if token else None
    if user is None:
        raise UnauthorizedError("Not authenticated.", code="not_authenticated")
    request.state.token = token
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
