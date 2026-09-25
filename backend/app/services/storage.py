"""Upload storage (PLAN.md §9.3).

Files are streamed to a temp file under the uploads dir while being hashed and size-checked,
then identified by their content (magic bytes), never by the client's MIME type. A file is
accepted only when its content is an allowed type *and* matches its extension. Stored names
are a UUID plus an extension chosen by the server, so user input never becomes a path.
"""

import codecs
import hashlib
import re
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

CHUNK = 64 * 1024
TEMP_PREFIX = ".tmp-"


@dataclass(frozen=True)
class FileType:
    key: str
    mime_type: str
    extension: str
    label: str


FILE_TYPES: dict[str, FileType] = {
    t.key: t
    for t in (
        FileType("pdf", "application/pdf", ".pdf", "PDF"),
        FileType(
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".docx",
            "DOCX",
        ),
        FileType("doc", "application/msword", ".doc", "DOC"),
        FileType("odt", "application/vnd.oasis.opendocument.text", ".odt", "ODT"),
        FileType("rtf", "application/rtf", ".rtf", "RTF"),
        FileType("txt", "text/plain; charset=utf-8", ".txt", "TXT"),
        FileType("md", "text/markdown; charset=utf-8", ".md", "Markdown"),
    )
}

# Which detected content each (lower-cased) extension may hold.
EXTENSION_TYPES: dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "doc",
    ".odt": "odt",
    ".rtf": "rtf",
    ".txt": "txt",
    ".md": "md",
    ".markdown": "md",
}
ALLOWED_LABELS = ", ".join(t.label for t in FILE_TYPES.values())

_OLE2 = bytes.fromhex("D0CF11E0A1B11AE1")
_ODT_MIMETYPE = b"application/vnd.oasis.opendocument.text"


class UploadRejected(ValueError):
    """The file is not an allowed type, or its content doesn't match its extension."""


class UploadTooLarge(ValueError):
    pass


class EmptyUpload(ValueError):
    pass


@dataclass(frozen=True)
class StagedFile:
    """An upload written to a temp file and verified, waiting to be kept or discarded."""

    temp_path: Path
    file_type: FileType
    size_bytes: int
    sha256: str

    def keep(self, uploads_dir: Path, preferred: str | None = None) -> str:
        """Moves the file to its permanent UUID name and returns that name. A restore passes
        the name from the backup; it's used only if it's one we could have generated, fits
        this file's type, and is free."""
        name = f"{uuid.uuid4().hex}{self.file_type.extension}"
        if (
            preferred
            and _STORED_NAME.match(preferred)
            and preferred.endswith(self.file_type.extension)
            and not (uploads_dir / preferred).exists()
        ):
            name = preferred
        self.temp_path.rename(uploads_dir / name)
        return name

    def discard(self) -> None:
        self.temp_path.unlink(missing_ok=True)


def stage_upload(
    source: BinaryIO, original_filename: str, uploads_dir: Path, max_bytes: int
) -> StagedFile:
    """Streams `source` to a temp file and verifies it. The caller must `keep` or `discard`."""
    expected = EXTENSION_TYPES.get(Path(original_filename).suffix.lower())
    if expected is None:
        raise UploadRejected(f"Only these file types are allowed: {ALLOWED_LABELS}.")

    temp_path = uploads_dir / f"{TEMP_PREFIX}{uuid.uuid4().hex}"
    digest = hashlib.sha256()
    size = 0
    try:
        with temp_path.open("xb") as out:
            while chunk := source.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLarge(f"Files can be at most {max_bytes // (1024 * 1024)} MB.")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise EmptyUpload("The file is empty.")
        detected = detect_type(temp_path)
        if detected != expected and not (detected == "txt" and expected == "md"):
            ext = Path(original_filename).suffix.lower()
            raise UploadRejected(f"The file's contents don't match its {ext} extension.")
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
    return StagedFile(temp_path, FILE_TYPES[expected], size, digest.hexdigest())


def detect_type(path: Path) -> str | None:
    """Identifies an allowed type from the file's content, or returns None."""
    with path.open("rb") as f:
        head = f.read(8)
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"{\\rtf"):
        return "rtf"
    if head.startswith(_OLE2):
        return "doc"
    if head.startswith(b"PK\x03\x04"):
        return _detect_zip(path)
    return "txt" if _is_utf8_text(path) else None


def _detect_zip(path: Path) -> str | None:
    """DOCX and ODT are zip files; tell them apart from any other zip by what's inside."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "mimetype" in names:
                info = zf.getinfo("mimetype")
                if info.file_size <= 100 and zf.read(info).strip() == _ODT_MIMETYPE:
                    return "odt"
            if "[Content_Types].xml" in names and "word/document.xml" in names:
                return "docx"
    except zipfile.BadZipFile:
        return None
    return None


def _is_utf8_text(path: Path) -> bool:
    decoder = codecs.getincrementaldecoder("utf-8")()
    try:
        with path.open("rb") as f:
            while chunk := f.read(CHUNK):
                if b"\x00" in chunk:
                    return False
                decoder.decode(chunk)
            decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        return False
    return True


def remove_stale_temp_files(uploads_dir: Path) -> None:
    """Deletes temp files left by uploads interrupted by a crash or restart."""
    for path in uploads_dir.glob(f"{TEMP_PREFIX}*"):
        path.unlink(missing_ok=True)


_STORED_NAME = re.compile(r"^[0-9a-f]{32}\.[a-z]{2,4}$")


def stored_path(uploads_dir: Path, stored_filename: str) -> Path:
    """The on-disk path for a stored name, refusing anything that isn't one we generated."""
    if not _STORED_NAME.match(stored_filename):
        raise ValueError(f"not a stored filename: {stored_filename!r}")
    return uploads_dir / stored_filename


# --- filenames ----------------------------------------------------------------------------


def clean_filename(name: str) -> str:
    """The user's filename, reduced to a display-safe base name (never used as a path)."""
    base = re.split(r"[\\/]", name)[-1]
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C").strip()
    return base[:255] or "document"


def content_disposition(disposition: str, filename: str) -> str:
    """An RFC 6266 header with an ASCII fallback and an RFC 5987 UTF-8 `filename*`."""
    # Strip accents ("é" -> "e"), then replace anything else outside a safe set with "_".
    decomposed = unicodedata.normalize("NFKD", filename)
    ascii_name = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    ascii_name = re.sub(r"[^A-Za-z0-9._ ()\-]", "_", ascii_name).strip() or "document"
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"
