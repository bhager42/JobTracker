"""Backup export and restore (PLAN.md §7.6).

The export is a ZIP holding `applications.json` (everything, full fidelity), a flat
`applications.csv` for spreadsheets, and every document under `documents/<stored name>`.

Import reads that ZIP (or just its JSON). Into an empty instance it is a restore: ids,
history, and settings come back exactly, so export → import → export is identical. Into an
instance with data it appends: new ids, documents reused when an identical file (same
SHA-256) is already there. Every file is re-checked by the same rules as an upload, and the
whole import is one transaction: on any error nothing is kept.
"""

import csv
import io
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path
from typing import IO, Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.enums import DocumentKind, EmploymentType, HistorySource, Source, Status, WorkMode
from app.models import Application, Document, StatusHistory
from app.schemas import AutoCloseSettings
from app.services import app_settings, storage

FORMAT = "jobtracker-export"
VERSION = 1
JSON_NAME = "applications.json"
CSV_NAME = "applications.csv"
DOCS_DIR = "documents/"


class ImportFailed(ValueError):
    """The file isn't a valid JobTracker export, or something in it breaks the rules."""


# --- the bundle format ----------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HistoryRecord(_Strict):
    from_status: Status | None
    to_status: Status
    changed_at: datetime
    source: HistorySource
    note: str | None = None


class DocumentRecord(_Strict):
    id: int
    kind: DocumentKind
    display_name: Annotated[str, Field(min_length=1, max_length=200)]
    original_filename: Annotated[str, Field(min_length=1, max_length=255)]
    stored_filename: Annotated[str, Field(pattern=r"^[0-9a-f]{32}\.[a-z]{2,4}$")]
    mime_type: str
    size_bytes: int
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    uploaded_at: datetime


class ApplicationRecord(_Strict):
    id: int
    company: Annotated[str, Field(min_length=1, max_length=200)]
    job_title: Annotated[str, Field(min_length=1, max_length=200)]
    job_url: str | None
    location: str | None
    work_mode: WorkMode | None
    employment_type: EmploymentType | None
    salary_min: int | None
    salary_max: int | None
    salary_currency: str | None
    # Added in 0.1.2; optional so earlier backups still import.
    salary_expectation: int | None = None
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
    document_ids: list[int]
    history: list[HistoryRecord]


class ExportBundle(_Strict):
    format: Literal["jobtracker-export"]
    version: Literal[1]
    exported_at: datetime
    app_version: str
    settings: dict[str, AutoCloseSettings]
    documents: list[DocumentRecord]
    applications: list[ApplicationRecord]


APP_FIELDS = [f for f in ApplicationRecord.model_fields if f not in ("document_ids", "history")]
DOC_FIELDS = list(DocumentRecord.model_fields)


# --- export ---------------------------------------------------------------------------------


def build_bundle(session: Session, now: datetime, app_version: str) -> ExportBundle:
    docs = session.scalars(select(Document).order_by(Document.id)).all()
    apps = session.scalars(
        select(Application)
        .options(selectinload(Application.history), selectinload(Application.documents))
        .order_by(Application.id)
    ).all()
    return ExportBundle(
        format=FORMAT,
        version=VERSION,
        exported_at=now,
        app_version=app_version,
        settings={app_settings.AUTO_CLOSE_KEY: app_settings.load_auto_close(session)},
        documents=[
            DocumentRecord.model_validate({f: getattr(d, f) for f in DOC_FIELDS}) for d in docs
        ],
        applications=[
            ApplicationRecord.model_validate(
                {
                    **{f: getattr(a, f) for f in APP_FIELDS},
                    "document_ids": sorted(d.id for d in a.documents),
                    "history": [
                        {
                            "from_status": h.from_status,
                            "to_status": h.to_status,
                            "changed_at": h.changed_at,
                            "source": h.source,
                            "note": h.note,
                        }
                        for h in a.history
                    ],
                }
            )
            for a in apps
        ],
    )


