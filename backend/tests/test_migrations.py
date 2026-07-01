"""alembic chain - drone_media_file migration reversibility against a fresh postgres."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

EXPECTED_COLUMNS = {
    "id",
    "object_key",
    "fingerprint",
    "captured_at",
    "capture_position",
    "device_sn",
    "mission_id",
    "inspection_id",
    "order_index",
    "origin",
    "filename",
    "size_bytes",
    "status",
    "raw_callback",
    "received_at",
    "updated_at",
}


@pytest.fixture(scope="module")
def alembic_env():
    """empty postgres plus an alembic config pointed at it.

    migrations/env.py reads the url off app settings, so the fixture swaps
    settings.database_url for the container and restores it afterwards. the
    config is built without alembic.ini - env.py would otherwise run its
    fileConfig and disable every already-created logger, breaking caplog
    assertions in tests that run later in the same process.
    """
    with PostgresContainer(
        image="postgres:16", username="test", password="test", dbname="migrations"
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


def _table_columns(url: str, table: str) -> set[str] | None:
    """column names of a table, none when the table does not exist."""
    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return None
        return {c["name"] for c in inspector.get_columns(table)}
    finally:
        engine.dispose()


def test_upgrade_head_creates_drone_media_file(alembic_env):
    """upgrade head builds the table with columns, constraints, and indexes."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    assert _table_columns(url, "drone_media_file") == EXPECTED_COLUMNS

    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        index_list = inspector.get_indexes("drone_media_file")
        # fingerprint uniqueness is a partial unique index, not a table
        # constraint, so manual null-fingerprint rows can coexist
        fingerprint_uq = next(
            i for i in index_list if i["name"] == "uq_drone_media_file_fingerprint"
        )
        assert fingerprint_uq["unique"] is True
        assert fingerprint_uq["column_names"] == ["fingerprint"]

        checks = inspector.get_check_constraints("drone_media_file")
        assert any(c["name"] == "ck_drone_media_file_status" for c in checks)

        fks = inspector.get_foreign_keys("drone_media_file")
        mission_fk = next(fk for fk in fks if fk["referred_table"] == "mission")
        assert mission_fk["options"].get("ondelete") == "SET NULL"

        indexes = {i["name"] for i in index_list}
        assert {"ix_drone_media_file_mission_id", "ix_drone_media_file_device_sn"} <= indexes
    finally:
        engine.dispose()


def test_downgrade_reverses_cleanly_and_upgrade_restores(alembic_env):
    """downgrade to the pre-field-hub revision drops both field-hub tables; upgrade restores."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    command.downgrade(cfg, "0010_lha_lens_height")
    assert _table_columns(url, "drone_media_file") is None
    assert _table_columns(url, "wayline_dispatch") is None
    # the rest of the schema is untouched by the downgrade
    assert _table_columns(url, "mission") is not None

    command.upgrade(cfg, "head")
    assert _table_columns(url, "drone_media_file") == EXPECTED_COLUMNS
    assert _table_columns(url, "wayline_dispatch") is not None


def test_papi_center_height_reference_upgrade_and_downgrade(alembic_env):
    """0022 adds the papi center-height columns + CHECK; downgrade drops them."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    cols = _table_columns(url, "inspection_configuration")
    assert {"papi_center_height_reference", "papi_center_height_custom_m"} <= cols

    engine = create_engine(url)
    try:
        checks = inspect(engine).get_check_constraints("inspection_configuration")
        assert any(
            c["name"] == "ck_inspection_configuration_papi_center_height_reference" for c in checks
        )
    finally:
        engine.dispose()

    command.downgrade(cfg, "0021_scan_length_anchor")
    cols = _table_columns(url, "inspection_configuration")
    assert "papi_center_height_reference" not in cols
    assert "papi_center_height_custom_m" not in cols

    command.upgrade(cfg, "head")
