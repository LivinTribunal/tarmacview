"""alembic round-trip for 0019_mission_status_measured on a fresh postgres (T3 migration)."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
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


def _seed_airport_mission(engine, status: str):
    """insert one airport + one mission at the given status; return the mission id."""
    airport_id, mission_id = uuid4(), uuid4()
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
                "VALUES (:id, 'M', :status, :aid)"
            ),
            {"id": str(mission_id), "status": status, "aid": str(airport_id)},
        )
    return mission_id


def test_upgrade_allows_measured_downgrade_collapses(alembic_env, fresh_pg):
    """0019 lets MEASURED in; the downgrade collapses it to EXPORTED and bars it."""
    command.upgrade(alembic_env, "head")

    engine = create_engine(fresh_pg)
    try:
        # MEASURED inserts cleanly once the widened CHECK is in place
        mission_id = _seed_airport_mission(engine, "MEASURED")

        command.downgrade(alembic_env, PRIOR_REVISION)

        # the previously-MEASURED row is rewritten to EXPORTED, not left dangling
        with engine.connect() as conn:
            status = conn.execute(
                text("SELECT status FROM mission WHERE id = :id"), {"id": str(mission_id)}
            ).scalar()
        assert status == "EXPORTED"

        # and the narrowed CHECK now rejects a fresh MEASURED row
        with pytest.raises(Exception, match="ck_mission_status"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO mission (id, name, status, airport_id) "
                        "SELECT :id, 'M2', 'MEASURED', airport_id FROM mission "
                        "WHERE id = :existing"
                    ),
                    {"id": str(uuid4()), "existing": str(mission_id)},
                )

        # re-apply 0019 and confirm we land back on head with MEASURED allowed again
        command.upgrade(alembic_env, "head")
        _seed_airport_mission_status_measured_ok(engine)
    finally:
        engine.dispose()

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()


def _seed_airport_mission_status_measured_ok(engine):
    """assert a MEASURED mission inserts after re-upgrade (fresh airport/mission)."""
    airport_id, mission_id = uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO airport (id, icao_code, name, elevation, location, "
                "terrain_source) VALUES (:id, 'LKPR', 'Prague', 380.0, "
                "'POINT Z (14.26 50.10 380)', 'FLAT')"
            ),
            {"id": str(airport_id)},
        )
        conn.execute(
            text(
                "INSERT INTO mission (id, name, status, airport_id) "
                "VALUES (:id, 'M3', 'MEASURED', :aid)"
            ),
            {"id": str(mission_id), "aid": str(airport_id)},
        )
