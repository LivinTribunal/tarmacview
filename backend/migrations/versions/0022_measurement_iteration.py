"""measurement iteration grouping

Revision ID: 0022_measurement_iteration
Revises: 0021_scan_length_anchor
Create Date: 2026-06-21 00:00:00.000000

links re-flies of the same inspection into an iteration group. adds both columns
nullable, backfills every existing row to its own group (iteration_group_id = id,
iteration_index = 1), and indexes the group id for the group read.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_measurement_iteration"
down_revision: Union[str, None] = "0021_scan_length_anchor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("measurement", sa.Column("iteration_group_id", sa.UUID(), nullable=True))
    op.add_column("measurement", sa.Column("iteration_index", sa.Integer(), nullable=True))

    # backfill: every existing run is the sole member of its own group
    op.execute(
        "UPDATE measurement SET iteration_group_id = id, iteration_index = 1 "
        "WHERE iteration_group_id IS NULL"
    )

    op.create_index(
        "ix_measurement_iteration_group_id",
        "measurement",
        ["iteration_group_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_measurement_iteration_group_id", table_name="measurement")
    op.drop_column("measurement", "iteration_index")
    op.drop_column("measurement", "iteration_group_id")
