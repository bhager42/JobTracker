import json
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.clock import Clock, get_clock, local_date
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Application, Document, StatusHistory
from app.problems import problem_responses
from app.schemas import (
    CsvImportResult,
    CsvPreview,
    CsvRowError,
    DataStats,
    ImportResultOut,
)
from app.services import csv_import, export_import, storage

router = APIRouter(prefix="/api", tags=["data"])

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ClockDep = Annotated[Clock, Depends(get_clock)]
MB = 1024 * 1024


@router.get(
    "/export",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}, "description": "The backup ZIP."}},
)
def export(session: SessionDep, settings: SettingsDep, clock: ClockDep) -> FileResponse:
    """Everything as a ZIP: applications.json (for re-import), applications.csv, and files."""
    now = clock()
    path = export_import.write_export(session, now, settings.app_version, settings.uploads_dir)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"jobtracker-export-{local_date(now).isoformat()}.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.post("/import", responses=problem_responses(413, 422))
def import_export(file: UploadFile, session: SessionDep, settings: SettingsDep) -> ImportResultOut:
    """Restores a JobTracker export (.zip, or its applications.json). Into an empty instance
    ids and settings come back exactly; otherwise records are added alongside what's there."""
    try:
        bundle, zf = export_import.read_bundle(
            file.file,
            file.filename or "",
            max_bytes=settings.max_import_mb * MB,
            max_file_bytes=settings.max_upload_mb * MB,
        )
        try:
            result = export_import.import_bundle(
                session, bundle, zf, settings.uploads_dir, settings.max_upload_mb * MB
            )
        finally:
            if zf is not None:
                zf.close()
    except (
        export_import.ImportFailed,
        storage.UploadRejected,
        storage.UploadTooLarge,
        storage.EmptyUpload,
    ) as exc:
        raise HTTPException(422, str(exc)) from exc
    return ImportResultOut.model_validate(result.model_dump())


def _table(file: UploadFile, settings: Settings) -> csv_import.CsvTable:
    try:
        return csv_import.read_csv(file.file, settings.max_upload_mb * MB)
    except csv_import.CsvError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/import/csv/preview", responses=problem_responses(413, 422))
def preview_csv(file: UploadFile, settings: SettingsDep) -> CsvPreview:
    """Reads a CSV's columns and first rows, and suggests a column for each field."""
    table = _table(file, settings)
    return CsvPreview(
        headers=table.headers,
        sample_rows=table.rows[: csv_import.SAMPLE_ROWS],
        row_count=len(table.rows),
        suggested_mapping=csv_import.suggest_mapping(table.headers),
        fields=list(csv_import.FIELDS),
        required=list(csv_import.REQUIRED),
    )


@router.post("/import/csv", responses=problem_responses(413, 422))
def import_csv(
    file: UploadFile,
    mapping: Annotated[str, Form(description='JSON object: {"field": "CSV column", ...}')],
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    dry_run: Annotated[bool, Form()] = False,
) -> CsvImportResult:
    """Imports the rows that pass validation; the rest are reported. `dry_run` only reports."""
    try:
        parsed = json.loads(mapping)
        if not isinstance(parsed, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
        ):
            raise ValueError
    except ValueError as exc:
        raise HTTPException(422, "mapping must be a JSON object of field → column") from exc
    table = _table(file, settings)
    try:
        result = csv_import.import_csv(session, table, parsed, clock(), dry_run=dry_run)
    except csv_import.CsvError as exc:
        raise HTTPException(422, str(exc)) from exc
    return CsvImportResult(
        total=result.total,
        valid=result.valid,
        created=result.created,
        errors=[CsvRowError(row=e.row, message=e.message) for e in result.errors],
    )


@router.get("/stats")
def stats(session: SessionDep, settings: SettingsDep) -> DataStats:
    def count(model: type[object], *where: object) -> int:
        return session.scalar(select(func.count()).select_from(model).where(*where)) or 0  # type: ignore[arg-type]

    db_bytes = sum(
        p.stat().st_size
        for p in (settings.db_path, settings.db_path.with_name(settings.db_path.name + "-wal"))
        if p.exists()
    )
    uploads = sum(
        p.stat().st_size
        for p in settings.uploads_dir.iterdir()
        if p.is_file() and not p.name.startswith(storage.TEMP_PREFIX)
    )
    return DataStats(
        applications=count(Application),
        archived=count(Application, Application.archived.is_(True)),
        documents=count(Document),
        history_entries=count(StatusHistory),
        database_bytes=db_bytes,
        uploads_bytes=uploads,
    )
