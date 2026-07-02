"""alembic round-trip for 0025_ils_harmonization on a fresh postgres (T3 migration)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRIOR_REVISION = "0024_agl_meht_height"


def _alembic_config() -> Config:
    """alembic config anchored at the backend dir, independent of pytest cwd."""
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return cfg


@pytest.fixture(scope="module")
def fresh_pg():
    """dedicated postgres for migration runs - never shares the app test db."""
    with PostgresContainer(image="postgres:16", username="mig", password="mig", dbname="mig") as pg:
        yield pg.get_connection_url()


@pytest.fixture
def alembic_env(fresh_pg, monkeypatch):
    """point migrations/env.py (which reads settings.database_url) at the fresh db."""
    monkeypatch.setattr(settings, "database_url", fresh_pg)
    return _alembic_config()


def _columns(url: str, table: str) -> set[str]:
    """current column names on the given table."""
    engine = create_engine(url)
    try:
        return {c["name"] for c in inspect(engine).get_columns(table)}
    finally:
        engine.dispose()


def test_ils_columns_added_and_dropped(alembic_env, fresh_pg):
    """0025 adds the 1 AGL + 4 measurement columns, drops them, re-adds on re-upgrade."""
    command.upgrade(alembic_env, "head")
    assert "ils_harmonization_tolerance" in _columns(fresh_pg, "agl")
    meas = _columns(fresh_pg, "measurement")
    for col in (
        "touchpoint_latitude",
        "touchpoint_longitude",
        "touchpoint_altitude",
        "ils_harmonization_tolerance",
    ):
        assert col in meas

    command.downgrade(alembic_env, PRIOR_REVISION)
    agl_cols = _columns(fresh_pg, "agl")
    meas_cols = _columns(fresh_pg, "measurement")
    assert "ils_harmonization_tolerance" not in agl_cols
    for col in (
        "touchpoint_latitude",
        "touchpoint_longitude",
        "touchpoint_altitude",
        "ils_harmonization_tolerance",
    ):
        assert col not in meas_cols
    # the rest of both tables survives the column drops
    assert "glide_slope_angle" in agl_cols
    assert "object_key" in meas_cols

    command.upgrade(alembic_env, "head")
    assert "ils_harmonization_tolerance" in _columns(fresh_pg, "agl")
    assert "touchpoint_latitude" in _columns(fresh_pg, "measurement")

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()
