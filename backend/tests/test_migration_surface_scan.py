"""alembic chain - surface-scan config migration (0015) against a fresh postgres (T3)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

SCAN_COLUMNS = {
    "scan_surface_id",
    "scan_length_mode",
    "scan_length_from",
    "scan_length_to",
    "scan_width",
    "scan_width_side",
    "scan_height",
    "scan_run_count",
    "scan_run_orientation",
    "scan_sidelap_percent",
    "scan_frontlap_percent",
}

# the 0016 column - rides on the scan-config table but lands a migration later.
FRONTLAP_COLUMN = "scan_frontlap_percent"


@pytest.fixture(scope="module")
def alembic_env():
    """empty postgres plus an alembic config pointed at it."""
    with PostgresContainer(
        image="postgres:16", username="test", password="test", dbname="scanmig"
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


def _columns(url: str, table: str) -> set[str]:
    """column names of a table."""
    engine = create_engine(url)
    try:
        return {c["name"] for c in inspect(engine).get_columns(table)}
    finally:
        engine.dispose()


def test_upgrade_head_adds_scan_columns(alembic_env):
    """upgrade head adds every surface-scan column to inspection_configuration."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    cols = _columns(url, "inspection_configuration")
    assert SCAN_COLUMNS <= cols


def test_scan_surface_fk_and_checks(alembic_env):
    """scan_surface_id is a SET NULL FK; the enum columns carry CHECK constraints."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        fks = inspector.get_foreign_keys("inspection_configuration")
        surface_fk = next(fk for fk in fks if "scan_surface_id" in fk["constrained_columns"])
        assert surface_fk["referred_table"] == "airfield_surface"
        assert surface_fk["options"].get("ondelete") == "SET NULL"

        check_names = {
            c["name"] for c in inspector.get_check_constraints("inspection_configuration")
        }
        assert {
            "ck_inspection_configuration_scan_length_mode",
            "ck_inspection_configuration_scan_width_side",
            "ck_inspection_configuration_scan_run_orientation",
        } <= check_names
    finally:
        engine.dispose()


def test_downgrade_drops_scan_columns_and_upgrade_restores(alembic_env):
    """downgrade to 0014 drops the scan columns; upgrade restores them."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    command.downgrade(cfg, "0014_taxiway_heading_backfill")
    cols_after = _columns(url, "inspection_configuration")
    assert not (SCAN_COLUMNS & cols_after)
    # the rest of the config table survives the downgrade
    assert "altitude_offset" in cols_after

    command.upgrade(cfg, "head")
    assert SCAN_COLUMNS <= _columns(url, "inspection_configuration")


def test_anchor_column_and_check(alembic_env):
    """0021 adds scan_length_anchor + its CHECK; downgrade to 0020 drops it."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")
    assert "scan_length_anchor" in _columns(url, "inspection_configuration")

    engine = create_engine(url)
    try:
        check_names = {
            c["name"] for c in inspect(engine).get_check_constraints("inspection_configuration")
        }
        assert "ck_inspection_configuration_scan_length_anchor" in check_names
    finally:
        engine.dispose()

    command.downgrade(cfg, "0020_mission_status_measured")
    assert "scan_length_anchor" not in _columns(url, "inspection_configuration")

    command.upgrade(cfg, "head")
    assert "scan_length_anchor" in _columns(url, "inspection_configuration")


def test_frontlap_migration_isolates_to_its_own_column(alembic_env):
    """downgrade to 0015 drops only scan_frontlap_percent; the other scan columns survive."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")
    assert FRONTLAP_COLUMN in _columns(url, "inspection_configuration")

    command.downgrade(cfg, "0015_surface_scan_config")
    cols_after = _columns(url, "inspection_configuration")
    assert FRONTLAP_COLUMN not in cols_after
    # the 0015 columns are untouched by the 0016 downgrade
    assert (SCAN_COLUMNS - {FRONTLAP_COLUMN}) <= cols_after

    command.upgrade(cfg, "head")
    assert FRONTLAP_COLUMN in _columns(url, "inspection_configuration")
