"""lha lens height

Revision ID: 0010_lha_lens_height
Revises: 0009_collapse_takeoff_landing_scope
Create Date: 2026-05-29 10:55:20.207477

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_lha_lens_height"
down_revision: Union[str, None] = "0009_collapse_takeoff_landing_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PAPI-only lens optics height; null for non-PAPI units
    op.add_column("lha", sa.Column("lens_height_msl_m", sa.Float(), nullable=True))
    op.add_column("lha", sa.Column("lens_height_agl_m", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("lha", "lens_height_agl_m")
    op.drop_column("lha", "lens_height_msl_m")
