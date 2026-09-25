from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.clock import Clock, get_clock
from app.db import get_session
from app.routers.applications import AutoCloseDep, application_out
from app.schemas import ActivityItem, DashboardKpis, DashboardOut
from app.services import dashboard

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def get_dashboard(
    session: Annotated[Session, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    cfg: AutoCloseDep,
) -> DashboardOut:
    now = clock()
    return DashboardOut(
        kpis=DashboardKpis.model_validate(dashboard.kpis(session, now)),
        auto_closing_soon=[
            application_out(a, cfg) for a in dashboard.auto_closing_soon(session, now, cfg)
        ],
        offers_awaiting_decision=[
            application_out(a, cfg) for a in dashboard.offers_awaiting_decision(session)
        ],
        recent_activity=[
            ActivityItem(
                id=h.id,
                application_id=a.id,
                company=a.company,
                job_title=a.job_title,
                from_status=h.from_status,
                to_status=h.to_status,
                changed_at=h.changed_at,
                source=h.source,
                note=h.note,
            )
            for h, a in dashboard.recent_activity(session)
        ],
    )
