"""Small in-memory sliding-window rate limiter (per process).

Good enough for a single free-tier instance. For multiple instances put a shared
limiter (Redis, or the platform's edge) in front; see docs/DEPLOYMENT.md.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window: float = 60.0) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            raise RateLimited("Too many requests. Please slow down and try again shortly.")
        q.append(now)

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, per_minute_attr: str):
    """FastAPI dependency factory limiting by client IP and bucket name."""

    async def dependency(request: Request) -> None:
        settings = get_settings()
        if not settings.rate_limit_enabled:
            return
        limiter.check(f"{bucket}:{client_ip(request)}", getattr(settings, per_minute_attr))

    return dependency
