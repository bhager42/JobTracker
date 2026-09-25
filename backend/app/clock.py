"""The injectable clock. Code that needs "now" or "today" takes it from here, never directly
from `datetime.now()`, so tests can freeze time (CLAUDE.md: tests never use the real time)."""

from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi import Request

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


def get_clock(request: Request) -> Clock:
    """FastAPI dependency: the clock passed to `create_app`, shared with the scheduler."""
    clock: Clock = request.app.state.clock
    return clock


def local_date(moment: datetime) -> date:
    """The calendar date of an aware UTC moment in the container's `TZ`."""
    return moment.astimezone().date()
