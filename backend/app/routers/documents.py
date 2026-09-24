from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.clock import Clock, get_clock
from app.config import Settings, get_settings
from app.db import get_session
from app.enums import DocumentKind
from app.models import Document
from app.problems import ProblemError, problem_responses
from app.schemas import (
    DocumentInUseProblem,
    DocumentOut,
    DocumentUpdate,
    DocumentUploaded,
    LinkedApplication,
)
from app.services import documents as svc
from app.services import storage

router = APIRouter(prefix="/api/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _get_or_404(session: Session, doc_id: int) -> Document:
    doc = session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, f"Document {doc_id} not found")
    return doc


@router.get("")
def list_documents(
    session: SessionDep,
    kind: DocumentKind | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> list[DocumentOut]:
    return [DocumentOut.model_validate(d) for d in svc.list_documents(session, kind, q)]


@router.post(
    "",
    status_code=201,
    responses={
        200: {"model": DocumentUploaded, "description": "An identical file already existed"},
        **problem_responses(413, 415, 422),
    },
)
def upload_document(
    file: UploadFile,
    kind: Annotated[DocumentKind, Form()],
    session: SessionDep,
    settings: SettingsDep,
    clock: Annotated[Clock, Depends(get_clock)],
    response: Response,
    display_name: Annotated[str | None, Form(max_length=200)] = None,
) -> DocumentUploaded:
    try:
        doc, duplicate = svc.upload_document(
            session,
            source=file.file,
            filename=file.filename or "document",
            kind=kind,
            display_name=display_name.strip() if display_name else None,
            uploads_dir=settings.uploads_dir,
            max_bytes=settings.max_upload_mb * 1024 * 1024,
            now=clock(),
        )
    except storage.UploadTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except storage.UploadRejected as exc:
        raise HTTPException(415, str(exc)) from exc
    except storage.EmptyUpload as exc:
        raise HTTPException(422, str(exc)) from exc
    if duplicate:
        response.status_code = 200
    return DocumentUploaded.model_validate(
        {**DocumentOut.model_validate(doc).model_dump(), "duplicate": duplicate}
    )


@router.get(
    "/{doc_id}/file",
    response_class=FileResponse,
    responses={
        200: {
            "content": {"application/octet-stream": {}},
            "description": "The file. Only PDFs are served inline; everything else downloads.",
        },
        **problem_responses(404),
    },
)
def get_document_file(
    doc_id: int,
    session: SessionDep,
    settings: SettingsDep,
    disposition: Literal["inline", "attachment"] = "attachment",
) -> FileResponse:
    doc = _get_or_404(session, doc_id)
    path = storage.stored_path(settings.uploads_dir, doc.stored_filename)
    if not path.is_file():
        raise HTTPException(404, f"The file for document {doc_id} is missing from storage")
    inline = disposition == "inline" and doc.mime_type == "application/pdf"
    headers = {
        "Content-Disposition": storage.content_disposition(
            "inline" if inline else "attachment", doc.original_filename
        ),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
        # PLAN.md §9.3-4: an inline PDF is sandboxed and may only be framed by this app.
        "Content-Security-Policy": (
            "sandbox; frame-ancestors 'self'" if inline else "default-src 'none'; sandbox"
        ),
    }
    return FileResponse(path, media_type=doc.mime_type, headers=headers)


@router.patch("/{doc_id}", responses=problem_responses(404, 422))
def update_document(doc_id: int, data: DocumentUpdate, session: SessionDep) -> DocumentOut:
    doc = _get_or_404(session, doc_id)
    for name, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(doc, name, value)
    session.commit()
    return DocumentOut.model_validate(doc)


@router.delete(
    "/{doc_id}",
    status_code=204,
    responses=problem_responses(404, 409, status_409=DocumentInUseProblem),
)
def delete_document(doc_id: int, session: SessionDep, settings: SettingsDep) -> Response:
    doc = _get_or_404(session, doc_id)
    try:
        svc.delete_document(session, doc, settings.uploads_dir)
    except svc.DocumentInUse:
        apps = doc.applications
        names = ", ".join(f"{a.company} ({a.job_title})" for a in apps)
        raise ProblemError(
            DocumentInUseProblem(
                title="Conflict",
                status=409,
                detail=f"“{doc.display_name}” is attached to {len(apps)} "
                f"application{'s' if len(apps) != 1 else ''}: {names}. Detach it first.",
                applications=[LinkedApplication.model_validate(a) for a in apps],
            )
        ) from None
    return Response(status_code=204)
