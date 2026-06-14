"""shim: legacy import path for the openaip lookup package.

the implementation moved to `app.services.openaip`; this module re-exports
the full surface so external callers (`app.seed`, the airports route) and
existing tests keep working unchanged.
"""

from app.services.openaip import (
    _AIRSPACE_TYPE_MAP,
    _ICAO_PATTERN,
    _OBSTACLE_TYPE_MAP,
    _client,
    _compute_runway_geometry,
    _convert_altitude_limit,
    _convert_length,
    _extract_elevation,
    _extract_items,
    _extract_point,
    _fetch_nearby_airspaces,
    _fetch_nearby_obstacles,
    _generate_obstacle_boundary,
    _get,
    _map_airspace_type,
    _map_obstacle_type,
    _parse_airspace,
    _parse_obstacle,
    _parse_polygon_geometry,
    _parse_runs,
    _parse_runway,
    _parse_runway_from_dual_thresholds,
    _parse_single_run,
    _pick_matching_airport,
    lookup_airport_by_icao,
)

__all__ = [
    "lookup_airport_by_icao",
    "_AIRSPACE_TYPE_MAP",
    "_OBSTACLE_TYPE_MAP",
    "_ICAO_PATTERN",
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
