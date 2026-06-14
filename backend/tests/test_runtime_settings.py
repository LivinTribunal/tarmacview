"""tests for the runtime_settings in-process cache (provider + api key keys)."""

from unittest.mock import MagicMock

import pytest

from app.services import runtime_settings


@pytest.fixture(autouse=True)
def _reset_runtime_cache():
    """ensure each test starts with an empty in-process cache."""
    runtime_settings._CACHE.clear()
    yield
    runtime_settings._CACHE.clear()


def test_get_api_provider_lazy_loads_and_caches(monkeypatch):
    """first call hits the DB loader; subsequent calls read from cache."""
    db = MagicMock()
    calls: list[str] = []

    def _fake_loader(_db):
        """count the loader invocations."""
        calls.append("loaded")
        return "OPEN_ELEVATION"

    monkeypatch.setattr(runtime_settings, "_load_api_provider", _fake_loader)

    assert runtime_settings.get_api_provider(db) == "OPEN_ELEVATION"
    assert runtime_settings.get_api_provider(db) == "OPEN_ELEVATION"
    assert calls == ["loaded"]


def test_get_api_key_lazy_loads_and_caches(monkeypatch):
    """first call hits the DB loader; subsequent calls read from cache (None included)."""
    db = MagicMock()
    calls: list[str] = []

    def _fake_loader(_db):
        """count the loader invocations and return None to assert the sentinel path."""
        calls.append("loaded")
        return None

    monkeypatch.setattr(runtime_settings, "_load_api_key", _fake_loader)

    assert runtime_settings.get_api_key(db) is None
    assert runtime_settings.get_api_key(db) is None
    # None was cached, so the loader fires exactly once even though the value is falsy
    assert calls == ["loaded"]


def test_invalidate_drops_provider_and_key():
    """invalidate(key) drops a single key; invalidate() drops everything."""
    runtime_settings._CACHE["elevation_api_provider"] = "OPEN_ELEVATION"
    runtime_settings._CACHE["elevation_api_key"] = "tok"
    runtime_settings._CACHE["elevation_api_fallback_enabled"] = True

    runtime_settings.invalidate("elevation_api_provider")
    assert "elevation_api_provider" not in runtime_settings._CACHE
    assert "elevation_api_key" in runtime_settings._CACHE
    assert "elevation_api_fallback_enabled" in runtime_settings._CACHE

    runtime_settings.invalidate()
    assert runtime_settings._CACHE == {}
