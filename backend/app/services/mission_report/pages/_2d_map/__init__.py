"""per-layer drawers for the 2d top-down map page."""

# safety-zone fill colors (shared by zone fill + legend chip)
_ZONE_COLORS = {
    "CTR": "#2196F388",
    "RESTRICTED": "#FF980088",
    "PROHIBITED": "#E5454588",
    "TEMPORARY_NO_FLY": "#9C27B088",
    "AIRPORT_BOUNDARY": "#CCCCCC44",
}

from .agl import _draw_agls_and_lhas  # noqa: E402
from .legend import _draw_legend  # noqa: E402
from .surface import _draw_surfaces  # noqa: E402
from .trajectory import _draw_trajectory  # noqa: E402
from .zone import _draw_safety_zones  # noqa: E402

__all__ = [
    "_ZONE_COLORS",
    "_draw_agls_and_lhas",
    "_draw_legend",
    "_draw_safety_zones",
    "_draw_surfaces",
    "_draw_trajectory",
]
