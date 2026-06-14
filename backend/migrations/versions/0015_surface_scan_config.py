"""add surface-scan config columns to inspection_configuration

Revision ID: 0015_surface_scan_config
Revises: 0014_taxiway_heading_backfill
Create Date: 2026-06-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0015_surface_scan_config"
down_revision: Union[str, None] = "0014_taxiway_heading_backfill"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# enum value lists rendered into the CHECK bodies - kept in sync with the
# python ScanLengthMode / ScanWidthSide / ScanRunOrientation enums.
_SCAN_LENGTH_MODE_VALUES = "'FULL', 'MAX_LENGTH', 'INTERVAL'"
_SCAN_WIDTH_SIDE_VALUES = "'LEFT', 'RIGHT'"
_SCAN_RUN_ORIENTATION_VALUES = "'LENGTH_WISE', 'WIDTH_WISE'"


def upgrade() -> None:
    op.add_column(
        "inspection_configuration",
        sa.Column(
            "scan_surface_id",
            sa.UUID(),
            sa.ForeignKey("airfield_surface.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_length_mode", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_length_from", sa.Float(), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_length_to", sa.Float(), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_width", sa.Float(), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_width_side", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_height", sa.Float(), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_run_count", sa.Integer(), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_run_orientation", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "inspection_configuration",
        sa.Column("scan_sidelap_percent", sa.Float(), nullable=True),
    )

    op.create_check_constraint(
        "ck_inspection_configuration_scan_length_mode",
        "inspection_configuration",
        f"scan_length_mode IN ({_SCAN_LENGTH_MODE_VALUES})",
    )
    op.create_check_constraint(
        "ck_inspection_configuration_scan_width_side",
        "inspection_configuration",
        f"scan_width_side IN ({_SCAN_WIDTH_SIDE_VALUES})",
    )
    op.create_check_constraint(
        "ck_inspection_configuration_scan_run_orientation",
        "inspection_configuration",
        f"scan_run_orientation IN ({_SCAN_RUN_ORIENTATION_VALUES})",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inspection_configuration_scan_run_orientation",
        "inspection_configuration",
        type_="check",
    )
    op.drop_constraint(
        "ck_inspection_configuration_scan_width_side",
        "inspection_configuration",
        type_="check",
    )
    op.drop_constraint(
        "ck_inspection_configuration_scan_length_mode",
        "inspection_configuration",
        type_="check",
    )
    op.drop_column("inspection_configuration", "scan_sidelap_percent")
    op.drop_column("inspection_configuration", "scan_run_orientation")
    op.drop_column("inspection_configuration", "scan_run_count")
    op.drop_column("inspection_configuration", "scan_height")
    op.drop_column("inspection_configuration", "scan_width_side")
    op.drop_column("inspection_configuration", "scan_width")
    op.drop_column("inspection_configuration", "scan_length_to")
    op.drop_column("inspection_configuration", "scan_length_from")
    op.drop_column("inspection_configuration", "scan_length_mode")
    op.drop_column("inspection_configuration", "scan_surface_id")
