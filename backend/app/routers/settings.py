from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.clock import Clock, get_clock
from app.config import Settings, get_settings
from app.db import get_session
from app.problems import problem_responses
from app.schemas import AboutOut, AutoCloseRunResult, SettingsOut, SettingsUpdate
from app.services import app_settings, auto_close

router = APIRouter(prefix="/api", tags=["settings"])

SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/settings")
def get_app_settings(session: SessionDep) -> SettingsOut:
    return SettingsOut(auto_close=app_settings.load_auto_close(session))


@router.patch("/settings", responses=problem_responses(422))
def update_app_settings(data: SettingsUpdate, session: SessionDep) -> SettingsOut:
    if data.auto_close is not None:
        app_settings.update_auto_close(session, data.auto_close)
    return get_app_settings(session)


@router.post("/automation/auto-close/run")
def run_auto_close_now(
    session: SessionDep, clock: Annotated[Clock, Depends(get_clock)]
) -> AutoCloseRunResult:
    """Runs the auto-close rule now (it also runs at startup and hourly). Respects the
    enabled toggle: when auto-close is off, nothing is closed."""
    cfg = app_settings.load_auto_close(session)
    ids = auto_close.run_auto_close(session, clock(), cfg)
    return AutoCloseRunResult(enabled=cfg.enabled, closed=len(ids), application_ids=ids)


@router.get("/about")
def about(settings: Annotated[Settings, Depends(get_settings)]) -> AboutOut:
    return AboutOut(
        version=settings.app_version,
        build_sha=settings.build_sha,
        data_dir=str(settings.data_dir),
    )
