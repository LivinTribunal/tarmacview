"""seed elevation_api_fallback_enabled system_settings row

Revision ID: 0003_elevation_api_fallback_setting
Revises: 0002_dji_heading_mode
Create Date: 2026-05-11 00:00:00.000000

"""
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = '0003_elevation_api_fallback_setting'
down_revision: Union[str, None] = '0002_dji_heading_mode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SETTING_KEY = "elevation_api_fallback_enabled"


def upgrade() -> None:
    # widen alembic_version.version_num so this 35-char revision id fits.
    # alembic 1.18 hardcodes the column at varchar(32); the framework UPDATE
    # that follows this upgrade() body would otherwise fail with
    # StringDataRightTruncation on fresh databases. idempotent: ALTER COLUMN
    # TYPE is a no-op when the target type already matches.
    op.execute(
        "ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"
    )

    # idempotent insert - missing row gets "false" (matches env bootstrap default).
    # already-present rows (e.g. previously seeded by a startup hook) are left alone.
    op.execute(
        sa.text(
            "INSERT INTO system_settings (id, key, value, updated_at) "
            "VALUES (:id, :key, :value, now()) "
            "ON CONFLICT (key) DO NOTHING"
        ).bindparams(id=str(uuid4()), key=_SETTING_KEY, value="false")
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM system_settings WHERE key = :key").bindparams(key=_SETTING_KEY)
    )
