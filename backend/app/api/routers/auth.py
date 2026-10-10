from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import DB, CurrentUser, extract_token
from app.core import security
from app.core.config import get_settings
from app.core.ratelimit import rate_limit
from app.schemas.auth import AuthOut, LoginIn, PasswordChange, ProfileUpdate, RegisterIn, UserOut
from app.schemas.common import Message
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
auth_limit = Depends(rate_limit("auth", "rate_limit_auth_per_minute"))


def _set_cookie(response: Response, token: str, expires) -> None:
    s = get_settings()
    response.set_cookie(
        s.cookie_name,
        token,
        httponly=True,
        secure=s.cookie_secure,
        samesite=s.cookie_samesite,
        max_age=s.session_expire_minutes * 60,
        path="/",
    )


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED, dependencies=[auth_limit])
async def register(body: RegisterIn, request: Request, response: Response, db: DB):
    user = await auth_service.register(db, body.email, body.password, body.display_name)
    token, expires = await auth_service.create_session(db, user, request.headers.get("user-agent", ""))
    _set_cookie(response, token, expires)
    return AuthOut(user=UserOut.model_validate(user), access_token=token, expires_at=expires)


@router.post("/login", response_model=AuthOut, dependencies=[auth_limit])
async def login(body: LoginIn, request: Request, response: Response, db: DB):
    user = await auth_service.authenticate(db, body.email, body.password)
    token, expires = await auth_service.create_session(db, user, request.headers.get("user-agent", ""))
    _set_cookie(response, token, expires)
    return AuthOut(user=UserOut.model_validate(user), access_token=token, expires_at=expires)


@router.post("/logout", response_model=Message)
async def logout(request: Request, response: Response, db: DB):
    token = extract_token(request)
    if token:
        await auth_service.revoke_session(db, token)
    response.delete_cookie(get_settings().cookie_name, path="/")
    return Message(message="Logged out")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserOut)
async def update_profile(body: ProfileUpdate, user: CurrentUser, db: DB):
    user.display_name = body.display_name.strip() or user.display_name
    await db.commit()
    return user


@router.post("/change-password", response_model=Message, dependencies=[auth_limit])
async def change_password(body: PasswordChange, request: Request, user: CurrentUser, db: DB):
    decoded = security.decode_access_token(request.state.token)
    await auth_service.change_password(db, user, body.current_password, body.new_password, decoded[1] if decoded else None)
    return Message(message="Password updated. Other sessions were signed out.")
