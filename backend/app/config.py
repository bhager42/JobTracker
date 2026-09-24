from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment variables (see PLAN.md §10)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = Path("/data")
    port: int = Field(default=8080, ge=1, le=65535)
    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1"]
    auto_close_days_default: int = Field(default=30, ge=1, le=365)
    max_upload_mb: int = Field(default=10, ge=1, le=100)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    app_version: str = "0.1.0"
    build_sha: str = "dev"
    static_dir: Path = Path(__file__).resolve().parent.parent / "static"

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def _split_hosts(cls, value: object) -> object:
        if isinstance(value, str):
            return [h.strip() for h in value.split(",") if h.strip()]
        return value

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jobtracker.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
