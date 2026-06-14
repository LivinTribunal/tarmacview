"""alembic round-trip for 0012_wayline_dispatch on a fresh postgres (T3 migration)."""

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

PRIOR_REVISION = "0010_lha_lens_height"


def _alembic_config() -> Config:
    """alembic config anchored at the backend dir, independent of pytest cwd.

    built without the ini file on purpose: env.py runs fileConfig() when a
    config file is attached, and fileConfig's disable_existing_loggers would
    silence app loggers that later log-assertion tests (e.g. test_openaip)
    depend on. env.py reads the db url off settings either way.
    """
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
    """0012 applies, reverts cleanly, and re-applies on the same database."""
    command.upgrade(alembic_env, "head")
    assert "wayline_dispatch" in _table_names(fresh_pg)

    command.downgrade(alembic_env, PRIOR_REVISION)
    assert "wayline_dispatch" not in _table_names(fresh_pg)

    command.upgrade(alembic_env, "head")
    assert "wayline_dispatch" in _table_names(fresh_pg)

    engine = create_engine(fresh_pg)
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
    # compare against the script head so the assert tracks the chain as it grows
    assert version == ScriptDirectory.from_config(alembic_env).get_current_head()


def test_mission_wayline_mapping_is_queryable(alembic_env, fresh_pg):
    """after upgrade the mission <-> wayline mapping joins, and re-dispatch is unique."""
    command.upgrade(alembic_env, "head")

    airport_id, mission_id, wayline_id = uuid4(), uuid4(), uuid4()
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
                    "VALUES (:id, 'Mapped Mission', 'EXPORTED', :aid)"
                ),
                {"id": str(mission_id), "aid": str(airport_id)},
            )
            conn.execute(
                text(
                    "INSERT INTO wayline_dispatch (id, mission_id, wayline_id, status) "
                    "VALUES (:id, :mid, :wid, 'DISPATCHED')"
                ),
                {"id": str(uuid4()), "mid": str(mission_id), "wid": str(wayline_id)},
            )

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT m.name, wd.wayline_id FROM wayline_dispatch wd "
                    "JOIN mission m ON m.id = wd.mission_id "
                    "WHERE wd.wayline_id = :wid"
                ),
                {"wid": str(wayline_id)},
            ).one()
            assert row[0] == "Mapped Mission"
            assert str(row[1]) == str(wayline_id)

            # unique mission_id index - the re-dispatch-updates contract at the db layer
            with pytest.raises(Exception, match="ix_wayline_dispatch_mission_id"):
                with engine.begin() as dup:
                    dup.execute(
                        text(
                            "INSERT INTO wayline_dispatch (id, mission_id, wayline_id, status) "
                            "VALUES (:id, :mid, :wid, 'DISPATCHED')"
                        ),
                        {"id": str(uuid4()), "mid": str(mission_id), "wid": str(uuid4())},
                    )

            # cascade with the mission delete - no orphaned mappings
            with engine.begin() as delete_conn:
                delete_conn.execute(
                    text("DELETE FROM mission WHERE id = :mid"), {"mid": str(mission_id)}
                )
            remaining = conn.execute(
                text("SELECT count(*) FROM wayline_dispatch WHERE mission_id = :mid"),
                {"mid": str(mission_id)},
            ).scalar()
            assert remaining == 0
    finally:
        engine.dispose()
