"""in-process cache for system_settings rows that change behavior at runtime.

surfaces a tiny lazy-loaded view over selected keys in the ``system_settings`` table so
hot paths (the elevation provider on the trajectory call site) can read the current
value without a DB hit per call. The admin update route invalidates the cache after
``db.commit()`` so a super-admin toggle takes effect on the next request without a
restart.

env vars stay as bootstrap defaults for fresh databases; the DB row wins when present.

lives in ``app.services`` rather than ``app.core`` because reading the row requires
importing ``app.models.system_settings``, and the structural-test boundary forbids
``app.core`` from importing ``app.models``. services is the layer allowed to bridge
the two.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.models.system_settings import SystemSettings
from app.services.elevation_provider import DEFAULT_REMOTE_PROVIDER_KEY

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


# bools, strings, and Nones. widen the annotation when adding a setting with a
# different runtime type so the readers below get a type-checker prompt.
_CACHE: dict[str, Any] = {}
_LOCK = threading.Lock()


_API_FALLBACK_ENABLED_KEY = "elevation_api_fallback_enabled"
_API_PROVIDER_KEY = "elevation_api_provider"
_API_KEY_KEY = "elevation_api_key"

_DEFAULT_PROVIDER = DEFAULT_REMOTE_PROVIDER_KEY


def _load_api_fallback_enabled(db: Session) -> bool:
    """read elevation_api_fallback_enabled from system_settings, falling back to env."""
    row = db.query(SystemSettings).filter(SystemSettings.key == _API_FALLBACK_ENABLED_KEY).first()
    if row is None or row.value is None:
        return bool(settings.elevation_api_fallback_enabled)
    return str(row.value).lower() == "true"


def _load_api_provider(db: Session) -> str:
    """read elevation_api_provider from system_settings, falling back to OPEN_ELEVATION."""
    row = db.query(SystemSettings).filter(SystemSettings.key == _API_PROVIDER_KEY).first()
    if row is None or not row.value:
        return _DEFAULT_PROVIDER
    return str(row.value)


def _load_api_key(db: Session) -> str | None:
    """read encrypted elevation_api_key, decrypt, falling back to None."""
    row = db.query(SystemSettings).filter(SystemSettings.key == _API_KEY_KEY).first()
    if row is None or not row.value:
        return None
    # decryption is lazy-imported so a missing SECRET_ENCRYPTION_KEY at startup
    # does not crash bootstrap paths that never read the api key (test runs,
    # development without a configured remote provider).
    from app.core.security import decrypt_secret

    return decrypt_secret(row.value)


def get_api_fallback_enabled(db: Session) -> bool:
    """return cached elevation_api_fallback_enabled, loading from DB on first hit."""
    cached = _CACHE.get(_API_FALLBACK_ENABLED_KEY)
    if cached is not None:
        return bool(cached)

    with _LOCK:
        cached = _CACHE.get(_API_FALLBACK_ENABLED_KEY)
        if cached is not None:
            return bool(cached)
        value = _load_api_fallback_enabled(db)
        _CACHE[_API_FALLBACK_ENABLED_KEY] = value
        return value


def get_api_provider(db: Session) -> str:
    """return cached elevation_api_provider, loading from DB on first hit."""
    cached = _CACHE.get(_API_PROVIDER_KEY)
    if cached is not None:
        return str(cached)

    with _LOCK:
        cached = _CACHE.get(_API_PROVIDER_KEY)
        if cached is not None:
            return str(cached)
        value = _load_api_provider(db)
        _CACHE[_API_PROVIDER_KEY] = value
        return value


def get_api_key(db: Session) -> str | None:
    """return cached elevation_api_key (decrypted), loading from DB on first hit."""
    # sentinel allows None to be a valid cached value (no key configured)
    if _API_KEY_KEY in _CACHE:
        return _CACHE[_API_KEY_KEY]

    with _LOCK:
        if _API_KEY_KEY in _CACHE:
            return _CACHE[_API_KEY_KEY]
        value = _load_api_key(db)
        _CACHE[_API_KEY_KEY] = value
        return value


def invalidate(key: str | None = None) -> None:
    """drop cached entries. pass a key to invalidate just one, omit for everything."""
    with _LOCK:
        if key is None:
            _CACHE.clear()
        else:
            _CACHE.pop(key, None)
