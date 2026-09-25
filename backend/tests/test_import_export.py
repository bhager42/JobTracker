import csv
import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FrozenClock, api_client
from tests.test_documents import DOCX, PDF


def make_client(tmp_path: Path, name: str, clock: FrozenClock, **extra: Any) -> TestClient:
    settings = Settings(data_dir=tmp_path / name, static_dir=tmp_path / "static", **extra)
    return api_client(create_app(settings, clock=clock))


def create(client: TestClient, company: str, **fields: Any) -> dict[str, Any]:
    res = client.post("/api/applications", json={"company": company, "job_title": "Eng", **fields})
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def upload(client: TestClient, name: str, data: bytes, kind: str = "resume") -> dict[str, Any]:
    res = client.post("/api/documents", files={"file": (name, data)}, data={"kind": kind})
    assert res.status_code in (200, 201), res.text
    return res.json()  # type: ignore[no-any-return]


def export_zip(client: TestClient) -> zipfile.ZipFile:
    res = client.get("/api/export")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(res.content))


def import_file(client: TestClient, name: str, data: bytes) -> Any:
    return client.post("/api/import", files={"file": (name, data)})


def zip_bytes(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def comparable(zf: zipfile.ZipFile) -> dict[str, Any]:
    data = json.loads(zf.read("applications.json"))
    del data["exported_at"]
    return data  # type: ignore[no-any-return]


@pytest.fixture
def populated(tmp_path: Path, clock: FrozenClock) -> Any:
    """An instance with varied data: documents, history, archived and auto-closed rows,
    non-default settings, and a deleted row (so ids have a gap)."""
    with make_client(tmp_path, "a", clock) as c:
        pdf = upload(c, "Résumé.pdf", PDF)
        docx = upload(c, "Cover letter.docx", DOCX, "cover_letter")
        acme = create(
            c,
            "Acme",
            source="linkedin",
            work_mode="remote",
            salary_min=120000,
            salary_max=150000,
            notes="=HYPERLINK(evil)",
            document_ids=[pdf["id"], docx["id"]],
        )
        gone = create(c, "Deleted Co")
        globex = create(c, "Globex", archived=True, document_ids=[pdf["id"]])
        create(c, "Saved", status="saved")
        c.delete(f"/api/applications/{gone['id']}")
        clock.advance(days=3)
        c.post(f"/api/applications/{acme['id']}/status", json={"status": "screening", "note": "hi"})
        clock.advance(days=40)
        c.post("/api/automation/auto-close/run")  # auto-closes Globex? no: archived is skipped
        c.patch("/api/settings", json={"auto_close": {"days": 21, "statuses": ["applied"]}})
        c.post(f"/api/applications/{globex['id']}/status", json={"status": "withdrawn"})
        yield c


def test_export_then_import_into_a_fresh_instance_is_identical(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    """Phase 7 AC: same data and same files after a round trip."""
    original = export_zip(populated)
    names = original.namelist()
    assert {"applications.json", "applications.csv"} <= set(names)
    assert len([n for n in names if n.startswith("documents/")]) == 2

    with make_client(tmp_path, "b", clock) as fresh:
        res = import_file(fresh, "backup.zip", populated.get("/api/export").content)
        assert res.status_code == 200, res.text
        assert res.json() == {
            "restored": True,
            "applications": 3,
            "documents": 2,
            "documents_reused": 0,
            "documents_missing": 0,
        }
        again = export_zip(fresh)
        assert comparable(again) == comparable(original)
        for name in names:
            if name.startswith("documents/"):
                assert again.read(name) == original.read(name), name

        # And the API agrees, down to history and settings. (History rows get fresh
        # internal ids; they aren't part of the export.)
        def detail(client: TestClient, app_id: int) -> dict[str, Any]:
            body = client.get(f"/api/applications/{app_id}").json()
            for h in body["history"]:
                del h["id"]
            return body  # type: ignore[no-any-return]

        for a in populated.get("/api/applications", params={"archived": "include"}).json()["items"]:
            assert detail(fresh, a["id"]) == detail(populated, a["id"])
        assert fresh.get("/api/settings").json() == populated.get("/api/settings").json()
        doc_id = comparable(original)["documents"][0]["id"]
        assert fresh.get(f"/api/documents/{doc_id}/file").content == PDF


def test_export_csv_is_spreadsheet_safe(populated: TestClient) -> None:
    raw = export_zip(populated).read("applications.csv")
    assert raw.startswith(b"\xef\xbb\xbf")  # BOM so Excel reads UTF-8
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    acme = next(r for r in rows if r["company"] == "Acme")
    assert acme["status"] == "screening"
    assert acme["notes"] == "'=HYPERLINK(evil)"  # formula neutralised
    assert acme["documents"] == "Résumé; Cover letter"  # by document id
    assert acme["salary_min"] == "120000"


def test_import_into_an_instance_with_data_appends(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    backup = populated.get("/api/export").content
    with make_client(tmp_path, "c", clock) as other:
        existing = create(other, "Already here")
        upload(other, "same-resume.pdf", PDF)  # identical bytes to the backup's PDF
        other.patch("/api/settings", json={"auto_close": {"days": 45}})
        res = import_file(other, "backup.zip", backup).json()
        assert res == {
            "restored": False,
            "applications": 3,
            "documents": 1,
            "documents_reused": 1,
            "documents_missing": 0,
        }
        listed = other.get("/api/applications", params={"archived": "include"}).json()
        assert listed["total"] == 4
        assert existing["id"] in {a["id"] for a in listed["items"]}
        acme = next(a for a in listed["items"] if a["company"] == "Acme")
        detail = other.get(f"/api/applications/{acme['id']}").json()
        assert len(detail["documents"]) == 2
        assert [h["to_status"] for h in detail["history"]] == ["applied", "screening"]
        assert other.get("/api/settings").json()["auto_close"]["days"] == 45  # kept


def test_import_json_only_skips_files(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    raw = export_zip(populated).read("applications.json")
    with make_client(tmp_path, "d", clock) as fresh:
        res = import_file(fresh, "applications.json", raw).json()
        assert res["applications"] == 3
        assert res["documents"] == 0
        assert res["documents_missing"] == 2
        acme = next(
            a for a in fresh.get("/api/applications").json()["items"] if a["company"] == "Acme"
        )
        assert fresh.get(f"/api/applications/{acme['id']}").json()["documents"] == []


# --- refusing bad imports -----------------------------------------------------------------


def _bundle(populated: TestClient) -> tuple[dict[str, Any], dict[str, bytes]]:
    zf = export_zip(populated)
    data = json.loads(zf.read("applications.json"))
    files = {n: zf.read(n) for n in zf.namelist() if n.startswith("documents/")}
    return data, files


def _assert_nothing_imported(client: TestClient, data_dir: Path) -> None:
    assert client.get("/api/applications", params={"archived": "include"}).json()["total"] == 0
    assert client.get("/api/documents").json() == []
    assert [p.name for p in (data_dir / "uploads").iterdir()] == []


@pytest.mark.parametrize(
    ("name", "data", "message"),
    [
        ("notes.txt", b"hello", "Choose a JobTracker export"),
        ("backup.zip", b"PK\x03\x04garbage", "damaged"),
        ("backup.zip", zip_bytes({"other.json": b"{}"}), "No applications.json"),
        ("backup.json", b'{"format": "something-else"}', "Not a valid JobTracker export"),
        ("backup.json", b"not json", "Not a valid JobTracker export"),
    ],
)
def test_rejects_things_that_are_not_exports(
    tmp_path: Path, clock: FrozenClock, name: str, data: bytes, message: str
) -> None:
    with make_client(tmp_path, "e", clock) as c:
        res = import_file(c, name, data)
        assert res.status_code == 422
        assert message in res.json()["detail"]


def test_a_spoofed_file_aborts_the_whole_import(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    data, files = _bundle(populated)
    pdf_name = next(n for n in files if n.endswith(".pdf"))
    files[pdf_name] = b"MZ\x90\x00 an executable"  # not a PDF any more
    payload = zip_bytes({"applications.json": json.dumps(data).encode(), **files})
    with make_client(tmp_path, "f", clock) as c:
        res = import_file(c, "backup.zip", payload)
        assert res.status_code == 422
        assert "contents don't match" in res.json()["detail"]
        _assert_nothing_imported(c, tmp_path / "f")


def test_a_tampered_file_fails_its_checksum(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    data, files = _bundle(populated)
    pdf_name = next(n for n in files if n.endswith(".pdf"))
    files[pdf_name] = PDF + b"% changed\n"
    payload = zip_bytes({"applications.json": json.dumps(data).encode(), **files})
    with make_client(tmp_path, "g", clock) as c:
        res = import_file(c, "backup.zip", payload)
        assert res.status_code == 422
        assert "checksum" in res.json()["detail"]
        _assert_nothing_imported(c, tmp_path / "g")


def test_bad_references_are_refused(
    populated: TestClient, tmp_path: Path, clock: FrozenClock
) -> None:
    data, _files = _bundle(populated)
    data["applications"][0]["document_ids"] = [999]
    with make_client(tmp_path, "h", clock) as c:
        res = import_file(c, "b.json", json.dumps(data).encode())
        assert res.status_code == 422
        assert "unknown documents" in res.json()["detail"]


def test_zip_bombs_are_refused(tmp_path: Path, clock: FrozenClock) -> None:
    # 3 MB of zeros compresses to a few KB but unpacks past a 1 MB/2 MB limit.
    bomb = zip_bytes({"applications.json": b"{}", "documents/x.pdf": b"\0" * 3 * 1024 * 1024})
    assert len(bomb) < 50_000
    with make_client(tmp_path, "i", clock, max_import_mb=2, max_upload_mb=1) as c:
        res = import_file(c, "bomb.zip", bomb)
        assert res.status_code == 422
        assert "MAX_IMPORT_MB" in res.json()["detail"]


def test_import_needs_the_csrf_header(tmp_path: Path, clock: FrozenClock) -> None:
    with make_client(tmp_path, "j", clock) as c:
        del c.headers["x-requested-with"]
        assert import_file(c, "b.zip", b"PK").status_code == 403


# --- CSV import -----------------------------------------------------------------------------

SPREADSHEET = (
    "Company,Position,Date Applied,Status,Source,Salary,Remote?,Link,Notes\n"
    "Acme,Backend Engineer,03/01/2026,Recruiter Screen,LinkedIn,$120k,Remote,"
    "https://acme.example/1,Great team\n"
    'Globex,Data Engineer,2026-02-15,Ghosted,Company website,"130,000",Hybrid,,\n'
    ",Missing company,2026-02-10,Applied,,,,,\n"
    "Initech,SRE,next tuesday,Applied,,,,,\n"
    "Hooli,Staff Engineer,Mar 5, 2026,Wishlist,Referral,,On-site,,\n"
)


def post_csv(client: TestClient, text: str, mapping: dict[str, str] | None, **data: Any) -> Any:
    form: dict[str, Any] = {
        k: str(v).lower() if isinstance(v, bool) else v for k, v in data.items()
    }
    if mapping is not None:
        form["mapping"] = json.dumps(mapping)
    path = "/api/import/csv" if mapping is not None else "/api/import/csv/preview"
    return client.post(path, files={"file": ("jobs.csv", text.encode())}, data=form)


MAPPING = {
    "company": "Company",
    "job_title": "Position",
    "date_applied": "Date Applied",
    "status": "Status",
    "source": "Source",
    "salary_min": "Salary",
    "work_mode": "Remote?",
    "job_url": "Link",
    "notes": "Notes",
}


def test_csv_preview_suggests_a_mapping(client: TestClient) -> None:
    text = SPREADSHEET.replace("Mar 5, 2026", '"Mar 5, 2026"')
    body = post_csv(client, text, None).json()
    assert body["headers"][:3] == ["Company", "Position", "Date Applied"]
    assert body["row_count"] == 5
    assert len(body["sample_rows"]) == 5
    assert body["required"] == ["company", "job_title"]
    assert body["suggested_mapping"] == {
        "company": "Company",
        "job_title": "Position",
        "date_applied": "Date Applied",
        "status": "Status",
        "source": "Source",
        "work_mode": "Remote?",
        "job_url": "Link",
        "salary_min": "Salary",
        "notes": "Notes",
    }


def test_csv_dry_run_reports_without_writing(client: TestClient) -> None:
    text = SPREADSHEET.replace("Mar 5, 2026", '"Mar 5, 2026"')
    body = post_csv(client, text, MAPPING, dry_run=True).json()
    assert body["total"] == 5
    assert body["valid"] == 3
    assert body["created"] == 0
    assert [(e["row"], e["message"]) for e in body["errors"]] == [
        (4, "company: Field required"),
        (5, "can't read the date “next tuesday” (use YYYY-MM-DD or MM/DD/YYYY)"),
    ]
    assert client.get("/api/applications").json()["total"] == 0


def test_csv_import_creates_valid_rows_leniently(client: TestClient) -> None:
    text = SPREADSHEET.replace("Mar 5, 2026", '"Mar 5, 2026"')
    body = post_csv(client, text, MAPPING).json()
    assert body["created"] == 3
    items = {a["company"]: a for a in client.get("/api/applications").json()["items"]}
    assert set(items) == {"Acme", "Globex", "Hooli"}
    acme = client.get(f"/api/applications/{items['Acme']['id']}").json()
    assert acme["status"] == "screening"
    assert acme["date_applied"] == "2026-03-01"
    assert acme["source"] == "linkedin"
    assert acme["salary_min"] == 120000
    assert acme["work_mode"] == "remote"
    assert acme["history"][0]["source"] == "import"
    globex = items["Globex"]
    assert (globex["status"], globex["source"], globex["salary_min"], globex["work_mode"]) == (
        "not_selected",
        "company_site",
        130000,
        "hybrid",
    )
    assert (items["Hooli"]["status"], items["Hooli"]["date_applied"]) == ("saved", "2026-03-05")


def test_csv_semicolons_and_windows_encoding(client: TestClient) -> None:
    text = "Firma;Titel;Notizen\nMüller GmbH;Entwickler;Grüße\n"
    mapping = {"company": "Firma", "job_title": "Titel", "notes": "Notizen"}
    res = client.post(
        "/api/import/csv",
        files={"file": ("jobs.csv", text.encode("cp1252"))},
        data={"mapping": json.dumps(mapping)},
    )
    assert res.json()["created"] == 1
    [app] = client.get("/api/applications").json()["items"]
    assert app["company"] == "Müller GmbH"


@pytest.mark.parametrize(
    ("mapping", "message"),
    [
        ({"job_title": "Position"}, "Map a column to company"),
        ({"company": "Company", "job_title": "Nope"}, "No column named Nope"),
        ({"company": "Company", "job_title": "Position", "salary": "Salary"}, "Unknown fields"),
    ],
)
def test_csv_bad_mappings(client: TestClient, mapping: dict[str, str], message: str) -> None:
    res = post_csv(client, SPREADSHEET, mapping)
    assert res.status_code == 422
    assert message in res.json()["detail"]


def test_csv_rejects_empty_files_and_bad_mapping_json(client: TestClient) -> None:
    assert post_csv(client, "", None).status_code == 422
    res = client.post(
        "/api/import/csv",
        files={"file": ("jobs.csv", b"a,b\n1,2\n")},
        data={"mapping": "[1, 2]"},
    )
    assert res.status_code == 422


# --- stats ----------------------------------------------------------------------------------


def test_stats(populated: TestClient) -> None:
    body = populated.get("/api/stats").json()
    assert body["applications"] == 3
    assert body["archived"] == 1
    assert body["documents"] == 2
    assert body["history_entries"] == 5
    assert body["database_bytes"] > 0
    assert body["uploads_bytes"] == len(PDF) + len(DOCX)
