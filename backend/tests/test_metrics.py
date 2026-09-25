from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.enums import Status
from app.models import Application
from app.services.metrics import _bucket_sql, bucket_start
from tests.conftest import FrozenClock


def create(client: TestClient, company: str = "Co", **fields: Any) -> dict[str, Any]:
    res = client.post(
        "/api/applications", json={"company": company, "job_title": "Engineer", **fields}
    )
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def move(client: TestClient, app: dict[str, Any], status: str, **extra: Any) -> None:
    res = client.post(f"/api/applications/{app['id']}/status", json={"status": status, **extra})
    assert res.status_code == 200, res.text


def get(client: TestClient, path: str, **params: Any) -> dict[str, Any]:
    res = client.get(f"/api/metrics/{path}", params=params)
    assert res.status_code == 200, res.text
    return res.json()  # type: ignore[no-any-return]


def buckets(client: TestClient, granularity: str, **params: Any) -> list[tuple[str, int]]:
    body = get(client, "timeseries", granularity=granularity, **params)
    assert body["granularity"] == granularity
    return [(b["label"], b["total"]) for b in body["buckets"]]


# --- bucketing ----------------------------------------------------------------------------


def test_sql_bucketing_matches_python_for_every_day(client: TestClient) -> None:
    """The SQLite expression and its Python twin agree across two years, including leap day
    and both year boundaries."""
    factory: sessionmaker[Session] = client.app.state.session_factory  # type: ignore[attr-defined]
    start = date(2025, 12, 1)
    days = [start + timedelta(days=i) for i in range(800)]  # to Feb 2028 (a leap year)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    with factory() as session:
        session.add_all(
            Application(
                company="x",
                job_title="y",
                date_applied=d,
                status=Status.APPLIED,
                status_changed_at=now,
                created_at=now,
                updated_at=now,
            )
            for d in days
        )
        session.commit()
        for granularity in ("week", "month", "year"):
            rows = session.execute(
                select(Application.date_applied, _bucket_sql(granularity))  # type: ignore[arg-type]
            ).all()
            assert len(rows) == len(days)
            for applied, bucket in rows:
                assert date.fromisoformat(bucket) == bucket_start(applied, granularity), (
                    granularity,
                    applied,
                )


@pytest.fixture
def boundary(client: TestClient) -> None:
    """Applications around the 2025/2026 boundary. ISO week 2026-W01 runs Mon 2025-12-29
    to Sun 2026-01-04, so its days fall in two calendar years."""
    for company, applied in [
        ("a", "2025-12-22"),  # Mon, 2025-W52
        ("b", "2025-12-28"),  # Sun, 2025-W52
        ("c", "2025-12-29"),  # Mon, 2026-W01 (but December and 2025)
        ("d", "2025-12-31"),  # Wed, 2026-W01
        ("e", "2026-01-01"),  # Thu, 2026-W01
        ("f", "2026-01-04"),  # Sun, 2026-W01
        ("g", "2026-01-05"),  # Mon, 2026-W02
        ("h", "2026-01-20"),  # Tue, 2026-W04 (W03 is empty)
    ]:
        create(client, company, date_applied=applied)
    create(client, "wishlist", status="saved")  # never counted


@pytest.mark.usefixtures("boundary")
def test_weekly_uses_iso_weeks_across_the_year_boundary(client: TestClient) -> None:
    assert buckets(client, "week") == [
        ("2025-W52", 2),
        ("2026-W01", 4),
        ("2026-W02", 1),
        ("2026-W03", 0),  # empty weeks are filled
        ("2026-W04", 1),
    ]
    body = get(client, "timeseries", granularity="week")
    w01 = body["buckets"][1]
    assert (w01["start"], w01["end"]) == ("2025-12-29", "2026-01-04")


@pytest.mark.usefixtures("boundary")
def test_monthly_and_yearly_use_calendar_periods(client: TestClient) -> None:
    assert buckets(client, "month") == [("2025-12", 4), ("2026-01", 4)]
    assert buckets(client, "year") == [("2025", 4), ("2026", 4)]


