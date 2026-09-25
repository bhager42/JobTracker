from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app
from app.migrate import alembic_config
from tests.conftest import api_client


def test_health_ok(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"


def test_startup_creates_data_dirs_and_migrates(client: TestClient, settings: Settings) -> None:
    assert settings.db_path.is_file()
    assert settings.uploads_dir.is_dir()
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        head = ScriptDirectory.from_config(alembic_config(settings.database_url)).get_current_head()
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"


def test_allowed_hosts_parsed_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_HOSTS", "truenas.local, 192.168.1.10")
    assert Settings().allowed_hosts == ["truenas.local", "192.168.1.10"]


def test_spa_fallback_serves_index(tmp_path: Path) -> None:
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>JobTracker</title>")
    (static / "assets" / "app.js").write_text("console.log(1)")
    (static / "favicon.svg").write_text("<svg/>")
    settings = Settings(data_dir=tmp_path / "data", static_dir=static)
    with api_client(create_app(settings)) as c:
        assert "JobTracker" in c.get("/applications/42").text
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/favicon.svg").text == "<svg/>"
        assert c.get("/api/nope").status_code == 404
        assert "JobTracker" in c.get("/..%2F..%2Fetc/passwd").text


def test_migrations_match_models(client: TestClient, settings: Settings) -> None:
    """Fails when a model changes without a migration (CLAUDE.md: every schema change needs one)."""
    from alembic.autogenerate import compare_metadata
    from alembic.runtime.migration import MigrationContext

    from app.models import Base

    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []
