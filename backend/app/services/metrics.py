"""Metric definitions shared by the dashboard and (Phase 5) the metrics page.

Rates count what an application has *ever* reached, from `status_history`, not just its
current status: an application rejected after an interview still counts as interviewed.
Calendar periods use the container `TZ`, with ISO weeks starting Monday (CLAUDE.md).
"""

import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import ColumnElement, Integer, Select, and_, case, cast, exists, func, select
from sqlalchemy.orm import Session

from app.clock import local_date
from app.enums import STATUS_GROUPS, Source, Status, StatusGroup, WorkMode
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


# --- Metrics page (PLAN.md §7.5) ---------------------------------------------------------

Granularity = Literal["week", "month", "year"]

# How far each funnel stage reaches: an application counts for a stage if it ever reached it
# *or any later stage*, so the funnel never grows (someone who went straight from Applied to
# Interviewing still passed the screening stage).
FUNNEL_STAGES: tuple[tuple[Status, frozenset[Status]], ...] = (
    (Status.APPLIED, frozenset()),  # every applied application
    # A rejection without an interview is a response, but not proof of a screen.
    (Status.SCREENING, frozenset({Status.SCREENING}) | INTERVIEW_STATUSES),
    (Status.INTERVIEWING, INTERVIEW_STATUSES),
    (Status.OFFER, OFFER_STATUSES),
    (Status.ACCEPTED, frozenset({Status.ACCEPTED})),
)


@dataclass(frozen=True)
class MetricsFilter:
    """The slice every metrics endpoint reports on. `date_from`/`date_to` bound
    `date_applied`; the other filters match current values. Wishlist entries never count."""

    date_from: date | None = None
    date_to: date | None = None
    statuses: list[Status] | None = None
    sources: list[Source] | None = None
    work_modes: list[WorkMode] | None = None

    def conditions(self) -> list[ColumnElement[bool]]:
        conds: list[ColumnElement[bool]] = [applied_filter()]
        if self.date_from:
            conds.append(Application.date_applied >= self.date_from)
        if self.date_to:
            conds.append(Application.date_applied <= self.date_to)
        if self.statuses:
            conds.append(Application.status.in_(self.statuses))
        if self.sources:
            conds.append(Application.source.in_(self.sources))
        if self.work_modes:
            conds.append(Application.work_mode.in_(self.work_modes))
        return conds

    def count(self, session: Session, *extra: ColumnElement[bool]) -> int:
        return count(
            session,
            select(func.count()).select_from(Application).where(*self.conditions(), *extra),
        )


# SQLite-specific bucketing lives only here (PLAN.md §3): a move to Postgres rewrites these
# two functions and nothing else.


def _bucket_sql(granularity: Granularity) -> ColumnElement[str]:
    """SQL for the first day of the bucket holding `date_applied` (ISO weeks start Monday)."""
    d = Application.date_applied
    if granularity == "week":
        # strftime('%w') is 0 for Sunday; step back to that week's Monday.
        days_since_monday = (cast(func.strftime("%w", d), Integer) + 6) % 7
        return func.date(d, func.printf("-%d days", days_since_monday))
    if granularity == "month":
        return func.strftime("%Y-%m-01", d)
    return func.strftime("%Y-01-01", d)


def bucket_start(day: date, granularity: Granularity) -> date:
    """The Python twin of `_bucket_sql`, used to lay out (and zero-fill) the buckets."""
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    if granularity == "month":
        return day.replace(day=1)
    return day.replace(month=1, day=1)


def next_bucket(start: date, granularity: Granularity) -> date:
    if granularity == "week":
        return start + timedelta(days=7)
    if granularity == "month":
        return (start + timedelta(days=32)).replace(day=1)
    return start.replace(year=start.year + 1)


def bucket_label(start: date, granularity: Granularity) -> str:
    if granularity == "week":
        year, week, _ = start.isocalendar()
        return f"{year}-W{week:02d}"
    if granularity == "month":
        return start.strftime("%Y-%m")
    return str(start.year)


@dataclass(frozen=True)
class Bucket:
    start: date
    end: date  # inclusive
    label: str
    total: int
    by_group: dict[StatusGroup, int]


