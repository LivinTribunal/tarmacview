"""relax ck_airport_terrain_source to include DEM_SRTM

Revision ID: 0016_terrain_source_dem_srtm
Revises: 0015_surface_scan_config
Create Date: 2026-06-14 00:00:00.000000

adds the offline-staged Copernicus GLO-30 terrain source. the CHECK body is
rendered from the live TerrainSource enum (mirrors app/models/airport.py's
__table_args__) so the DB constraint and the python enum cannot drift. downgrade
restores the legacy three-value list; any airport already on DEM_SRTM would then
violate the tightened constraint, so the downgrade resets those rows to FLAT
first.

"""
from typing import Sequence, Union

from alembic import op

from app.core.enums import TerrainSource, enum_check_values

revision: str = "0016_terrain_source_dem_srtm"
down_revision: Union[str, None] = "0015_surface_scan_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# rendered from the live enum on upgrade; the legacy snapshot is a literal so the
# downgrade target is frozen regardless of future enum growth.
_TERRAIN_SOURCE_VALUES = enum_check_values(TerrainSource)
_LEGACY_TERRAIN_SOURCE_VALUES = "'FLAT', 'DEM_UPLOAD', 'DEM_API'"


def upgrade() -> None:
    op.drop_constraint("ck_airport_terrain_source", "airport", type_="check")
    op.create_check_constraint(
        "ck_airport_terrain_source",
        "airport",
        f"terrain_source IN ({_TERRAIN_SOURCE_VALUES})",
    )


def downgrade() -> None:
    # rows on the new source would violate the tightened constraint - snap to FLAT
    op.execute("UPDATE airport SET terrain_source = 'FLAT' WHERE terrain_source = 'DEM_SRTM'")

    op.drop_constraint("ck_airport_terrain_source", "airport", type_="check")
    op.create_check_constraint(
        "ck_airport_terrain_source",
        "airport",
        f"terrain_source IN ({_LEGACY_TERRAIN_SOURCE_VALUES})",
    )
