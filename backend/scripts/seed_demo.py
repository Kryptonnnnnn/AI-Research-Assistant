"""Create a demo user and ingest the sample documents (no external services needed).

    python -m scripts.seed_demo            # from backend/, after `alembic upgrade head`

Environment: DEMO_EMAIL (default demo@example.com), DEMO_PASSWORD (default DemoPassw0rd!).
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sqlalchemy import select

from app.core.errors import ConflictError
from app.db.base import dispose_engine, get_sessionmaker
from app.jobs import queue
from app.models import User
from app.services import auth_service, document_service

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


async def main() -> None:
    email = os.environ.get("DEMO_EMAIL", "demo@example.com")
    password = os.environ.get("DEMO_PASSWORD", "DemoPassw0rd!")
    sm = get_sessionmaker()
    async with sm() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            try:
                user = await auth_service.register(db, email, password, "Demo User")
            except ConflictError:
                user = (await db.execute(select(User).where(User.email == email))).scalar_one()
            print(f"Created demo user {email}")
        for path in sorted(SAMPLES.glob("*.md")):
            item = await document_service.ingest_upload(db, user.id, path.name, "text/markdown", path.read_bytes())
            print(f"  {path.name}: {item.status}")
    print(f"Processed {await queue.drain(sm)} job(s)")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
