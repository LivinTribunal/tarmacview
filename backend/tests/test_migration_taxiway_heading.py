"""alembic backfill check for 0014_taxiway_heading_backfill on a fresh postgres (T3 migration)."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from testcontainers.postgres import PostgresContainer

from app.core.config import settings
from app.utils.geo import bearing_between

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRIOR_REVISION = "0013_drone_media_updated_at"

EAST_CENTERLINE = "LINESTRING Z (14.24 50.1 380, 14.26 50.1 380)"
SINGLE_POINT_CENTERLINE = "LINESTRING Z (14.24 50.1 380)"


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


def _insert_surface(conn, airport_id, identifier, surface_type, geometry, heading=None):
    """insert a minimal airfield_surface row, returning its id."""
    surface_id = uuid4()
    conn.execute(
        text(
            "INSERT INTO airfield_surface (id, airport_id, identifier, surface_type, "
            "geometry, buffer_distance, heading) "
            "VALUES (:id, :aid, :ident, :stype, :geom, 15.0, :heading)"
        ),
        {
            "id": str(surface_id),
            "aid": str(airport_id),
            "ident": identifier,
            "stype": surface_type,
            "geom": geometry,
            "heading": heading,
        },
    )
    return surface_id


def test_backfill_fills_only_null_heading_taxiways(alembic_env, fresh_pg):
    """taxiways with NULL heading get the centerline bearing; everything else is untouched."""
    command.upgrade(alembic_env, PRIOR_REVISION)

    airport_id = uuid4()
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
            null_tw = _insert_surface(conn, airport_id, "A", "TAXIWAY", EAST_CENTERLINE)
            explicit_tw = _insert_surface(
                conn, airport_id, "B", "TAXIWAY", EAST_CENTERLINE, heading=123.0
            )
            degenerate_tw = _insert_surface(
                conn, airport_id, "C", "TAXIWAY", SINGLE_POINT_CENTERLINE
            )
            null_rwy = _insert_surface(conn, airport_id, "09", "RUNWAY", EAST_CENTERLINE)

        command.upgrade(alembic_env, "head")

        with engine.connect() as conn:
            headings = {
                str(row.id): row.heading
                for row in conn.execute(text("SELECT id, heading FROM airfield_surface"))
            }
    finally:
        engine.dispose()

    expected = bearing_between(14.24, 50.1, 14.26, 50.1)
    assert headings[str(null_tw)] == pytest.approx(expected, abs=1e-9)
    assert headings[str(explicit_tw)] == 123.0
    assert headings[str(degenerate_tw)] is None
    assert headings[str(null_rwy)] is None


def test_downgrade_clears_taxiway_headings_only(alembic_env, fresh_pg):
    """downgrade nulls taxiway headings and leaves runway headings alone."""
    command.upgrade(alembic_env, "head")

    airport_id = uuid4()
    engine = create_engine(fresh_pg)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO airport (id, icao_code, name, elevation, location, "
                    "terrain_source) VALUES (:id, 'LZKZ', 'Kosice', 230.0, "
                    "'POINT Z (21.24 48.66 230)', 'FLAT')"
                ),
                {"id": str(airport_id)},
            )
            taxiway = _insert_surface(
                conn, airport_id, "D", "TAXIWAY", EAST_CENTERLINE, heading=45.0
            )
            runway = _insert_surface(
                conn, airport_id, "27", "RUNWAY", EAST_CENTERLINE, heading=270.0
            )

        command.downgrade(alembic_env, PRIOR_REVISION)

        with engine.connect() as conn:
            headings = {
                str(row.id): row.heading
                for row in conn.execute(text("SELECT id, heading FROM airfield_surface"))
            }
    finally:
        engine.dispose()

    assert headings[str(taxiway)] is None
    assert headings[str(runway)] == 270.0
