"""system settings service: per-key upsert + masked api-key surface."""

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
}


def _get_setting(db: Session, key: str) -> str:
    """get a single setting value, falling back to default."""
    row = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if row:
        return row.value or SETTINGS_DEFAULTS.get(key, "")
    return SETTINGS_DEFAULTS.get(key, "")


# fields blanked for non-super-admin callers on the widened (operator-readable)
# GET path so credentials never leak. elevation_api_key blanks to None, the rest to "".
SENSITIVE_SETTINGS_FIELDS = {
    "cesium_ion_token": "",
    "elevation_api_url": "",
    "elevation_api_key": None,
}


def get_system_settings(db: Session, *, is_super_admin: bool = True) -> dict:
    """get all system settings as a dict; api key is masked when set.

    non-super-admin callers get the sensitive credential fields blanked.
    """
    raw_key = _get_setting(db, "elevation_api_key")
    api_key_view = ELEVATION_API_KEY_MASK if raw_key else None
    result = {
        "maintenance_mode": _get_setting(db, "maintenance_mode") == "true",
        "cesium_ion_token": _get_setting(db, "cesium_ion_token"),
        "elevation_api_url": _get_setting(db, "elevation_api_url"),
        "elevation_api_fallback_enabled": _get_setting(db, "elevation_api_fallback_enabled")
        == "true",
        "elevation_api_provider": _get_setting(db, "elevation_api_provider")
        or DEFAULT_REMOTE_PROVIDER_KEY,
        "elevation_api_key": api_key_view,
    }
    if not is_super_admin:
        result.update(SENSITIVE_SETTINGS_FIELDS)
    return result


def _collect_setting_updates(
    maintenance_mode: bool | None,
    cesium_ion_token: str | None,
    elevation_api_url: str | None,
    elevation_api_fallback_enabled: bool | None,
    elevation_api_provider: str | None,
    elevation_api_key: str | None,
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
) -> dict:
    """upsert system settings; api key is encrypted at rest before persist."""
    updates = _collect_setting_updates(
        maintenance_mode,
        cesium_ion_token,
        elevation_api_url,
        elevation_api_fallback_enabled,
        elevation_api_provider,
        elevation_api_key,
    )
    _upsert_settings(db, user_id, updates)

    db.flush()

    return get_system_settings(db)


def is_maintenance_mode(db: Session) -> bool:
    """check if maintenance mode is enabled via system_settings table."""
    return _get_setting(db, "maintenance_mode") == "true"
