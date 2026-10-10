import pytest

from app.core.ratelimit import limiter
from tests.conftest import PASSWORD, make_client, register


async def test_register_login_me_logout(client):
    data = await register(client, "carol@example.com")
    assert data["user"]["email"] == "carol@example.com" and "password" not in str(data)
    assert (await client.get("/api/v1/auth/me")).json()["email"] == "carol@example.com"  # cookie auth

    assert (await client.post("/api/v1/auth/logout")).status_code == 200
    client.cookies.clear()
    assert (await client.get("/api/v1/auth/me")).status_code == 401

    r = await client.post("/api/v1/auth/login", json={"email": "CAROL@example.com", "password": PASSWORD})
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_logout_revokes_token_server_side(client):
    data = await register(client)
    token = data["access_token"]
    await client.post("/api/v1/auth/logout")
    client.cookies.clear()
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401  # token no longer valid even though the JWT itself hasn't expired


async def test_bearer_token_works(client):
    token = (await register(client))["access_token"]
    client.cookies.clear()
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})).status_code == 401


async def test_wrong_password_and_unknown_user_same_error(client):
    await register(client)
    a = await client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "WrongPassw0rd!!"})
    b = await client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "WrongPassw0rd!!"})
    assert a.status_code == b.status_code == 401
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


async def test_duplicate_email_conflict(client):
    await register(client)
    r = await client.post("/api/v1/auth/register", json={"email": "alice@example.com", "password": PASSWORD})
    assert r.status_code == 409


@pytest.mark.parametrize("pw", ["short1A", "alllowercase123", "NoDigitsHereAtAll"])
async def test_weak_passwords_rejected(client, pw):
    r = await client.post("/api/v1/auth/register", json={"email": "x@example.com", "password": pw})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"


async def test_password_is_argon2id_hashed(client):
    await register(client)
    from sqlalchemy import select

    from app.db.base import get_sessionmaker
    from app.models import User

    async with get_sessionmaker()() as db:
        h = (await db.execute(select(User.password_hash))).scalar_one()
    assert h.startswith("$argon2id$") and PASSWORD not in h


async def test_protected_routes_require_auth(client):
    for method, path in [
        ("get", "/api/v1/documents"),
        ("get", "/api/v1/conversations"),
        ("get", "/api/v1/dashboard"),
        ("get", "/api/v1/notes"),
        ("get", "/api/v1/settings"),
        ("get", "/api/v1/collections"),
        ("post", "/api/v1/chat"),
        ("post", "/api/v1/search"),
    ]:
        r = await getattr(client, method)(path)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "not_authenticated"


async def test_profile_update_and_password_change(client):
    await register(client)
    r = await client.patch("/api/v1/auth/me", json={"display_name": "Alice A"})
    assert r.json()["display_name"] == "Alice A"
    bad = await client.post("/api/v1/auth/change-password", json={"current_password": "nope", "new_password": "NewStr0ngPass!"})
    assert bad.status_code == 401
    ok = await client.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "NewStr0ngPass!"})
    assert ok.status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 200  # current session survives


async def test_password_change_signs_out_other_sessions(app):
    async with make_client(app) as a, make_client(app) as b:
        await register(a)
        r = await b.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
        assert r.status_code == 200
        await a.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "NewStr0ngPass!"})
        assert (await b.get("/api/v1/auth/me")).status_code == 401


async def test_rate_limit_on_auth(app, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("RATE_LIMIT_AUTH_PER_MINUTE", "3")
    from app.core.config import reset_settings_cache

    reset_settings_cache()
    limiter.reset()
    async with make_client(app) as c:
        codes = [
            (await c.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "x"})).status_code for _ in range(5)
        ]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    reset_settings_cache()


async def test_expired_session_rejected(client):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from app.db.base import get_sessionmaker
    from app.models import UserSession

    await register(client)
    async with get_sessionmaker()() as db:
        await db.execute(update(UserSession).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_validation_error_envelope(client):
    r = await client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "x"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "validation_error" and body["details"][0]["field"] == "email"
