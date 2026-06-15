"""add MEASURED mission status

Revision ID: 0019_mission_status_measured
Revises: 0018_measurement
Create Date: 2026-06-15 00:00:00.000000

widens the mission status CHECK to include the additive `MEASURED` lifecycle
state (kicked off on measurement create from VALIDATED/EXPORTED). drops and
recreates `ck_mission_status` rather than altering it in place, mirroring
0009's pattern. downgrade collapses any `MEASURED` rows back to `EXPORTED`
(best-effort - the VALIDATED -> MEASURED skip cannot be recovered) before
narrowing the constraint again.

"""
from typing import Sequence, Union

from alembic import op


revision: str = '0019_mission_status_measured'
down_revision: Union[str, None] = '0018_measurement'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_mission_status', 'mission', type_='check')
    op.create_check_constraint(
        'ck_mission_status',
        'mission',
        "status IN ('DRAFT', 'PLANNED', 'VALIDATED', 'EXPORTED', 'MEASURED', "
        "'COMPLETED', 'CANCELLED')",
    )


def downgrade() -> None:
    # collapse MEASURED rows to EXPORTED so the narrowed CHECK can re-apply;
    # a mission measured straight from VALIDATED is reported as EXPORTED.
    op.execute("UPDATE mission SET status = 'EXPORTED' WHERE status = 'MEASURED'")

    op.drop_constraint('ck_mission_status', 'mission', type_='check')
    op.create_check_constraint(
        'ck_mission_status',
        'mission',
        "status IN ('DRAFT', 'PLANNED', 'VALIDATED', 'EXPORTED', "
        "'COMPLETED', 'CANCELLED')",
    )
