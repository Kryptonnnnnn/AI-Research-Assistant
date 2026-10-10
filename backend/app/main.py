from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.router import api_router
from app.api.routers.meta import VERSION, health_router
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestLoggingMiddleware, setup_logging
from app.db.base import dispose_engine
from app.embeddings.factory import get_embedding_provider
from app.jobs.worker import JobRunner

logger = logging.getLogger("app")


def _safe_warmup(fn) -> None:
    try:
        fn()
        logger.info("Embedding model warmed up")
    except Exception as exc:  # noqa: BLE001 - surfaced again (with a clear message) on first real use
        logger.warning("Embedding warm-up failed: %s", exc)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        runner = JobRunner() if settings.job_runner == "embedded" else None
        if runner:
            runner.start()
        warmup = getattr(get_embedding_provider(), "warmup", None) if settings.job_runner != "disabled" else None
        if warmup:  # load the embedding model in the background so the first upload/query isn't slow
            warm_task = asyncio.create_task(asyncio.to_thread(_safe_warmup, warmup))
        logger.info(
            "Started (env=%s, jobs=%s, llm=%s, embeddings=%s)",
            settings.app_env,
            settings.job_runner,
            settings.llm_provider,
            settings.embedding_provider,
        )
        yield
        if warmup:
            warm_task.cancel()
        if runner:
            await runner.stop()
        await dispose_engine()

    app = FastAPI(
        title=settings.app_name,
        version=VERSION,
        lifespan=lifespan,
        description="RAG-powered research assistant API. All /api/v1 routes except auth and health require a session.",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    install_error_handlers(app)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition", "X-Process-Time-Ms"],
    )
    app.include_router(api_router, prefix=settings.api_prefix)
    app.include_router(health_router)  # also at root for platform health checks (/health, /ready)
    return app


app = create_app()
