import os
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.clock import get_clock
from app.config import Settings
from app.main import create_app

# Pin the container TZ so "today" and bucketing are deterministic on any machine.
os.environ["TZ"] = "America/Chicago"
time.tzset()


class FrozenClock:
    """A controllable clock. Tests move time with `advance` or by setting `now`."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", static_dir=tmp_path / "static")


@pytest.fixture
def clock() -> FrozenClock:
    # 15:00 UTC on a Tuesday is 10:00 in Chicago, the same calendar day.
    return FrozenClock(datetime(2026, 3, 10, 15, 0, tzinfo=UTC))


@pytest.fixture
def client(settings: Settings, clock: FrozenClock) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_clock] = lambda: clock
    with TestClient(app) as c:
        yield c