CSV_COLUMNS = [
    "id",
    "company",
    "job_title",
    "status",
    "date_applied",
    "status_changed_at",
    "interview_rounds",
    "source",
    "work_mode",
    "employment_type",
    "location",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_expectation",
    "contact_name",
    "contact_email",
    "job_url",
    "archived",
    "auto_close_exempt",
    "documents",
    "notes",
]


def _csv_cell(value: object) -> object:
    # Spreadsheet apps run cells starting with these as formulas (CSV injection).
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return "" if value is None else value


def bundle_csv(bundle: ExportBundle) -> str:
    names = {d.id: d.display_name for d in bundle.documents}
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for a in bundle.applications:
        row = a.model_dump(mode="json")
        row["documents"] = "; ".join(names[i] for i in a.document_ids if i in names)
        writer.writerow([_csv_cell(row[c]) for c in CSV_COLUMNS])
    return out.getvalue()


def write_export(session: Session, now: datetime, app_version: str, uploads_dir: Path) -> Path:
    """Writes the export ZIP to a temp file in the uploads dir (same disk as the files it
    copies, not the small tmpfs) and returns its path. The caller deletes it."""
    bundle = build_bundle(session, now, app_version)
    path = uploads_dir / f"{storage.TEMP_PREFIX}export-{uuid.uuid4().hex}.zip"
    try:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(JSON_NAME, bundle.model_dump_json(indent=2))
            # UTF-8 with BOM so Excel detects the encoding.
            zf.writestr(CSV_NAME, "\ufeff" + bundle_csv(bundle))
            for doc in bundle.documents:
                src = storage.stored_path(uploads_dir, doc.stored_filename)
                if src.is_file():
                    # Already-compressed formats (PDF, DOCX) gain little from deflate.
                    zf.write(src, DOCS_DIR + doc.stored_filename, zipfile.ZIP_STORED)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


# --- import ---------------------------------------------------------------------------------


class ImportResult(BaseModel):
    restored: bool = Field(description="True when the instance was empty: ids and settings kept.")
    applications: int
    documents: int
    documents_reused: int
    documents_missing: int = Field(
        description="Documents listed in the JSON whose file wasn't in the upload."
    )


def read_bundle(
    source: IO[bytes], filename: str, max_bytes: int, max_file_bytes: int
) -> tuple[ExportBundle, zipfile.ZipFile | None]:
    """Parses an uploaded export. Returns the bundle and, for a ZIP, the open archive."""
    head = source.read(4)
    source.seek(0)
    zf: zipfile.ZipFile | None = None
    if head.startswith(b"PK\x03\x04"):
        try:
            zf = zipfile.ZipFile(source)
        except zipfile.BadZipFile as exc:
            raise ImportFailed("That ZIP file is damaged") from exc
        total = sum(i.file_size for i in zf.infolist())
        if total > max_bytes:
            raise ImportFailed("The export unpacks to more than MAX_IMPORT_MB allows")
        try:
            info = zf.getinfo(JSON_NAME)
        except KeyError as exc:
            raise ImportFailed(f"No {JSON_NAME} in the ZIP; is it a JobTracker export?") from exc
        if info.file_size > max_bytes:
            raise ImportFailed(f"{JSON_NAME} is too large")
        raw = zf.read(info)
        for member in zf.infolist():
            if member.filename.startswith(DOCS_DIR) and member.file_size > max_file_bytes:
                raise ImportFailed(f"{member.filename} is larger than MAX_UPLOAD_MB allows")
    elif filename.lower().endswith(".json"):
        raw = source.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise ImportFailed("The JSON file is too large")
    else:
        raise ImportFailed("Choose a JobTracker export: the .zip, or its applications.json")
    try:
        return ExportBundle.model_validate_json(raw), zf
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise ImportFailed(f"Not a valid JobTracker export ({where}: {first['msg']})") from exc


