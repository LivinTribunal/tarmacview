"""relax ck_mission_status to include MEASURED

Revision ID: 0020_mission_status_measured
Revises: 0019_measurement_label
Create Date: 2026-06-15 00:00:00.000000

adds the MEASURED mission status between EXPORTED and the terminal states. the
upgrade drops + recreates ck_mission_status with MEASURED; the body stays
byte-identical to the literal in app/models/mission.py so the DB constraint and
the python state machine cannot drift. downgrade restores the legacy six-value
list; a row already at MEASURED would violate the tightened constraint, so the
downgrade snaps those rows back to EXPORTED first (mirrors 0016_terrain_source).

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0020_mission_status_measured"
down_revision: Union[str, None] = "0019_measurement_label"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# byte-identical to the CheckConstraint literal in app/models/mission.py
_MISSION_STATUS_VALUES = (
    "'DRAFT', 'PLANNED', 'VALIDATED', 'EXPORTED', 'MEASURED', 'COMPLETED', 'CANCELLED'"
)
_LEGACY_MISSION_STATUS_VALUES = (
    "'DRAFT', 'PLANNED', 'VALIDATED', 'EXPORTED', 'COMPLETED', 'CANCELLED'"
)


def upgrade() -> None:
    op.drop_constraint("ck_mission_status", "mission", type_="check")
    op.create_check_constraint(
        "ck_mission_status",
        "mission",
        f"status IN ({_MISSION_STATUS_VALUES})",
    )


def downgrade() -> None:
    # rows on the new status would violate the tightened constraint - snap back
    # to EXPORTED, the legal pre-MEASURED state MEASURED is reached from
    op.execute("UPDATE mission SET status = 'EXPORTED' WHERE status = 'MEASURED'")

    op.drop_constraint("ck_mission_status", "mission", type_="check")
    op.create_check_constraint(
        "ck_mission_status",
        "mission",
        f"status IN ({_LEGACY_MISSION_STATUS_VALUES})",
    )
