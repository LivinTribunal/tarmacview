"""alembic chain - per-inspection drone-media migration (0016) on a fresh postgres (T3)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

NEW_COLUMNS = {"inspection_id", "order_index", "origin", "filename", "size_bytes"}


@pytest.fixture(scope="module")
def alembic_env():
    """empty postgres plus an alembic config pointed at it."""
    with PostgresContainer(
        image="postgres:16", username="test", password="test", dbname="dmpmig"
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


def test_upgrade_head_adds_columns_and_fk(alembic_env):
    """upgrade head adds the per-inspection columns + the SET NULL inspection fk."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    assert NEW_COLUMNS <= _columns(url, "drone_media_file")

    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        fks = inspector.get_foreign_keys("drone_media_file")
        insp_fk = next(fk for fk in fks if "inspection_id" in fk["constrained_columns"])
        assert insp_fk["referred_table"] == "inspection"
        assert insp_fk["options"].get("ondelete") == "SET NULL"

        checks = {c["name"] for c in inspector.get_check_constraints("drone_media_file")}
        assert {
            "ck_drone_media_file_origin",
            "ck_drone_media_file_order_positive",
            "ck_drone_media_file_order_inspection",
        } <= checks
    finally:
        engine.dispose()


def test_origin_backfilled_to_hub_then_not_null(alembic_env):
    """a row written at 0015 (no origin column) backfills to origin='HUB'."""
    cfg, url = alembic_env
    command.downgrade(cfg, "0015_surface_scan_config")

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO drone_media_file "
                    "(id, object_key, fingerprint, status, received_at, updated_at) "
                    "VALUES (gen_random_uuid(), 'legacy', 'fp-legacy', 'RECEIVED', now(), now())"
                )
            )

        command.upgrade(cfg, "head")

        with engine.connect() as conn:
            origin = conn.execute(
                text("SELECT origin FROM drone_media_file WHERE fingerprint = 'fp-legacy'")
            ).scalar_one()
        assert origin == "HUB"
    finally:
        engine.dispose()


def test_partial_unique_allows_null_fingerprints_rejects_dupes(alembic_env):
    """null-fingerprint rows coexist; a duplicate non-null fingerprint is rejected."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            for key in ("m1", "m2"):
                conn.execute(
                    text(
                        "INSERT INTO drone_media_file "
                        "(id, object_key, fingerprint, origin, status, received_at, updated_at) "
                        "VALUES (gen_random_uuid(), :k, NULL, 'MANUAL', 'MATCHED', now(), now())"
                    ),
                    {"k": key},
                )

        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO drone_media_file "
                    "(id, object_key, fingerprint, origin, status, received_at, updated_at) "
                    "VALUES (gen_random_uuid(), 'h1', 'dup', 'HUB', 'RECEIVED', now(), now())"
                )
            )
        with pytest.raises(Exception) as exc:  # noqa: PT011
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO drone_media_file "
                        "(id, object_key, fingerprint, origin, status, received_at, updated_at) "
                        "VALUES (gen_random_uuid(), 'h2', 'dup', 'HUB', 'RECEIVED', now(), now())"
                    )
                )
        assert "uq_drone_media_file_fingerprint" in str(exc.value)
    finally:
        engine.dispose()


def test_downgrade_drops_columns_and_upgrade_restores(alembic_env):
    """downgrade to 0015 drops the new columns; upgrade restores them."""
    cfg, url = alembic_env
    command.upgrade(cfg, "head")

    # clear rows other tests committed - the 0015 downgrade restores the
    # fingerprint NOT NULL + UNIQUE, which the null-fingerprint manual rows
    # would otherwise block
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE drone_media_file"))
    finally:
        engine.dispose()

    command.downgrade(cfg, "0015_surface_scan_config")
    cols_after = _columns(url, "drone_media_file")
    assert not (NEW_COLUMNS & cols_after)
    # the original hub columns survive the downgrade
    assert {"object_key", "fingerprint", "mission_id"} <= cols_after

    command.upgrade(cfg, "head")
    assert NEW_COLUMNS <= _columns(url, "drone_media_file")
