"""unified inter-pass visibility-graph core (MEASUREMENTS_ONLY trajectory core)."""

import functools
import os
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

from shapely.geometry import MultiPoint, Point
from shapely.ops import unary_union

import app.services.trajectory.pathfinding as _pf
from app.core.enums import CameraAction, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.utils.geo import bearing_between

from ..safety_validator import (
    resolve_obstacle_buffer,
    segment_runway_crossing_length,
)
from ..types import (
    GRID_NODE_SPACING,
    HARD_ZONE_TYPES,
    TRANSIT_AGL,
    LocalGeometries,
    LocalObstacle,
    LocalSurface,
    LocalZone,
    Meters,
    MetersPerSecond,
    Point3D,
    WaypointData,
)
from ._graph import (
    _build_visibility_graph,
    _is_segment_blocked,
    _runway_crossing_node_pairs,
    _segment_exits_airport_boundary,
    _surface_edge_nodes,
)
from ._transit import (
    _adjust_transit_altitude_for_terrain,
    _buffered_polygon_for,
    _check_cruise_clearance,
    _check_endpoint_outside_obstacles,
    _polygon_exterior_vertices,
)

# bounded dilation cap for the unified inter-pass visibility graph
MAX_INTER_PASS_DILATION_ATTEMPTS = 3  # initial + 2 dilations


def _try_fast_inter_pass_transit(
    from_point: Point3D,
    to_point: Point3D,
    local_geoms: LocalGeometries,
    speed: MetersPerSecond,
    elevation_provider,
    transit_agl: Meters,
    buffer_distance_override: float | None,
    require_perpendicular_runway_crossing: bool,
    keep_inside_airport_boundary: bool = False,
) -> list[WaypointData] | None:
    """return a single TRANSIT waypoint if a straight line is clear, else None."""
    proj = local_geoms.proj
    from_x, from_y = proj.to_local(from_point.lon, from_point.lat)
    to_x, to_y = proj.to_local(to_point.lon, to_point.lat)

    fast_buffer = buffer_distance_override if buffer_distance_override is not None else 0.0
    if _is_segment_blocked(
        from_x,
        from_y,
        to_x,
        to_y,
        local_geoms.obstacles,
        local_geoms.zones,
        buffer_distance=fast_buffer,
    ):
        return None

    if local_geoms.surfaces and require_perpendicular_runway_crossing:
        for surface in local_geoms.surfaces:
            if segment_runway_crossing_length(from_x, from_y, to_x, to_y, surface.polygon) > 0:
                return None

    if _segment_exits_airport_boundary(
        from_x,
        from_y,
        to_x,
        to_y,
        local_geoms.boundary_zones,
        keep_inside_airport_boundary,
    ):
        return None

    wps = [
        WaypointData(
            lon=to_point.lon,
            lat=to_point.lat,
            alt=to_point.alt,
            heading=bearing_between(from_point.lon, from_point.lat, to_point.lon, to_point.lat),
            speed=speed,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        )
    ]
    _adjust_transit_altitude_for_terrain(wps, elevation_provider, transit_agl)
    _check_cruise_clearance(wps, local_geoms)
    return wps


def _intersecting_obstacles(
    obstacles: list[LocalObstacle],
    region,
    buffer_distance_override: float | None,
) -> list[tuple[LocalObstacle, object]]:
    """obstacles whose buffered polygon intersects the routable region."""
    intersecting: list[tuple[LocalObstacle, object]] = []
    for obs in obstacles:
        buffered = _buffered_polygon_for(obs, buffer_distance_override)
        if buffered.intersects(region):
            intersecting.append((obs, buffered))
    return intersecting


def _build_unified_region(
    hull,
    intersecting: list[tuple[LocalObstacle, object]],
):
    """union the hull with the buffered polygons of every intersecting obstacle."""
    if not intersecting:
        return hull
    return unary_union([hull, *(b for _, b in intersecting)])


def _path_to_transit_waypoints(
    path: list[tuple[float, float, float]],
    from_local: tuple[float, float, float],
    to_local: tuple[float, float, float],
    local_geoms: LocalGeometries,
    speed: MetersPerSecond,
    elevation_provider,
    transit_agl: Meters,
) -> list[WaypointData]:
    """convert a unified-graph path into TRANSIT waypoints with terrain-aware altitudes."""
    proj = local_geoms.proj
    fallback_alt = max(from_local[2], to_local[2])

    wps: list[WaypointData] = []
    for k in range(1, len(path)):
        prev_lon, prev_lat = proj.to_wgs84(path[k - 1][0], path[k - 1][1])
        cur_lon, cur_lat = proj.to_wgs84(path[k][0], path[k][1])
        wps.append(
            WaypointData(
                lon=cur_lon,
                lat=cur_lat,
                alt=fallback_alt,
                heading=bearing_between(prev_lon, prev_lat, cur_lon, cur_lat),
                speed=speed,
                waypoint_type=WaypointType.TRANSIT,
                camera_action=CameraAction.NONE,
            )
        )

    _adjust_transit_altitude_for_terrain(wps, elevation_provider, transit_agl)
    _check_cruise_clearance(wps, local_geoms)
    return wps


