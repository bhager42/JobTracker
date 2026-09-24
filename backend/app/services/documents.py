"""The document library: uploads with dedupe, edits, deletes, and application links."""

from datetime import datetime
from pathlib import Path
from typing import BinaryIO

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.enums import DocumentKind
from app.models import Application, Document
from app.services import storage


class DocumentInUse(Exception):
    def __init__(self, document: Document) -> None:
        super().__init__(f"Document {document.id} is attached to applications")
        self.document = document


class UnknownDocuments(ValueError):
    pass


def list_documents(
    session: Session, kind: DocumentKind | None = None, q: str | None = None
) -> list[Document]:
    stmt = select(Document).order_by(Document.uploaded_at.desc(), Document.id.desc())
    if kind:
        stmt = stmt.where(Document.kind == kind)
    if q and (q := q.strip()):
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(
            or_(
                Document.display_name.ilike(pattern, escape="\\"),
                Document.original_filename.ilike(pattern, escape="\\"),
            )
        )
    return list(session.scalars(stmt))


def upload_document(
    session: Session,
    *,
    source: BinaryIO,
    filename: str,
    kind: DocumentKind,
    display_name: str | None,
    uploads_dir: Path,
    max_bytes: int,
    now: datetime,
) -> tuple[Document, bool]:
    """Stores an upload. An identical file already in the library is reused rather than
    stored twice: returns `(document, duplicate)`."""
    original = storage.clean_filename(filename)
    staged = storage.stage_upload(source, original, uploads_dir, max_bytes)

    existing = session.scalars(
        select(Document).where(Document.sha256 == staged.sha256).order_by(Document.id).limit(1)
    ).first()
    if existing is not None:
        staged.discard()
        return existing, True

    stored_filename = staged.keep(uploads_dir)
    doc = Document(
        kind=kind,
        display_name=display_name or Path(original).stem or original,
        original_filename=original,
        stored_filename=stored_filename,
        mime_type=staged.file_type.mime_type,
        size_bytes=staged.size_bytes,
        sha256=staged.sha256,
        uploaded_at=now,
    )
    session.add(doc)
    try:
        session.commit()
    except BaseException:
        storage.stored_path(uploads_dir, stored_filename).unlink(missing_ok=True)
        raise
    session.refresh(doc)
    return doc, False


def delete_document(session: Session, doc: Document, uploads_dir: Path) -> None:
    if doc.application_count:
        raise DocumentInUse(doc)
    path = storage.stored_path(uploads_dir, doc.stored_filename)
    session.delete(doc)
    session.commit()
    # Only after the row is gone, so a failed commit never loses the file.
    path.unlink(missing_ok=True)


def set_application_documents(session: Session, app: Application, document_ids: list[int]) -> None:
    """Replaces the application's attached documents with exactly `document_ids`."""
    ids = list(dict.fromkeys(document_ids))
    docs = list(session.scalars(select(Document).where(Document.id.in_(ids)))) if ids else []
    missing = sorted(set(ids) - {d.id for d in docs})
    if missing:
        raise UnknownDocuments(f"Unknown document ids: {', '.join(map(str, missing))}")
    app.documents = docs


def refresh_counts(session: Session, docs: list[Document]) -> None:
    """Reloads `application_count` after links change in this session."""
    for doc in docs:
        session.refresh(doc, attribute_names=["application_count"])
