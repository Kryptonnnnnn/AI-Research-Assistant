from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ORMModel


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    display_name: str = Field(default="", max_length=120)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime


class AuthOut(BaseModel):
    user: UserOut
    access_token: str  # also set as an httpOnly cookie; API clients may use it as a Bearer token
    token_type: str = "bearer"
    expires_at: datetime


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=0, max_length=120)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)
