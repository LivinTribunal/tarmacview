"""add agl glide-slope-tolerance field + measurement glidepath snapshot columns

Revision ID: 0022_glide_slope_tolerance
Revises: 0021_scan_length_anchor
Create Date: 2026-06-30 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0022_glide_slope_tolerance"
down_revision: Union[str, None] = "0021_scan_length_anchor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agl",
        sa.Column("glide_slope_angle_tolerance", sa.Float(), nullable=True),
    )
    op.add_column("measurement", sa.Column("glide_slope_angle", sa.Float(), nullable=True))
    op.add_column(
        "measurement", sa.Column("glide_slope_angle_tolerance", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("measurement", "glide_slope_angle_tolerance")
    op.drop_column("measurement", "glide_slope_angle")
    op.drop_column("agl", "glide_slope_angle_tolerance")
