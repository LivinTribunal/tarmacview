"""add violation_kind to validation_violation

Revision ID: 0007_validation_violation_kind
Revises: 0006_keep_inside_airport_boundary
Create Date: 2026-05-16 00:45:55.465006

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007_validation_violation_kind'
down_revision: Union[str, None] = '0006_keep_inside_airport_boundary'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'validation_violation',
        sa.Column('violation_kind', sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('validation_violation', 'violation_kind')
