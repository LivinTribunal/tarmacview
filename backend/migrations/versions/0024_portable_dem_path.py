"""normalize dem_file_path to a portable basename

Revision ID: 0024_portable_dem_path
Revises: 0023_merge_0022_heads
Create Date: 2026-07-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0024_portable_dem_path"
down_revision: Union[str, Sequence[str], None] = "0023_merge_0022_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # every DEM file lives under settings.terrain_dir by construction (all write
    # paths root there), so basename + the read-time resolver always resolves.
    # strip any stored dem_file_path to its basename so a legacy absolute path
    # into the old dmpm repo no longer strands terrain resolution.
    import os

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, dem_file_path FROM airport WHERE dem_file_path IS NOT NULL")
    ).fetchall()
    for row in rows:
        base = os.path.basename(row.dem_file_path)
        if base and base != row.dem_file_path:
            bind.execute(
                sa.text("UPDATE airport SET dem_file_path = :p WHERE id = :id"),
                {"p": base, "id": row.id},
            )


def downgrade() -> None:
    # basename normalization is not reversible (the original absolute prefix is
    # lost); no-op.
    pass
