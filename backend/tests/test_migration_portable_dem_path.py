"""alembic chain - portable dem_file_path normalization migration (0023) (T3).

verifies the 0023 merge migration (a) collapses the two 0022 heads to a single
head and (b) strips every stored dem_file_path to its basename so a legacy
absolute path into the old drone-mission-planning-module repo no longer strands
terrain resolution. a null-DEM row is a control that must stay null.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

_INSERT_DEM = text(
    "INSERT INTO airport (id, icao_code, name, elevation, location, terrain_source, "
    "dem_file_path) VALUES (gen_random_uuid(), :icao, :name, 290.0, "
    "'POINT Z (18 49 290)', 'DEM_API', :path) RETURNING id"
)
_INSERT_NULL = text(
    "INSERT INTO airport (id, icao_code, name, elevation, location, terrain_source) "
    "VALUES (gen_random_uuid(), :icao, :name, 290.0, 'POINT Z (18 49 290)', 'FLAT') "
    "RETURNING id"
)


@pytest.fixture(scope="module")
def alembic_env():
    """empty postgres plus an alembic config pointed at it."""
    with PostgresContainer(
        image="postgres:16", username="test", password="test", dbname="dempathmig"
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


def test_upgrade_normalizes_dem_paths_to_basename(alembic_env):
    """0023 strips stored dem_file_path to basename and leaves null rows null."""
    cfg, url = alembic_env
    # build the pre-merge schema off one of the two 0022 heads
    command.upgrade(cfg, "0022_dji_heading_mode_default_toward_poi")

    engine = create_engine(url)
    legacy = "/Users/x/drone-mission-planning-module/backend/data/terrain/MPA1_api_cache.tif"
    try:
        with engine.begin() as conn:
            dem_id = conn.execute(
                _INSERT_DEM, {"icao": "MPA1", "name": "legacy dem", "path": legacy}
            ).scalar_one()
            null_id = conn.execute(
                _INSERT_NULL, {"icao": "MPA2", "name": "flat control"}
            ).scalar_one()
    finally:
        engine.dispose()

    command.upgrade(cfg, "head")

    engine = create_engine(url)
    try:
        dem_path = (
            engine.connect()
            .execute(text("SELECT dem_file_path FROM airport WHERE id = :id"), {"id": dem_id})
            .scalar_one()
        )
        null_path = (
            engine.connect()
            .execute(text("SELECT dem_file_path FROM airport WHERE id = :id"), {"id": null_id})
            .scalar_one()
        )
    finally:
        engine.dispose()

    assert dem_path == "MPA1_api_cache.tif"
    assert null_path is None


def test_head_collapses_to_single_revision(alembic_env):
    """after 0023 the script directory reports a single head."""
    cfg, _ = alembic_env
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0023_portable_dem_path"]
