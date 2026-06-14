"""seed elevation_api_provider and elevation_api_key system_settings rows

Revision ID: 0005_elevation_provider_strategy
Revises: 0004_waypoint_persisted_agl
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = '0005_elevation_provider_strategy'
down_revision: Union[str, None] = '0004_waypoint_persisted_agl'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PROVIDER_KEY = "elevation_api_provider"
_API_KEY_KEY = "elevation_api_key"


def upgrade() -> None:
    # SystemSettings is a key-value table - the issue's "new column" maps to
    # new rows here. idempotent: existing rows are left alone, missing rows
    # get the default (OPEN_ELEVATION for the provider, empty/null for the key).
    op.execute(
        sa.text(
            "INSERT INTO system_settings (id, key, value, updated_at) "
            "VALUES (:id, :key, :value, now()) "
            "ON CONFLICT (key) DO NOTHING"
        ).bindparams(id=str(uuid4()), key=_PROVIDER_KEY, value="OPEN_ELEVATION")
    )
    op.execute(
        sa.text(
            "INSERT INTO system_settings (id, key, value, updated_at) "
            "VALUES (:id, :key, :value, now()) "
            "ON CONFLICT (key) DO NOTHING"
        ).bindparams(id=str(uuid4()), key=_API_KEY_KEY, value=None)
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM system_settings WHERE key = :key").bindparams(key=_PROVIDER_KEY)
    )
    op.execute(
        sa.text("DELETE FROM system_settings WHERE key = :key").bindparams(key=_API_KEY_KEY)
    )
