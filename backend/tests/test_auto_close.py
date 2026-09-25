import asyncio
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FrozenClock, api_client


def create(client: TestClient, company: str = "Acme", **fields: Any) -> dict[str, Any]:
    res = client.post(
        "/api/applications", json={"company": company, "job_title": "Engineer", **fields}
    )
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def run(client: TestClient) -> dict[str, Any]:
    res = client.post("/api/automation/auto-close/run")
    assert res.status_code == 200, res.text
    return res.json()  # type: ignore[no-any-return]


def get(client: TestClient, app_id: int) -> dict[str, Any]:
    return client.get(f"/api/applications/{app_id}").json()  # type: ignore[no-any-return]


def set_auto_close(client: TestClient, **values: Any) -> dict[str, Any]:
    res = client.patch("/api/settings", json={"auto_close": values})
    assert res.status_code == 200, res.text
    return res.json()["auto_close"]  # type: ignore[no-any-return]


# --- settings -----------------------------------------------------------------------------


def test_default_settings(client: TestClient) -> None:
    assert client.get("/api/settings").json() == {
        "auto_close": {"enabled": True, "days": 30, "statuses": ["applied"]},
        "auto_close_allowed_statuses": ["applied", "screening", "interviewing"],
    }


def test_env_seeds_days_on_first_run_then_db_wins(tmp_path: Path, clock: FrozenClock) -> None:
    def settings(days: int) -> Settings:
        return Settings(
            data_dir=tmp_path / "data", static_dir=tmp_path / "s", auto_close_days_default=days
        )

    with api_client(create_app(settings(45), clock=clock)) as c:
        assert c.get("/api/settings").json()["auto_close"]["days"] == 45
        set_auto_close(c, days=20)
    # A later start with a different env default keeps the stored value.
    with api_client(create_app(settings(60), clock=clock)) as c:
        assert c.get("/api/settings").json()["auto_close"]["days"] == 20


def test_patch_settings_is_partial_and_normalises_statuses(client: TestClient) -> None:
    assert set_auto_close(client, statuses=["screening", "applied", "applied"]) == {
        "enabled": True,
        "days": 30,
        "statuses": ["applied", "screening"],
    }
    assert set_auto_close(client, enabled=False)["statuses"] == ["applied", "screening"]


@pytest.mark.parametrize(
    "values",
    [
        {"days": 0},
        {"days": 366},
        {"statuses": []},
        {"statuses": ["offer"]},  # later stages always need a person
        {"statuses": ["accepted"]},
        {"statuses": ["nope"]},
        {"surprise": True},
    ],
)
def test_patch_settings_validates(client: TestClient, values: dict[str, Any]) -> None:
    res = client.patch("/api/settings", json={"auto_close": values})
    assert res.status_code == 422
    assert client.get("/api/settings").json()["auto_close"]["days"] == 30


# --- the rule -----------------------------------------------------------------------------


