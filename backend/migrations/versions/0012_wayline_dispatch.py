"""wayline dispatch

Revision ID: 0011_wayline_dispatch
Revises: 0010_lha_lens_height
Create Date: 2026-06-10 01:21:16.306307

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_wayline_dispatch"
down_revision: Union[str, None] = "0011_drone_media_file"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # mission <-> field-hub wayline mapping; unique mission_id makes re-dispatch an update
    op.create_table(
        "wayline_dispatch",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("mission_id", sa.UUID(), nullable=False),
        sa.Column("wayline_id", sa.UUID(), nullable=False),
        sa.Column("device_sn", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "dispatched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["mission_id"], ["mission.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_wayline_dispatch_mission_id"), "wayline_dispatch", ["mission_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_wayline_dispatch_mission_id"), table_name="wayline_dispatch")
    op.drop_table("wayline_dispatch")
