"""Request hardening (PLAN.md §9): body limits, Host allowlist, cross-site guard, headers."""

from urllib.parse import urlsplit

from fastapi import HTTPException
from starlette.responses import Response
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
    Upload paths get their own limits; everything else is JSON and stays small.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        default_limit: int,
        upload_limits: dict[str, int],
    ) -> None:
        self.app = app
        self.default_limit = default_limit
        self.upload_limits = upload_limits

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.upload_limits.get(scope["path"], self.default_limit)
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


# --- Host allowlist (DNS rebinding) ---------------------------------------------------------

# Loopback names are always accepted: a rebinding attack can point a domain at 127.0.0.1, but
# the browser still sends that domain as the Host, never "127.0.0.1". Allowing them keeps the
# container healthcheck working whatever ALLOWED_HOSTS says.
LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})


def hostname_of(host: str) -> str:
    """ "truenas.local:30420" → "truenas.local"; "[::1]:8080" → "::1"."""
    host = host.strip().lower()
    if host.startswith("["):
        return host[1 : host.find("]")] if "]" in host else host
    if host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host.rstrip(".")


def host_allowed(hostname: str, allowed: list[str]) -> bool:
    if hostname in LOOPBACK:
        return True
    for pattern in (a.lower() for a in allowed):
        if pattern == "*" or hostname == pattern:
            return True
        if pattern.startswith("*.") and hostname.endswith(pattern[1:]):
            return True
    return False


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return str(value.decode("latin-1"))
    return None


class HostCheckMiddleware:
    """Rejects requests whose Host isn't in ALLOWED_HOSTS with 400 (PLAN.md §9.1)."""

    def __init__(self, app: ASGIApp, *, allowed_hosts: list[str]) -> None:
        self.app = app
        self.allowed = allowed_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            host = _header(scope, b"host") or ""
            if not host_allowed(hostname_of(host), self.allowed):
                response = problem_response(
                    400, "Unknown Host. Add it to ALLOWED_HOSTS to reach JobTracker by this name."
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


# --- Cross-site request guard (CSRF) ---------------------------------------------------------

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
REQUIRED_HEADER = (b"x-requested-with", "jobtracker")
ALLOWED_BODY_TYPES = ("application/json", "multipart/form-data")


class CsrfMiddleware:
    """Guards state-changing API calls (PLAN.md §9.1):

    - an `Origin` (or, failing that, `Referer`) from a host not in ALLOWED_HOSTS is refused;
    - the request must carry `X-Requested-With: jobtracker`. A cross-site page can only send a
      custom header after a CORS preflight, which fails because no CORS is enabled;
    - a body must be JSON or multipart, never a form/text type a plain HTML form can send.
    """

    def __init__(self, app: ASGIApp, *, allowed_hosts: list[str]) -> None:
        self.app = app
        self.allowed = allowed_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] not in SAFE_METHODS
            and scope["path"].startswith("/api/")
        ):
            problem = self._check(scope)
            if problem is not None:
                await problem(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _check(self, scope: Scope) -> Response | None:
        for name in (b"origin", b"referer"):
            value = _header(scope, name)
            if value is None:
                continue
            host = urlsplit(value).hostname if value != "null" else None
            if not host or not host_allowed(host.lower(), self.allowed):
                return problem_response(403, "Cross-origin request refused")
            break  # Origin wins over Referer when both are present
        if (_header(scope, REQUIRED_HEADER[0]) or "").lower() != REQUIRED_HEADER[1]:
            return problem_response(403, "Missing X-Requested-With: jobtracker header")
        if _has_body(scope):
            content_type = (_header(scope, b"content-type") or "").split(";")[0].strip().lower()
            if content_type not in ALLOWED_BODY_TYPES:
                return problem_response(415, "Send JSON or multipart/form-data")
        return None


def _has_body(scope: Scope) -> bool:
    length = _header(scope, b"content-length")
    if length is not None:
        return length.strip() not in ("", "0")
    return _header(scope, b"transfer-encoding") is not None


# --- Security headers -------------------------------------------------------------------------

# 'unsafe-inline' is for styles only: Radix positions popovers with style attributes and the
# chart component emits a <style> block. Scripts stay strictly same-origin.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self'",  # the sandboxed PDF preview
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
    ]
)
SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = tuple(
    (k.encode(), v.encode())
    for k, v in (
        ("content-security-policy", CONTENT_SECURITY_POLICY),
        ("x-frame-options", "DENY"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        (
            "permissions-policy",
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), "
            "microphone=(), payment=(), usb=()",
        ),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
    )
)


class SecurityHeadersMiddleware:
    """Adds security headers to every response (PLAN.md §9.4). A route that sets its own
    (the inline PDF preview's sandbox CSP and SAMEORIGIN framing) keeps them. API responses
    are never cached, since they hold personal data."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_api = scope["path"].startswith("/api/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in SECURITY_HEADERS if k not in present]
                if is_api and b"cache-control" not in present:
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