@pytest.mark.usefixtures("boundary")
def test_range_is_filled_with_empty_buckets_and_clipped(client: TestClient) -> None:
    assert buckets(client, "month", **{"from": "2025-10-15", "to": "2026-03-01"}) == [
        ("2025-10", 0),
        ("2025-11", 0),
        ("2025-12", 4),
        ("2026-01", 4),
        ("2026-02", 0),
        ("2026-03", 0),
    ]
    # "from" inside a week still reports that whole week's bucket, counting only what's in range.
    assert buckets(client, "week", **{"from": "2025-12-31", "to": "2026-01-06"}) == [
        ("2026-W01", 3),
        ("2026-W02", 1),
    ]


def test_timeseries_splits_by_current_status_group(client: TestClient) -> None:
    create(client, "active", date_applied="2026-03-02")
    ok = create(client, "ok", date_applied="2026-03-03")
    move(client, ok, "accepted")
    no = create(client, "no", date_applied="2026-03-04")
    move(client, no, "rejected_no_interview")
    gone = create(client, "gone", date_applied="2026-03-05")
    move(client, gone, "withdrawn")
    [bucket] = get(client, "timeseries", granularity="month")["buckets"]
    assert bucket["total"] == 4
    assert bucket["by_group"] == {
        "active": 1,
        "closed_positive": 1,
        "closed_neutral": 1,
        "closed_negative": 1,
    }


def test_empty_data_gives_no_buckets(client: TestClient) -> None:
    assert get(client, "timeseries", granularity="week")["buckets"] == []


def test_bad_range_and_granularity(client: TestClient) -> None:
    assert (
        client.get("/api/metrics/summary", params={"from": "2026-02-01", "to": "2026-01-01"})
    ).status_code == 422
    assert (client.get("/api/metrics/timeseries", params={"granularity": "day"})).status_code == 422


# --- summary, funnel, outcomes ------------------------------------------------------------


@pytest.fixture
def pipeline(client: TestClient, clock: FrozenClock) -> dict[str, dict[str, Any]]:
    """Eight applied applications with known histories, plus one wishlist entry. The clock
    starts Tuesday 2026-03-10 10:00 in Chicago; responses come days later."""
    apps = {name: create(client, name, date_applied="2026-03-10") for name in (
        "waiting", "ghosted", "screened_out", "direct_interview", "round2",
        "offer", "accepted", "withdrew",
    )}  # fmt: skip
    create(client, "wishlist", status="saved")

    clock.advance(days=2)  # first responses on the 12th: 2 days
    move(client, apps["screened_out"], "screening")
    move(client, apps["round2"], "screening")
    move(client, apps["offer"], "screening")
    clock.advance(days=4)  # the 16th: 6 days
    move(client, apps["direct_interview"], "interviewing", interview_rounds=1)
    move(client, apps["accepted"], "interviewing", interview_rounds=1)
    clock.advance(days=4)  # the 20th
    move(client, apps["screened_out"], "rejected_no_interview")
    move(client, apps["round2"], "interviewing", interview_rounds=1)
    move(client, apps["offer"], "interviewing", interview_rounds=1)
    move(client, apps["direct_interview"], "rejected_after_interview", interview_rounds=1)
    move(client, apps["ghosted"], "not_selected")
    move(client, apps["withdrew"], "withdrawn")
    clock.advance(days=5)
    move(client, apps["round2"], "rejected_after_interview", interview_rounds=2)
    move(client, apps["offer"], "offer")
    move(client, apps["accepted"], "offer")
    move(client, apps["accepted"], "accepted")
    return apps


@pytest.mark.usefixtures("pipeline")
def test_summary_counts_rates_and_median(client: TestClient) -> None:
    body = get(client, "summary")
    assert {k: body[k] for k in ("total_applied", "responded", "interviewed", "offered")} == {
        "total_applied": 8,
        # screened_out, direct_interview, round2, offer, accepted
        "responded": 5,
        "interviewed": 4,
        "offered": 2,
    }
    assert body["accepted"] == 1
    assert body["response_rate"] == pytest.approx(5 / 8)
    assert body["interview_rate"] == pytest.approx(4 / 8)
    assert body["offer_rate"] == pytest.approx(2 / 8)
    # First responses after 2, 2, 2, 6, 6 days.
    assert body["median_days_to_first_response"] == 2


