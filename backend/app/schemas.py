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

from app.enums import (
    AUTO_CLOSE_ALLOWED_STATUSES,
    DocumentKind,
    EmploymentType,
    HistorySource,
    Source,
    Status,
    WorkMode,
)
from app.problems import Problem


class OutputModel(BaseModel):
    """Base for response bodies: fields with defaults are still always sent, so the generated
    TypeScript types mark them required rather than optional."""

    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )


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
    salary_expectation: Salary = None
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


DocumentIds = Annotated[list[int], Field(max_length=100)]


class ApplicationCreate(_ApplicationFields):
    company: RequiredText
    job_title: RequiredText
    status: Status = Status.APPLIED
    document_ids: DocumentIds = []
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


# --- documents ----------------------------------------------------------------------------


class DocumentOut(OutputModel):
    id: int
    kind: DocumentKind
    display_name: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    uploaded_at: datetime
    application_count: int


class DocumentUploaded(DocumentOut):
    duplicate: bool = Field(
        description="True when an identical file was already in the library; that entry is"
        " returned instead of a new one."
    )


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: RequiredText | None = None
    kind: DocumentKind | None = None


class DocumentLinks(BaseModel):
    """The complete set of documents attached to an application."""

    model_config = ConfigDict(extra="forbid")

    document_ids: DocumentIds


class LinkedApplication(OutputModel):
    id: int
    company: str
    job_title: str


class DocumentInUseProblem(Problem):
    applications: list[LinkedApplication]


class StatusHistoryOut(OutputModel):
    id: int
    from_status: Status | None
    to_status: Status
    changed_at: datetime
    source: HistorySource
    note: str | None


class ApplicationOut(OutputModel):
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
    salary_expectation: int | None
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
    auto_closed: bool = Field(
        default=False, description="Closed as Not Selected by automation; can be undone."
    )
    auto_close_at: datetime | None = Field(
        default=None,
        description="When the auto-close rule will close this application, if it applies.",
    )


class ApplicationDetail(ApplicationOut):
    history: list[StatusHistoryOut]
    documents: list[DocumentOut]


class ApplicationPage(OutputModel):
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


class BulkResult(OutputModel):
    affected: int


# --- settings -----------------------------------------------------------------------------


def _check_auto_close_statuses(statuses: list[Status]) -> list[Status]:
    not_allowed = [s for s in statuses if s not in AUTO_CLOSE_ALLOWED_STATUSES]
    if not_allowed:
        allowed = ", ".join(AUTO_CLOSE_ALLOWED_STATUSES)
        raise ValueError(f"only these statuses can auto-close: {allowed}")
    # Stable order, no duplicates.
    return [s for s in AUTO_CLOSE_ALLOWED_STATUSES if s in statuses]


AutoCloseDays = Annotated[int, Field(ge=1, le=365)]
AutoCloseStatuses = Annotated[
    list[Status], Field(min_length=1), AfterValidator(_check_auto_close_statuses)
]


class AutoCloseSettings(OutputModel):
    enabled: bool = True
    days: AutoCloseDays = 30
    statuses: AutoCloseStatuses = [Status.APPLIED]


class AutoCloseSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    days: AutoCloseDays | None = None
    statuses: AutoCloseStatuses | None = None


class SettingsOut(OutputModel):
    auto_close: AutoCloseSettings
    auto_close_allowed_statuses: list[Status] = list(AUTO_CLOSE_ALLOWED_STATUSES)


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_close: AutoCloseSettingsUpdate | None = None


class AutoCloseRunResult(OutputModel):
    enabled: bool
    closed: int
    application_ids: list[int]


class AboutOut(OutputModel):
    version: str
    build_sha: str
    data_dir: str


# --- dashboard ----------------------------------------------------------------------------


class DashboardKpis(OutputModel):
    applied_this_week: int
    applied_this_month: int
    active_pipeline: int = Field(description="Applied, screening, interviewing, or offer.")
    total_applied: int
    interview_rate: float | None = Field(
        description="Share of applied applications that ever reached an interview."
    )
    response_rate: float | None = Field(
        description="Share of applied applications that ever got a response (anything past"
        " Applied except Not Selected, Withdrawn, or Position Closed)."
    )


class ActivityItem(OutputModel):
    id: int
    application_id: int
    company: str
    job_title: str
    from_status: Status | None
    to_status: Status
    changed_at: datetime
    source: HistorySource
    note: str | None


class DashboardOut(OutputModel):
    kpis: DashboardKpis
    auto_closing_soon: list[ApplicationOut]
    offers_awaiting_decision: list[ApplicationOut]
    recent_activity: list[ActivityItem]


# --- metrics ------------------------------------------------------------------------------


class StatusCount(OutputModel):
    status: Status
    count: int


class RoundCount(OutputModel):
    rounds: int
    count: int


class Outcomes(OutputModel):
    rejected_no_interview: int
    rejected_after_interview: list[RoundCount] = Field(
        description="Rejections after interviewing, by the round reached."
    )
    ghosted: int = Field(description="Not Selected (No Response).")
    withdrawn: int
    declined: int
    position_closed: int


class MetricsSummary(OutputModel):
    total_applied: int
    responded: int
    interviewed: int
    offered: int
    accepted: int
    response_rate: float | None
    interview_rate: float | None
    offer_rate: float | None
    median_days_to_first_response: float | None
    status_breakdown: list[StatusCount] = Field(
        description="Current status of the applications in range, in pipeline order."
    )
    outcomes: Outcomes


class GroupCounts(OutputModel):
    active: int
    closed_positive: int
    closed_neutral: int
    closed_negative: int


class TimeseriesBucket(OutputModel):
    start: date
    end: date
    label: str = Field(description='"2026-W01", "2026-03", or "2026".')
    total: int
    by_group: GroupCounts = Field(description="Split by each application's current status group.")


class MetricsTimeseries(OutputModel):
    granularity: Literal["week", "month", "year"]
    buckets: list[TimeseriesBucket]


class FunnelStage(OutputModel):
    stage: Status
    count: int
    rate: float | None = Field(description="Share of applied applications that got this far.")


class MetricsFunnel(OutputModel):
    stages: list[FunnelStage]


class SourceMetrics(OutputModel):
    source: Source | None = Field(description="Null groups applications with no source set.")
    applications: int
    responses: int
    interviews: int
    response_rate: float | None
    interview_rate: float | None


class MetricsBySource(OutputModel):
    sources: list[SourceMetrics]


# --- import / export ----------------------------------------------------------------------


class CsvPreview(OutputModel):
    headers: list[str]
    sample_rows: list[list[str]]
    row_count: int
    suggested_mapping: dict[str, str] = Field(description="Field → CSV column header.")
    fields: list[str] = Field(description="Fields a column can map to.")
    required: list[str]


class CsvRowError(OutputModel):
    row: int = Field(description="Line number in the file; the header is line 1.")
    message: str


class CsvImportResult(OutputModel):
    total: int
    valid: int
    created: int = Field(description="0 on a dry run.")
    errors: list[CsvRowError]


class ImportResultOut(OutputModel):
    restored: bool = Field(
        description="The instance was empty, so ids and settings were restored exactly."
    )
    applications: int
    documents: int
    documents_reused: int
    documents_missing: int


class DataStats(OutputModel):
    applications: int
    archived: int
    documents: int
    history_entries: int
    database_bytes: int
    uploads_bytes: int
