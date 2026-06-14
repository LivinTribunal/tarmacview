"""add mission.dji_heading_mode

Revision ID: 0002_dji_heading_mode
Revises: 0001_initial_schema
Create Date: 2026-05-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002_dji_heading_mode'
down_revision: Union[str, None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# values mirrored on the python side (app.models.mission._DJI_HEADING_MODE_VALUES)
# so the DB constraint and the python literal cannot drift.
_DJI_HEADING_MODE_VALUES = ("smoothTransition", "towardPOI", "followWayline")


def upgrade() -> None:
    op.add_column(
        "mission",
        sa.Column(
            "dji_heading_mode",
            sa.String(length=20),
            nullable=True,
            server_default="smoothTransition",
        ),
    )
    op.create_check_constraint(
        "ck_mission_dji_heading_mode",
        "mission",
        "dji_heading_mode IN ({})".format(
            ", ".join(f"'{v}'" for v in _DJI_HEADING_MODE_VALUES)
        ),
    )


def downgrade() -> None:
    op.drop_constraint("ck_mission_dji_heading_mode", "mission", type_="check")
    op.drop_column("mission", "dji_heading_mode")
