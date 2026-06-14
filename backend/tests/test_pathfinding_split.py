"""regression net for the pathfinding.py -> pathfinding/ package split (T3).

byte-identical behavior is the contract: every prior import path still resolves,
the per-file seam matches the acceptance criteria, the `safety_validator` import
never lands in the package init (no cycle), and the `astar` monkeypatch seam
still reaches `_compute_one_transit` across the new `_transit`/package boundary.
"""

import ast
import pathlib

import pytest
from shapely.geometry import LineString, MultiPoint, box

from app.core.exceptions import TrajectoryGenerationError
from app.services.trajectory import pathfinding
from app.services.trajectory.types import (
    TRANSIT_AGL,
    LocalGeometries,
    LocalSurface,
    Point3D,
)
from app.utils.local_projection import LocalProjection

# the four symbols orchestrator.py imports + every helper the equivalence
# suites import / patch by module path - the AC external surface
_AC_EXTERNAL_SURFACE = {
    # orchestrator.py
    "compute_inter_pass_transits",
    "compute_transit_path",
    "has_line_of_sight",
    "resolve_inspection_collisions",
    # test_trajectory_pathfinding.py
    "_build_visibility_graph",
    "_check_cruise_clearance",
    "_collect_graph_nodes_in_circle",
    "_max_effective_buffer",
    "_max_turn_angle",
    "_run_astar",
    "_grid_fill_in_region",
    "_surface_edge_nodes",
    "_TransitContext",
    "_compute_one_transit",
    "astar",
    # test_unified_visibility_graph.py
    "_buffered_polygon_for",
    # test_elevation_provider.py
    "_adjust_transit_altitude_for_terrain",
    # test_local_projection.py
    "_is_segment_blocked",
    # test_trajectory_generator.py
    "_extract_local_polygon_vertices",
    "DEFAULT_OBSTACLE_RADIUS",
}

_GRAPH_CALLABLES = {
    "_extract_local_polygon_vertices",
    "_collect_nearby_objects_local",
    "_segment_exits_airport_boundary",
    "_is_segment_blocked",
    "_build_visibility_graph",
    "_runway_crossing_node_pairs",
    "_surface_edge_nodes",
    "_collect_graph_nodes_in_circle",
    "_run_astar",
    "has_line_of_sight",
    "_max_turn_angle",
    "_max_effective_buffer",
}
_GRAPH_CONSTANTS = {
    "MIN_SEARCH_RADIUS",
    "SEARCH_RADIUS_MARGIN",
    "SEARCH_RADIUS_EXPANSION",
    "MAX_ASTAR_RETRIES",
}
_TRANSIT_CALLABLES = {
    "_adjust_transit_altitude_for_terrain",
    "_check_cruise_clearance",
    "compute_transit_path",
    "_buffered_polygon_for",
    "_polygon_exterior_vertices",
    "_check_endpoint_outside_obstacles",
}
_INTER_PASS_CALLABLES = {
    "_try_fast_inter_pass_transit",
    "_intersecting_obstacles",
    "_build_unified_region",
    "_path_to_transit_waypoints",
    "_UnifiedAttemptCache",
    "_TransitContext",
    "_surface_edge_nodes_in_region",
    "_grid_fill_in_region",
    "_compute_one_transit",
    "compute_inter_pass_transits",
}
_INTER_PASS_CONSTANTS = {"MAX_INTER_PASS_DILATION_ATTEMPTS"}
_REROUTE_CALLABLES = {"resolve_inspection_collisions"}

_PKG_DIR = pathlib.Path(pathfinding.__file__).parent
# pathfinding-external trajectory modules - importing any of these at package
# init would re-introduce a cycle (orchestrator imports pathfinding). the
# sibling `safety_validator` / `types` packages and the package self-import
# (`import ...pathfinding as _pf`, the astar seam) are deliberately allowed.
_FORBIDDEN_TRAJECTORY_MODULES = {
    "orchestrator",
    "methods",
    "heading_optimizer",
    "helpers",
    "config_resolver",
}


