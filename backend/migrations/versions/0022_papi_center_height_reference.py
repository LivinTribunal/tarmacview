"""add papi center-height reference columns to inspection_configuration

Revision ID: 0022_papi_center_height_reference
Revises: 0021_scan_length_anchor
Create Date: 2026-06-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0022_papi_center_height_reference"
down_revision: Union[str, None] = "0021_scan_length_anchor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# enum values rendered into the CHECK body - kept in sync with the python
# PapiCenterHeightReference enum. server_default GROUND backfills existing rows.
_PAPI_CENTER_HEIGHT_REF_VALUES = "'GROUND', 'LENS', 'CUSTOM'"


def upgrade() -> None:
    op.add_column(
        "inspection_configuration",
        sa.Column(
            "papi_center_height_reference",
            sa.String(length=10),
            nullable=True,
            server_default="GROUND",
        ),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("papi_center_height_custom_m", sa.Float(), nullable=True),
    )
    op.create_check_constraint(
        "ck_inspection_configuration_papi_center_height_reference",
        "inspection_configuration",
        f"papi_center_height_reference IN ({_PAPI_CENTER_HEIGHT_REF_VALUES})",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inspection_configuration_papi_center_height_reference",
        "inspection_configuration",
        type_="check",
    )
    op.drop_column("inspection_configuration", "papi_center_height_custom_m")
    op.drop_column("inspection_configuration", "papi_center_height_reference")
