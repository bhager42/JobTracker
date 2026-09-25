"""CSV import with column mapping (PLAN.md §7.6).

Step 1, preview: read the header row and a few rows, and suggest which column feeds which
field. Step 2, import: the user confirms the mapping; each row is converted leniently
("Mar 10, 2026", "$120k", "Recruiter Screen") and validated like any new application. Rows
that fail are reported, not imported; a dry run reports without writing anything.
"""

import codecs
import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import IO

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.enums import EmploymentType, HistorySource, Source, Status, WorkMode
from app.schemas import ApplicationCreate
from app.services.applications import create_application

MAX_ROWS = 5000
SAMPLE_ROWS = 5

# Fields a column can map to, and header names that suggest them.
FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "company": ("company", "employer", "organization", "organisation", "companyname"),
    "job_title": ("jobtitle", "title", "position", "role", "job"),
    "job_url": ("joburl", "url", "link", "posting", "joblink", "postingurl"),
    "date_applied": ("dateapplied", "applied", "appliedon", "date", "applicationdate"),
    "status": ("status", "stage", "state"),
    "source": ("source", "channel", "via", "foundon"),
    "location": ("location", "city", "place"),
    "work_mode": ("workmode", "remote", "worktype", "onsiteremote", "arrangement"),
    "employment_type": ("employmenttype", "type", "jobtype", "contracttype"),
    "salary_min": ("salarymin", "minsalary", "salary", "salaryfrom", "pay"),
    "salary_max": ("salarymax", "maxsalary", "salaryto"),
    "salary_currency": ("currency", "salarycurrency"),
    "contact_name": ("contact", "contactname", "recruiter", "hiringmanager"),
    "contact_email": ("contactemail", "email", "recruiteremail"),
    "notes": ("notes", "note", "comments", "comment"),
    "job_description": ("jobdescription", "description", "jd"),
}
FIELDS = tuple(FIELD_SYNONYMS)
REQUIRED = ("company", "job_title")

# Words people use in spreadsheets, normalized (lowercase, letters and digits only).
STATUS_ALIASES: dict[str, Status] = {
    **{s.value.replace("_", ""): s for s in Status},
    "wishlist": Status.SAVED,
    "interested": Status.SAVED,
    "todo": Status.SAVED,
    "submitted": Status.APPLIED,
    "sent": Status.APPLIED,
    "screen": Status.SCREENING,
    "phonescreen": Status.SCREENING,
    "recruiterscreen": Status.SCREENING,
    "interview": Status.INTERVIEWING,
    "interviewed": Status.INTERVIEWING,
    "offerreceived": Status.OFFER,
    "hired": Status.ACCEPTED,
    "offerdeclined": Status.DECLINED,
    "rejected": Status.REJECTED_NO_INTERVIEW,
    "rejectednointerview": Status.REJECTED_NO_INTERVIEW,
    "rejectedafterinterview": Status.REJECTED_AFTER_INTERVIEW,
    "ghosted": Status.NOT_SELECTED,
    "noresponse": Status.NOT_SELECTED,
    "notselectednoresponse": Status.NOT_SELECTED,
    "positionclosed": Status.CLOSED,
    "withdrew": Status.WITHDRAWN,
}
ENUM_ALIASES: dict[str, dict[str, str]] = {
    "work_mode": {
        **{m.value: m.value for m in WorkMode},
        "wfh": "remote",
        "onsite": "onsite",
        "inoffice": "onsite",
        "office": "onsite",
    },
    "employment_type": {
        **{t.value.replace("_", ""): t.value for t in EmploymentType},
        "fulltime": "full_time",
        "parttime": "part_time",
        "ft": "full_time",
        "pt": "part_time",
        "contractor": "contract",
        "intern": "internship",
    },
    "source": {
        **{s.value.replace("_", ""): s.value for s in Source},
        "companywebsite": "company_site",
        "website": "company_site",
        "careerspage": "company_site",
        "referred": "referral",
        "headhunter": "recruiter",
    },
}

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y",
                "%d %b %Y", "%d %B %Y", "%Y-%m-%dT%H:%M:%S")  # fmt: skip


class CsvError(ValueError):
    pass


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


@dataclass
class CsvTable:
    headers: list[str]
    rows: list[list[str]]


