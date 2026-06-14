"""alembic chain - DEM_SRTM terrain-source CHECK relax migration (0016) (T3).

verifies the ck_airport_terrain_source constraint accepts DEM_SRTM after upgrade,
rejects it after downgrade, and that the downgrade snaps existing DEM_SRTM rows
back to FLAT instead of stranding them against the tightened constraint.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

_INSERT = text(
    "INSERT INTO airport (id, icao_code, name, elevation, location, terrain_source) "
    "VALUES (gen_random_uuid(), :icao, :name, 280.0, 'POINT Z (14 50 280)', :src)"
)


@pytest.fixture(scope="module")
def alembic_env():
    """empty postgres plus an alembic config pointed at it."""
    with PostgresContainer(
        image="postgres:16", username="test", password="test", dbname="srtmmig"
    ) as pg:
        url = pg.get_connection_url()
        cfg = Config()
        cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
        original_url = settings.database_url
        settings.database_url = url
        try:
            yield cfg, url
        finally:
            settings.database_url = original_url


def _terrain_check_text(url: str) -> str:
    """return the sqltext of the airport terrain-source CHECK constraint."""
    engine = create_engine(url)
    try:
        checks = inspect(engine).get_check_constraints("airport")
        check = next(c for c in checks if c["name"] == "ck_airport_terrain_source")
        return check["sqltext"]
    finally:
        engine.dispose()


def test_upgrade_head_accepts_dem_srtm(alembic_env):
    """after upgrade the CHECK lists DEM_SRTM and an airport can persist it."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    assert "DEM_SRTM" in _terrain_check_text(url)

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(_INSERT, {"icao": "SRT1", "name": "srtm ok", "src": "DEM_SRTM"})
        # an unknown source is still rejected by the relaxed constraint
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(_INSERT, {"icao": "BOGS", "name": "bogus", "src": "NOPE"})
    finally:
        engine.dispose()


def test_downgrade_snaps_srtm_rows_to_flat_and_rejects(alembic_env):
    """downgrade to 0015 resets DEM_SRTM rows to FLAT and tightens the CHECK."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(_INSERT, {"icao": "SRT2", "name": "to flat", "src": "DEM_SRTM"})
    finally:
        engine.dispose()

    command.downgrade(cfg, "0015_surface_scan_config")

    assert "DEM_SRTM" not in _terrain_check_text(url)

    engine = create_engine(url)
    try:
        # the staged row survived the downgrade, reset to FLAT
        row = (
            engine.connect()
            .execute(text("SELECT terrain_source FROM airport WHERE icao_code = 'SRT2'"))
            .fetchone()
        )
        assert row is not None
        assert row[0] == "FLAT"
        # the tightened constraint now refuses DEM_SRTM
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(_INSERT, {"icao": "SRT3", "name": "blocked", "src": "DEM_SRTM"})
    finally:
        engine.dispose()


def test_upgrade_restores_after_downgrade(alembic_env):
    """re-upgrading to head re-relaxes the constraint."""
    cfg, url = alembic_env
    command.downgrade(cfg, "0015_surface_scan_config")
    command.upgrade(cfg, "head")
    assert "DEM_SRTM" in _terrain_check_text(url)
