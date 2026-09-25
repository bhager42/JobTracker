"""Metric definitions shared by the dashboard and (Phase 5) the metrics page.

Rates count what an application has *ever* reached, from `status_history`, not just its
current status: an application rejected after an interview still counts as interviewed.
Calendar periods use the container `TZ`, with ISO weeks starting Monday (CLAUDE.md).
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import ColumnElement, Select, and_, exists, func, select
from sqlalchemy.orm import Session

from app.clock import local_date
from app.enums import Status
from app.models import Application, StatusHistory

# Statuses that show the employer responded. Withdrawn and Position Closed are not a response
# to you, and Not Selected (No Response) is by definition the absence of one.
RESPONSE_STATUSES: frozenset[Status] = frozenset(
    {
        Status.SCREENING,
        Status.INTERVIEWING,
        Status.OFFER,
        Status.ACCEPTED,
        Status.DECLINED,
        Status.REJECTED_NO_INTERVIEW,
        Status.REJECTED_AFTER_INTERVIEW,
    }
)
# Statuses that mean at least one interview happened.
INTERVIEW_STATUSES: frozenset[Status] = frozenset(
    {
        Status.INTERVIEWING,
        Status.OFFER,
        Status.ACCEPTED,
        Status.DECLINED,
        Status.REJECTED_AFTER_INTERVIEW,
    }
)
OFFER_STATUSES: frozenset[Status] = frozenset({Status.OFFER, Status.ACCEPTED, Status.DECLINED})
ACTIVE_STATUSES: frozenset[Status] = frozenset(
    {Status.APPLIED, Status.SCREENING, Status.INTERVIEWING, Status.OFFER}
)


def applied_filter() -> ColumnElement[bool]:
    """Applications that were actually sent (not just saved to a wishlist)."""
    return and_(Application.status != Status.SAVED, Application.date_applied.is_not(None))


def ever_reached(statuses: frozenset[Status]) -> ColumnElement[bool]:
    return exists().where(
        StatusHistory.application_id == Application.id,
        StatusHistory.to_status.in_(statuses),
    )


def count(session: Session, stmt: Select[tuple[int]]) -> int:
    return session.scalar(stmt) or 0


def rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


@dataclass(frozen=True)
class Period:
    start: date
    end: date  # inclusive


def current_week(now: datetime) -> Period:
    """The ISO week (Monday to Sunday) containing `now` in the container TZ."""
    today = local_date(now)
    start = today - timedelta(days=today.weekday())
    return Period(start, start + timedelta(days=6))


def current_month(now: datetime) -> Period:
    today = local_date(now)
    start = today.replace(day=1)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return Period(start, next_month - timedelta(days=1))


def applied_in(session: Session, period: Period) -> int:
    return count(
        session,
        select(func.count())
        .select_from(Application)
        .where(applied_filter(), Application.date_applied.between(period.start, period.end)),
    )