class _UnifiedAttemptCache(NamedTuple):
    """per-dilation-attempt cache for the unified inter-pass visibility graph."""

    region: object
    intersecting: list[tuple[LocalObstacle, object]]
    region_nodes: list[tuple[float, float]]
    surface_edge_nodes: list[tuple[float, float]]
    grid_nodes: list[tuple[float, float]]


class _TransitContext(NamedTuple):
    """immutable free-variable bundle threaded into `_compute_one_transit`.

    every field is read-only across workers; per-worker `local_cache` +
    `cur_dilation` stay function-locals in `_compute_one_transit` so parallel
    transits never share dilation state.
    """

    pass_endpoints: list[tuple[Point3D, Point3D]]
    local_geoms: LocalGeometries
    proj: object
    hull: object
    speed: MetersPerSecond
    elevation_provider: object
    transit_agl: Meters
    buffer_distance_override: float | None
    require_perpendicular_runway_crossing: bool
    keep_inside_airport_boundary: bool


def _surface_edge_nodes_in_region(
    surfaces: list[LocalSurface],
    cur_hull,
) -> list[tuple[float, float]]:
    """surface centerline edge nodes (±half_w spaced at SURFACE_NODE_SPACING) inside cur_hull.

    thin wrapper over `_surface_edge_nodes` with the dilated-hull containment
    predicate; the per-pass `_collect_graph_nodes_in_circle` uses the same
    helper with its search-circle predicate so node spacing stays in lockstep.
    """
    return _surface_edge_nodes(surfaces, lambda x, y: cur_hull.contains(Point(x, y)))


def _grid_fill_in_region(
    cur_hull,
    intersecting: list[tuple[LocalObstacle, object]],
    zones: list[LocalZone],
    surfaces: list[LocalSurface],
) -> list[tuple[float, float]]:
    """regular GRID_NODE_SPACING grid fill inside cur_hull, excluding no-go polygons.

    excludes buffered obstacles (via `intersecting`), hard zones, and surfaces
    (LocalSurface.polygon is already inflated by `buffer_distance`). degenerate
    hulls (Point/LineString from collinear pass endpoints) yield no grid nodes
    because `contains` is strict for zero-area shapes.
    """
    if cur_hull.is_empty or cur_hull.area == 0:
        return []

    exclusion_polys: list = [b for _, b in intersecting]
    for zone in zones:
        if zone.zone_type in HARD_ZONE_TYPES:
            exclusion_polys.append(zone.polygon)
    for surface in surfaces:
        exclusion_polys.append(surface.polygon)

    xmin, ymin, xmax, ymax = cur_hull.bounds
    nodes: list[tuple[float, float]] = []
    x = xmin
    while x <= xmax:
        y = ymin
        while y <= ymax:
            pt = Point(x, y)
            if cur_hull.contains(pt) and not any(ep.contains(pt) for ep in exclusion_polys):
                nodes.append((x, y))
            y += GRID_NODE_SPACING
        x += GRID_NODE_SPACING
    return nodes


