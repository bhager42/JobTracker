"""Request hardening (PLAN.md §9). Phase 6 adds Host/Origin checks and security headers."""

from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.problems import problem_response


class _BodyTooLarge(HTTPException):
    """An HTTPException, so FastAPI's body parsing re-raises it (anything else becomes a 400)
    and the problem handler renders it as a 413."""

    def __init__(self, limit: int) -> None:
        super().__init__(413, _too_large_detail(limit), headers={"Connection": "close"})


def _too_large_detail(limit: int) -> str:
    return f"Request body is larger than {limit / (1024 * 1024):.0f} MB"


class BodySizeLimitMiddleware:
    """Rejects request bodies over a limit with 413, counting bytes as they stream in.

    Checking while streaming (not just `Content-Length`) matters: without it, a chunked or
    lying request would be spooled to disk in full before the upload handler saw it.
    Upload paths get a larger limit; everything else is JSON and stays small.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        default_limit: int,
        upload_limit: int,
        upload_paths: frozenset[str],
    ) -> None:
        self.app = app
        self.default_limit = default_limit
        self.upload_limit = upload_limit
        self.upload_paths = upload_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.upload_limit if scope["path"] in self.upload_paths else self.default_limit
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > limit
                except ValueError:
                    too_big = False
                if too_big:
                    await self._reject(scope, receive, send, limit)
                    return

        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge(limit)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if started:
                raise
            await self._reject(scope, receive, send, limit)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send, limit: int) -> None:
        response = problem_response(413, _too_large_detail(limit))
        response.headers["Connection"] = "close"
        await response(scope, receive, send)
