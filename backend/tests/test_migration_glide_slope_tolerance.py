"""alembic round-trip for 0022_glide_slope_tolerance on a fresh postgres (T3 migration)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRIOR_REVISION = "0021_scan_length_anchor"


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


def test_glide_slope_columns_added_and_dropped(alembic_env, fresh_pg):
    """0022 adds the three glide-slope columns, drops them on downgrade, re-adds on re-upgrade."""
    command.upgrade(alembic_env, "head")
    assert "glide_slope_angle_tolerance" in _columns(fresh_pg, "inspection_configuration")
    meas = _columns(fresh_pg, "measurement")
    assert "glide_slope_angle" in meas
    assert "glide_slope_angle_tolerance" in meas

    command.downgrade(alembic_env, PRIOR_REVISION)
    cfg_cols = _columns(fresh_pg, "inspection_configuration")
    meas_cols = _columns(fresh_pg, "measurement")
    assert "glide_slope_angle_tolerance" not in cfg_cols
    assert "glide_slope_angle" not in meas_cols
    assert "glide_slope_angle_tolerance" not in meas_cols
    # the rest of both tables survives the column drops
    assert "scan_length_anchor" in cfg_cols
    assert "object_key" in meas_cols

    command.upgrade(alembic_env, "head")
    assert "glide_slope_angle_tolerance" in _columns(fresh_pg, "inspection_configuration")
    assert "glide_slope_angle" in _columns(fresh_pg, "measurement")

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()
