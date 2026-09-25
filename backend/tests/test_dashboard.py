from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services.metrics import Period, current_month, current_week
from tests.conftest import FrozenClock

# The clock fixture is Tuesday 2026-03-10 10:00 in Chicago.


def create(client: TestClient, company: str = "Acme", **fields: Any) -> dict[str, Any]:
    res = client.post(
        "/api/applications", json={"company": company, "job_title": "Engineer", **fields}
    )
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def move(client: TestClient, app: dict[str, Any], status: str) -> None:
    res = client.post(f"/api/applications/{app['id']}/status", json={"status": status})
    assert res.status_code == 200, res.text


def dashboard(client: TestClient) -> dict[str, Any]:
    res = client.get("/api/dashboard")
    assert res.status_code == 200, res.text
    return res.json()  # type: ignore[no-any-return]


# --- periods ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("now", "week"),
    [
        # Tuesday → Monday 9th to Sunday 15th.
        (datetime(2026, 3, 10, 15, tzinfo=UTC), Period(date(2026, 3, 9), date(2026, 3, 15))),
        # 04:00 UTC Monday is still Sunday 23:00 in Chicago: the previous week.
        (datetime(2026, 3, 16, 4, tzinfo=UTC), Period(date(2026, 3, 9), date(2026, 3, 15))),
        (datetime(2026, 3, 16, 6, tzinfo=UTC), Period(date(2026, 3, 16), date(2026, 3, 22))),
        # A week spanning New Year: ISO week 1 of 2027 starts Monday 2026-12-28.
        (datetime(2027, 1, 1, 18, tzinfo=UTC), Period(date(2026, 12, 28), date(2027, 1, 3))),
    ],
)
def test_current_week_is_iso_in_container_tz(now: datetime, week: Period) -> None:
    assert current_week(now) == week


def test_current_month_in_container_tz() -> None:
    # 04:30 UTC on April 1st is still March 31st in Chicago.
    assert current_month(datetime(2026, 4, 1, 4, 30, tzinfo=UTC)) == Period(
        date(2026, 3, 1), date(2026, 3, 31)
    )
    assert current_month(datetime(2026, 2, 10, tzinfo=UTC)) == Period(
        date(2026, 2, 1), date(2026, 2, 28)
    )


# --- KPIs ---------------------------------------------------------------------------------


def test_applied_this_week_and_month(client: TestClient) -> None:
    create(client, "Mon", date_applied="2026-03-09")  # this week
    create(client, "Sun", date_applied="2026-03-15")  # this week (its last day)
    create(client, "PrevSun", date_applied="2026-03-08")  # last week, this month
    create(client, "Feb", date_applied="2026-02-28")  # neither
    create(client, "Saved", status="saved")  # never counts
    create(client, "Today")  # defaults to today, the 10th
    kpis = dashboard(client)["kpis"]
    assert kpis["applied_this_week"] == 3
    assert kpis["applied_this_month"] == 4
    assert kpis["total_applied"] == 5


def test_rates_use_ever_reached_from_history(client: TestClient) -> None:
    create(client, "Saved", status="saved")  # excluded from the denominator
    create(client, "Waiting")
    rejected = create(client, "Screened")
    move(client, rejected, "screening")
    move(client, rejected, "rejected_no_interview")
    interviewed = create(client, "Interviewed")
    move(client, interviewed, "interviewing")
    move(client, interviewed, "rejected_after_interview")
    ghosted = create(client, "Ghosted")
    move(client, ghosted, "not_selected")
    withdrew = create(client, "Withdrew")
    move(client, withdrew, "withdrawn")

    kpis = dashboard(client)["kpis"]
    assert kpis["total_applied"] == 5
    assert kpis["response_rate"] == pytest.approx(2 / 5)
    assert kpis["interview_rate"] == pytest.approx(1 / 5)


