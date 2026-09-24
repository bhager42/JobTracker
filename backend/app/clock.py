"""The injectable clock. Code that needs "now" or "today" takes it from here, never directly
from `datetime.now()`, so tests can freeze time (CLAUDE.md: tests never use the real time)."""

from collections.abc import Callable
from datetime import UTC, date, datetime

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


def get_clock() -> Clock:
    """FastAPI dependency. Tests override it with a frozen clock."""
    return utc_now


def local_date(moment: datetime) -> date:
    """The calendar date of an aware UTC moment in the container's `TZ`."""
    return moment.astimezone().date()
