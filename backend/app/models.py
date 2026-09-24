"""SQLAlchemy models (see PLAN.md §5)."""

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Dialect,
    ForeignKey,
    Integer,
    String,
    Text,
    TypeDecorator,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import EmploymentType, HistorySource, Source, Status, WorkMode

__all__ = ["Application", "Base", "StatusHistory"]


class UTCDateTime(TypeDecorator[datetime]):
    """Stores naive UTC (SQLite has no time zones) and always returns aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime; pass an aware UTC datetime")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: Any, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if not isinstance(value, datetime):
            raise TypeError(f"expected datetime from the database, got {type(value).__name__}")
        return value.replace(tzinfo=UTC)


def _enum_column(enum: type[Any]) -> String:
    # Plain TEXT columns: enum values are validated by Pydantic, and adding a status later
    # then needs no table rebuild.
    return String(max(len(e.value) for e in enum))


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company: Mapped[str] = mapped_column(Text, index=True)
    job_title: Mapped[str] = mapped_column(Text)
    job_url: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    work_mode: Mapped[WorkMode | None] = mapped_column(_enum_column(WorkMode))
    employment_type: Mapped[EmploymentType | None] = mapped_column(_enum_column(EmploymentType))
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_currency: Mapped[str | None] = mapped_column(String(3), default="USD")
    source: Mapped[Source | None] = mapped_column(_enum_column(Source))
    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    date_applied: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[Status] = mapped_column(
        _enum_column(Status), index=True, default=Status.APPLIED, server_default=Status.APPLIED
    )
    status_changed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    interview_rounds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    auto_close_exempt: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    notes: Mapped[str | None] = mapped_column(Text)
    job_description: Mapped[str | None] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)

    history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="StatusHistory.changed_at, StatusHistory.id",
    )


class StatusHistory(Base):
    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[Status | None] = mapped_column(_enum_column(Status))
    to_status: Mapped[Status] = mapped_column(_enum_column(Status))
    changed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    source: Mapped[HistorySource] = mapped_column(_enum_column(HistorySource))
    note: Mapped[str | None] = mapped_column(Text)

    application: Mapped[Application] = relationship(back_populates="history")
