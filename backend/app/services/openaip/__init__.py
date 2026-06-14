"""openaip lookup package - airport + nearby airspaces and obstacles by icao code."""

from .client import (
    _ICAO_PATTERN,
    _client,
    _extract_items,
    _fetch_nearby_airspaces,
    _fetch_nearby_obstacles,
    _get,
    _pick_matching_airport,
    lookup_airport_by_icao,
)
from .conversions import _convert_altitude_limit, _convert_length
from .geometry import _compute_runway_geometry, _generate_obstacle_boundary
from .parsers import (
    _AIRSPACE_TYPE_MAP,
    _OBSTACLE_TYPE_MAP,
    _extract_elevation,
    _extract_point,
    _map_airspace_type,
    _map_obstacle_type,
    _parse_airspace,
    _parse_obstacle,
    _parse_polygon_geometry,
    _parse_runs,
    _parse_runway,
    _parse_runway_from_dual_thresholds,
    _parse_single_run,
)

__all__ = [
    "lookup_airport_by_icao",
    "_ICAO_PATTERN",
    "_AIRSPACE_TYPE_MAP",
    "_OBSTACLE_TYPE_MAP",
    "_client",
    "_get",
    "_extract_items",
    "_pick_matching_airport",
    "_fetch_nearby_airspaces",
    "_fetch_nearby_obstacles",
    "_convert_length",
    "_convert_altitude_limit",
    "_compute_runway_geometry",
    "_generate_obstacle_boundary",
    "_map_airspace_type",
    "_map_obstacle_type",
    "_extract_point",
    "_extract_elevation",
    "_parse_runway",
    "_parse_runs",
    "_parse_single_run",
    "_parse_runway_from_dual_thresholds",
    "_parse_polygon_geometry",
    "_parse_airspace",
    "_parse_obstacle",
]
