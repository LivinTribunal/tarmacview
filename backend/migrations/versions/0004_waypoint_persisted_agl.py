"""persist per-waypoint agl + camera_target_agl

Revision ID: 0004_waypoint_persisted_agl
Revises: 0003_elevation_api_fallback_setting
Create Date: 2026-05-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004_waypoint_persisted_agl'
down_revision: Union[str, None] = '0003_elevation_api_fallback_setting'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # both nullable so legacy rows survive the upgrade. backfill is lazy: the
    # first build_enriched_response call computes and persists per-waypoint values.
    op.add_column("waypoint", sa.Column("agl", sa.Float(), nullable=True))
    op.add_column("waypoint", sa.Column("camera_target_agl", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("waypoint", "camera_target_agl")
    op.drop_column("waypoint", "agl")
