"""RFC 9457 Problem Details for every API error (see PLAN.md §8)."""

from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"


class FieldError(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    errors: list[FieldError] | None = None


def problem_responses(*statuses: int, **models: type[Problem]) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses` for routers, so error shapes are part of the generated types.

    Pass `status_409=SomeProblem` to document a problem with extension members.
    """
    return {
        status: {"model": models.get(f"status_{status}", Problem), "content": {PROBLEM_JSON: {}}}
        for status in statuses
    }


PROBLEM_RESPONSES = problem_responses(404, 409, 422)


class ProblemError(Exception):
    """Raise to answer with a problem that carries extension members (RFC 9457 §3.2)."""

    def __init__(self, problem: Problem) -> None:
        super().__init__(problem.detail)
        self.problem = problem


def problem_response(
    status: int, detail: str | None = None, errors: list[FieldError] | None = None
) -> JSONResponse:
    body = Problem(title=HTTPStatus(status).phrase, status=status, detail=detail, errors=errors)
    return _render(body)


def _render(problem: Problem) -> JSONResponse:
    return JSONResponse(
        problem.model_dump(mode="json", exclude_none=True),
        status_code=problem.status,
        media_type=PROBLEM_JSON,
    )


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def problem_error(_request: Request, exc: ProblemError) -> JSONResponse:
        return _render(exc.problem)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else None
        response = problem_response(exc.status_code, detail)
        if isinstance(exc, HTTPException) and exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            FieldError(
                loc=list(err.get("loc", ())),
                msg=str(err.get("msg", "")),
                type=str(err.get("type", "")),
            )
            for err in jsonable_encoder(exc.errors())
        ]
        return problem_response(422, "Request validation failed", errors)
