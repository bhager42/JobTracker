"""Optional single-password login (PLAN.md §9.2), on when AUTH_PASSWORD(_FILE) is set.

Sessions are stateless signed cookies: an expiry and a nonce, signed with HMAC-SHA256. The key
mixes a secret kept in the data dir (so sessions survive restarts) with a fingerprint of the
password (so changing the password signs everyone out). The cookie is HttpOnly and
SameSite=Strict, and Secure whenever the request came over HTTPS.
"""

import base64
import hashlib
import hmac
import logging
import os
import secrets
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.types import ASGIApp, Receive, Scope, Send

from app.clock import Clock, get_clock
from app.problems import problem_response, problem_responses
from app.schemas import OutputModel

log = logging.getLogger(__name__)

COOKIE = "jobtracker_session"
SESSION_TTL = timedelta(days=30)
# Reachable without a session: the healthcheck and the login flow itself.
PUBLIC_API_PATHS = frozenset(
    {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/logout"}
)


def load_or_create_secret(path: Path) -> bytes:
    """A 32-byte signing secret, created once (owner-only permissions) in the data dir."""
    try:
        secret = path.read_bytes()
        if len(secret) >= 32:
            return secret
    except FileNotFoundError:
        pass
    secret = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(secret)
    return secret


class LoginRateLimiter:
    """Allows `max_failures` wrong passwords per client per `window`; success resets it."""

    def __init__(self, max_failures: int = 5, window: timedelta = timedelta(minutes=15)) -> None:
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque[datetime]] = {}

    def retry_after(self, client: str, now: datetime) -> int | None:
        """Seconds until this client may try again, or None if it may try now."""
        failures = self._failures.get(client)
        if not failures:
            return None
        while failures and now - failures[0] >= self.window:
            failures.popleft()
        if not failures:
            del self._failures[client]
            return None
        if len(failures) < self.max_failures:
            return None
        return max(1, int((failures[0] + self.window - now).total_seconds()) + 1)

    def record_failure(self, client: str, now: datetime) -> None:
        self._failures.setdefault(client, deque()).append(now)

    def reset(self, client: str) -> None:
        self._failures.pop(client, None)


@dataclass
class Authenticator:
    password: str
    secret: bytes
    limiter: LoginRateLimiter = field(default_factory=LoginRateLimiter)
    _hasher: PasswordHasher = field(default_factory=PasswordHasher, repr=False)

    def __post_init__(self) -> None:
        # Only the argon2 hash is kept for verifying; the fingerprint ties sessions to it.
        self._hash = self._hasher.hash(self.password)
        fingerprint = hashlib.sha256(self.password.encode()).digest()
        self._key = hmac.new(self.secret, b"session:" + fingerprint, hashlib.sha256).digest()
        del self.password

    def check_password(self, attempt: str) -> bool:
        try:
            return self._hasher.verify(self._hash, attempt)
        except VerificationError:
            return False

    def issue(self, now: datetime) -> str:
        expires = int((now + SESSION_TTL).timestamp())
        payload = f"{expires}.{secrets.token_urlsafe(16)}".encode()
        return f"{_b64(payload)}.{_b64(self._sign(payload))}"

    def valid(self, token: str | None, now: datetime) -> bool:
        if not token or token.count(".") != 1:
            return False
        payload_b64, sig_b64 = token.split(".")
        try:
            payload, sig = _unb64(payload_b64), _unb64(sig_b64)
            expires = int(payload.split(b".", 1)[0])
        except ValueError:
            return False
        return hmac.compare_digest(sig, self._sign(payload)) and now.timestamp() < expires

    def _sign(self, payload: bytes) -> bytes:
        return hmac.new(self._key, payload, hashlib.sha256).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except Exception as exc:
        raise ValueError("bad base64") from exc


def session_cookie(scope: Scope) -> str | None:
    for key, value in scope.get("headers", []):
        if key == b"cookie":
            for part in str(value.decode("latin-1")).split(";"):
                name, _, val = part.strip().partition("=")
                if name == COOKIE:
                    return val
    return None


class AuthMiddleware:
    """When auth is on, every API route except the public ones needs a valid session.
    The SPA's static files stay public: they hold no data, and they include the login page."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            auth: Authenticator | None = scope["app"].state.auth
            if (
                auth is not None
                and scope["path"] not in PUBLIC_API_PATHS
                and not auth.valid(session_cookie(scope), scope["app"].state.clock())
            ):
                await problem_response(401, "Sign in to continue")(scope, receive, send)
                return
        await self.app(scope, receive, send)


# --- routes -------------------------------------------------------------------------------

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthStatus(OutputModel):
    enabled: bool
    authenticated: bool


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: Annotated[str, Field(min_length=1, max_length=1024)]


def _auth(request: Request) -> Authenticator | None:
    auth: Authenticator | None = request.app.state.auth
    return auth


AuthDep = Annotated[Authenticator | None, Depends(_auth)]
ClockDep = Annotated[Clock, Depends(get_clock)]


@router.get("/status")
def status(request: Request, auth: AuthDep, clock: ClockDep) -> AuthStatus:
    if auth is None:
        return AuthStatus(enabled=False, authenticated=True)
    return AuthStatus(enabled=True, authenticated=auth.valid(request.cookies.get(COOKIE), clock()))


@router.post("/login", status_code=204, responses=problem_responses(401, 404, 429))
def login(
    body: LoginRequest, request: Request, response: Response, auth: AuthDep, clock: ClockDep
) -> None:
    if auth is None:
        raise HTTPException(404, "Sign-in is not enabled")
    now = clock()
    client = request.client.host if request.client else "unknown"
    wait = auth.limiter.retry_after(client, now)
    if wait is not None:
        raise HTTPException(
            429,
            f"Too many wrong passwords. Try again in {wait // 60 + 1} minutes.",
            headers={"Retry-After": str(wait)},
        )
    if not auth.check_password(body.password):
        auth.limiter.record_failure(client, now)
        log.warning("Failed sign-in from %s", client)
        raise HTTPException(401, "Wrong password")
    auth.limiter.reset(client)
    response.set_cookie(
        COOKIE,
        auth.issue(now),
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    response.delete_cookie(
        COOKIE, httponly=True, samesite="strict", secure=request.url.scheme == "https", path="/"
    )
