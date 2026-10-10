"""Dashboard, settings, health and readiness."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text

from app.api.deps import DB, CurrentUser
from app.core.config import get_settings
from app.core.errors import ProviderError
from app.core.ratelimit import rate_limit
from app.llm.factory import get_llm
from app.models import ProcessingJob
from app.schemas.settings import ProviderTestIn, ProviderTestOut, SettingsOut, SettingsUpdate
from app.services import dashboard_service, settings_service

VERSION = "1.0.0"

router = APIRouter(tags=["meta"])


@router.get("/dashboard")
async def dashboard(user: CurrentUser, db: DB):
    return await dashboard_service.metrics(db, user.id)


@router.get("/settings", response_model=SettingsOut)
async def get_user_settings(user: CurrentUser, db: DB):
    return await settings_service.to_out(db, user.id)


@router.put("/settings", response_model=SettingsOut)
async def put_user_settings(body: SettingsUpdate, user: CurrentUser, db: DB):
    return await settings_service.update(db, user.id, body)


@router.post(
    "/settings/test-provider",
    response_model=ProviderTestOut,
    dependencies=[Depends(rate_limit("auth", "rate_limit_auth_per_minute"))],
)
async def test_provider(body: ProviderTestIn, user: CurrentUser, db: DB):
    """Connectivity probe. Secrets never leave the server and never appear in the response."""
    eff = await settings_service.effective(db, user.id)
    provider = body.llm_provider or eff.llm_provider
    model = body.llm_model if body.llm_model is not None else (eff.llm_model if provider == eff.llm_provider else "")
    t0 = time.perf_counter()
    try:
        llm = get_llm(provider, model or None)
        detail = await llm.check()
        ok, model = True, llm.model
    except ProviderError as exc:
        ok, detail = False, exc.message
    return ProviderTestOut(
        ok=ok, provider=provider, model=model, detail=detail, latency_ms=round((time.perf_counter() - t0) * 1000, 1)
    )


health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health():
    """Liveness: the process is up. Used by Render / uptime monitors."""
    return {"status": "ok", "version": VERSION}


@health_router.get("/ready")
async def ready(db: DB):
    """Readiness: dependencies are reachable. Contains no secrets."""
    s = get_settings()
    checks: dict[str, dict] = {}
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = {"ok": True, "backend": "postgresql" if s.is_postgres else "sqlite"}
        if s.is_postgres:
            ext = (await db.execute(text("SELECT 1 FROM pg_extension WHERE extname='vector'"))).first()
            checks["pgvector"] = {"ok": ext is not None}
        counts = dict((await db.execute(select(ProcessingJob.status, func.count()).group_by(ProcessingJob.status))).all())
        checks["jobs"] = {
            "ok": True,
            "runner": s.job_runner,
            "queued": counts.get("queued", 0),
            "running": counts.get("running", 0),
            "failed": counts.get("failed", 0),
        }
    except Exception:  # noqa: BLE001
        checks["database"] = {"ok": False}
    try:
        from app.storage.factory import get_storage

        await get_storage().check()
        checks["storage"] = {"ok": True, "backend": s.storage_backend}
    except Exception as exc:  # noqa: BLE001 - class name only: useful for diagnosis, never secrets
        checks["storage"] = {"ok": False, "backend": s.storage_backend, "error": type(exc).__name__}
    checks["embeddings"] = {"ok": True, "provider": s.embedding_provider, "dim": s.embedding_dim}
    checks["llm"] = {"provider": s.llm_provider, "configured": bool(s.llm_model) or s.llm_provider == "mock"}
    ok = all(c.get("ok", True) for c in checks.values())
    from fastapi.responses import JSONResponse

    return JSONResponse(
        {"status": "ready" if ok else "degraded", "version": VERSION, "checks": checks}, status_code=200 if ok else 503
    )