def read_csv(source: IO[bytes], max_bytes: int) -> CsvTable:
    raw = source.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise CsvError("The CSV file is too large")
    if not raw.strip():
        raise CsvError("The CSV file is empty")
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        text = raw.decode("utf-16")  # Excel's "Unicode text"
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1252", errors="replace")  # older Excel exports
    try:
        dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(
            text[:8192], delimiters=",;\t"
        )
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        headers = [h.strip() for h in next(reader)]
    except StopIteration as exc:
        raise CsvError("The CSV file has no header row") from exc
    if not any(headers):
        raise CsvError("The first row should hold column names")
    rows: list[list[str]] = []
    for row in reader:
        if not any(cell.strip() for cell in row):
            continue
        rows.append([c.strip() for c in row] + [""] * (len(headers) - len(row)))
        if len(rows) > MAX_ROWS:
            raise CsvError(f"At most {MAX_ROWS} rows can be imported at once")
    return CsvTable(headers, rows)


def suggest_mapping(headers: list[str]) -> dict[str, str]:
    """field → header, for headers that clearly name a field. Each header is used once."""
    by_norm = {_norm(h): h for h in headers if h}
    mapping: dict[str, str] = {}
    used: set[str] = set()
    for field_name, synonyms in FIELD_SYNONYMS.items():
        for synonym in synonyms:
            header = by_norm.get(synonym)
            if header and header not in used:
                mapping[field_name] = header
                used.add(header)
                break
    return mapping


# --- converting a row ------------------------------------------------------------------------


def parse_date(text: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"can't read the date “{text}” (use YYYY-MM-DD or MM/DD/YYYY)")


def parse_money(text: str) -> int:
    cleaned = text.lower().replace(",", "").replace(" ", "")
    cleaned = re.sub(r"^[^\d]+", "", cleaned)  # currency symbols or codes in front
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(k)?[a-z]*", cleaned)
    if not match:
        raise ValueError(f"can't read the amount “{text}”")
    value = float(match.group(1)) * (1000 if match.group(2) else 1)
    return round(value)


def parse_status(text: str) -> Status:
    status = STATUS_ALIASES.get(_norm(text))
    if status is None:
        raise ValueError(f"unknown status “{text}”")
    return status


def parse_enum(field_name: str, text: str) -> str:
    value = ENUM_ALIASES[field_name].get(_norm(text))
    if value is None:
        raise ValueError(f"unknown {field_name.replace('_', ' ')} “{text}”")
    return value


def convert_row(values: dict[str, str]) -> ApplicationCreate:
    """Mapped cell text → a validated new application. Raises ValueError with a message."""
    data: dict[str, object] = {}
    for field_name, text in values.items():
        if not text:
            continue
        if field_name == "date_applied":
            data[field_name] = parse_date(text)
        elif field_name in ("salary_min", "salary_max"):
            data[field_name] = parse_money(text)
        elif field_name == "status":
            data[field_name] = parse_status(text)
        elif field_name in ENUM_ALIASES:
            data[field_name] = parse_enum(field_name, text)
        else:
            data[field_name] = text
    try:
        return ApplicationCreate.model_validate(data)
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(p) for p in err["loc"]) or "row"
        msg = str(err["msg"]).removeprefix("Value error, ")
        raise ValueError(f"{where}: {msg}") from exc


@dataclass
class RowError:
    row: int  # 1-based line number in the file (the header is line 1)
    message: str


@dataclass
class CsvResult:
    total: int
    valid: int
    created: int
    errors: list[RowError] = field(default_factory=list)


def import_csv(
    session: Session,
    table: CsvTable,
    mapping: dict[str, str],
    now: datetime,
    *,
    dry_run: bool,
) -> CsvResult:
    unknown_fields = set(mapping) - set(FIELDS)
    if unknown_fields:
        raise CsvError(f"Unknown fields: {', '.join(sorted(unknown_fields))}")
    missing = [f for f in REQUIRED if f not in mapping]
    if missing:
        raise CsvError(f"Map a column to {' and '.join(missing)}")
    index = {h: i for i, h in enumerate(table.headers)}
    bad = [h for h in mapping.values() if h not in index]
    if bad:
        raise CsvError(f"No column named {', '.join(bad)}")

    result = CsvResult(total=len(table.rows), valid=0, created=0)
    parsed: list[ApplicationCreate] = []
    for n, row in enumerate(table.rows, start=2):
        values = {f: row[index[h]] if index[h] < len(row) else "" for f, h in mapping.items()}
        try:
            parsed.append(convert_row(values))
        except ValueError as exc:
            result.errors.append(RowError(n, str(exc)))
    result.valid = len(parsed)
    if dry_run or not parsed:
        return result
    for data in parsed:
        # Imported rows start a fresh auto-close window from now, so importing an old
        # spreadsheet doesn't close everything on the next run.
        create_application(session, data, now, history_source=HistorySource.IMPORT, commit=False)
    session.commit()
    result.created = len(parsed)
    return result
