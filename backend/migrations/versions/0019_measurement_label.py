"""measurement label

Revision ID: 0019_measurement_label
Revises: 0018_measurement
Create Date: 2026-06-15 09:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_measurement_label"
down_revision: Union[str, None] = "0018_measurement"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # operator-supplied free-text run name; null falls back to the inspection label
    op.add_column("measurement", sa.Column("label", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("measurement", "label")
