from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FrozenClock


def create(client: TestClient, **fields: Any) -> dict[str, Any]:
    body = {"company": "Acme", "job_title": "Backend Engineer", **fields}
    res = client.post("/api/applications", json=body)
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def list_ids(client: TestClient, **params: Any) -> list[int]:
    res = client.get("/api/applications", params=params)
    assert res.status_code == 200, res.text
    return [a["id"] for a in res.json()["items"]]


# --- create -------------------------------------------------------------------------------


def test_create_applies_defaults_and_writes_initial_history(client: TestClient) -> None:
    app = create(client, job_url="https://acme.example/jobs/1")
    assert app["status"] == "applied"
    assert app["date_applied"] == "2026-03-10"
    assert app["salary_currency"] == "USD"
    assert app["interview_rounds"] == 0
    assert app["archived"] is False
    assert app["status_changed_at"] == "2026-03-10T15:00:00Z"
    assert [(h["from_status"], h["to_status"], h["source"]) for h in app["history"]] == [
        (None, "applied", "user")
    ]


def test_date_applied_defaults_to_today_in_container_tz(
    client: TestClient, clock: FrozenClock
) -> None:
    # 03:00 UTC on Mar 11 is still Mar 10 in Chicago.
    clock.now = datetime(2026, 3, 11, 3, 0, tzinfo=UTC)
    assert create(client)["date_applied"] == "2026-03-10"


def test_saved_status_has_no_date_until_it_moves_on(client: TestClient, clock: FrozenClock) -> None:
    app = create(client, status="saved")
    assert app["date_applied"] is None
    clock.advance(days=3)
    res = client.post(f"/api/applications/{app['id']}/status", json={"status": "applied"})
    assert res.json()["date_applied"] == "2026-03-13"


def test_create_strips_text_and_blanks_become_null(client: TestClient) -> None:
    app = create(client, company="  Acme  ", location="   ", salary_currency="eur")
    assert app["company"] == "Acme"
    assert app["location"] is None
    assert app["salary_currency"] == "EUR"


@pytest.mark.parametrize(
    ("fields", "loc"),
    [
        ({"company": ""}, "company"),
        ({"job_title": "   "}, "job_title"),
        ({"job_url": "javascript:alert(1)"}, "job_url"),
        ({"job_url": "ftp://example.com/x"}, "job_url"),
        ({"job_url": "https://"}, "job_url"),
        ({"contact_email": "not-an-email"}, "contact_email"),
        ({"status": "hired"}, "status"),
        ({"work_mode": "moon"}, "work_mode"),
        ({"source": "carrier-pigeon"}, "source"),
        ({"salary_min": -1}, "salary_min"),
        ({"salary_currency": "DOLLARS"}, "salary_currency"),
        ({"interview_rounds": -1}, "interview_rounds"),
        ({"unknown_field": 1}, "unknown_field"),
    ],
)
def test_create_rejects_invalid_fields(
    client: TestClient, fields: dict[str, Any], loc: str
) -> None:
    body = {"company": "Acme", "job_title": "Engineer", **fields}
    res = client.post("/api/applications", json=body)
    assert res.status_code == 422
    assert res.headers["content-type"] == "application/problem+json"
    problem = res.json()
    assert problem["status"] == 422
    assert any(loc in err["loc"] for err in problem["errors"]), problem


def test_create_rejects_inverted_salary_range(client: TestClient) -> None:
    res = client.post(
        "/api/applications",
        json={"company": "A", "job_title": "B", "salary_min": 200, "salary_max": 100},
    )
    assert res.status_code == 422
    assert "salary_min" in res.text


def test_create_requires_company_and_title(client: TestClient) -> None:
    res = client.post("/api/applications", json={})
    assert res.status_code == 422
    locs = {tuple(e["loc"]) for e in res.json()["errors"]}
    assert ("body", "company") in locs
    assert ("body", "job_title") in locs


# --- read / update / delete ---------------------------------------------------------------


def test_get_returns_detail_and_404_is_a_problem(client: TestClient) -> None:
    app = create(client)
    res = client.get(f"/api/applications/{app['id']}")
    assert res.status_code == 200
    assert res.json()["company"] == "Acme"

    res = client.get("/api/applications/999")
    assert res.status_code == 404
    assert res.headers["content-type"] == "application/problem+json"
    assert res.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "detail": "Application 999 not found",
    }


def test_patch_changes_only_sent_fields(client: TestClient, clock: FrozenClock) -> None:
    app = create(client, location="Chicago", notes="first")
    clock.advance(hours=1)
    res = client.patch(f"/api/applications/{app['id']}", json={"notes": "second"})
    assert res.status_code == 200
    body = res.json()
    assert body["notes"] == "second"
    assert body["location"] == "Chicago"
    assert body["updated_at"] == "2026-03-10T16:00:00Z"
    assert body["status_changed_at"] == "2026-03-10T15:00:00Z"
    assert len(body["history"]) == 1


