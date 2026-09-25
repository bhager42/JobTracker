"""The in-process auto-close scheduler (PLAN.md §6).

It runs once at startup, then every `interval` seconds. Uvicorn runs a single worker, so there
is exactly one scheduler; the rule is idempotent, so a run after downtime simply catches up.
"""

import asyncio
import logging

from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.services.auto_close import run_auto_close

log = logging.getLogger(__name__)

HOURLY = 3600.0


def run_once(session_factory: sessionmaker[Session], clock: Clock) -> list[int]:
    with session_factory() as session:
        ids = run_auto_close(session, clock())
    if ids:
        log.info("Auto-closed %d application(s): %s", len(ids), ids)
    return ids


async def run_forever(
    session_factory: sessionmaker[Session], clock: Clock, interval: float = HOURLY
) -> None:
    """Runs after each `interval`. The startup run happens before this is started."""
    while True:
        await asyncio.sleep(interval)
        try:
            # SQLAlchemy sessions are synchronous; keep the event loop free.
            await asyncio.to_thread(run_once, session_factory, clock)
        except Exception:
            # Keep the scheduler alive; the next run retries.
            log.exception("Auto-close run failed")
