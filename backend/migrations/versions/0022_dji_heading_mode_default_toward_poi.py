"""change mission.dji_heading_mode default to towardPOI

Revision ID: 0022_dji_heading_mode_default_toward_poi
Revises: 0021_scan_length_anchor
Create Date: 2026-06-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0022_dji_heading_mode_default_toward_poi'
down_revision: Union[str, None] = '0021_scan_length_anchor'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# towardPOI (continuous POI tracking) is now the default heading mode for new
# missions. existing rows keep their persisted value - the default only
# applies to inserts that omit the column.
def upgrade() -> None:
    op.alter_column(
        "mission",
        "dji_heading_mode",
        existing_type=sa.String(length=20),
        existing_nullable=True,
        server_default="towardPOI",
    )


def downgrade() -> None:
    op.alter_column(
        "mission",
        "dji_heading_mode",
        existing_type=sa.String(length=20),
        existing_nullable=True,
        server_default="smoothTransition",
    )