def test_patch_can_clear_optional_fields(client: TestClient) -> None:
    app = create(client, location="Chicago")
    res = client.patch(f"/api/applications/{app['id']}", json={"location": None})
    assert res.json()["location"] is None


@pytest.mark.parametrize("field", ["company", "job_title", "status", "archived"])
def test_patch_rejects_null_for_required_fields(client: TestClient, field: str) -> None:
    app = create(client)
    res = client.patch(f"/api/applications/{app['id']}", json={field: None})
    assert res.status_code == 422


def test_patch_checks_salary_against_stored_values(client: TestClient) -> None:
    app = create(client, salary_min=100_000, salary_max=150_000)
    res = client.patch(f"/api/applications/{app['id']}", json={"salary_max": 90_000})
    assert res.status_code == 422
    assert res.json()["detail"] == "salary_min must not exceed salary_max"


def test_patch_cannot_clear_date_applied_unless_saved(client: TestClient) -> None:
    app = create(client)
    url = f"/api/applications/{app['id']}"
    assert client.patch(url, json={"date_applied": None}).status_code == 422
    res = client.patch(url, json={"date_applied": None, "status": "saved"})
    assert res.status_code == 200
    assert res.json()["date_applied"] is None


def test_delete_removes_application_and_history(client: TestClient) -> None:
    app = create(client)
    assert client.delete(f"/api/applications/{app['id']}").status_code == 204
    assert client.get(f"/api/applications/{app['id']}").status_code == 404
    assert client.delete(f"/api/applications/{app['id']}").status_code == 404


# --- status history -----------------------------------------------------------------------


def test_status_change_writes_history(client: TestClient, clock: FrozenClock) -> None:
    app = create(client)
    url = f"/api/applications/{app['id']}/status"
    clock.advance(days=2)
    client.post(url, json={"status": "screening", "note": "Recruiter called"})
    clock.advance(days=5)
    res = client.post(url, json={"status": "interviewing", "interview_rounds": 1})
    body = res.json()
    assert body["status"] == "interviewing"
    assert body["interview_rounds"] == 1
    assert body["status_changed_at"] == "2026-03-17T15:00:00Z"
    assert [
        (h["from_status"], h["to_status"], h["changed_at"], h["note"]) for h in body["history"]
    ] == [
        (None, "applied", "2026-03-10T15:00:00Z", None),
        ("applied", "screening", "2026-03-12T15:00:00Z", "Recruiter called"),
        ("screening", "interviewing", "2026-03-17T15:00:00Z", None),
    ]


def test_same_status_writes_no_history_and_keeps_clock(
    client: TestClient, clock: FrozenClock
) -> None:
    app = create(client, status="interviewing", interview_rounds=1)
    clock.advance(days=1)
    res = client.post(
        f"/api/applications/{app['id']}/status",
        json={"status": "interviewing", "interview_rounds": 2},
    )
    body = res.json()
    assert body["interview_rounds"] == 2
    assert body["status_changed_at"] == "2026-03-10T15:00:00Z"
    assert len(body["history"]) == 1


def test_status_change_through_patch_writes_history(client: TestClient) -> None:
    app = create(client)
    res = client.patch(
        f"/api/applications/{app['id']}",
        json={"status": "rejected_after_interview", "interview_rounds": 2},
    )
    body = res.json()
    assert body["status"] == "rejected_after_interview"
    assert body["interview_rounds"] == 2
    assert body["history"][-1]["from_status"] == "applied"
    assert body["history"][-1]["to_status"] == "rejected_after_interview"
    assert body["history"][-1]["source"] == "user"


def test_status_endpoint_validates(client: TestClient) -> None:
    app = create(client)
    url = f"/api/applications/{app['id']}/status"
    assert client.post(url, json={"status": "nope"}).status_code == 422
    assert client.post(url, json={"status": "offer", "note": "x" * 1001}).status_code == 422
    assert client.post("/api/applications/999/status", json={"status": "offer"}).status_code == 404


# --- listing, filters, sorting, paging ----------------------------------------------------


@pytest.fixture
def seeded(client: TestClient) -> dict[str, int]:
    rows = {
        "acme": create(
            client,
            company="Acme",
            job_title="Backend Engineer",
            date_applied="2026-01-05",
            source="linkedin",
            work_mode="remote",
            notes="Uses FastAPI",
        ),
        "globex": create(
            client,
            company="Globex",
            job_title="Data Engineer",
            date_applied="2026-02-10",
            source="referral",
            work_mode="hybrid",
            status="interviewing",
        ),
        "initech": create(
            client,
            company="Initech",
            job_title="Frontend Developer",
            date_applied="2026-03-01",
            source="linkedin",
            work_mode="onsite",
            status="rejected_no_interview",
        ),
        "saved": create(client, company="Umbrella", job_title="SRE_Lead", status="saved"),
        "archived": create(
            client, company="Hooli", job_title="Engineer", date_applied="2025-12-01", archived=True
        ),
    }
    return {k: v["id"] for k, v in rows.items()}


