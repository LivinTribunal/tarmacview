"""collapse takeoff-landing scope into airborne FULL

Revision ID: 0009_collapse_takeoff_landing_scope
Revises: 0008_approach_descent_config
Create Date: 2026-05-26 00:00:00.000000

collapses the legacy `FULL` (ground takeoff/landing in wayline; buggy) and
`NO_TAKEOFF_LANDING` (airborne) rows into a single `FULL` row carrying the
airborne semantics. tightens the CHECK constraint to the two surviving values
and flips the column default to `FULL`. the trajectory pipeline regresses
affected missions to DRAFT on the next save because `flight_plan_scope`
lives in TRAJECTORY_FIELDS.

"""
from typing import Sequence, Union

from alembic import op


revision: str = '0009_collapse_takeoff_landing_scope'
down_revision: Union[str, None] = '0008_approach_descent_config'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # collapse legacy FULL + NO_TAKEOFF_LANDING rows into the new airborne FULL
    op.execute(
        "UPDATE mission SET flight_plan_scope = 'FULL' "
        "WHERE flight_plan_scope IN ('FULL', 'NO_TAKEOFF_LANDING')"
    )

    op.drop_constraint('ck_mission_flight_plan_scope', 'mission', type_='check')
    op.create_check_constraint(
        'ck_mission_flight_plan_scope',
        'mission',
        "flight_plan_scope IN ('FULL', 'MEASUREMENTS_ONLY')",
    )
    op.alter_column(
        'mission',
        'flight_plan_scope',
        server_default='FULL',
    )


def downgrade() -> None:
    """best-effort restore of the three-value enum.

    re-widens the CHECK constraint to `{FULL, NO_TAKEOFF_LANDING,
    MEASUREMENTS_ONLY}` and restores the `FULL` default. existing rows cannot
    be cleanly un-collapsed - the upgrade folded both legacy FULL and legacy
    NO_TAKEOFF_LANDING into a single `FULL`, so the original distinction is
    lost. every row stays at `FULL`; operators who need the old airborne-only
    semantics on a specific mission must flip it back to `NO_TAKEOFF_LANDING`
    manually.
    """
    op.alter_column(
        'mission',
        'flight_plan_scope',
        server_default='FULL',
    )
    op.drop_constraint('ck_mission_flight_plan_scope', 'mission', type_='check')
    op.create_check_constraint(
        'ck_mission_flight_plan_scope',
        'mission',
        "flight_plan_scope IN ('FULL', 'NO_TAKEOFF_LANDING', 'MEASUREMENTS_ONLY')",
    )
