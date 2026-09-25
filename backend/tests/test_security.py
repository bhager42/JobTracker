from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import host_allowed, hostname_of
from tests.conftest import FrozenClock, api_client

NEW_APP = {"company": "Acme", "job_title": "Engineer"}


@pytest.fixture
def lan_client(tmp_path: Path, clock: FrozenClock) -> Any:
    """The app as deployed on a NAS: reached as truenas.local, like the TrueNAS example."""
    settings = Settings(
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "static",
        allowed_hosts=["truenas.local", "192.168.1.10", "*.tail1234.ts.net"],
    )
    with api_client(create_app(settings, clock=clock), base_url="http://truenas.local:30420") as c:
        yield c


# --- Host allowlist -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("header", "hostname"),
    [
        ("truenas.local:30420", "truenas.local"),
        ("TrueNAS.Local.", "truenas.local"),
        ("[::1]:8080", "::1"),
        ("192.168.1.10", "192.168.1.10"),
    ],
)
def test_hostname_parsing(header: str, hostname: str) -> None:
    assert hostname_of(header) == hostname


def test_host_patterns() -> None:
    allowed = ["truenas.local", "*.tail1234.ts.net"]
    assert host_allowed("truenas.local", allowed)
    assert host_allowed("nas.tail1234.ts.net", allowed)
    assert not host_allowed("tail1234.ts.net.evil.com", allowed)
    assert not host_allowed("evil.com", allowed)
    assert host_allowed("localhost", [])  # loopback is always fine
    assert host_allowed("anything", ["*"])


def test_bad_host_gets_400(lan_client: TestClient) -> None:
    for path in ("/api/health", "/api/applications", "/"):
        res = lan_client.get(path, headers={"Host": "attacker.example"})
        assert res.status_code == 400, path
        assert res.headers["content-type"] == "application/problem+json"
        assert "ALLOWED_HOSTS" in res.json()["detail"]
    # Allowed names (and loopback, for the container healthcheck) still work.
    assert lan_client.get("/api/health").status_code == 200
    assert lan_client.get("/api/health", headers={"Host": "192.168.1.10:30420"}).status_code == 200
    assert lan_client.get("/api/health", headers={"Host": "nas.tail1234.ts.net"}).status_code == 200
    assert lan_client.get("/api/health", headers={"Host": "127.0.0.1:8080"}).status_code == 200


def test_dns_rebinding_is_blocked(lan_client: TestClient) -> None:
    """A rebinding attack points attacker.example at the NAS; the browser then sends
    Host: attacker.example, which isn't allowed."""
    res = lan_client.post(
        "/api/applications",
        json=NEW_APP,
        headers={"Host": "attacker.example", "Origin": "http://attacker.example"},
    )
    assert res.status_code == 400


# --- cross-site requests ------------------------------------------------------------------


def test_cross_origin_post_is_rejected(lan_client: TestClient) -> None:
    res = lan_client.post("/api/applications", json=NEW_APP, headers={"Origin": "https://evil.com"})
    assert res.status_code == 403
    assert res.json()["detail"] == "Cross-origin request refused"
    assert lan_client.get("/api/applications").json()["total"] == 0


@pytest.mark.parametrize("method", ["post", "patch", "put", "delete"])
def test_every_unsafe_method_checks_origin(lan_client: TestClient, method: str) -> None:
    res = lan_client.request(
        method.upper(), "/api/applications/1", headers={"Origin": "https://evil.com"}
    )
    assert res.status_code == 403


def test_null_origin_and_foreign_referer_are_rejected(lan_client: TestClient) -> None:
    assert (
        lan_client.post("/api/applications", json=NEW_APP, headers={"Origin": "null"})
    ).status_code == 403
    res = lan_client.post(
        "/api/applications", json=NEW_APP, headers={"Referer": "https://evil.com/page"}
    )
    assert res.status_code == 403


