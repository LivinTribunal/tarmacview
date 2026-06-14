"""safety-critical constraint checking: per-pass drone, obstacle, zone, angle-band, battery."""

from ._constraints import (
    _check_constraint,
    _check_runway_buffer,
    _violation,
    check_battery,
    check_drone_constraints,
    check_safety_zone,
)
from ._geometry import (
    _polygon_contains_lonlat_2d,
    check_obstacle,
    resolve_obstacle_buffer,
    segment_runway_crossing_length,
    segments_intersect_obstacle,
    segments_intersect_zone,
)
from ._passes import (
    _BOUNDARY_EGRESS_WAYPOINT_TYPES,
    _GROUND_LEVEL_WAYPOINT_TYPES,
    _batch_check_boundary_zones,
    _batch_check_minimum_agl,
    _batch_check_obstacles,
    _batch_check_zones,
    validate_inspection_pass,
    validate_papi_angle_band,
    validate_vertical_profile_angle_band,
)

__all__ = [
    "_BOUNDARY_EGRESS_WAYPOINT_TYPES",
    "_GROUND_LEVEL_WAYPOINT_TYPES",
    "_batch_check_boundary_zones",
    "_batch_check_minimum_agl",
    "_batch_check_obstacles",
    "_batch_check_zones",
    "_check_constraint",
    "_check_runway_buffer",
    "_polygon_contains_lonlat_2d",
    "_violation",
    "check_battery",
    "check_drone_constraints",
    "check_obstacle",
    "check_safety_zone",
    "resolve_obstacle_buffer",
    "segment_runway_crossing_length",
    "segments_intersect_obstacle",
    "segments_intersect_zone",
    "validate_inspection_pass",
    "validate_papi_angle_band",
    "validate_vertical_profile_angle_band",
]
