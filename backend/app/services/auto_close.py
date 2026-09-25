"""Auto-close (PLAN.md §6): applications that go quiet become "Not Selected (No Response)".

`run_auto_close` is idempotent and takes `now` from the caller, so tests control time and the
hourly scheduler can simply run it again after downtime to catch up.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import HistorySource, Status
from app.models import Application
from app.schemas import AutoCloseSettings
from app.services.app_settings import load_auto_close
from app.services.applications import change_status


class NotAutoClosed(ValueError):
    pass


def auto_close_at(app: Application, cfg: AutoCloseSettings) -> datetime | None:
    """When this application will be auto-closed, or None if the rule doesn't apply to it.

    It closes on the first run after this moment (runs are hourly).
    """
    if not cfg.enabled or app.status not in cfg.statuses or app.auto_close_exempt or app.archived:
        return None
    return app.status_changed_at + timedelta(days=cfg.days)


def run_auto_close(
    session: Session, now: datetime, cfg: AutoCloseSettings | None = None
) -> list[int]:
    """Closes every eligible application quiet for more than the window. Returns their ids."""
    cfg = cfg or load_auto_close(session)
    if not cfg.enabled:
        return []
    cutoff = now - timedelta(days=cfg.days)
    stale = session.scalars(
        select(Application)
        .where(
            Application.status.in_(cfg.statuses),
            Application.auto_close_exempt.is_(False),
            Application.archived.is_(False),
            Application.status_changed_at < cutoff,
        )
        .order_by(Application.id)
    ).all()
    note = f"Auto-closed after {cfg.days} days with no update"
    for app in stale:
        change_status(app, Status.NOT_SELECTED, now=now, source=HistorySource.AUTOMATION, note=note)
    session.commit()
    return [app.id for app in stale]


def undo_auto_close(session: Session, app: Application, now: datetime) -> None:
    """Restores the status from before the auto-close and restarts the clock from now."""
    last = app.history[-1] if app.history else None
    if (
        app.status != Status.NOT_SELECTED
        or last is None
        or last.source != HistorySource.AUTOMATION
        or last.from_status is None
    ):
        raise NotAutoClosed("This application wasn't closed automatically")
    change_status(app, last.from_status, now=now, note="Undid auto-close")
    session.commit()
