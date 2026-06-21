"""alembic round-trip for 0021_measurement_iteration on a fresh postgres (T3 migration)."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRIOR_REVISION = "0020_mission_status_measured"


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


def _measurement_indexes(url: str) -> set[str]:
    """current index names on the measurement table."""
    engine = create_engine(url)
    try:
        return {ix["name"] for ix in inspect(engine).get_indexes("measurement")}
    finally:
        engine.dispose()


def _seed_measurement_at_prior(url: str) -> str:
    """insert one measurement (+ FK chain) at the pre-iteration revision; return its id."""
    airport_id, mission_id, template_id, config_id, inspection_id, measurement_id = (
        str(uuid4()) for _ in range(6)
    )
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO airport (id, icao_code, name, elevation, location, "
                    "terrain_source) VALUES (:id, 'LZIT', 'Iter', 133.0, "
                    "'POINT Z (17.21 48.17 133)', 'FLAT')"
                ),
                {"id": airport_id},
            )
            conn.execute(
                text(
                    "INSERT INTO mission (id, name, status, airport_id) "
                    "VALUES (:id, 'M', 'DRAFT', :aid)"
                ),
                {"id": mission_id, "aid": airport_id},
            )
            conn.execute(
                text("INSERT INTO inspection_template (id, name) VALUES (:id, 'T')"),
                {"id": template_id},
            )
            conn.execute(
                text("INSERT INTO inspection_configuration (id) VALUES (:id)"),
                {"id": config_id},
            )
            conn.execute(
                text(
                    "INSERT INTO inspection (id, mission_id, template_id, config_id, "
                    "method, sequence_order) VALUES (:id, :mid, :tid, :cid, "
                    "'HORIZONTAL_RANGE', 1)"
                ),
                {"id": inspection_id, "mid": mission_id, "tid": template_id, "cid": config_id},
            )
            conn.execute(
                text(
                    "INSERT INTO measurement (id, inspection_id, status) "
                    "VALUES (:id, :iid, 'QUEUED')"
                ),
                {"id": measurement_id, "iid": inspection_id},
            )
    finally:
        engine.dispose()
    return measurement_id


def test_iteration_columns_added_backfilled_and_round_trip(alembic_env, fresh_pg):
    """0021 adds both columns + the index, backfills every existing row, and round-trips."""
    command.upgrade(alembic_env, PRIOR_REVISION)
    measurement_id = _seed_measurement_at_prior(fresh_pg)

    command.upgrade(alembic_env, "head")
    cols = _measurement_columns(fresh_pg)
    assert "iteration_group_id" in cols
    assert "iteration_index" in cols
    assert "ix_measurement_iteration_group_id" in _measurement_indexes(fresh_pg)

    # the pre-existing row is backfilled to its own group, index 1
    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT iteration_group_id, iteration_index FROM measurement WHERE id = :id"),
                {"id": measurement_id},
            ).one()
        assert str(row[0]) == measurement_id
        assert row[1] == 1
    finally:
        engine.dispose()

    command.downgrade(alembic_env, PRIOR_REVISION)
    cols = _measurement_columns(fresh_pg)
    assert "iteration_group_id" not in cols
    assert "iteration_index" not in cols
    # the rest of the table survives the column drop
    assert "object_key" in cols

    command.upgrade(alembic_env, "head")
    assert "iteration_group_id" in _measurement_columns(fresh_pg)

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()