def _compute_one_transit(
    ctx: _TransitContext, transit_idx: int
) -> tuple[list[WaypointData], list[str]]:
    """compute waypoints + emitted warnings for one inter-pass transit; thread-safe.

    `local_cache` + `cur_dilation` stay function-locals so every parallel worker
    rebuilds its own dilation state - no cross-transit sharing.
    """
    last_pt = ctx.pass_endpoints[transit_idx][1]
    first_next_pt = ctx.pass_endpoints[transit_idx + 1][0]

    # fast path: clear straight line, no runway crossing
    fast_wps = _try_fast_inter_pass_transit(
        last_pt,
        first_next_pt,
        ctx.local_geoms,
        ctx.speed,
        ctx.elevation_provider,
        ctx.transit_agl,
        ctx.buffer_distance_override,
        ctx.require_perpendicular_runway_crossing,
        ctx.keep_inside_airport_boundary,
    )
    if fast_wps is not None:
        return fast_wps, []

    from_local = (
        *ctx.proj.to_local(last_pt.lon, last_pt.lat),
        last_pt.alt,
    )
    to_local = (
        *ctx.proj.to_local(first_next_pt.lon, first_next_pt.lat),
        first_next_pt.alt,
    )

    # crossing-pair nodes are independent of the hull dilation - compute once
    crossing_pairs: list[tuple[float, float]] = (
        _runway_crossing_node_pairs(
            (from_local[0], from_local[1]),
            (to_local[0], to_local[1]),
            ctx.local_geoms.surfaces or [],
        )
        if ctx.require_perpendicular_runway_crossing
        else []
    )

    # per-worker cache + dilation state - keeps the loop thread-safe
    local_cache: dict[int, _UnifiedAttemptCache] = {}
    cur_dilation = 0.0
    local_warnings: list[str] = []
    path: list[tuple[float, float, float]] | None = None
    region = None

    for attempt in range(MAX_INTER_PASS_DILATION_ATTEMPTS):
        cached = local_cache.get(attempt)
        if cached is not None:
            region = cached.region
            intersecting = cached.intersecting
            region_nodes = cached.region_nodes
            surface_edge_nodes = cached.surface_edge_nodes
            grid_nodes = cached.grid_nodes
        else:
            cur_hull = ctx.hull.buffer(cur_dilation) if cur_dilation > 0 else ctx.hull
            intersecting = _intersecting_obstacles(
                ctx.local_geoms.obstacles, cur_hull, ctx.buffer_distance_override
            )
            region = _build_unified_region(cur_hull, intersecting)
            region_nodes = list(_polygon_exterior_vertices(region))
            for _, buffered in intersecting:
                region_nodes.extend(_polygon_exterior_vertices(buffered))
            surface_edge_nodes = _surface_edge_nodes_in_region(
                ctx.local_geoms.surfaces or [], cur_hull
            )
            grid_nodes = _grid_fill_in_region(
                cur_hull,
                intersecting,
                ctx.local_geoms.zones,
                ctx.local_geoms.surfaces or [],
            )
            local_cache[attempt] = _UnifiedAttemptCache(
                region=region,
                intersecting=intersecting,
                region_nodes=region_nodes,
                surface_edge_nodes=surface_edge_nodes,
                grid_nodes=grid_nodes,
            )

        nodes: list[tuple[float, float, float]] = [from_local, to_local]
        nodes.extend((x, y, 0.0) for (x, y) in region_nodes)
        nodes.extend((x, y, 0.0) for (x, y) in surface_edge_nodes)
        nodes.extend((x, y, 0.0) for (x, y) in crossing_pairs)
        grid_start_index = len(nodes)
        nodes.extend((x, y, 0.0) for (x, y) in grid_nodes)

        obstacles_for_graph = [obs for obs, _ in intersecting]
        graph = _build_visibility_graph(
            nodes,
            obstacles_for_graph,
            ctx.local_geoms.zones,
            ctx.local_geoms.surfaces,
            buffer_distance=(
                ctx.buffer_distance_override if ctx.buffer_distance_override is not None else 0.0
            ),
            require_perpendicular_runway_crossing=ctx.require_perpendicular_runway_crossing,
            grid_start_index=grid_start_index,
            boundaries=ctx.local_geoms.boundary_zones,
            keep_inside_airport_boundary=ctx.keep_inside_airport_boundary,
        )
        # astar is resolved off the package object (not a direct import) so the
        # `monkeypatch.setattr(pathfinding, "astar", ...)` seam still reaches
        # this call after the package split
        path_indices = _pf.astar(graph, 0, 1, nodes, use_euclidean=True)
        if path_indices is not None:
            path = [nodes[i] for i in path_indices]
            if attempt > 0:
                local_warnings.append(
                    f"transit graph expanded {attempt}× to find path between "
                    f"passes {transit_idx + 1} and {transit_idx + 2}"
                )
            break

        if attempt == MAX_INTER_PASS_DILATION_ATTEMPTS - 1:
            break

        # adaptive Δ: largest buffer among obstacles not yet enclosed by the region
        not_enclosed: list[LocalObstacle] = []
        for obs in ctx.local_geoms.obstacles:
            buffered = _buffered_polygon_for(obs, ctx.buffer_distance_override)
            if not region.contains(buffered):
                not_enclosed.append(obs)
        if not not_enclosed:
            raise TrajectoryGenerationError(
                "expansion exhausted, no obstacles left to reach - "
                "failure not fixable by graph expansion"
            )
        delta = max(
            resolve_obstacle_buffer(obs, ctx.buffer_distance_override) for obs in not_enclosed
        )
        cur_dilation += delta
        local_cache.clear()

    if path is None:
        raise TrajectoryGenerationError("no path after 2 dilations")

    wps = _path_to_transit_waypoints(
        path,
        from_local,
        to_local,
        ctx.local_geoms,
        ctx.speed,
        ctx.elevation_provider,
        ctx.transit_agl,
    )
    return wps, local_warnings


