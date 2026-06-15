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


def _seed_airport(conn, airport_id) -> None:
    """one airport row so a mission insert satisfies the FK."""
    conn.execute(
        text(
            "INSERT INTO airport (id, icao_code, name, elevation, location, terrain_source) "
            "VALUES (:id, 'LZMS', 'Sliac', 217.0, 'POINT Z (19.13 48.63 217)', 'FLAT')"
        ),
        {"id": str(airport_id)},
    )


def test_upgrade_downgrade_upgrade_round_trip(alembic_env, fresh_pg):
    """0019 applies, reverts cleanly to 0018, and re-applies on the same database."""
    command.upgrade(alembic_env, "head")
    command.downgrade(alembic_env, PRIOR_REVISION)
    command.upgrade(alembic_env, "head")

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()


def test_check_constraint_accepts_measured_and_downgrade_reverses(alembic_env, fresh_pg):
    """after upgrade the CHECK accepts MEASURED; downgrade backfills it away and rejects it."""
    command.upgrade(alembic_env, "head")

    airport_id, mission_id = uuid4(), uuid4()
    engine = create_engine(fresh_pg)
    try:
        # MEASURED is accepted after the upgrade
        with engine.begin() as conn:
            _seed_airport(conn, airport_id)
            conn.execute(
                text(
                    "INSERT INTO mission (id, name, status, airport_id) "
                    "VALUES (:id, 'M', 'MEASURED', :aid)"
                ),
                {"id": str(mission_id), "aid": str(airport_id)},
            )

        command.downgrade(alembic_env, PRIOR_REVISION)

        # the existing MEASURED row was snapped back to EXPORTED by the downgrade
        with engine.connect() as conn:
            status = conn.execute(
                text("SELECT status FROM mission WHERE id = :id"), {"id": str(mission_id)}
            ).scalar()
            assert status == "EXPORTED"

        # and a fresh MEASURED insert is now rejected by ck_mission_status
        with pytest.raises(Exception, match="ck_mission_status"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO mission (id, name, status, airport_id) "
                        "VALUES (:id, 'M2', 'MEASURED', :aid)"
                    ),
                    {"id": str(uuid4()), "aid": str(airport_id)},
                )

        # leave the db at head for module isolation
        command.upgrade(alembic_env, "head")
    finally:
        engine.dispose()