def test_list_default_sort_and_archived_hidden(client: TestClient, seeded: dict[str, int]) -> None:
    res = client.get("/api/applications").json()
    assert res["total"] == 4
    assert res["page"] == 1
    assert res["page_size"] == 50
    # Newest date_applied first; the saved row has no date and sorts last.
    assert [a["id"] for a in res["items"]] == [
        seeded["initech"],
        seeded["globex"],
        seeded["acme"],
        seeded["saved"],
    ]


def test_list_archived_modes(client: TestClient, seeded: dict[str, int]) -> None:
    assert list_ids(client, archived="only") == [seeded["archived"]]
    assert len(list_ids(client, archived="include")) == 5
    assert client.get("/api/applications", params={"archived": "yes"}).status_code == 422


def test_list_filters(client: TestClient, seeded: dict[str, int]) -> None:
    assert set(list_ids(client, status=["interviewing", "rejected_no_interview"])) == {
        seeded["globex"],
        seeded["initech"],
    }
    assert set(list_ids(client, source="linkedin")) == {seeded["acme"], seeded["initech"]}
    assert list_ids(client, work_mode="hybrid") == [seeded["globex"]]
    assert set(list_ids(client, **{"from": "2026-02-01", "to": "2026-03-01"})) == {
        seeded["globex"],
        seeded["initech"],
    }
    # Filters combine with AND.
    assert list_ids(client, source="linkedin", status="applied") == [seeded["acme"]]


def test_list_text_search(client: TestClient, seeded: dict[str, int]) -> None:
    assert list_ids(client, q="globex") == [seeded["globex"]]  # company, case-insensitive
    assert set(list_ids(client, q="engineer")) == {seeded["acme"], seeded["globex"]}  # title
    assert list_ids(client, q="fastapi") == [seeded["acme"]]  # notes
    # LIKE wildcards are literal: "_" only matches an underscore.
    assert list_ids(client, q="SRE_") == [seeded["saved"]]
    assert list_ids(client, q="%") == []


def test_list_sorting(client: TestClient, seeded: dict[str, int]) -> None:
    assert list_ids(client, sort="company") == [
        seeded["acme"],
        seeded["globex"],
        seeded["initech"],
        seeded["saved"],
    ]
    assert list_ids(client, sort="date_applied")[:3] == [
        seeded["acme"],
        seeded["globex"],
        seeded["initech"],
    ]
    assert client.get("/api/applications", params={"sort": "notes"}).status_code == 422


def test_list_paging(client: TestClient, seeded: dict[str, int]) -> None:
    res = client.get("/api/applications", params={"page_size": 3, "page": 2}).json()
    assert res["total"] == 4
    assert [a["id"] for a in res["items"]] == [seeded["saved"]]
    assert client.get("/api/applications", params={"page_size": 500}).status_code == 422
    assert client.get("/api/applications", params={"page": 0}).status_code == 422


# --- bulk ---------------------------------------------------------------------------------


def test_bulk_set_status_writes_history_per_application(
    client: TestClient, seeded: dict[str, int]
) -> None:
    ids = [seeded["acme"], seeded["globex"], 999]
    res = client.post(
        "/api/applications/bulk",
        json={"ids": ids, "action": "set_status", "payload": {"status": "withdrawn"}},
    )
    assert res.json() == {"affected": 2}
    for app_id in ids[:2]:
        body = client.get(f"/api/applications/{app_id}").json()
        assert body["status"] == "withdrawn"
        assert body["history"][-1]["to_status"] == "withdrawn"


def test_bulk_archive_unarchive_delete(client: TestClient, seeded: dict[str, int]) -> None:
    ids = [seeded["acme"], seeded["globex"]]
    post = lambda action: client.post(  # noqa: E731
        "/api/applications/bulk", json={"ids": ids, "action": action}
    ).json()
    assert post("archive") == {"affected": 2}
    assert set(list_ids(client, archived="only")) == {*ids, seeded["archived"]}
    assert post("unarchive") == {"affected": 2}
    assert list_ids(client, archived="only") == [seeded["archived"]]
    assert post("delete") == {"affected": 2}
    assert client.get(f"/api/applications/{ids[0]}").status_code == 404


def test_bulk_validates(client: TestClient) -> None:
    url = "/api/applications/bulk"
    assert client.post(url, json={"ids": [], "action": "delete"}).status_code == 422
    assert client.post(url, json={"ids": [1], "action": "explode"}).status_code == 422
    assert client.post(url, json={"ids": [1], "action": "set_status"}).status_code == 422
