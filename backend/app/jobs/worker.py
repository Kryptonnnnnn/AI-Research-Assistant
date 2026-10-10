"""Job runner. Embedded in the API process by default; or run standalone:

python -m app.jobs.worker            # long-running worker (JOB_RUNNER=external for the API)
python -m app.jobs.worker --once     # drain the queue and exit
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sys

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.base import get_sessionmaker
from app.jobs import queue

logger = logging.getLogger("app.worker")


class JobRunner:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def _loop(self) -> None:
        sm = get_sessionmaker()
        interval = get_settings().job_poll_interval_seconds
        try:
            recovered = await queue.recover_stale(sm)
            if recovered:
                logger.warning("Recovered %d interrupted job(s)", recovered)
        except Exception:  # noqa: BLE001
            logger.exception("Stale-job recovery failed")
        if get_settings().auto_reindex:
            try:
                n = await queue.enqueue_stale_reindex(sm)
                if n:
                    logger.warning("Queued %d document(s) for re-indexing (embedding model/chunking changed)", n)
            except Exception:  # noqa: BLE001
                logger.exception("Stale-index scan failed")
        last_recover = asyncio.get_running_loop().time()
        while not self._stop.is_set():
            try:
                worked = await queue.run_next(sm)
            except Exception:  # noqa: BLE001 - keep the worker alive
                logger.exception("Worker iteration failed")
                worked = False
            if asyncio.get_running_loop().time() - last_recover > 60:
                with contextlib.suppress(Exception):
                    await queue.recover_stale(sm)
                last_recover = asyncio.get_running_loop().time()
            if worked:
                continue
            queue.wakeup.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(queue.wakeup.wait(), timeout=interval)

    def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="job-runner")

    async def stop(self) -> None:
        self._stop.set()
        queue.wakeup.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task


async def _main(once: bool) -> None:
    sm = get_sessionmaker()
    if once:
        print(f"processed {await queue.drain(sm)} job(s)")
        return
    runner = JobRunner()
    runner.start()
    logger.info("Worker started")
    await asyncio.Event().wait()


if __name__ == "__main__":
    setup_logging(get_settings().log_level)
    asyncio.run(_main("--once" in sys.argv))
    sys.exit(0)
