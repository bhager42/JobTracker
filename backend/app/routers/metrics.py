from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_session
from app.enums import STATUSES_IN_ORDER, Source, Status, StatusGroup, WorkMode
from app.problems import problem_responses
from app.schemas import (
    FunnelStage,
    GroupCounts,
    MetricsBySource,
    MetricsFunnel,
    MetricsSummary,
    MetricsTimeseries,
    Outcomes,
    RoundCount,
    SourceMetrics,
    StatusCount,
    TimeseriesBucket,
)
from app.services import metrics
from app.services.metrics import MetricsFilter, rate

router = APIRouter(prefix="/api/metrics", tags=["metrics"], responses=problem_responses(422))

SessionDep = Annotated[Session, Depends(get_session)]


def metrics_filter(
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    status: Annotated[list[Status] | None, Query()] = None,
    source: Annotated[list[Source] | None, Query()] = None,
    work_mode: Annotated[list[WorkMode] | None, Query()] = None,
) -> MetricsFilter:
    """The same slice for every chart (PLAN.md §7.5: filters apply to every chart)."""
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "`from` must not be after `to`")
    return MetricsFilter(date_from, date_to, status, source, work_mode)


FilterDep = Annotated[MetricsFilter, Depends(metrics_filter)]


@router.get("/summary")
def get_summary(session: SessionDep, f: FilterDep) -> MetricsSummary:
    s = metrics.summary(session, f)
    breakdown = s.status_breakdown
    return MetricsSummary(
        total_applied=s.total_applied,
        responded=s.responded,
        interviewed=s.interviewed,
        offered=s.offered,
        accepted=s.accepted,
        response_rate=rate(s.responded, s.total_applied),
        interview_rate=rate(s.interviewed, s.total_applied),
        offer_rate=rate(s.offered, s.total_applied),
        median_days_to_first_response=s.median_days_to_first_response,
        status_breakdown=[
            StatusCount(status=st, count=breakdown[st])
            for st in STATUSES_IN_ORDER
            if breakdown.get(st)
        ],
        outcomes=Outcomes(
            rejected_no_interview=breakdown.get(Status.REJECTED_NO_INTERVIEW, 0),
            rejected_after_interview=[
                RoundCount(rounds=r, count=n)
                for r, n in s.rejected_after_interview_by_round.items()
            ],
            ghosted=breakdown.get(Status.NOT_SELECTED, 0),
            withdrawn=breakdown.get(Status.WITHDRAWN, 0),
            declined=breakdown.get(Status.DECLINED, 0),
            position_closed=breakdown.get(Status.CLOSED, 0),
        ),
    )


@router.get("/timeseries")
def get_timeseries(
    session: SessionDep,
    f: FilterDep,
    granularity: Literal["week", "month", "year"] = "month",
) -> MetricsTimeseries:
    buckets = metrics.timeseries(session, f, granularity)
    return MetricsTimeseries(
        granularity=granularity,
        buckets=[
            TimeseriesBucket(
                start=b.start,
                end=b.end,
                label=b.label,
                total=b.total,
                by_group=GroupCounts(
                    active=b.by_group[StatusGroup.ACTIVE],
                    closed_positive=b.by_group[StatusGroup.CLOSED_POSITIVE],
                    closed_neutral=b.by_group[StatusGroup.CLOSED_NEUTRAL],
                    closed_negative=b.by_group[StatusGroup.CLOSED_NEGATIVE],
                ),
            )
            for b in buckets
        ],
    )


@router.get("/funnel")
def get_funnel(session: SessionDep, f: FilterDep) -> MetricsFunnel:
    stages = metrics.funnel(session, f)
    applied = stages[0][1]
    return MetricsFunnel(
        stages=[FunnelStage(stage=s, count=n, rate=rate(n, applied)) for s, n in stages]
    )


@router.get("/by-source")
def get_by_source(session: SessionDep, f: FilterDep) -> MetricsBySource:
    return MetricsBySource(
        sources=[
            SourceMetrics(
                source=s.source,
                applications=s.applications,
                responses=s.responses,
                interviews=s.interviews,
                response_rate=rate(s.responses, s.applications),
                interview_rate=rate(s.interviews, s.applications),
            )
            for s in metrics.by_source(session, f)
        ]
    )
