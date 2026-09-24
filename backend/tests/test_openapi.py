import json
from pathlib import Path

from app.config import Settings
from app.main import create_app

GENERATED = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api" / "openapi.json"


def test_frontend_api_types_are_current(settings: Settings) -> None:
    """Fails when the API changes without `pnpm gen:api` (CLAUDE.md)."""
    assert json.loads(GENERATED.read_text()) == create_app(settings).openapi(), (
        "Run `pnpm gen:api` in frontend/"
    )
