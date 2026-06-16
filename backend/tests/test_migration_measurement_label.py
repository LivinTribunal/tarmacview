"""alembic round-trip for 0019_measurement_label on a fresh postgres (T3 migration)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRIOR_REVISION = "0018_measurement"


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


def _measurement_columns(url: str) -> set[str]:
    """current column names on the measurement table."""
    engine = create_engine(url)
    try:
        return {c["name"] for c in inspect(engine).get_columns("measurement")}
    finally:
        engine.dispose()


def test_label_column_added_and_dropped(alembic_env, fresh_pg):
    """0019 adds measurement.label on upgrade, drops it on downgrade, re-adds on re-upgrade."""
    command.upgrade(alembic_env, "head")
    assert "label" in _measurement_columns(fresh_pg)

    command.downgrade(alembic_env, PRIOR_REVISION)
    cols = _measurement_columns(fresh_pg)
    assert "label" not in cols
    # the rest of the table survives the column drop
    assert "object_key" in cols

    command.upgrade(alembic_env, "head")
    assert "label" in _measurement_columns(fresh_pg)

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()
