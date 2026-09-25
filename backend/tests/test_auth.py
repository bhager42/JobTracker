from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import COOKIE, LoginRateLimiter
from app.config import Settings
from app.main import create_app
from tests.conftest import FrozenClock, api_client

PASSWORD = "correct horse battery staple"


def make_settings(tmp_path: Path, **extra: Any) -> Settings:
    return Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "static", **extra)


@pytest.fixture
def auth_client(tmp_path: Path, clock: FrozenClock) -> Any:
    settings = make_settings(tmp_path, auth_password=PASSWORD)
    with api_client(create_app(settings, clock=clock)) as c:
        yield c


def login(client: TestClient, password: str = PASSWORD) -> Any:
    return client.post("/api/auth/login", json={"password": password})


def test_auth_is_off_by_default(client: TestClient) -> None:
    assert client.get("/api/auth/status").json() == {"enabled": False, "authenticated": True}
    assert client.get("/api/applications").status_code == 200
    assert login(client).status_code == 404


def test_unauthenticated_api_calls_get_401(auth_client: TestClient) -> None:
    for method, path in [
        ("GET", "/api/applications"),
        ("GET", "/api/dashboard"),
        ("GET", "/api/metrics/summary"),
        ("GET", "/api/documents"),
        ("GET", "/api/settings"),
        ("GET", "/api/openapi.json"),
        ("POST", "/api/applications"),
    ]:
        res = auth_client.request(method, path, json={"company": "A", "job_title": "B"})
        assert res.status_code == 401, path
        assert res.headers["content-type"] == "application/problem+json"
    # Public: the healthcheck and the sign-in flow.
    assert auth_client.get("/api/health").status_code == 200
    assert auth_client.get("/api/auth/status").json() == {
        "enabled": True,
        "authenticated": False,
    }


def test_login_works(auth_client: TestClient) -> None:
    res = login(auth_client)
    assert res.status_code == 204
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=")
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Max-Age=2592000" in cookie
    assert "Secure" not in cookie  # plain http on the LAN
    assert auth_client.get("/api/auth/status").json()["authenticated"] is True
    assert auth_client.get("/api/applications").status_code == 200
    res = auth_client.post("/api/applications", json={"company": "A", "job_title": "B"})
    assert res.status_code == 201


def test_cookie_is_secure_over_https(tmp_path: Path, clock: FrozenClock) -> None:
    settings = make_settings(tmp_path, auth_password=PASSWORD)
    with api_client(create_app(settings, clock=clock), base_url="https://localhost") as c:
        assert "Secure" in login(c).headers["set-cookie"]


def test_wrong_password(auth_client: TestClient) -> None:
    res = login(auth_client, "hunter2")
    assert res.status_code == 401
    assert res.json()["detail"] == "Wrong password"
    assert "set-cookie" not in res.headers
    assert auth_client.get("/api/applications").status_code == 401


def test_logout(auth_client: TestClient) -> None:
    login(auth_client)
    assert auth_client.post("/api/auth/logout").status_code == 204
    assert auth_client.get("/api/applications").status_code == 401


def test_forged_and_expired_sessions_are_refused(
    auth_client: TestClient, clock: FrozenClock
) -> None:
    login(auth_client)
    token = auth_client.cookies[COOKIE]
    payload, sig = token.split(".")

    def use(value: str) -> None:
        auth_client.cookies.clear()  # replace, don't add a second cookie of the same name
        auth_client.cookies.set(COOKIE, value)

    use(f"{payload}.{'A' * len(sig)}")
    assert auth_client.get("/api/applications").status_code == 401
    use("garbage")
    assert auth_client.get("/api/applications").status_code == 401

    use(token)
    assert auth_client.get("/api/applications").status_code == 200
    clock.advance(days=31)
    assert auth_client.get("/api/applications").status_code == 401


def test_sessions_survive_restarts_but_not_password_changes(
    tmp_path: Path, clock: FrozenClock
) -> None:
    with api_client(create_app(make_settings(tmp_path, auth_password=PASSWORD), clock=clock)) as c:
        login(c)
        token = c.cookies[COOKIE]
    key = tmp_path / "data" / "session.key"
    assert key.stat().st_mode & 0o777 == 0o600

    with api_client(create_app(make_settings(tmp_path, auth_password=PASSWORD), clock=clock)) as c:
        c.cookies.set(COOKIE, token)
        assert c.get("/api/applications").status_code == 200
    with api_client(create_app(make_settings(tmp_path, auth_password="new"), clock=clock)) as c:
        c.cookies.set(COOKIE, token)
        assert c.get("/api/applications").status_code == 401


def test_login_rate_limit(auth_client: TestClient, clock: FrozenClock) -> None:
    for _ in range(5):
        assert login(auth_client, "nope").status_code == 401
    res = login(auth_client)  # even the right password waits
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) == 15 * 60 + 1
    clock.advance(minutes=15)
    assert login(auth_client).status_code == 204


def test_rate_limit_window_slides_and_success_resets() -> None:
    from datetime import UTC, datetime

    limiter = LoginRateLimiter(max_failures=3, window=timedelta(minutes=10))
    t0 = datetime(2026, 3, 10, tzinfo=UTC)
    for minutes in (0, 4, 8):
        limiter.record_failure("1.2.3.4", t0 + timedelta(minutes=minutes))
    assert limiter.retry_after("1.2.3.4", t0 + timedelta(minutes=9)) == 61
    assert limiter.retry_after("5.6.7.8", t0) is None  # other clients unaffected
    assert limiter.retry_after("1.2.3.4", t0 + timedelta(minutes=10)) is None  # oldest expired
    limiter.reset("1.2.3.4")
    assert limiter.retry_after("1.2.3.4", t0 + timedelta(minutes=10)) is None


def test_password_file(tmp_path: Path, clock: FrozenClock) -> None:
    secret = tmp_path / "password.txt"
    secret.write_text(PASSWORD + "\n")  # docker secrets usually end with a newline
    settings = make_settings(tmp_path, auth_password_file=secret)
    with api_client(create_app(settings, clock=clock)) as c:
        assert login(c).status_code == 204


@pytest.mark.parametrize(
    "extra",
    [
        {"auth_password": ""},
        {"auth_password": "x", "auth_password_file": "/etc/hostname"},
        {"auth_password_file": "/nonexistent/password"},
    ],
)
def test_bad_auth_config_fails_fast(tmp_path: Path, extra: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        make_settings(tmp_path, **extra)


def test_login_validates_input(auth_client: TestClient) -> None:
    assert auth_client.post("/api/auth/login", json={}).status_code == 422
    assert auth_client.post("/api/auth/login", json={"password": ""}).status_code == 422
