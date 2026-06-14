"""drone media file

Revision ID: 0011_drone_media_file
Revises: 0010_lha_lens_height
Create Date: 2026-06-10 01:26:40.397692

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_drone_media_file"
down_revision: Union[str, None] = "0010_lha_lens_height"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # media originals reported by the field hub; rows arrive as RECEIVED and
    # get matched to missions in a follow-up slice
    op.create_table(
        "drone_media_file",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("fingerprint", sa.String(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("capture_position", sa.String(), nullable=True),
        sa.Column("device_sn", sa.String(), nullable=True),
        sa.Column("mission_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("raw_callback", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('RECEIVED', 'MATCHED', 'UNASSIGNED', 'INGESTED')",
            name="ck_drone_media_file_status",
        ),
        sa.ForeignKeyConstraint(["mission_id"], ["mission.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint"),
    )
    op.create_index(
        "ix_drone_media_file_device_sn", "drone_media_file", ["device_sn"], unique=False
    )
    op.create_index(
        "ix_drone_media_file_mission_id", "drone_media_file", ["mission_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_drone_media_file_mission_id", table_name="drone_media_file")
    op.drop_index("ix_drone_media_file_device_sn", table_name="drone_media_file")
    op.drop_table("drone_media_file")
