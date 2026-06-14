"""backfill taxiway heading from the centerline bearing

Revision ID: 0014_taxiway_heading_backfill
Revises: 0013_drone_media_updated_at
Create Date: 2026-06-13 00:00:00.000000

"""

import math
import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_taxiway_heading_backfill"
down_revision: Union[str, None] = "0013_drone_media_updated_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")


def _linestring_lonlat(wkt: str | None) -> list[tuple[float, float]]:
    """parse a wkt linestring into (lon, lat) tuples, ignoring z."""
    if not wkt:
        return []
    start, end = wkt.find("("), wkt.rfind(")")
    if start == -1 or end == -1:
        return []

    points = []
    for chunk in wkt[start + 1 : end].split(","):
        nums = _NUM_RE.findall(chunk)
        if len(nums) >= 2:
            points.append((float(nums[0]), float(nums[1])))

    return points


def _bearing_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """initial bearing in degrees from point 1 to point 2 (0 = north, 90 = east).

    mirrors app.utils.geo.bearing_between; inlined so the migration stays
    self-contained.
    """
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)

    east = math.sin(delta_lon) * math.cos(lat2_rad)
    north = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(
        lat2_rad
    ) * math.cos(delta_lon)

    return (math.degrees(math.atan2(east, north)) + 360) % 360


def upgrade() -> None:
    """fill heading for taxiways missing one, derived from their centerline."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, geometry FROM airfield_surface "
            "WHERE surface_type = 'TAXIWAY' AND heading IS NULL"
        )
    ).fetchall()

    for row in rows:
        points = _linestring_lonlat(row.geometry)
        if len(points) < 2:
            continue
        heading = _bearing_between(points[0][0], points[0][1], points[-1][0], points[-1][1])
        conn.execute(
            sa.text("UPDATE airfield_surface SET heading = :heading WHERE id = :id"),
            {"heading": heading, "id": row.id},
        )


def downgrade() -> None:
    """clear taxiway headings (the pre-backfill state had none)."""
    op.execute("UPDATE airfield_surface SET heading = NULL WHERE surface_type = 'TAXIWAY'")
