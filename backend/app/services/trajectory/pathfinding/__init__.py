"""visibility-graph + A* transit pathfinding and reroute search.

re-export shim for the pathfinding/ package split. every prior
`from app.services.trajectory.pathfinding import X` resolves byte-identically.
the `safety_validator` import lives in each submodule that uses it, never here,
so the package init has no cycle. `astar` is re-exported (not re-implemented)
so the `monkeypatch.setattr(pathfinding, "astar", ...)` seam still reaches
`_compute_one_transit`, which resolves it off this package object.
"""

from app.utils.geo import astar

from ..types import DEFAULT_OBSTACLE_RADIUS
from ._graph import (
    MAX_ASTAR_RETRIES,
    MIN_SEARCH_RADIUS,
    SEARCH_RADIUS_EXPANSION,
    SEARCH_RADIUS_MARGIN,
    _build_visibility_graph,
    _collect_graph_nodes_in_circle,
    _collect_nearby_objects_local,
    _extract_local_polygon_vertices,
    _is_segment_blocked,
    _max_effective_buffer,
    _max_turn_angle,
    _run_astar,
    _runway_crossing_node_pairs,
    _segment_exits_airport_boundary,
    _surface_edge_nodes,
    has_line_of_sight,
)
from ._inter_pass import (
    MAX_INTER_PASS_DILATION_ATTEMPTS,
    _build_unified_region,
    _compute_one_transit,
    _grid_fill_in_region,
    _intersecting_obstacles,
    _path_to_transit_waypoints,
    _surface_edge_nodes_in_region,
    _TransitContext,
    _try_fast_inter_pass_transit,
    _UnifiedAttemptCache,
    compute_inter_pass_transits,
)
from ._reroute import resolve_inspection_collisions
from ._transit import (
    _adjust_transit_altitude_for_terrain,
    _buffered_polygon_for,
    _check_cruise_clearance,
    _check_endpoint_outside_obstacles,
    _polygon_exterior_vertices,
    compute_transit_path,
)

__all__ = [
    "DEFAULT_OBSTACLE_RADIUS",
    "MAX_ASTAR_RETRIES",
    "MAX_INTER_PASS_DILATION_ATTEMPTS",
    "MIN_SEARCH_RADIUS",
    "SEARCH_RADIUS_EXPANSION",
    "SEARCH_RADIUS_MARGIN",
    "_TransitContext",
    "_UnifiedAttemptCache",
    "_adjust_transit_altitude_for_terrain",
    "_build_unified_region",
    "_build_visibility_graph",
    "_buffered_polygon_for",
    "_check_cruise_clearance",
    "_check_endpoint_outside_obstacles",
    "_collect_graph_nodes_in_circle",
    "_collect_nearby_objects_local",
    "_compute_one_transit",
    "_extract_local_polygon_vertices",
    "_grid_fill_in_region",
    "_intersecting_obstacles",
    "_is_segment_blocked",
    "_max_effective_buffer",
    "_max_turn_angle",
    "_path_to_transit_waypoints",
    "_polygon_exterior_vertices",
    "_run_astar",
    "_runway_crossing_node_pairs",
    "_segment_exits_airport_boundary",
    "_surface_edge_nodes",
    "_surface_edge_nodes_in_region",
    "_try_fast_inter_pass_transit",
    "astar",
    "compute_inter_pass_transits",
    "compute_transit_path",
    "has_line_of_sight",
    "resolve_inspection_collisions",
]