def compute_inter_pass_transits(
    pass_endpoints: list[tuple[Point3D, Point3D]],
    local_geoms: LocalGeometries,
    speed: MetersPerSecond,
    *,
    elevation_provider=None,
    transit_agl: Meters = TRANSIT_AGL,
    buffer_distance_override: float | None = None,
    require_perpendicular_runway_crossing: bool = True,
    keep_inside_airport_boundary: bool = False,
) -> tuple[list[list[WaypointData]], list[str]]:
    """compute A* transit between consecutive inspection passes via a unified visibility graph.

    this is the MEASUREMENTS_ONLY trajectory core. pass_endpoints is a contiguous
    sequence of (first_mh_wp, last_mh_wp) pairs - one per surviving pass. callers
    must drop empty passes upstream so adjacent entries name consecutive non-empty
    passes; this function pairs them strictly index-by-index and returns exactly
    len(pass_endpoints) - 1 transits.

    the convex hull of every pass endpoint (dilated as needed), unioned with the
    buffered polygons of obstacles that intersect it, forms a single region whose
    nodes feed one visibility graph per transit. node sources mirror the per-pass
    A* in `_collect_graph_nodes_in_circle`:
      - region exterior + buffered-obstacle vertices (corner candidates)
      - surface centerline edge nodes (±half_w spaced at SURFACE_NODE_SPACING)
        kept inside the dilated hull
      - perpendicular crossing nodes (`_runway_crossing_node_pairs`) for the
        from->to line so A* always has a short crossing edge available
      - GRID_NODE_SPACING grid fill inside the dilated hull, with buffered
        obstacles, hard zones, and surfaces excluded as no-go regions

    on no-path the hull is dilated by an adaptive Δ (max buffer of obstacles not yet
    enclosed) and the graph is rebuilt; total cap is two dilations. failure modes
    are distinguished:
      - "inspection endpoint inside obstacle keepout"  (pre-flight)
      - "expansion exhausted, no obstacles left to reach"  (mid-loop)
      - "no path after 2 dilations"  (final)

    returns (transits, warnings) where transits[i] is the waypoint list for the
    transit between input[i] and input[i+1], and warnings notes any expansions used.
    """
    transits: list[list[WaypointData]] = []
    warnings: list[str] = []

    if len(pass_endpoints) < 2:
        return transits, warnings

    proj = local_geoms.proj

    # pre-flight: every transit start/end must sit outside obstacle keepouts
    for i in range(len(pass_endpoints) - 1):
        _check_endpoint_outside_obstacles(
            pass_endpoints[i][1], local_geoms, buffer_distance_override
        )
        _check_endpoint_outside_obstacles(
            pass_endpoints[i + 1][0], local_geoms, buffer_distance_override
        )

    # convex hull of all inspection start/end points (single closed region)
    all_points_local: list[tuple[float, float]] = []
    for first, last in pass_endpoints:
        all_points_local.append(proj.to_local(first.lon, first.lat))
        all_points_local.append(proj.to_local(last.lon, last.lat))
    hull = MultiPoint(all_points_local).convex_hull

    ctx = _TransitContext(
        pass_endpoints=pass_endpoints,
        local_geoms=local_geoms,
        proj=proj,
        hull=hull,
        speed=speed,
        elevation_provider=elevation_provider,
        transit_agl=transit_agl,
        buffer_distance_override=buffer_distance_override,
        require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        keep_inside_airport_boundary=keep_inside_airport_boundary,
    )
    compute_one = functools.partial(_compute_one_transit, ctx)

    n_transits = len(pass_endpoints) - 1
    parallel_enabled = os.environ.get("TRAJECTORY_PARALLEL_VG", "1") != "0"

    if parallel_enabled and n_transits > 1:
        max_workers = min(n_transits, os.cpu_count() or 1)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            ordered = list(executor.map(compute_one, range(n_transits)))
    else:
        ordered = [compute_one(i) for i in range(n_transits)]

    for wps, transit_warnings in ordered:
        transits.append(wps)
        warnings.extend(transit_warnings)

    return transits, warnings
