"""add agl surveyed meht_height_m field

Revision ID: 0024_agl_meht_height
Revises: 0023_merge_0022_heads
Create Date: 2026-07-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0024_agl_meht_height"
down_revision: Union[str, None] = "0023_merge_0022_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agl", sa.Column("meht_height_m", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("agl", "meht_height_m")
