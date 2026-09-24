import io
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

# --- sample files -------------------------------------------------------------------------

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


def make_zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


DOCX = make_zip(
    {
        "[Content_Types].xml": b"<Types/>",
        "_rels/.rels": b"<Relationships/>",
        "word/document.xml": b"<w:document/>",
    }
)
ODT = make_zip({"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": b"<x/>"})
DOC = bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 504
RTF = b"{\\rtf1\\ansi Hello}"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
EXE = b"MZ\x90\x00" + b"\x00" * 64


def upload(
    client: TestClient,
    filename: str,
    data: bytes,
    kind: str = "resume",
    **form: str,
) -> Any:
    return client.post(
        "/api/documents",
        files={"file": (filename, data, "application/octet-stream")},
        data={"kind": kind, **form},
    )


def create_app_row(client: TestClient, company: str, **fields: Any) -> dict[str, Any]:
    res = client.post(
        "/api/applications", json={"company": company, "job_title": "Engineer", **fields}
    )
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def stored_files(settings: Settings) -> list[str]:
    return sorted(p.name for p in settings.uploads_dir.iterdir())


# --- upload -------------------------------------------------------------------------------


def test_upload_pdf_stores_under_uuid_name(client: TestClient, settings: Settings) -> None:
    res = upload(client, "Résumé – Backend.pdf", PDF, display_name="Resume – Backend v3")
    assert res.status_code == 201, res.text
    doc = res.json()
    assert doc["display_name"] == "Resume – Backend v3"
    assert doc["original_filename"] == "Résumé – Backend.pdf"
    assert doc["mime_type"] == "application/pdf"
    assert doc["size_bytes"] == len(PDF)
    assert doc["kind"] == "resume"
    assert doc["application_count"] == 0
    assert doc["duplicate"] is False
    [name] = stored_files(settings)
    assert len(name) == 36 and name.endswith(".pdf")  # 32 hex chars + ".pdf"
    assert "sum" not in name.lower()


@pytest.mark.parametrize(
    ("filename", "data", "mime"),
    [
        (
            "cv.docx",
            DOCX,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        ("letter.odt", ODT, "application/vnd.oasis.opendocument.text"),
        ("old.doc", DOC, "application/msword"),
        ("cv.rtf", RTF, "application/rtf"),
        ("notes.txt", "Plain text ✓".encode(), "text/plain; charset=utf-8"),
        ("README.md", b"# Cover letter\n", "text/markdown; charset=utf-8"),
        ("UPPER.PDF", PDF, "application/pdf"),
    ],
)
def test_upload_accepts_allowed_types(
    client: TestClient, filename: str, data: bytes, mime: str
) -> None:
    res = upload(client, filename, data)
    assert res.status_code == 201, res.text
    assert res.json()["mime_type"] == mime


def test_display_name_defaults_to_file_stem(client: TestClient) -> None:
    assert upload(client, "Cover Letter.docx", DOCX).json()["display_name"] == "Cover Letter"


def test_path_components_in_filename_are_dropped(client: TestClient, settings: Settings) -> None:
    doc = upload(client, "..\\..\\evil/../../x.pdf", PDF).json()
    assert doc["original_filename"] == "x.pdf"
    assert all(len(n) == 36 for n in stored_files(settings))


@pytest.mark.parametrize(
    ("filename", "data"),
    [
        ("photo.png", PNG),  # type not allowed
        ("setup.exe", EXE),
        ("no-extension", PDF),
        ("resume.pdf", EXE),  # spoofed: executable named .pdf
        ("resume.pdf", DOCX),  # spoofed: real DOCX named .pdf
        ("resume.docx", PDF),  # spoofed: real PDF named .docx
        ("resume.docx", make_zip({"a.txt": b"hi"})),  # a zip that isn't a DOCX
        ("resume.odt", DOCX),
        ("notes.txt", b"\xff\xfe\x00binary"),  # binary content named .txt
        ("notes.txt", PDF),  # a PDF named .txt
    ],
)
def test_upload_rejects_wrong_or_spoofed_types(
    client: TestClient, settings: Settings, filename: str, data: bytes
) -> None:
    res = upload(client, filename, data)
    assert res.status_code == 415, res.text
    assert res.headers["content-type"] == "application/problem+json"
    assert stored_files(settings) == []  # no temp file left behind


def test_upload_rejects_empty_file(client: TestClient) -> None:
    assert upload(client, "empty.pdf", b"").status_code == 422


def test_upload_rejects_bad_kind(client: TestClient) -> None:
    assert upload(client, "cv.pdf", PDF, kind="selfie").status_code == 422


@pytest.fixture
def small_client(tmp_path: Path) -> Any:
    settings = Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "static", max_upload_mb=1)
    with TestClient(create_app(settings)) as c:
        yield c, settings


