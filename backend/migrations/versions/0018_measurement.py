"""measurement context

Revision ID: 0018_measurement
Revises: 0017_merge_0016_heads
Create Date: 2026-06-14 22:08:14.205284

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_measurement"
down_revision: Union[str, None] = "0017_merge_0016_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # one measurement run per inspection's media set; the heavy results blob lives
    # in object storage, only the object_key pointer + summary columns land here.
    # the status CHECK mirrors the MeasurementStatus enum.
    op.create_table(
        "measurement",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("inspection_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("runway_heading", sa.Float(), nullable=True),
        sa.Column(
            "reference_points",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "light_boxes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "summaries",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "media_object_keys",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("first_frame_object_key", sa.String(), nullable=True),
        sa.Column("object_key", sa.String(), nullable=True),
        sa.Column(
            "annotated_video_keys",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'FIRST_FRAME', 'AWAITING_CONFIRM', 'PROCESSING', 'DONE', 'ERROR')",
            name="ck_measurement_status",
        ),
        sa.ForeignKeyConstraint(["inspection_id"], ["inspection.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_measurement_inspection_id", "measurement", ["inspection_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_measurement_inspection_id", table_name="measurement")
    op.drop_table("measurement")