def test_full_surface_importable_from_package_root():
    """every external + private symbol still resolves off the package root."""
    every = (
        _GRAPH_CALLABLES
        | _GRAPH_CONSTANTS
        | _TRANSIT_CALLABLES
        | _INTER_PASS_CALLABLES
        | _INTER_PASS_CONSTANTS
        | _REROUTE_CALLABLES
    )
    for name in every:
        assert hasattr(pathfinding, name), name


def test_all_lists_at_least_the_ac_external_surface():
    """__all__ re-exports the four orchestrator symbols + every patched helper."""
    exported = set(pathfinding.__all__)
    assert _AC_EXTERNAL_SURFACE <= exported
    for name in _AC_EXTERNAL_SURFACE:
        assert hasattr(pathfinding, name), name


def test_symbols_live_in_their_assigned_submodule():
    """the per-file seam matches the acceptance criteria exactly."""
    for name in _GRAPH_CALLABLES:
        assert getattr(pathfinding, name).__module__.endswith("pathfinding._graph"), name
    for name in _TRANSIT_CALLABLES:
        assert getattr(pathfinding, name).__module__.endswith("pathfinding._transit"), name
    for name in _INTER_PASS_CALLABLES:
        assert getattr(pathfinding, name).__module__.endswith("pathfinding._inter_pass"), name
    for name in _REROUTE_CALLABLES:
        assert getattr(pathfinding, name).__module__.endswith("pathfinding._reroute"), name


def test_no_external_trajectory_import_at_package_init():
    """no submodule imports a pathfinding-external trajectory module."""
    for py in _PKG_DIR.glob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                head = node.module.split(".")[0]
                assert head not in _FORBIDDEN_TRAJECTORY_MODULES, (py.name, node.module)
            if isinstance(node, ast.Import):
                for alias in node.names:
                    parts = alias.name.split(".")
                    assert not (
                        "trajectory" in parts
                        and any(m in parts for m in _FORBIDDEN_TRAJECTORY_MODULES)
                    ), (py.name, alias.name)


def _ctx_with_surface(surface: LocalSurface) -> pathfinding._TransitContext:
    """a 2-pass context whose transit 0 is blocked only by a runway surface.

    mirrors the proven `TestComputeOneTransitLifted` geometry: the fast path
    bails on the runway crossing, then the dilation loop calls `astar`.
    """
    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)

    def to_pt(x, y, alt=100.0):
        lon, lat = proj.to_wgs84(x, y)
        return Point3D(lon=lon, lat=lat, alt=alt)

    endpoints = [
        (to_pt(0.0, -50.0), to_pt(100.0, -50.0)),
        (to_pt(200.0, -50.0), to_pt(300.0, -50.0)),
    ]
    geoms = LocalGeometries(
        proj=proj, obstacles=[], zones=[], boundary_zones=[], surfaces=[surface]
    )
    all_local: list[tuple[float, float]] = []
    for first, last in endpoints:
        all_local.append(proj.to_local(first.lon, first.lat))
        all_local.append(proj.to_local(last.lon, last.lat))
    return pathfinding._TransitContext(
        pass_endpoints=endpoints,
        local_geoms=geoms,
        proj=proj,
        hull=MultiPoint(all_local).convex_hull,
        speed=5.0,
        elevation_provider=None,
        transit_agl=TRANSIT_AGL,
        buffer_distance_override=None,
        require_perpendicular_runway_crossing=True,
        keep_inside_airport_boundary=False,
    )


def test_astar_monkeypatch_seam_reaches_compute_one_transit(monkeypatch):
    """patching `pathfinding.astar` still reaches `_compute_one_transit`.

    the split moved `_compute_one_transit` into `_transit.py`; it must resolve
    `astar` off this package object so the long-standing
    `monkeypatch.setattr(pathfinding, "astar", ...)` seam keeps working.
    """
    surface = LocalSurface(
        polygon=box(120.0, -200.0, 160.0, 200.0),
        centerline=LineString([(140.0, -200.0), (140.0, 200.0)]),
        identifier="RW-CROSS",
        surface_type="runway",
        width=40.0,
        length=400.0,
        heading=0.0,
    )
    monkeypatch.setattr(pathfinding, "astar", lambda *a, **k: None)
    with pytest.raises(TrajectoryGenerationError):
        pathfinding._compute_one_transit(_ctx_with_surface(surface), 0)
