from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
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
    # Optional single-password login (PLAN.md §9.2). Off when both are unset.
    auth_password: SecretStr | None = None
    auth_password_file: Path | None = None

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def _split_hosts(cls, value: object) -> object:
        if isinstance(value, str):
            return [h.strip() for h in value.split(",") if h.strip()]
        return value

    @model_validator(mode="after")
    def _check_auth(self) -> Self:
        # Fail fast on a bad auth setup rather than starting unprotected.
        if self.auth_password is not None and self.auth_password_file is not None:
            raise ValueError("set AUTH_PASSWORD or AUTH_PASSWORD_FILE, not both")
        if self.auth_password is not None and not self.auth_password.get_secret_value():
            raise ValueError("AUTH_PASSWORD is empty")
        if self.auth_password_file is not None:
            try:
                text = self.auth_password_file.read_text().strip()
            except OSError as exc:
                raise ValueError(f"cannot read AUTH_PASSWORD_FILE: {exc}") from exc
            if not text:
                raise ValueError("AUTH_PASSWORD_FILE is empty")
        return self

    @property
    def password(self) -> str | None:
        """The login password, or None when auth is off. Trailing newlines in a secrets file
        are ignored."""
        if self.auth_password is not None:
            return self.auth_password.get_secret_value()
        if self.auth_password_file is not None:
            return self.auth_password_file.read_text().strip()
        return None

    @property
    def session_key_path(self) -> Path:
        return self.data_dir / "session.key"

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
