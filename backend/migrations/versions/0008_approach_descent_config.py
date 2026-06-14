"""add approach-descent config columns to inspection_configuration

Revision ID: 0008_approach_descent_config
Revises: 0007_validation_violation_kind
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008_approach_descent_config'
down_revision: Union[str, None] = '0007_validation_violation_kind'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'inspection_configuration',
        sa.Column('descent_start_distance', sa.Float(), nullable=True),
    )
    op.add_column(
        'inspection_configuration',
        sa.Column('descent_glide_slope_override', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('inspection_configuration', 'descent_glide_slope_override')
    op.drop_column('inspection_configuration', 'descent_start_distance')