def test_upload_rejects_oversize_file(small_client: Any) -> None:
    client, settings = small_client
    big = PDF + b"0" * (1024 * 1024)  # just over 1 MB
    res = upload(client, "big.pdf", big)
    assert res.status_code == 413
    assert "1 MB" in res.json()["detail"]
    assert stored_files(settings) == []


def test_oversize_body_is_cut_off_while_streaming(small_client: Any) -> None:
    """Without a Content-Length, the limit still applies as the body streams in."""
    client, _settings = small_client

    def body() -> Any:
        yield (
            b'--xyz\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n'
            b"Content-Type: application/pdf\r\n\r\n%PDF-"
        )
        for _ in range(40):
            yield b"x" * 64 * 1024  # 2.5 MB total, over the 1 MB + 1 MB overhead limit

    res = client.post(
        "/api/documents",
        content=body(),
        headers={"content-type": "multipart/form-data; boundary=xyz"},
    )
    assert res.status_code == 413


def test_json_bodies_are_limited_too(client: TestClient) -> None:
    res = client.post(
        "/api/applications",
        content=b'{"company": "' + b"x" * (5 * 1024 * 1024) + b'"}',
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413


def test_identical_upload_is_deduplicated(client: TestClient, settings: Settings) -> None:
    first = upload(client, "cv.pdf", PDF, display_name="CV")
    second = upload(client, "copy-of-cv.pdf", PDF, kind="other")
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["duplicate"] is True
    assert second.json()["display_name"] == "CV"
    assert len(stored_files(settings)) == 1
    assert len(client.get("/api/documents").json()) == 1


# --- list / rename ------------------------------------------------------------------------


def test_list_filters_by_kind_and_search(client: TestClient) -> None:
    upload(client, "backend.pdf", PDF, display_name="Resume – Backend")
    upload(client, "letter.docx", DOCX, kind="cover_letter", display_name="Letter – Acme")
    upload(client, "frontend.md", b"# Frontend", display_name="Resume – Frontend")
    names = lambda **p: [d["display_name"] for d in client.get("/api/documents", params=p).json()]  # noqa: E731
    assert names() == ["Resume – Frontend", "Letter – Acme", "Resume – Backend"]  # newest first
    assert names(kind="cover_letter") == ["Letter – Acme"]
    assert names(q="backend") == ["Resume – Backend"]
    assert names(q="letter.docx") == ["Letter – Acme"]  # matches the original filename too


def test_rename_and_change_kind(client: TestClient) -> None:
    doc = upload(client, "cv.pdf", PDF).json()
    res = client.patch(
        f"/api/documents/{doc['id']}", json={"display_name": " Resume v4 ", "kind": "other"}
    )
    assert res.status_code == 200
    assert res.json()["display_name"] == "Resume v4"
    assert res.json()["kind"] == "other"
    assert client.patch(f"/api/documents/{doc['id']}", json={"display_name": ""}).status_code == 422
    assert client.patch("/api/documents/999", json={"kind": "other"}).status_code == 404


# --- serving ------------------------------------------------------------------------------


def test_pdf_preview_is_inline_and_sandboxed(client: TestClient) -> None:
    doc = upload(client, "Résumé.pdf", PDF).json()
    res = client.get(f"/api/documents/{doc['id']}/file", params={"disposition": "inline"})
    assert res.status_code == 200
    assert res.content == PDF
    assert res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"].startswith("inline;")
    assert res.headers["x-content-type-options"] == "nosniff"
    csp = res.headers["content-security-policy"]
    assert "sandbox" in csp
    assert "frame-ancestors 'self'" in csp


def test_download_uses_original_filename(client: TestClient) -> None:
    doc = upload(client, "Résumé – Backend.pdf", PDF).json()
    res = client.get(f"/api/documents/{doc['id']}/file")
    disposition = res.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert 'filename="Resume _ Backend.pdf"' in disposition  # ASCII fallback
    assert f"filename*=UTF-8''{quote('Résumé – Backend.pdf', safe='')}" in disposition


def test_non_pdf_is_never_served_inline(client: TestClient) -> None:
    doc = upload(client, "page.md", b"<script>alert(1)</script>").json()
    res = client.get(f"/api/documents/{doc['id']}/file", params={"disposition": "inline"})
    assert res.headers["content-disposition"].startswith("attachment;")
    assert res.headers["content-type"].startswith("text/markdown")
    assert "sandbox" in res.headers["content-security-policy"]


def test_header_injection_in_filename_is_neutralised(client: TestClient) -> None:
    doc = upload(client, 'a";\r\nX-Evil: 1;".pdf', PDF).json()
    res = client.get(f"/api/documents/{doc['id']}/file")
    assert "x-evil" not in res.headers
    assert '";' not in res.headers["content-disposition"].split("filename*")[0][:-2]


def test_missing_document_file_404s(client: TestClient) -> None:
    assert client.get("/api/documents/999/file").status_code == 404


# --- attaching ----------------------------------------------------------------------------


def test_attach_pdf_and_docx_to_two_applications(client: TestClient) -> None:
    pdf = upload(client, "resume.pdf", PDF).json()
    docx = upload(client, "letter.docx", DOCX, kind="cover_letter").json()
    acme = create_app_row(client, "Acme")
    globex = create_app_row(client, "Globex")

    for app in (acme, globex):
        res = client.put(
            f"/api/applications/{app['id']}/documents",
            json={"document_ids": [pdf["id"], docx["id"]]},
        )
        assert res.status_code == 200, res.text
        # Ordered by kind (cover letter, then resume), then name.
        assert [d["id"] for d in res.json()["documents"]] == [docx["id"], pdf["id"]]

    detail = client.get(f"/api/applications/{acme['id']}").json()
    assert {d["original_filename"] for d in detail["documents"]} == {"resume.pdf", "letter.docx"}
    counts = {d["id"]: d["application_count"] for d in client.get("/api/documents").json()}
    assert counts == {pdf["id"]: 2, docx["id"]: 2}


def test_put_replaces_links_and_detaches(client: TestClient) -> None:
    a = upload(client, "a.pdf", PDF).json()
    b = upload(client, "b.docx", DOCX).json()
    app = create_app_row(client, "Acme", document_ids=[a["id"], b["id"]])
    assert len(app["documents"]) == 2
    res = client.put(f"/api/applications/{app['id']}/documents", json={"document_ids": [b["id"]]})
    assert [d["id"] for d in res.json()["documents"]] == [b["id"]]
    res = client.put(f"/api/applications/{app['id']}/documents", json={"document_ids": []})
    assert res.json()["documents"] == []


def test_attaching_unknown_documents_fails(client: TestClient) -> None:
    app = create_app_row(client, "Acme")
    res = client.put(f"/api/applications/{app['id']}/documents", json={"document_ids": [42]})
    assert res.status_code == 422
    assert res.json()["detail"] == "Unknown document ids: 42"
    res = client.post(
        "/api/applications", json={"company": "X", "job_title": "Y", "document_ids": [7]}
    )
    assert res.status_code == 422
    assert client.get("/api/applications").json()["total"] == 1  # nothing half-created


# --- deleting -----------------------------------------------------------------------------


def test_deleting_linked_document_is_blocked(client: TestClient, settings: Settings) -> None:
    doc = upload(client, "resume.pdf", PDF).json()
    acme = create_app_row(client, "Acme", document_ids=[doc["id"]])
    globex = create_app_row(client, "Globex", document_ids=[doc["id"]])

    res = client.delete(f"/api/documents/{doc['id']}")
    assert res.status_code == 409
    assert res.headers["content-type"] == "application/problem+json"
    body = res.json()
    assert "Acme (Engineer)" in body["detail"]
    assert {a["id"] for a in body["applications"]} == {acme["id"], globex["id"]}
    assert len(stored_files(settings)) == 1

    for app in (acme, globex):
        client.put(f"/api/applications/{app['id']}/documents", json={"document_ids": []})
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert stored_files(settings) == []
    assert client.get(f"/api/documents/{doc['id']}/file").status_code == 404


def test_deleting_an_application_keeps_its_documents(client: TestClient) -> None:
    doc = upload(client, "resume.pdf", PDF).json()
    app = create_app_row(client, "Acme", document_ids=[doc["id"]])
    other = create_app_row(client, "Globex", document_ids=[doc["id"]])
    assert client.delete(f"/api/applications/{app['id']}").status_code == 204
    client.post("/api/applications/bulk", json={"ids": [other["id"]], "action": "delete"})
    [remaining] = client.get("/api/documents").json()
    assert remaining["id"] == doc["id"]
    assert remaining["application_count"] == 0
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204


def test_startup_removes_stale_temp_files(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "static")
    settings.uploads_dir.mkdir(parents=True)
    (settings.uploads_dir / ".tmp-deadbeef").write_bytes(b"partial")
    with TestClient(create_app(settings)):
        pass
    assert stored_files(settings) == []
