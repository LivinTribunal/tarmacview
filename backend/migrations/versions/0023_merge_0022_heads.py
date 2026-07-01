"""merge the three 0022 heads into a single lineage

Revision ID: 0023_merge_0022_heads
Revises: 0022_dji_heading_mode_default_toward_poi, 0022_glide_slope_tolerance, 0022_papi_center_height_reference
Create Date: 2026-07-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0023_merge_0022_heads"
down_revision: Union[str, Sequence[str], None] = (
    "0022_dji_heading_mode_default_toward_poi",
    "0022_glide_slope_tolerance",
    "0022_papi_center_height_reference",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