def timeseries(session: Session, f: MetricsFilter, granularity: Granularity) -> list[Bucket]:
    """Applications per bucket by `date_applied`, split by current status group, with empty
    buckets filled with zeros across the requested (or data's) range."""
    bucket = _bucket_sql(granularity).label("bucket")
    rows = session.execute(
        select(bucket, Application.status, func.count())
        .where(*f.conditions())
        .group_by(bucket, Application.status)
    ).all()
    counts: dict[date, dict[StatusGroup, int]] = {}
    for start_text, status, n in rows:
        start = date.fromisoformat(start_text)
        groups = counts.setdefault(start, {})
        group = STATUS_GROUPS[Status(status)]
        groups[group] = groups.get(group, 0) + n

    first = f.date_from or (min(counts) if counts else None)
    last = f.date_to or (max(counts) if counts else None)
    if first is None or last is None or first > last:
        return []
    buckets: list[Bucket] = []
    start = bucket_start(first, granularity)
    while start <= last:
        nxt = next_bucket(start, granularity)
        groups = counts.get(start, {})
        buckets.append(
            Bucket(
                start=start,
                end=nxt - timedelta(days=1),
                label=bucket_label(start, granularity),
                total=sum(groups.values()),
                by_group={g: groups.get(g, 0) for g in CHART_GROUPS},
            )
        )
        start = nxt
    return buckets


# Groups an applied application can be in (a wishlist entry is never "applied").
CHART_GROUPS: tuple[StatusGroup, ...] = (
    StatusGroup.ACTIVE,
    StatusGroup.CLOSED_POSITIVE,
    StatusGroup.CLOSED_NEUTRAL,
    StatusGroup.CLOSED_NEGATIVE,
)


@dataclass(frozen=True)
class Summary:
    total_applied: int
    responded: int
    interviewed: int
    offered: int
    accepted: int
    median_days_to_first_response: float | None
    status_breakdown: dict[Status, int]
    rejected_after_interview_by_round: dict[int, int]


def summary(session: Session, f: MetricsFilter) -> Summary:
    status_counts = dict(
        session.execute(
            select(Application.status, func.count())
            .where(*f.conditions())
            .group_by(Application.status)
        )
        .tuples()
        .all()
    )
    by_round = dict(
        session.execute(
            select(Application.interview_rounds, func.count())
            .where(*f.conditions(), Application.status == Status.REJECTED_AFTER_INTERVIEW)
            .group_by(Application.interview_rounds)
            .order_by(Application.interview_rounds)
        )
        .tuples()
        .all()
    )
    return Summary(
        total_applied=sum(status_counts.values()),
        responded=f.count(session, ever_reached(RESPONSE_STATUSES)),
        interviewed=f.count(session, ever_reached(INTERVIEW_STATUSES)),
        offered=f.count(session, ever_reached(OFFER_STATUSES)),
        accepted=f.count(session, ever_reached(frozenset({Status.ACCEPTED}))),
        median_days_to_first_response=_median_days_to_first_response(session, f),
        status_breakdown={Status(s): n for s, n in status_counts.items()},
        rejected_after_interview_by_round=by_round,
    )


def _median_days_to_first_response(session: Session, f: MetricsFilter) -> float | None:
    """Days from `date_applied` to the first response, in the container TZ's calendar."""
    first = func.min(StatusHistory.changed_at).label("first")
    rows = session.execute(
        select(Application.date_applied, first)
        .join(StatusHistory, StatusHistory.application_id == Application.id)
        .where(*f.conditions(), StatusHistory.to_status.in_(RESPONSE_STATUSES))
        .group_by(Application.id, Application.date_applied)
    ).all()
    days = [
        max(0, (local_date(changed_at) - applied).days)
        for applied, changed_at in rows
        if applied is not None and changed_at is not None
    ]
    return float(statistics.median(days)) if days else None


def funnel(session: Session, f: MetricsFilter) -> list[tuple[Status, int]]:
    stages: list[tuple[Status, int]] = []
    for stage, reached in FUNNEL_STAGES:
        n = f.count(session) if not reached else f.count(session, ever_reached(reached))
        stages.append((stage, n))
    return stages


@dataclass(frozen=True)
class SourceStats:
    source: Source | None
    applications: int
    responses: int
    interviews: int


def by_source(session: Session, f: MetricsFilter) -> list[SourceStats]:
    responded = ever_reached(RESPONSE_STATUSES)
    interviewed = ever_reached(INTERVIEW_STATUSES)
    rows = session.execute(
        select(
            Application.source,
            func.count(),
            func.sum(case((responded, 1), else_=0)),
            func.sum(case((interviewed, 1), else_=0)),
        )
        .where(*f.conditions())
        .group_by(Application.source)
    ).all()
    stats = [
        SourceStats(
            source=Source(s) if s is not None else None,
            applications=n,
            responses=int(r or 0),
            interviews=int(i or 0),
        )
        for s, n, r, i in rows
    ]
    # Most-used channels first; "unknown" last among ties.
    return sorted(stats, key=lambda s: (-s.applications, s.source is None, s.source or ""))
