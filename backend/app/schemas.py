"""Pydantic request/response models. The frontend's TS types are generated from these."""

import re
from datetime import date, datetime
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.enums import EmploymentType, HistorySource, Source, Status, WorkMode

# --- reusable field types -----------------------------------------------------------------


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _check_url(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise ValueError("must be an http:// or https:// URL")
    return value


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email(value: str) -> str:
    if not _EMAIL_RE.match(value):
        raise ValueError("must be an email address")
    return value


def _text(max_length: int) -> object:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


RequiredText = Annotated[str, _text(200)]


# Optional strings: blank input becomes None, and constraints apply to the string only.
_Blank = BeforeValidator(_blank_to_none)
OptionalText = Annotated[Annotated[str, _text(200)] | None, _Blank]
LongText = Annotated[Annotated[str, _text(200_000)] | None, _Blank]
Url = Annotated[Annotated[str, _text(2048), AfterValidator(_check_url)] | None, _Blank]
Email = Annotated[Annotated[str, _text(320), AfterValidator(_check_email)] | None, _Blank]
Currency = Annotated[
    Annotated[
        str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")
    ]
    | None,
    _Blank,
]
Salary = Annotated[int | None, Field(ge=0, le=100_000_000)]
Rounds = Annotated[int, Field(ge=0, le=50)]
Note = Annotated[Annotated[str, _text(1000)] | None, _Blank]


# --- applications -------------------------------------------------------------------------


class _ApplicationFields(BaseModel):
    """Every user-editable field, all optional. Create and update narrow this down."""

    model_config = ConfigDict(extra="forbid")

    company: RequiredText | None = None
    job_title: RequiredText | None = None
    job_url: Url = None
    location: OptionalText = None
    work_mode: WorkMode | None = None
    employment_type: EmploymentType | None = None
    salary_min: Salary = None
    salary_max: Salary = None
    salary_currency: Currency = None
    source: Source | None = None
    contact_name: OptionalText = None
    contact_email: Email = None
    date_applied: date | None = None
    interview_rounds: Rounds | None = None
    auto_close_exempt: bool | None = None
    notes: LongText = None
    job_description: LongText = None
    archived: bool | None = None

    @model_validator(mode="after")
    def _salary_range(self) -> Self:
        check_salary_range(self.salary_min, self.salary_max)
        return self


def check_salary_range(salary_min: int | None, salary_max: int | None) -> None:
    if salary_min is not None and salary_max is not None and salary_min > salary_max:
        raise ValueError("salary_min must not exceed salary_max")


class ApplicationCreate(_ApplicationFields):
    company: RequiredText
    job_title: RequiredText
    status: Status = Status.APPLIED
    salary_currency: Currency = "USD"
    interview_rounds: Rounds = 0
    auto_close_exempt: bool = False
    archived: bool = False


class ApplicationUpdate(_ApplicationFields):
    """Partial update: only fields present in the request body change.

    A status sent here is recorded in history exactly like `POST /status`.
    """

    status: Status | None = None

    @model_validator(mode="after")
    def _no_null_for_required(self) -> Self:
        for name in NOT_NULLABLE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


NOT_NULLABLE = (
    "company",
    "job_title",
    "status",
    "interview_rounds",
    "auto_close_exempt",
    "archived",
)


class StatusHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: Status | None
    to_status: Status
    changed_at: datetime
    source: HistorySource
    note: str | None


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company: str
    job_title: str
    job_url: str | None
    location: str | None
    work_mode: WorkMode | None
    employment_type: EmploymentType | None
    salary_min: int | None
    salary_max: int | None
    salary_currency: str | None
    source: Source | None
    contact_name: str | None
    contact_email: str | None
    date_applied: date | None
    status: Status
    status_changed_at: datetime
    interview_rounds: int
    auto_close_exempt: bool
    notes: str | None
    job_description: str | None
    archived: bool
    created_at: datetime
    updated_at: datetime


class ApplicationDetail(ApplicationOut):
    history: list[StatusHistoryOut]


class ApplicationPage(BaseModel):
    items: list[ApplicationOut]
    total: int
    page: int
    page_size: int


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Status
    note: Note = None
    interview_rounds: Rounds | None = None


class BulkAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: Annotated[list[int], Field(min_length=1, max_length=1000)]
    action: Literal["set_status", "archive", "unarchive", "delete"]
    payload: StatusChange | None = None

    @model_validator(mode="after")
    def _payload_for_status(self) -> Self:
        if self.action == "set_status" and self.payload is None:
            raise ValueError("set_status requires a payload with the new status")
        return self


class BulkResult(BaseModel):
    affected: int