def test_same_site_origin_is_allowed(lan_client: TestClient) -> None:
    res = lan_client.post(
        "/api/applications",
        json=NEW_APP,
        headers={"Origin": "http://truenas.local:30420", "Referer": "http://truenas.local:30420/"},
    )
    assert res.status_code == 201


def test_custom_header_is_required(lan_client: TestClient) -> None:
    """Without the header a cross-site form or fetch can't get through; with it, the browser
    would have to pass a CORS preflight first, and CORS is off."""
    res = lan_client.post(
        "/api/applications", json=NEW_APP, headers={"X-Requested-With": "XMLHttpRequest"}
    )
    assert res.status_code == 403
    assert "X-Requested-With" in res.json()["detail"]
    del lan_client.headers["x-requested-with"]
    res = lan_client.post("/api/applications", json=NEW_APP)
    assert res.status_code == 403


def test_form_encoded_bodies_are_rejected(lan_client: TestClient) -> None:
    """A plain HTML form can only send urlencoded/multipart/text bodies."""
    for content_type in ("application/x-www-form-urlencoded", "text/plain"):
        res = lan_client.post(
            "/api/applications",
            content=b'{"company": "Acme", "job_title": "Engineer"}',
            headers={"Content-Type": content_type},
        )
        assert res.status_code == 415, content_type


def test_bodyless_posts_and_reads_need_no_content_type(lan_client: TestClient) -> None:
    assert lan_client.post("/api/automation/auto-close/run").status_code == 200
    # Reads don't need the header (downloads and links can't set one).
    del lan_client.headers["x-requested-with"]
    assert lan_client.get("/api/applications").status_code == 200


def test_no_cors_headers(lan_client: TestClient) -> None:
    res = lan_client.options(
        "/api/applications",
        headers={"Origin": "https://evil.com", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in res.headers


# --- headers ------------------------------------------------------------------------------


def test_security_headers_on_api_and_pages(tmp_path: Path) -> None:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>JobTracker</title>")
    settings = Settings(data_dir=tmp_path / "data", static_dir=static)
    with api_client(create_app(settings)) as c:
        for res in (c.get("/api/health"), c.get("/applications"), c.get("/api/nope")):
            csp = res.headers["content-security-policy"]
            assert "default-src 'self'" in csp
            assert "script-src 'self'" in csp
            assert "unsafe-inline" not in csp.split("script-src")[1].split(";")[0]
            assert "frame-ancestors 'none'" in csp
            assert res.headers["x-frame-options"] == "DENY"
            assert res.headers["x-content-type-options"] == "nosniff"
            assert res.headers["referrer-policy"] == "no-referrer"
            assert "camera=()" in res.headers["permissions-policy"]
        assert c.get("/api/health").headers["cache-control"] == "no-store"
        assert "cache-control" not in c.get("/applications").headers or (
            c.get("/applications").headers["cache-control"] != "no-store"
        )


def test_errors_carry_security_headers_too(lan_client: TestClient) -> None:
    res = lan_client.get("/api/health", headers={"Host": "evil.example"})
    assert res.status_code == 400
    assert "default-src 'self'" in res.headers["content-security-policy"]


def test_pdf_preview_keeps_its_own_sandbox_policy(client: TestClient) -> None:
    pdf = b"%PDF-1.4\n%%EOF\n"
    doc = client.post(
        "/api/documents", files={"file": ("cv.pdf", pdf)}, data={"kind": "resume"}
    ).json()
    inline = client.get(f"/api/documents/{doc['id']}/file", params={"disposition": "inline"})
    assert inline.headers["content-security-policy"] == "sandbox; frame-ancestors 'self'"
    assert inline.headers["x-frame-options"] == "SAMEORIGIN"
    download = client.get(f"/api/documents/{doc['id']}/file")
    assert download.headers["x-frame-options"] == "DENY"


def test_swagger_ui_is_off_but_schema_stays(client: TestClient) -> None:
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 200