def import_bundle(
    session: Session,
    bundle: ExportBundle,
    zf: zipfile.ZipFile | None,
    uploads_dir: Path,
    max_file_bytes: int,
) -> ImportResult:
    _check_references(bundle)
    empty = (
        session.scalar(select(func.count()).select_from(Application)) == 0
        and session.scalar(select(func.count()).select_from(Document)) == 0
    )
    kept_files: list[str] = []  # stored names to delete if anything fails
    try:
        doc_ids, created, reused, missing = _import_documents(
            session, bundle, zf, uploads_dir, max_file_bytes, empty, kept_files
        )
        for record in bundle.applications:
            fields = record.model_dump(include=set(APP_FIELDS))
            if not empty:
                del fields["id"]
            app = Application(**fields)
            app.history = [StatusHistory(**h.model_dump()) for h in record.history]
            app.documents = [session.get_one(Document, doc_ids[i]) for i in record.document_ids
                             if i in doc_ids]  # fmt: skip
            session.add(app)
        if empty:
            for key, cfg in bundle.settings.items():
                if key == app_settings.AUTO_CLOSE_KEY:
                    app_settings.save_auto_close(session, cfg, commit=False)
        session.commit()
    except BaseException:
        session.rollback()
        for name in kept_files:
            storage.stored_path(uploads_dir, name).unlink(missing_ok=True)
        raise
    return ImportResult(
        restored=empty,
        applications=len(bundle.applications),
        documents=created,
        documents_reused=reused,
        documents_missing=missing,
    )


def _check_references(bundle: ExportBundle) -> None:
    doc_ids = [d.id for d in bundle.documents]
    app_ids = [a.id for a in bundle.applications]
    if len(set(doc_ids)) != len(doc_ids) or len(set(app_ids)) != len(app_ids):
        raise ImportFailed("The export has duplicate ids")
    known = set(doc_ids)
    for a in bundle.applications:
        unknown = set(a.document_ids) - known
        if unknown:
            raise ImportFailed(f"Application {a.id} links unknown documents {sorted(unknown)}")
        if not a.history:
            raise ImportFailed(f"Application {a.id} has no status history")


def _import_documents(
    session: Session,
    bundle: ExportBundle,
    zf: zipfile.ZipFile | None,
    uploads_dir: Path,
    max_file_bytes: int,
    empty: bool,
    kept_files: list[str],
) -> tuple[dict[int, int], int, int, int]:
    """Returns (export id → local id, created, reused, missing)."""
    mapping: dict[int, int] = {}
    created = reused = missing = 0
    for record in bundle.documents:
        existing = session.scalars(
            select(Document).where(Document.sha256 == record.sha256).limit(1)
        ).first()
        if existing is not None:
            mapping[record.id] = existing.id
            reused += 1
            continue
        member = DOCS_DIR + record.stored_filename
        if zf is None or member not in zf.namelist():
            missing += 1
            continue
        with zf.open(member) as src:
            staged = storage.stage_upload(
                src,  # type: ignore[arg-type]
                storage.clean_filename(record.original_filename),
                uploads_dir,
                max_file_bytes,
            )
        if staged.sha256 != record.sha256:
            staged.discard()
            raise ImportFailed(f"{record.original_filename} doesn't match its checksum")
        stored_name = staged.keep(uploads_dir, preferred=record.stored_filename)
        kept_files.append(stored_name)
        doc = Document(
            **({"id": record.id} if empty else {}),
            kind=record.kind,
            display_name=record.display_name,
            original_filename=record.original_filename,
            stored_filename=stored_name,
            mime_type=staged.file_type.mime_type,
            size_bytes=staged.size_bytes,
            sha256=staged.sha256,
            uploaded_at=record.uploaded_at,
        )
        session.add(doc)
        session.flush()
        mapping[record.id] = doc.id
        created += 1
    return mapping, created, reused, missing
