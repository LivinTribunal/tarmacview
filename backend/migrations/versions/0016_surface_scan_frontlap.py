"""add surface-scan frontlap column to inspection_configuration

Revision ID: 0016_surface_scan_frontlap
Revises: 0015_surface_scan_config
Create Date: 2026-06-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016_surface_scan_frontlap"
down_revision: Union[str, None] = "0015_surface_scan_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_frontlap_percent", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inspection_configuration", "scan_frontlap_percent")