@pytest.mark.usefixtures("pipeline")
def test_status_breakdown_and_outcomes(client: TestClient) -> None:
    body = get(client, "summary")
    assert body["status_breakdown"] == [
        {"status": "applied", "count": 1},
        {"status": "offer", "count": 1},
        {"status": "accepted", "count": 1},
        {"status": "withdrawn", "count": 1},
        {"status": "rejected_no_interview", "count": 1},
        {"status": "rejected_after_interview", "count": 2},
        {"status": "not_selected", "count": 1},
    ]
    assert body["outcomes"] == {
        "rejected_no_interview": 1,
        "rejected_after_interview": [{"rounds": 1, "count": 1}, {"rounds": 2, "count": 1}],
        "ghosted": 1,
        "withdrawn": 1,
        "declined": 0,
        "position_closed": 0,
    }


@pytest.mark.usefixtures("pipeline")
def test_funnel_counts_ever_reached_and_never_grows(client: TestClient) -> None:
    stages = get(client, "funnel")["stages"]
    assert [(s["stage"], s["count"]) for s in stages] == [
        ("applied", 8),
        # screened_out, round2, offer were screened; direct_interview and accepted skipped
        # straight to interviews but still passed the stage. A plain rejection doesn't count.
        ("screening", 5),
        ("interviewing", 4),
        ("offer", 2),
        ("accepted", 1),
    ]
    assert stages[2]["rate"] == pytest.approx(0.5)


def test_median_uses_the_container_calendar(client: TestClient, clock: FrozenClock) -> None:
    app = create(client, date_applied="2026-03-10")
    # 04:00 UTC on the 12th is still the 11th in Chicago: 1 day, not 2.
    clock.now = datetime(2026, 3, 12, 4, 0, tzinfo=UTC)
    move(client, app, "screening")
    assert get(client, "summary")["median_days_to_first_response"] == 1


def test_by_source(client: TestClient) -> None:
    for i in range(3):
        a = create(client, f"li{i}", source="linkedin")
        if i == 0:
            move(client, a, "interviewing")
    ref = create(client, "ref", source="referral")
    move(client, ref, "screening")
    create(client, "unknown")
    body = get(client, "by-source")["sources"]
    assert [(s["source"], s["applications"], s["responses"], s["interviews"]) for s in body] == [
        ("linkedin", 3, 1, 1),
        ("referral", 1, 1, 0),
        (None, 1, 0, 0),
    ]
    assert body[0]["interview_rate"] == pytest.approx(1 / 3)
    assert body[1]["response_rate"] == 1


# --- filters apply to every endpoint ------------------------------------------------------


def test_filters_apply_to_every_endpoint(client: TestClient) -> None:
    remote = create(client, "r", source="linkedin", work_mode="remote", date_applied="2026-01-05")
    move(client, remote, "interviewing")
    create(client, "o", source="linkedin", work_mode="onsite", date_applied="2026-01-06")
    create(client, "old", source="indeed", work_mode="remote", date_applied="2025-06-01")

    params = {"work_mode": "remote", "from": "2026-01-01"}
    assert get(client, "summary", **params)["total_applied"] == 1
    assert get(client, "summary", **params)["interviewed"] == 1
    assert buckets(client, "month", **params, to="2026-01-31") == [("2026-01", 1)]
    assert [s["count"] for s in get(client, "funnel", **params)["stages"]][:3] == [1, 1, 1]
    assert [s["source"] for s in get(client, "by-source", **params)["sources"]] == ["linkedin"]

    assert get(client, "summary", status="applied")["total_applied"] == 2
    assert get(client, "summary", source=["indeed", "linkedin"])["total_applied"] == 3
    assert get(client, "summary", to="2025-12-31")["total_applied"] == 1


def test_rejection_without_interview_is_not_a_screen(client: TestClient) -> None:
    app = create(client)
    move(client, app, "rejected_no_interview")
    stages = dict((s["stage"], s["count"]) for s in get(client, "funnel")["stages"])
    assert stages["applied"] == 1
    assert stages["screening"] == 0
    assert get(client, "summary")["responded"] == 1  # still a response
