"""tests for app.core.config startup guards."""

import logging
import warnings

import pytest

from app.core.config import DEFAULT_JWT_SECRET, Settings, _check_jwt_secret


def test_production_with_default_jwt_secret_raises():
    """production env with the built-in jwt default refuses to start."""
    s = Settings(environment="production", jwt_secret=DEFAULT_JWT_SECRET)
    with pytest.raises(RuntimeError, match="jwt_secret"):
        _check_jwt_secret(s)


def test_production_with_custom_jwt_secret_ok():
    """production env with a real jwt secret passes the guard."""
    s = Settings(environment="production", jwt_secret="a-real-secret-of-sufficient-length")
    _check_jwt_secret(s)


def test_development_with_default_jwt_secret_warns(caplog):
    """development env with the built-in default warns but does not raise."""
    s = Settings(environment="development", jwt_secret=DEFAULT_JWT_SECRET)
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _check_jwt_secret(s)
    assert any("jwt_secret" in r.message for r in caplog.records)


def test_settings_emits_no_pydantic_v1_deprecation_warning():
    """instantiating Settings does not surface PydanticDeprecatedSince20."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Settings()
    deprecations = [w for w in caught if "PydanticDeprecated" in type(w.category).__name__]
    assert deprecations == []
