import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.migrate import upgrade_to_head
from app.problems import install_problem_handlers
from app.routers import applications, health

log = logging.getLogger("jobtracker")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        upgrade_to_head(settings.database_url)
        engine = make_engine(settings.database_url)
        with engine.connect():
            pass  # connect once so pragmas (notably WAL, which persists in the file) apply now
        app.state.engine = engine
        app.state.session_factory = make_session_factory(engine)
        log.info("JobTracker %s started; data dir %s", settings.app_version, settings.data_dir)
        yield
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
    install_problem_handlers(app)
    app.include_router(health.router)
    app.include_router(applications.router)

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
