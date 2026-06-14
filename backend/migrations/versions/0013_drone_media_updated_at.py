"""drone media updated at

Revision ID: 0013_drone_media_updated_at
Revises: 0012_wayline_dispatch
Create Date: 2026-06-10 04:02:05.698153

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_drone_media_updated_at"
down_revision: Union[str, None] = "0012_wayline_dispatch"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # audit trail for the matching + manual-reassignment slice; server_default
    # backfills existing RECEIVED rows in place
    op.add_column(
        "drone_media_file",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("drone_media_file", "updated_at")
