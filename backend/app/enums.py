"""Enumerations shared with the frontend through the OpenAPI schema (see PLAN.md §4).

Status keys and their groups are defined here and nowhere else on the backend. Labels and
colors live in `frontend/src/lib/status.ts`.
"""

from enum import StrEnum


class Status(StrEnum):
    SAVED = "saved"
    APPLIED = "applied"
    SCREENING = "screening"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    WITHDRAWN = "withdrawn"
    REJECTED_NO_INTERVIEW = "rejected_no_interview"
    REJECTED_AFTER_INTERVIEW = "rejected_after_interview"
    NOT_SELECTED = "not_selected"
    CLOSED = "closed"


class StatusGroup(StrEnum):
    PRE_APPLICATION = "pre_application"
    ACTIVE = "active"
    CLOSED_POSITIVE = "closed_positive"
    CLOSED_NEUTRAL = "closed_neutral"
    CLOSED_NEGATIVE = "closed_negative"


STATUS_GROUPS: dict[Status, StatusGroup] = {
    Status.SAVED: StatusGroup.PRE_APPLICATION,
    Status.APPLIED: StatusGroup.ACTIVE,
    Status.SCREENING: StatusGroup.ACTIVE,
    Status.INTERVIEWING: StatusGroup.ACTIVE,
    Status.OFFER: StatusGroup.ACTIVE,
    Status.ACCEPTED: StatusGroup.CLOSED_POSITIVE,
    Status.DECLINED: StatusGroup.CLOSED_NEUTRAL,
    Status.WITHDRAWN: StatusGroup.CLOSED_NEUTRAL,
    Status.REJECTED_NO_INTERVIEW: StatusGroup.CLOSED_NEGATIVE,
    Status.REJECTED_AFTER_INTERVIEW: StatusGroup.CLOSED_NEGATIVE,
    Status.NOT_SELECTED: StatusGroup.CLOSED_NEGATIVE,
    Status.CLOSED: StatusGroup.CLOSED_NEUTRAL,
}

STATUSES_IN_ORDER: tuple[Status, ...] = tuple(Status)  # pipeline order, as declared

TERMINAL_STATUSES: frozenset[Status] = frozenset(
    s for s, g in STATUS_GROUPS.items() if g.name.startswith("CLOSED")
)

# Statuses the auto-close rule may apply to (PLAN.md §6). Later stages always need a person.
AUTO_CLOSE_ALLOWED_STATUSES: tuple[Status, ...] = (
    Status.APPLIED,
    Status.SCREENING,
    Status.INTERVIEWING,
)


class WorkMode(StrEnum):
    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"


class EmploymentType(StrEnum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERNSHIP = "internship"


class Source(StrEnum):
    LINKEDIN = "linkedin"
    INDEED = "indeed"
    REFERRAL = "referral"
    COMPANY_SITE = "company_site"
    RECRUITER = "recruiter"
    OTHER = "other"


class HistorySource(StrEnum):
    USER = "user"
    AUTOMATION = "automation"
    IMPORT = "import"


class DocumentKind(StrEnum):
    RESUME = "resume"
    COVER_LETTER = "cover_letter"
    OTHER = "other"
