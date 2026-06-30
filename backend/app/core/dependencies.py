"""route dependency-injection seam: routes import get_db from here, never from
app.core.database directly. enforced by scripts/structural-tests.sh (routes must not
import database internals) - do not delete this as a redundant shim."""

from app.core.database import get_db

__all__ = ["get_db"]
