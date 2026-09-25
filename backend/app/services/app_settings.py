"""User-editable settings, stored as JSON rows in the `settings` table.

Environment variables only seed first-run defaults (e.g. `AUTO_CLOSE_DAYS_DEFAULT`); after
that the database is authoritative (PLAN.md §6).
"""

import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models import AppSetting
from app.schemas import AutoCloseSettings, AutoCloseSettingsUpdate

log = logging.getLogger(__name__)

AUTO_CLOSE_KEY = "auto_close"


def seed_defaults(session: Session, *, auto_close_days: int) -> None:
    """Writes first-run defaults for any settings not stored yet."""
    if session.get(AppSetting, AUTO_CLOSE_KEY) is None:
        defaults = AutoCloseSettings(days=auto_close_days)
        session.add(AppSetting(key=AUTO_CLOSE_KEY, value=defaults.model_dump_json()))
        session.commit()


def load_auto_close(session: Session) -> AutoCloseSettings:
    row = session.get(AppSetting, AUTO_CLOSE_KEY)
    if row is None:
        return AutoCloseSettings()
    try:
        return AutoCloseSettings.model_validate_json(row.value)
    except ValidationError:
        # A hand-edited or outdated row must not take the app down; fall back and say so.
        log.exception("Invalid auto-close settings in the database; using defaults")
        return AutoCloseSettings()


def update_auto_close(session: Session, patch: AutoCloseSettingsUpdate) -> AutoCloseSettings:
    current = load_auto_close(session)
    updated = AutoCloseSettings.model_validate(
        {**current.model_dump(), **patch.model_dump(exclude_unset=True, exclude_none=True)}
    )
    save_auto_close(session, updated)
    return updated


def save_auto_close(session: Session, cfg: AutoCloseSettings, *, commit: bool = True) -> None:
    row = session.get(AppSetting, AUTO_CLOSE_KEY)
    if row is None:
        session.add(AppSetting(key=AUTO_CLOSE_KEY, value=cfg.model_dump_json()))
    else:
        row.value = cfg.model_dump_json()
    if commit:
        session.commit()
