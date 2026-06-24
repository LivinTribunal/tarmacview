"""add surface-scan length-anchor column to inspection_configuration

Revision ID: 0021_scan_length_anchor
Revises: 0020_mission_status_measured
Create Date: 2026-06-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0021_scan_length_anchor"
down_revision: Union[str, None] = "0020_mission_status_measured"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# enum values rendered into the CHECK body - kept in sync with the python
# ScanLengthAnchor enum. null passes the constraint and reads as THRESHOLD.
_SCAN_LENGTH_ANCHOR_VALUES = "'THRESHOLD', 'ENDPOINT'"


def upgrade() -> None:
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_length_anchor", sa.String(length=20), nullable=True),
    )
    op.create_check_constraint(
        "ck_inspection_configuration_scan_length_anchor",
        "inspection_configuration",
        f"scan_length_anchor IN ({_SCAN_LENGTH_ANCHOR_VALUES})",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inspection_configuration_scan_length_anchor",
        "inspection_configuration",
        type_="check",
    )
    op.drop_column("inspection_configuration", "scan_length_anchor")
