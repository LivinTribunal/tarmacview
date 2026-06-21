"""system settings service: per-key upsert + masked api-key surface."""

from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import DomainError
from app.models.system_settings import SystemSettings
from app.schemas.admin import ELEVATION_API_KEY_MASK
from app.services.elevation_provider import (
    DEFAULT_REMOTE_PROVIDER_KEY,
    REMOTE_PROVIDER_REGISTRY,
)

SETTINGS_DEFAULTS = {
    "maintenance_mode": "false",
    "cesium_ion_token": "",
    "elevation_api_url": "https://api.open-elevation.com",
    "elevation_api_fallback_enabled": "false",
    "elevation_api_provider": DEFAULT_REMOTE_PROVIDER_KEY,
    "elevation_api_key": "",
    "backup_enabled": "false",
    "backup_interval_hours": "24",
    "backup_retention_count": "3",
    "last_backup_at": "",
    "last_backup_status": "",
}


def _parse_dt(raw: str) -> datetime | None:
    """parse a stored iso timestamp; None on empty or unparseable value."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _get_setting(db: Session, key: str) -> str:
    """get a single setting value, falling back to default."""
    row = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if row:
        return row.value or SETTINGS_DEFAULTS.get(key, "")
    return SETTINGS_DEFAULTS.get(key, "")


def get_system_settings(db: Session) -> dict:
    """get all system settings as a dict; api key is masked when set."""
    raw_key = _get_setting(db, "elevation_api_key")
    api_key_view = ELEVATION_API_KEY_MASK if raw_key else None
    return {
        "maintenance_mode": _get_setting(db, "maintenance_mode") == "true",
        "cesium_ion_token": _get_setting(db, "cesium_ion_token"),
        "elevation_api_url": _get_setting(db, "elevation_api_url"),
        "elevation_api_fallback_enabled": _get_setting(db, "elevation_api_fallback_enabled")
        == "true",
        "elevation_api_provider": _get_setting(db, "elevation_api_provider")
        or DEFAULT_REMOTE_PROVIDER_KEY,
        "elevation_api_key": api_key_view,
        "backup_enabled": _get_setting(db, "backup_enabled") == "true",
        "backup_interval_hours": int(_get_setting(db, "backup_interval_hours") or 24),
        "backup_retention_count": int(_get_setting(db, "backup_retention_count") or 3),
        "last_backup_at": _parse_dt(_get_setting(db, "last_backup_at")),
        "last_backup_status": _get_setting(db, "last_backup_status") or None,
    }


def _collect_setting_updates(
    maintenance_mode: bool | None,
    cesium_ion_token: str | None,
    elevation_api_url: str | None,
    elevation_api_fallback_enabled: bool | None,
    elevation_api_provider: str | None,
    elevation_api_key: str | None,
    backup_enabled: bool | None,
    backup_interval_hours: int | None,
    backup_retention_count: int | None,
) -> dict[str, str]:
    """build the key->value update map from the supplied settings fields."""
    updates: dict[str, str] = {}
    if maintenance_mode is not None:
        updates["maintenance_mode"] = str(maintenance_mode).lower()
    if cesium_ion_token is not None:
        updates["cesium_ion_token"] = cesium_ion_token
    if elevation_api_url is not None:
        updates["elevation_api_url"] = elevation_api_url
    if elevation_api_fallback_enabled is not None:
        updates["elevation_api_fallback_enabled"] = str(elevation_api_fallback_enabled).lower()
    if elevation_api_provider is not None:
        if elevation_api_provider not in REMOTE_PROVIDER_REGISTRY:
            raise DomainError(
                f"unknown elevation_api_provider: {elevation_api_provider}", status_code=422
            )
        updates["elevation_api_provider"] = elevation_api_provider
    if elevation_api_key is not None and elevation_api_key != ELEVATION_API_KEY_MASK:
        if elevation_api_key == "":
            # explicit clear - persist empty string so the runtime cache reloads to None
            updates["elevation_api_key"] = ""
        else:
            # lazy import: encrypt_secret hard-fails when SECRET_ENCRYPTION_KEY is
            # missing, which we only want to trigger when a key is actually being
            # written, not on every settings update.
            from app.core.security import encrypt_secret

            updates["elevation_api_key"] = encrypt_secret(elevation_api_key)

    # backup config - last_backup_at / last_backup_status are read-only on the api,
    # only record_backup_run writes them
    if backup_enabled is not None:
        updates["backup_enabled"] = str(backup_enabled).lower()
    if backup_interval_hours is not None:
        updates["backup_interval_hours"] = str(backup_interval_hours)
    if backup_retention_count is not None:
        updates["backup_retention_count"] = str(backup_retention_count)

    return updates


def _upsert_settings(db: Session, user_id: UUID, updates: dict[str, str]) -> None:
    """upsert each key->value pair into system_settings, stamping updated_by."""
    for key, value in updates.items():
        row = db.query(SystemSettings).filter(SystemSettings.key == key).first()
        if row:
            row.value = value
            row.updated_by = user_id
        else:
            row = SystemSettings(key=key, value=value, updated_by=user_id)
            db.add(row)


def update_system_settings(
    db: Session,
    user_id: UUID,
    maintenance_mode: bool | None = None,
    cesium_ion_token: str | None = None,
    elevation_api_url: str | None = None,
    elevation_api_fallback_enabled: bool | None = None,
    elevation_api_provider: str | None = None,
    elevation_api_key: str | None = None,
    backup_enabled: bool | None = None,
    backup_interval_hours: int | None = None,
    backup_retention_count: int | None = None,
) -> dict:
    """upsert system settings; api key is encrypted at rest before persist."""
    updates = _collect_setting_updates(
        maintenance_mode,
        cesium_ion_token,
        elevation_api_url,
        elevation_api_fallback_enabled,
        elevation_api_provider,
        elevation_api_key,
        backup_enabled,
        backup_interval_hours,
        backup_retention_count,
    )
    _upsert_settings(db, user_id, updates)

    db.flush()

    return get_system_settings(db)


def record_backup_run(db: Session, *, at: datetime, status: str) -> None:
    """stamp last_backup_at / last_backup_status after a backup run (success or failure)."""
    # background path - commits its own session (documented exception, like seeder)
    _upsert_settings(db, None, {"last_backup_at": at.isoformat(), "last_backup_status": status})
    db.commit()


def is_maintenance_mode(db: Session) -> bool:
    """check if maintenance mode is enabled via system_settings table."""
    return _get_setting(db, "maintenance_mode") == "true"