def test_closes_only_after_the_window(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    clock.advance(days=30)
    assert run(client)["closed"] == 0  # exactly 30 days is not "more than" 30
    clock.advance(seconds=1)
    result = run(client)
    assert result == {"enabled": True, "closed": 1, "application_ids": [app["id"]]}
    body = get(client, app["id"])
    assert body["status"] == "not_selected"
    assert body["auto_closed"] is True
    assert body["status_changed_at"] == "2026-04-09T15:00:01Z"


def test_writes_history_with_automation_source(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    clock.advance(days=31)
    run(client)
    last = get(client, app["id"])["history"][-1]
    assert last == {
        **last,
        "from_status": "applied",
        "to_status": "not_selected",
        "source": "automation",
        "note": "Auto-closed after 30 days with no update",
        "changed_at": "2026-04-10T15:00:00Z",
    }


def test_eligible_statuses_only(client: TestClient, clock: FrozenClock) -> None:
    ids = {s: create(client, s, status=s)["id"] for s in ("applied", "screening", "interviewing")}
    offer = create(client, "Offer Co", status="offer")
    saved = create(client, "Saved Co", status="saved")
    clock.advance(days=40)

    assert run(client)["application_ids"] == [ids["applied"]]
    set_auto_close(client, statuses=["screening", "interviewing"])
    assert sorted(run(client)["application_ids"]) == [ids["screening"], ids["interviewing"]]
    assert get(client, offer["id"])["status"] == "offer"
    assert get(client, saved["id"])["status"] == "saved"


def test_exempt_and_archived_are_skipped(client: TestClient, clock: FrozenClock) -> None:
    exempt = create(client, "Pinned", auto_close_exempt=True)
    archived = create(client, "Old", archived=True)
    clock.advance(days=90)
    assert run(client)["closed"] == 0
    assert get(client, exempt["id"])["status"] == "applied"
    assert get(client, archived["id"])["status"] == "applied"


def test_idempotent(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    clock.advance(days=31)
    assert run(client)["closed"] == 1
    assert run(client)["closed"] == 0
    clock.advance(days=100)
    assert run(client)["closed"] == 0  # not_selected isn't eligible, so it stays put
    assert len(get(client, app["id"])["history"]) == 2


def test_status_changes_reset_the_clock(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    clock.advance(days=20)
    client.post(f"/api/applications/{app['id']}/status", json={"status": "screening"})
    client.post(f"/api/applications/{app['id']}/status", json={"status": "applied"})
    clock.advance(days=20)  # 40 days since creation, 20 since the last change
    assert run(client)["closed"] == 0


def test_disabled_closes_nothing(client: TestClient, clock: FrozenClock) -> None:
    create(client)
    set_auto_close(client, enabled=False)
    clock.advance(days=365)
    assert run(client) == {"enabled": False, "closed": 0, "application_ids": []}


def test_changing_the_window_applies_on_the_next_run(
    client: TestClient, clock: FrozenClock
) -> None:
    app = create(client)
    clock.advance(days=10)
    assert run(client)["closed"] == 0
    set_auto_close(client, days=7)
    assert run(client)["application_ids"] == [app["id"]]
    assert (
        get(client, app["id"])["history"][-1]["note"] == "Auto-closed after 7 days with no update"
    )


# --- auto_close_at ------------------------------------------------------------------------


def test_auto_close_at_is_reported(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    assert app["auto_close_at"] == "2026-04-09T15:00:00Z"
    listed = client.get("/api/applications").json()["items"][0]
    assert listed["auto_close_at"] == "2026-04-09T15:00:00Z"
    assert listed["auto_closed"] is False

    set_auto_close(client, days=14)
    assert get(client, app["id"])["auto_close_at"] == "2026-03-24T15:00:00Z"

    pinned = client.patch(f"/api/applications/{app['id']}", json={"auto_close_exempt": True})
    assert pinned.json()["auto_close_at"] is None
    assert create(client, status="offer")["auto_close_at"] is None
    set_auto_close(client, enabled=False)
    assert create(client)["auto_close_at"] is None


# --- undo ---------------------------------------------------------------------------------


def test_undo_restores_previous_status_and_resets_clock(
    client: TestClient, clock: FrozenClock
) -> None:
    set_auto_close(client, statuses=["applied", "screening"])
    app = create(client, status="screening")
    clock.advance(days=31)
    run(client)
    clock.advance(hours=2)

    res = client.post(f"/api/applications/{app['id']}/undo-auto-close")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "screening"
    assert body["auto_closed"] is False
    assert body["status_changed_at"] == "2026-04-10T17:00:00Z"
    assert body["auto_close_at"] == "2026-05-10T17:00:00Z"
    last = body["history"][-1]
    assert (last["from_status"], last["to_status"], last["source"], last["note"]) == (
        "not_selected",
        "screening",
        "user",
        "Undid auto-close",
    )
    # The clock restarted, so the next run doesn't close it straight away.
    assert run(client)["closed"] == 0
    assert client.get("/api/applications").json()["items"][0]["auto_closed"] is False


def test_undo_only_applies_to_auto_closed(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    url = f"/api/applications/{app['id']}/undo-auto-close"
    assert client.post(url).status_code == 409  # never closed
    client.post(f"/api/applications/{app['id']}/status", json={"status": "not_selected"})
    res = client.post(url)
    assert res.status_code == 409  # closed by a person
    assert res.json()["detail"] == "This application wasn't closed automatically"
    assert client.post("/api/applications/999/undo-auto-close").status_code == 404


def test_a_manual_change_after_auto_close_clears_the_flag(
    client: TestClient, clock: FrozenClock
) -> None:
    app = create(client)
    clock.advance(days=31)
    run(client)
    res = client.patch(f"/api/applications/{app['id']}", json={"notes": "just a note"})
    assert res.json()["auto_closed"] is True  # still the automation's close
    res = client.post(
        f"/api/applications/{app['id']}/status", json={"status": "rejected_no_interview"}
    )
    assert res.json()["auto_closed"] is False
    assert client.post(f"/api/applications/{app['id']}/undo-auto-close").status_code == 409


# --- scheduler ----------------------------------------------------------------------------


def test_runs_at_startup(tmp_path: Path, clock: FrozenClock) -> None:
    settings = Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "s")
    with api_client(create_app(settings, clock=clock)) as c:
        app = create(c)
    clock.advance(days=45)  # the NAS was off for a while
    with api_client(create_app(settings, clock=clock)) as c:
        body = get(c, app["id"])
        assert body["status"] == "not_selected"
        assert body["history"][-1]["changed_at"] == "2026-04-24T15:00:00Z"


def test_runs_again_on_the_interval(tmp_path: Path, clock: FrozenClock) -> None:
    settings = Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "s")
    with api_client(create_app(settings, clock=clock, auto_close_interval=0.01)) as c:
        app = create(c)
        clock.advance(days=31)

        async def wait_for_close() -> None:
            for _ in range(200):
                if get(c, app["id"])["status"] == "not_selected":
                    return
                await asyncio.sleep(0.01)
            raise AssertionError("scheduler never closed the application")

        asyncio.run(wait_for_close())


def test_scheduler_survives_a_failed_run(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import scheduler

    calls: list[int] = []
    real = scheduler.run_auto_close

    def flaky(*args: Any, **kwargs: Any) -> list[int]:
        calls.append(1)
        if len(calls) == 2:  # the first scheduled run (after the startup run) fails
            raise RuntimeError("database is locked")
        return real(*args, **kwargs)

    monkeypatch.setattr(scheduler, "run_auto_close", flaky)
    settings = Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "s")
    with api_client(create_app(settings, clock=clock, auto_close_interval=0.01)) as c:
        app = create(c)
        clock.advance(days=31)

        async def wait() -> None:
            for _ in range(300):
                if len(calls) >= 3 and get(c, app["id"])["status"] == "not_selected":
                    return
                await asyncio.sleep(0.01)
            raise AssertionError(f"scheduler stopped after {len(calls)} runs")

        asyncio.run(wait())


def test_about(client: TestClient, settings: Settings) -> None:
    assert client.get("/api/about").json() == {
        "version": settings.app_version,
        "build_sha": "dev",
        "data_dir": str(settings.data_dir),
    }
