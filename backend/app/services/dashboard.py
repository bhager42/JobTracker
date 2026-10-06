"""Numbers and lists for the dashboard (PLAN.md §7.2)."""

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import Status
from app.models import Application, StatusHistory
from app.schemas import AutoCloseSettings
from app.services import metrics

SOON = timedelta(days=7)


def kpis(session: Session, now: datetime) -> dict[str, int | float | None]:
    applied = metrics.count(
        session, select(func.count()).select_from(Application).where(metrics.applied_filter())
    )

    def reached(statuses: frozenset[Status]) -> int:
        return metrics.count(
            session,
            select(func.count())
            .select_from(Application)
            .where(metrics.applied_filter(), metrics.ever_reached(statuses)),
        )

    active = metrics.count(
        session,
        select(func.count())
        .select_from(Application)
        .where(Application.status.in_(metrics.ACTIVE_STATUSES), Application.archived.is_(False)),
    )
    return {
        "applied_this_week": metrics.applied_in(session, metrics.current_week(now)),
        "applied_this_month": metrics.applied_in(session, metrics.current_month(now)),
        "active_pipeline": active,
        "total_applied": applied,
        "interview_rate": metrics.rate(reached(metrics.INTERVIEW_STATUSES), applied),
        "response_rate": metrics.rate(reached(metrics.RESPONSE_STATUSES), applied),
    }


def auto_closing_soon(session: Session, now: datetime, cfg: AutoCloseSettings) -> list[Application]:
    """Eligible applications whose auto-close falls within the next 7 days."""
    if not cfg.enabled:
        return []
    threshold = now + SOON - timedelta(days=cfg.days)
    return list(
        session.scalars(
            select(Application)
            .where(
                Application.status.in_(cfg.statuses),
                Application.auto_close_exempt.is_(False),
                Application.archived.is_(False),
                Application.status_changed_at <= threshold,
            )
            .order_by(Application.status_changed_at, Application.id)
        )
    )


def offers_awaiting_decision(session: Session) -> list[Application]:
    return list(
        session.scalars(
            select(Application)
            .where(Application.status == Status.OFFER, Application.archived.is_(False))
            .order_by(Application.status_changed_at, Application.id)
        )
    )


def recent_activity(session: Session, limit: int = 15) -> list[tuple[StatusHistory, Application]]:
    rows = session.execute(
        select(StatusHistory, Application)
        .join(Application, StatusHistory.application_id == Application.id)
        .order_by(StatusHistory.changed_at.desc(), StatusHistory.id.desc())
        .limit(limit)
    )
    return [(h, a) for h, a in rows]
