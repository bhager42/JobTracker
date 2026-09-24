"""Application CRUD and the status-change rules. Every status change goes through
`change_status`, so it always writes a `status_history` row."""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from sqlalchemy import ColumnElement, Select, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.clock import local_date
from app.enums import HistorySource, Source, Status, WorkMode
from app.models import Application, StatusHistory
from app.schemas import ApplicationCreate, ApplicationUpdate, check_salary_range


class ValidationFailed(ValueError):
    """A request that is well-formed but breaks a rule that needs the stored row to check."""


def change_status(
    app: Application,
    new_status: Status,
    *,
    now: datetime,
    source: HistorySource = HistorySource.USER,
    note: str | None = None,
    interview_rounds: int | None = None,
) -> bool:
    """Apply a status change and record it. Returns False when the status is unchanged.

    Moving out of `saved` fills in `date_applied` with today if it is empty.
    """
    if interview_rounds is not None and interview_rounds != app.interview_rounds:
        app.interview_rounds = interview_rounds
        app.updated_at = now
    if app.status == new_status:
        return False
    app.history.append(
        StatusHistory(
            from_status=app.status,
            to_status=new_status,
            changed_at=now,
            source=source,
            note=note,
        )
    )
    app.status = new_status
    app.status_changed_at = now
    if new_status != Status.SAVED and app.date_applied is None:
        app.date_applied = local_date(now)
    app.updated_at = now
    return True


def create_application(session: Session, data: ApplicationCreate, now: datetime) -> Application:
    fields = data.model_dump(exclude={"status"})
    if data.status != Status.SAVED and fields["date_applied"] is None:
        fields["date_applied"] = local_date(now)
    app = Application(
        **fields,
        status=data.status,
        status_changed_at=now,
        created_at=now,
        updated_at=now,
    )
    app.history.append(
        StatusHistory(
            from_status=None, to_status=data.status, changed_at=now, source=HistorySource.USER
        )
    )
    session.add(app)
    session.commit()
    return app


def update_application(
    session: Session, app: Application, data: ApplicationUpdate, now: datetime
) -> Application:
    changes = data.model_dump(exclude_unset=True)
    new_status: Status | None = changes.pop("status", None)
    rounds: int | None = changes.pop("interview_rounds", None)

    check = {
        "salary_min": changes.get("salary_min", app.salary_min),
        "salary_max": changes.get("salary_max", app.salary_max),
    }
    try:
        check_salary_range(check["salary_min"], check["salary_max"])
    except ValueError as exc:
        raise ValidationFailed(str(exc)) from exc
    final_status = new_status or app.status
    if (
        "date_applied" in changes
        and changes["date_applied"] is None
        and final_status != Status.SAVED
    ):
        raise ValidationFailed("date_applied is required unless the status is saved")

    for name, value in changes.items():
        setattr(app, name, value)
    if new_status is not None:
        change_status(app, new_status, now=now, interview_rounds=rounds)
    elif rounds is not None:
        app.interview_rounds = rounds
    app.updated_at = now
    session.commit()
    return app


# --- listing ------------------------------------------------------------------------------

SORT_COLUMNS: dict[str, ColumnElement[object]] = {
    "company": func.lower(Application.company),
    "job_title": func.lower(Application.job_title),
    "date_applied": Application.date_applied,  # type: ignore[dict-item]
    "status": Application.status,  # type: ignore[dict-item]
    "status_changed_at": Application.status_changed_at,  # type: ignore[dict-item]
    "created_at": Application.created_at,  # type: ignore[dict-item]
    "updated_at": Application.updated_at,  # type: ignore[dict-item]
}
SortKey = Literal[
    "company",
    "-company",
    "job_title",
    "-job_title",
    "date_applied",
    "-date_applied",
    "status",
    "-status",
    "status_changed_at",
    "-status_changed_at",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
]
ArchivedFilter = Literal["exclude", "include", "only"]


@dataclass(frozen=True)
class ApplicationFilter:
    statuses: list[Status] | None = None
    q: str | None = None
    sources: list[Source] | None = None
    work_modes: list[WorkMode] | None = None
    date_from: date | None = None
    date_to: date | None = None
    archived: ArchivedFilter = "exclude"

    def apply(self, stmt: Select[tuple[Application]]) -> Select[tuple[Application]]:
        if self.statuses:
            stmt = stmt.where(Application.status.in_(self.statuses))
        if self.sources:
            stmt = stmt.where(Application.source.in_(self.sources))
        if self.work_modes:
            stmt = stmt.where(Application.work_mode.in_(self.work_modes))
        if self.date_from:
            stmt = stmt.where(Application.date_applied >= self.date_from)
        if self.date_to:
            stmt = stmt.where(Application.date_applied <= self.date_to)
        if self.archived == "exclude":
            stmt = stmt.where(Application.archived.is_(False))
        elif self.archived == "only":
            stmt = stmt.where(Application.archived.is_(True))
        if self.q and (q := self.q.strip()):
            pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            stmt = stmt.where(
                or_(
                    Application.company.ilike(pattern, escape="\\"),
                    Application.job_title.ilike(pattern, escape="\\"),
                    Application.notes.ilike(pattern, escape="\\"),
                )
            )
        return stmt


def list_applications(
    session: Session,
    filters: ApplicationFilter,
    sort: SortKey,
    page: int,
    page_size: int,
) -> tuple[list[Application], int]:
    base = filters.apply(select(Application))
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    column = SORT_COLUMNS[sort.removeprefix("-")]
    order = column.desc().nulls_last() if sort.startswith("-") else column.asc().nulls_last()
    tiebreak = Application.id.desc() if sort.startswith("-") else Application.id.asc()
    items = session.scalars(
        base.order_by(order, tiebreak).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(items), total


# --- bulk ---------------------------------------------------------------------------------


def bulk_set_status(
    session: Session,
    ids: list[int],
    new_status: Status,
    now: datetime,
    note: str | None = None,
    interview_rounds: int | None = None,
) -> int:
    apps = session.scalars(select(Application).where(Application.id.in_(ids))).all()
    for app in apps:
        change_status(app, new_status, now=now, note=note, interview_rounds=interview_rounds)
    session.commit()
    return len(apps)


def bulk_set_archived(session: Session, ids: list[int], archived: bool, now: datetime) -> int:
    result = session.execute(
        update(Application)
        .where(Application.id.in_(ids))
        .values(archived=archived, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    session.commit()
    return int(result.rowcount)  # type: ignore[attr-defined]


def bulk_delete(session: Session, ids: list[int]) -> int:
    # History rows go with them through ON DELETE CASCADE.
    result = session.execute(delete(Application).where(Application.id.in_(ids)))
    session.commit()
    return int(result.rowcount)  # type: ignore[attr-defined]
