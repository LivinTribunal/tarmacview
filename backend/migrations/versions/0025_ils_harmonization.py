"""add ils-harmonization tolerance + touchpoint snapshot columns

Revision ID: 0025_ils_harmonization
Revises: 0024_agl_meht_height
Create Date: 2026-07-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0025_ils_harmonization"
down_revision: Union[str, None] = "0024_agl_meht_height"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agl", sa.Column("ils_harmonization_tolerance", sa.Float(), nullable=True))
    op.add_column("measurement", sa.Column("touchpoint_latitude", sa.Float(), nullable=True))
    op.add_column("measurement", sa.Column("touchpoint_longitude", sa.Float(), nullable=True))
    op.add_column("measurement", sa.Column("touchpoint_altitude", sa.Float(), nullable=True))
    op.add_column(
        "measurement", sa.Column("ils_harmonization_tolerance", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("measurement", "ils_harmonization_tolerance")
    op.drop_column("measurement", "touchpoint_altitude")
    op.drop_column("measurement", "touchpoint_longitude")
    op.drop_column("measurement", "touchpoint_latitude")
    op.drop_column("agl", "ils_harmonization_tolerance")