def test_rates_are_null_with_no_applications(client: TestClient) -> None:
    kpis = dashboard(client)["kpis"]
    assert kpis == {
        "applied_this_week": 0,
        "applied_this_month": 0,
        "active_pipeline": 0,
        "total_applied": 0,
        "interview_rate": None,
        "response_rate": None,
    }


def test_active_pipeline(client: TestClient) -> None:
    for status in ("applied", "screening", "interviewing", "offer"):
        create(client, status, status=status)
    create(client, "Hidden", status="interviewing", archived=True)
    create(client, "Saved", status="saved")
    create(client, "Done", status="accepted")
    assert dashboard(client)["kpis"]["active_pipeline"] == 4


# --- needs attention ----------------------------------------------------------------------


def test_auto_closing_within_seven_days(client: TestClient, clock: FrozenClock) -> None:
    soon = create(client, "Soon")  # created now; after 24 days it has 6 days left
    clock.advance(days=4)
    later = create(client, "Later")  # 10 days left after the advance below
    create(client, "Pinned", auto_close_exempt=True)
    create(client, "Screening", status="screening")  # not eligible by default
    clock.advance(days=20)

    items = dashboard(client)["auto_closing_soon"]
    assert [a["company"] for a in items] == ["Soon"]
    assert items[0]["id"] == soon["id"]
    assert items[0]["auto_close_at"] == "2026-04-09T15:00:00Z"
    assert later["id"] not in {a["id"] for a in items}


def test_auto_closing_is_empty_when_disabled(client: TestClient, clock: FrozenClock) -> None:
    create(client)
    client.patch("/api/settings", json={"auto_close": {"enabled": False}})
    clock.advance(days=29)
    assert dashboard(client)["auto_closing_soon"] == []


def test_offers_awaiting_decision(client: TestClient, clock: FrozenClock) -> None:
    first = create(client, "First")
    clock.advance(days=1)
    second = create(client, "Second")
    move(client, second, "offer")
    clock.advance(days=1)
    move(client, first, "offer")  # the older offer is Second's
    create(client, "Archived", status="offer", archived=True)
    create(client, "Taken", status="accepted")
    offers = dashboard(client)["offers_awaiting_decision"]
    assert [a["company"] for a in offers] == ["Second", "First"]


# --- activity -----------------------------------------------------------------------------


def test_recent_activity_newest_first(client: TestClient, clock: FrozenClock) -> None:
    acme = create(client, "Acme")
    clock.advance(hours=1)
    create(client, "Globex")
    clock.advance(hours=1)
    move(client, acme, "screening")
    activity = dashboard(client)["recent_activity"]
    assert [(a["company"], a["from_status"], a["to_status"]) for a in activity] == [
        ("Acme", "applied", "screening"),
        ("Globex", None, "applied"),
        ("Acme", None, "applied"),
    ]
    assert activity[0]["application_id"] == acme["id"]
    assert activity[0]["changed_at"] == "2026-03-10T17:00:00Z"


def test_recent_activity_is_capped(client: TestClient) -> None:
    for i in range(20):
        create(client, f"Co {i}")
    assert len(dashboard(client)["recent_activity"]) == 15


def test_dashboard_matches_the_applications_api(client: TestClient, clock: FrozenClock) -> None:
    """Phase 4 AC: dashboard numbers agree with what the list API returns."""
    for i, status in enumerate(["applied", "screening", "offer", "saved", "accepted"]):
        create(client, f"Co {i}", status=status, date_applied="2026-03-09")
    listed = client.get(
        "/api/applications",
        params={"status": ["applied", "screening", "interviewing", "offer"]},
    ).json()
    this_week = client.get(
        "/api/applications", params={"from": "2026-03-09", "to": "2026-03-15"}
    ).json()
    kpis = dashboard(client)["kpis"]
    assert kpis["active_pipeline"] == listed["total"] == 3
    # The list includes the saved row (it has a date because it was created with one);
    # applied counts exclude wishlist entries.
    assert kpis["applied_this_week"] == this_week["total"] - 1 == 4
