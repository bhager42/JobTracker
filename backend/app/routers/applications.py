from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, selectinload

from app.clock import Clock, get_clock
from app.db import get_session
from app.enums import Source, Status, WorkMode
from app.models import Application
from app.problems import PROBLEM_RESPONSES
from app.schemas import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationOut,
    ApplicationPage,
    ApplicationUpdate,
    BulkAction,
    BulkResult,
    DocumentLinks,
    StatusChange,
)
from app.services import applications as svc
from app.services import documents as doc_svc

router = APIRouter(prefix="/api/applications", tags=["applications"], responses=PROBLEM_RESPONSES)

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def _get_or_404(session: Session, app_id: int) -> Application:
    app = session.get(
        Application,
        app_id,
        options=[selectinload(Application.history), selectinload(Application.documents)],
    )
    if app is None:
        raise HTTPException(404, f"Application {app_id} not found")
    return app


@router.get("")
def list_applications(
    session: SessionDep,
    status: Annotated[list[Status] | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    source: Annotated[list[Source] | None, Query()] = None,
    work_mode: Annotated[list[WorkMode] | None, Query()] = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    archived: svc.ArchivedFilter = "exclude",
    sort: svc.SortKey = "-date_applied",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ApplicationPage:
    filters = svc.ApplicationFilter(
        statuses=status,
        q=q,
        sources=source,
        work_modes=work_mode,
        date_from=date_from,
        date_to=date_to,
        archived=archived,
    )
    items, total = svc.list_applications(session, filters, sort, page, page_size)
    return ApplicationPage(
        items=[ApplicationOut.model_validate(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", status_code=201)
def create_application(
    data: ApplicationCreate, session: SessionDep, clock: ClockDep
) -> ApplicationDetail:
    try:
        app = svc.create_application(session, data, clock())
    except doc_svc.UnknownDocuments as exc:
        raise HTTPException(422, str(exc)) from exc
    session.refresh(app, attribute_names=["documents"])
    return ApplicationDetail.model_validate(app)


@router.get("/{app_id}")
def get_application(app_id: int, session: SessionDep) -> ApplicationDetail:
    return ApplicationDetail.model_validate(_get_or_404(session, app_id))


@router.patch("/{app_id}")
def update_application(
    app_id: int, data: ApplicationUpdate, session: SessionDep, clock: ClockDep
) -> ApplicationDetail:
    app = _get_or_404(session, app_id)
    try:
        svc.update_application(session, app, data, clock())
    except svc.ValidationFailed as exc:
        raise HTTPException(422, str(exc)) from exc
    return ApplicationDetail.model_validate(app)


@router.delete("/{app_id}", status_code=204)
def delete_application(app_id: int, session: SessionDep) -> Response:
    session.delete(_get_or_404(session, app_id))
    session.commit()
    return Response(status_code=204)


@router.post("/{app_id}/status")
def change_status(
    app_id: int, data: StatusChange, session: SessionDep, clock: ClockDep
) -> ApplicationDetail:
    app = _get_or_404(session, app_id)
    svc.change_status(
        app,
        data.status,
        now=clock(),
        note=data.note,
        interview_rounds=data.interview_rounds,
    )
    session.commit()
    return ApplicationDetail.model_validate(app)


@router.put("/{app_id}/documents")
def set_documents(app_id: int, data: DocumentLinks, session: SessionDep) -> ApplicationDetail:
    """Replaces the attached documents with exactly `document_ids`."""
    app = _get_or_404(session, app_id)
    before = list(app.documents)
    try:
        doc_svc.set_application_documents(session, app, data.document_ids)
    except doc_svc.UnknownDocuments as exc:
        raise HTTPException(422, str(exc)) from exc
    session.commit()
    session.refresh(app, attribute_names=["documents"])  # reload in display order
    doc_svc.refresh_counts(session, [*before, *app.documents])
    return ApplicationDetail.model_validate(app)


@router.post("/bulk")
def bulk_action(data: BulkAction, session: SessionDep, clock: ClockDep) -> BulkResult:
    now = clock()
    ids = list(dict.fromkeys(data.ids))
    match data.action:
        case "set_status" if data.payload is not None:  # the schema requires a payload here
            affected = svc.bulk_set_status(
                session,
                ids,
                data.payload.status,
                now,
                note=data.payload.note,
                interview_rounds=data.payload.interview_rounds,
            )
        case "archive" | "unarchive":
            affected = svc.bulk_set_archived(session, ids, data.action == "archive", now)
        case "delete":
            affected = svc.bulk_delete(session, ids)
        case _:
            raise HTTPException(422, "set_status requires a payload")
    return BulkResult(affected=affected)
