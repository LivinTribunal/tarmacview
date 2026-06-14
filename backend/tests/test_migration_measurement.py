"""alembic round-trip for 0018_measurement on a fresh postgres (T3 migration)."""

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

PRIOR_REVISION = "0017_merge_0016_heads"


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


def _table_names(url: str) -> set[str]:
    """current public table names."""
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_downgrade_upgrade_round_trip(alembic_env, fresh_pg):
    """0018 applies, reverts cleanly, and re-applies on the same database."""
    command.upgrade(alembic_env, "head")
    assert "measurement" in _table_names(fresh_pg)

    command.downgrade(alembic_env, PRIOR_REVISION)
    assert "measurement" not in _table_names(fresh_pg)

    command.upgrade(alembic_env, "head")
    assert "measurement" in _table_names(fresh_pg)

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()


def test_status_check_constraint_rejects_unknown_value(alembic_env, fresh_pg):
    """the status CHECK generated from MeasurementStatus rejects bad values."""
    command.upgrade(alembic_env, "head")

    airport_id, mission_id, template_id, config_id, inspection_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    engine = create_engine(fresh_pg)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO airport (id, icao_code, name, elevation, location, "
                    "terrain_source) VALUES (:id, 'LZIB', 'Bratislava', 133.0, "
                    "'POINT Z (17.21 48.17 133)', 'FLAT')"
                ),
                {"id": str(airport_id)},
            )
            conn.execute(
                text(
                    "INSERT INTO mission (id, name, status, airport_id) "
                    "VALUES (:id, 'M', 'DRAFT', :aid)"
                ),
                {"id": str(mission_id), "aid": str(airport_id)},
            )
            conn.execute(
                text("INSERT INTO inspection_template (id, name) VALUES (:id, 'T')"),
                {"id": str(template_id)},
            )
            conn.execute(
                text("INSERT INTO inspection_configuration (id) VALUES (:id)"),
                {"id": str(config_id)},
            )
            conn.execute(
                text(
                    "INSERT INTO inspection (id, mission_id, template_id, config_id, "
                    "method, sequence_order) VALUES (:id, :mid, :tid, :cid, "
                    "'HORIZONTAL_RANGE', 1)"
                ),
                {
                    "id": str(inspection_id),
                    "mid": str(mission_id),
                    "tid": str(template_id),
                    "cid": str(config_id),
                },
            )

        # a valid status inserts
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO measurement (id, inspection_id, status) "
                    "VALUES (:id, :iid, 'QUEUED')"
                ),
                {"id": str(uuid4()), "iid": str(inspection_id)},
            )

        # an unknown status is rejected by ck_measurement_status
        with pytest.raises(Exception, match="ck_measurement_status"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO measurement (id, inspection_id, status) "
                        "VALUES (:id, :iid, 'BOGUS')"
                    ),
                    {"id": str(uuid4()), "iid": str(inspection_id)},
                )

        # cascade with the inspection delete - no orphaned measurements
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM inspection WHERE id = :iid"), {"iid": str(inspection_id)}
            )
        with engine.connect() as conn:
            remaining = conn.execute(
                text("SELECT count(*) FROM measurement WHERE inspection_id = :iid"),
                {"iid": str(inspection_id)},
            ).scalar()
            assert remaining == 0
    finally:
        engine.dispose()
