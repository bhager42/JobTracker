import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import scheduler
from app.clock import Clock, utc_now
from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.migrate import upgrade_to_head
from app.problems import install_problem_handlers
from app.routers import applications, dashboard, documents, health
from app.routers import settings as settings_router
from app.security import BodySizeLimitMiddleware
from app.services.app_settings import seed_defaults
from app.services.storage import remove_stale_temp_files

log = logging.getLogger("jobtracker")


def create_app(
    settings: Settings | None = None,
    *,
    clock: Clock = utc_now,
    auto_close_interval: float = scheduler.HOURLY,
) -> FastAPI:
    """Builds the app. `clock` is used by requests and the scheduler alike, so tests can pass
    a frozen one; `auto_close_interval` is seconds between scheduled auto-close runs."""
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        remove_stale_temp_files(settings.uploads_dir)
        upgrade_to_head(settings.database_url)
        engine = make_engine(settings.database_url)
        with engine.connect():
            pass  # connect once so pragmas (notably WAL, which persists in the file) apply now
        session_factory = make_session_factory(engine)
        app.state.engine = engine
        app.state.session_factory = session_factory
        with session_factory() as session:
            seed_defaults(session, auto_close_days=settings.auto_close_days_default)
        # Migrations first, then one auto-close pass, then the hourly loop.
        scheduler.run_once(session_factory, clock)
        task = asyncio.create_task(
            scheduler.run_forever(session_factory, clock, auto_close_interval)
        )
        log.info("JobTracker %s started; data dir %s", settings.app_version, settings.data_dir)
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        engine.dispose()

    app = FastAPI(
        title="JobTracker",
        version=settings.app_version,
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.state.clock = clock
    install_problem_handlers(app)
    app.include_router(health.router)
    app.include_router(applications.router)
    app.include_router(documents.router)
    app.include_router(settings_router.router)
    app.include_router(dashboard.router)
    app.add_middleware(
        BodySizeLimitMiddleware,
        default_limit=4 * 1024 * 1024,
        # The file itself is checked exactly in storage; this allows for multipart overhead.
        upload_limit=(settings.max_upload_mb + 1) * 1024 * 1024,
        upload_paths=frozenset({"/api/documents"}),
    )

    _mount_spa(app, settings.static_dir)
    return app


def _mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend, falling back to index.html for client-side routes."""
    index = static_dir / "index.html"
    if not index.is_file():
        log.warning("No frontend build at %s; serving API only", static_dir)
        return

    assets = static_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    root = static_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        if path and candidate.is_relative_to(root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
