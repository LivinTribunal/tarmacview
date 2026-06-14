"""backwards-compat shim: re-exports get_db from app.core.database for route imports."""

from app.core.database import get_db

__all__ = ["get_db"]
