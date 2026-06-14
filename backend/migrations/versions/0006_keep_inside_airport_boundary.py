"""add keep_inside_airport_boundary mission toggle

Revision ID: 0006_keep_inside_airport_boundary
Revises: 0005_elevation_provider_strategy
Create Date: 2026-05-10 00:19:22.224384

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006_keep_inside_airport_boundary'
down_revision: Union[str, None] = '0005_elevation_provider_strategy'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'mission',
        sa.Column(
            'keep_inside_airport_boundary',
            sa.Boolean(),
            server_default=sa.text('true'),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('mission', 'keep_inside_airport_boundary')
