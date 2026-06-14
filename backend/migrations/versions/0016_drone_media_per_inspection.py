"""drone media per-inspection: order, origin, filename, size + inspection fk

Revision ID: 0016_drone_media_per_inspection
Revises: 0015_surface_scan_config
Create Date: 2026-06-14 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_drone_media_per_inspection"
down_revision: Union[str, None] = "0015_surface_scan_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# enum value list rendered into the CHECK body - kept in sync with the python
# MediaOrigin enum.
_MEDIA_ORIGIN_VALUES = "'HUB', 'MANUAL'"


def upgrade() -> None:
    op.add_column("drone_media_file", sa.Column("inspection_id", sa.UUID(), nullable=True))
    op.add_column("drone_media_file", sa.Column("order_index", sa.Integer(), nullable=True))
    # origin lands nullable so existing hub rows backfill before NOT NULL
    op.add_column("drone_media_file", sa.Column("origin", sa.String(length=20), nullable=True))
    op.add_column("drone_media_file", sa.Column("filename", sa.String(), nullable=True))
    op.add_column("drone_media_file", sa.Column("size_bytes", sa.BigInteger(), nullable=True))

    op.execute("UPDATE drone_media_file SET origin = 'HUB' WHERE origin IS NULL")
    op.alter_column(
        "drone_media_file", "origin", existing_type=sa.String(length=20), nullable=False
    )

    # manual uploads carry no dji fingerprint, so relax the column and swap the
    # column UNIQUE for a partial index that ignores the null-fingerprint rows
    op.alter_column("drone_media_file", "fingerprint", existing_type=sa.VARCHAR(), nullable=True)
    op.drop_constraint("drone_media_file_fingerprint_key", "drone_media_file", type_="unique")
    op.create_index(
        "uq_drone_media_file_fingerprint",
        "drone_media_file",
        ["fingerprint"],
        unique=True,
        postgresql_where=sa.text("fingerprint IS NOT NULL"),
    )

    op.create_index(
        "ix_drone_media_file_inspection_id", "drone_media_file", ["inspection_id"], unique=False
    )
    op.create_foreign_key(
        "fk_drone_media_file_inspection_id",
        "drone_media_file",
        "inspection",
        ["inspection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_drone_media_file_inspection_order",
        "drone_media_file",
        ["inspection_id", "order_index"],
    )

    op.create_check_constraint(
        "ck_drone_media_file_origin",
        "drone_media_file",
        f"origin IN ({_MEDIA_ORIGIN_VALUES})",
    )
    op.create_check_constraint(
        "ck_drone_media_file_order_positive",
        "drone_media_file",
        "order_index > 0",
    )
    # inspection assignment and order travel together - both set or both null
    op.create_check_constraint(
        "ck_drone_media_file_order_inspection",
        "drone_media_file",
        "(inspection_id IS NULL) = (order_index IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_drone_media_file_order_inspection", "drone_media_file", type_="check")
    op.drop_constraint("ck_drone_media_file_order_positive", "drone_media_file", type_="check")
    op.drop_constraint("ck_drone_media_file_origin", "drone_media_file", type_="check")

    op.drop_constraint("uq_drone_media_file_inspection_order", "drone_media_file", type_="unique")
    op.drop_constraint("fk_drone_media_file_inspection_id", "drone_media_file", type_="foreignkey")
    op.drop_index("ix_drone_media_file_inspection_id", table_name="drone_media_file")

    op.drop_index(
        "uq_drone_media_file_fingerprint",
        table_name="drone_media_file",
        postgresql_where=sa.text("fingerprint IS NOT NULL"),
    )
    # restore the column UNIQUE - downgrade requires no null-fingerprint rows exist
    op.create_unique_constraint(
        "drone_media_file_fingerprint_key", "drone_media_file", ["fingerprint"]
    )
    op.alter_column("drone_media_file", "fingerprint", existing_type=sa.VARCHAR(), nullable=False)

    op.drop_column("drone_media_file", "size_bytes")
    op.drop_column("drone_media_file", "filename")
    op.drop_column("drone_media_file", "origin")
    op.drop_column("drone_media_file", "order_index")
    op.drop_column("drone_media_file", "inspection_id")
