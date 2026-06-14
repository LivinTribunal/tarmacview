"""per-page builders - one module per pdf page."""

from .altitude_profile import _build_altitude_profile_page
from .cover import _build_cover_page
from .crossing_analysis import _build_crossing_analysis_page
from .inspection_detail import _build_inspection_detail_pages
from .inspection_summary import _build_inspection_summary_page
from .map_2d import _build_2d_map_page
from .timeline import _build_activities, _build_timeline_page
from .validation_summary import _build_validation_summary_page
from .waypoint_table import _build_waypoint_table_page

__all__ = [
    "_build_2d_map_page",
    "_build_activities",
    "_build_altitude_profile_page",
    "_build_cover_page",
    "_build_crossing_analysis_page",
    "_build_inspection_detail_pages",
    "_build_inspection_summary_page",
    "_build_timeline_page",
    "_build_validation_summary_page",
    "_build_waypoint_table_page",
]
