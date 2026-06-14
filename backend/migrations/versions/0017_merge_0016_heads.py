"""merge the three 0016 heads into a single lineage

Revision ID: 0017_merge_0016_heads
Revises: 0016_drone_media_per_inspection, 0016_surface_scan_frontlap, 0016_terrain_source_dem_srtm
Create Date: 2026-06-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017_merge_0016_heads"
down_revision: Union[str, Sequence[str], None] = (
    "0016_drone_media_per_inspection",
    "0016_surface_scan_frontlap",
    "0016_terrain_source_dem_srtm",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
