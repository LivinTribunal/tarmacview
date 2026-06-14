"""visibility-graph construction + circle-based A* primitives."""

import math

import numpy as np
import shapely
from shapely.creation import linestrings as _shapely_linestrings
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from app.core.config import settings
from app.core.constants import DETERMINANT_DEGENERACY_EPSILON
from app.utils.geo import astar, euclidean_distance

from ..safety_validator import (
    resolve_obstacle_buffer,
    segments_intersect_obstacle,
    segments_intersect_zone,
)
from ..types import (
    BOUNDARY_EGRESS_PENALTY_PER_METER,
    DEFAULT_OBSTACLE_RADIUS,
    GRID_EDGE_RADIUS,
    GRID_NODE_SPACING,
    HARD_ZONE_TYPES,
    RUNWAY_CROSSING_PENALTY_PER_METER,
    SURFACE_NODE_SPACING,
    Degrees,
    LocalBoundary,
    LocalGeometries,
    LocalObstacle,
    LocalSurface,
    LocalZone,
    Meters,
    Point3D,
    WaypointData,
)

# search radius constants for circle-based A*
MIN_SEARCH_RADIUS: Meters = 200.0
SEARCH_RADIUS_MARGIN = 1.2
SEARCH_RADIUS_EXPANSION = 1.5
MAX_ASTAR_RETRIES = 3


def _extract_local_polygon_vertices(
    polygon, buffer_m: float | None = None
) -> list[tuple[float, float]]:
    """extract vertices from Shapely polygon in local coords, offset outward by buffer distance."""
    offset = buffer_m if buffer_m is not None else settings.vertex_buffer_m

    buffered = polygon.buffer(offset)
    if buffered.is_empty:
        return []

    coords = list(buffered.exterior.coords)

    # skip closing duplicate of a closed ring
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]

    return [(c[0], c[1]) for c in coords]


def _collect_nearby_objects_local(
    local_geoms: LocalGeometries,
    center_x: float,
    center_y: float,
    search_radius: Meters,
    buffer_distance_override: float | None = None,
) -> tuple[list[LocalObstacle], list[LocalZone]]:
    """collect obstacles and hard safety zones within search_radius of center."""
    nearby_obs = []
    for obs in local_geoms.obstacles:
        buf = resolve_obstacle_buffer(obs, buffer_distance_override)
        buffered = obs.polygon.buffer(buf) if buf > 0 else obs.polygon
        c = buffered.centroid
        if euclidean_distance(center_x, center_y, c.x, c.y) <= search_radius:
            nearby_obs.append(obs)

    nearby_zones = []
    for zone in local_geoms.zones:
        if zone.zone_type not in HARD_ZONE_TYPES:
            continue
        c = zone.polygon.centroid
        if euclidean_distance(center_x, center_y, c.x, c.y) <= search_radius:
            nearby_zones.append(zone)

    return nearby_obs, nearby_zones


def _segment_exits_airport_boundary(
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    boundaries: list[LocalBoundary] | None,
    keep_inside_airport_boundary: bool,
) -> bool:
    """check whether a direct segment would leave the airport boundary union.

    when keep_inside_airport_boundary is true and the segment has any length
    outside the boundary union, the fast-path must fall through to A* so the
    solver can consider a detour that stays inside.
    """
    if not boundaries or not keep_inside_airport_boundary:
        return False
    line = LineString([(from_x, from_y), (to_x, to_y)])
    inside_total = 0.0
    for b in boundaries:
        if line.intersects(b.polygon):
            inside_total += line.intersection(b.polygon).length
    return inside_total < line.length


def _is_segment_blocked(
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    obstacles: list[LocalObstacle],
    zones: list[LocalZone],
    buffer_distance: Meters = 0.0,
) -> bool:
    """check if a straight-line segment is blocked by obstacles or hard zones."""
    for obs in obstacles:
        if segments_intersect_obstacle(from_x, from_y, to_x, to_y, obs, buffer_distance):
            return True

    for zone in zones:
        if zone.zone_type not in HARD_ZONE_TYPES:
            continue
        if segments_intersect_zone(from_x, from_y, to_x, to_y, zone.polygon):
            return True

    return False


def _build_visibility_graph(
    nodes: list[tuple[float, float, float]],
    obstacles: list[LocalObstacle],
    zones: list[LocalZone],
    surfaces: list[LocalSurface] | None = None,
    buffer_distance: Meters = 0.0,
    require_perpendicular_runway_crossing: bool = True,
    grid_start_index: int = -1,
    boundaries: list[LocalBoundary] | None = None,
    keep_inside_airport_boundary: bool = False,
) -> dict[int, list[tuple[int, float]]]:
    """build adjacency list where edges connect unobstructed node pairs.

    when require_perpendicular_runway_crossing is True (UI: "Avoid runway
    crossings"), edges crossing runways get a per-meter penalty so A* prefers
    a short go-around; perpendicular crossing nodes (`_runway_crossing_node_pairs`,
    fed in by both `_collect_graph_nodes_in_circle` and `compute_inter_pass_transits`)
    are the fallback when the only go-around is the full runway perimeter. when
    False, no crossing penalty is applied so the planner picks the shortest
    geodesic. the legacy field name is kept to avoid a schema/migration churn.

    when keep_inside_airport_boundary is True, every meter of each edge that
    lies outside the boundary union is penalized so A* favours staying inside.
    False skips the branch entirely so weights are byte-identical to the
    no-preference shape - paired with the geozone export, which the drone
    firmware enforces as a hard geofence in flight.

    when grid_start_index >= 0, grid-to-grid edges beyond GRID_EDGE_RADIUS
    are skipped to keep the O(N^2) check manageable.

    all coordinates are in local meters. edge weights use euclidean distance.
    """
    n = len(nodes)
    graph: dict[int, list[tuple[int, float]]] = {i: [] for i in range(n)}

    # buffered obstacles + hard zones combined into one blocking set
    blocking_polys: list = []
    for obs in obstacles:
        buf = resolve_obstacle_buffer(obs, buffer_distance)
        blocking_polys.append(obs.polygon.buffer(buf) if buf > 0 else obs.polygon)
    for zone in zones:
        if zone.zone_type in HARD_ZONE_TYPES:
            blocking_polys.append(zone.polygon)

    surface_polys: list = []
    if surfaces and require_perpendicular_runway_crossing:
        surface_polys = [s.polygon for s in surfaces]

    # collect surviving (i, j) pairs and their endpoint coords as a numpy array
    pair_i: list[int] = []
    pair_j: list[int] = []
    pair_coords: list[list[list[float]]] = []
    for i in range(n):
        for j in range(i + 1, n):
            xi, yi = nodes[i][0], nodes[i][1]
            xj, yj = nodes[j][0], nodes[j][1]

            # grid-to-grid neighbor-radius optimization
            if grid_start_index >= 0 and i >= grid_start_index and j >= grid_start_index:
                if euclidean_distance(xi, yi, xj, yj) > GRID_EDGE_RADIUS:
                    continue

            pair_i.append(i)
            pair_j.append(j)
            pair_coords.append([[xi, yi], [xj, yj]])

    if not pair_i:
        return graph

    coords_arr = np.asarray(pair_coords, dtype=float)
    lines = _shapely_linestrings(coords_arr)
    num_lines = lines.shape[0]

    # batched blocking check - STRtree predicate-mode collapses bbox+intersect into one call
    blocked = np.zeros(num_lines, dtype=bool)
    if blocking_polys:
        blocking_tree = STRtree(blocking_polys)
        b_hits = blocking_tree.query(lines, predicate="intersects")
        if b_hits.size > 0:
            blocked[b_hits[0]] = True

    # batched surface-crossing penalty - bbox+intersect candidates only,
    # accumulated in surface-list order so multi-surface FP sums match the reference
    penalty_per_edge = np.zeros(num_lines, dtype=float)
    if surface_polys:
        surface_tree = STRtree(surface_polys)
        s_hits = surface_tree.query(lines, predicate="intersects")
        if s_hits.size > 0:
            # drop blocked-line hits before the GEOS intersection batch - blocked
            # edges are skipped by the graph-write loop below, so their crossings
            # cannot contribute to penalty_per_edge anyway, and on dense missions
            # the blocked fraction can be 80%+ of all surface hits
            keep = ~blocked[s_hits[0]]
            line_idxs = s_hits[0][keep]
            poly_idxs = s_hits[1][keep]
            if line_idxs.size > 0:
                order = np.lexsort((poly_idxs, line_idxs))
                ordered_lines = line_idxs[order]
                ordered_polys = poly_idxs[order]
                polys_arr = np.asarray(surface_polys, dtype=object)
                intersections = shapely.intersection(lines[ordered_lines], polys_arr[ordered_polys])
                crossings = shapely.length(intersections)
                for k in range(ordered_lines.shape[0]):
                    crossing = float(crossings[k])
                    if crossing > 0:
                        penalty_per_edge[int(ordered_lines[k])] += (
                            crossing * RUNWAY_CROSSING_PENALTY_PER_METER
                        )

    # batched boundary-egress penalty - mirrors the runway-crossing block.
    # every meter of each edge OUTSIDE the boundary union is penalized so A*
    # favours staying inside. off skips the branch entirely so the weights stay
    # byte-identical to the no-preference shape.
    boundary_polys: list = []
    if boundaries and keep_inside_airport_boundary:
        boundary_polys = [b.polygon for b in boundaries]
    if boundary_polys:
        # edge length once per line - the outside fraction needs both halves
        edge_lengths = shapely.length(lines)
        boundary_tree = STRtree(boundary_polys)
        b_inside = np.zeros(num_lines, dtype=float)
        b_hits_b = boundary_tree.query(lines, predicate="intersects")
        if b_hits_b.size > 0:
            keep = ~blocked[b_hits_b[0]]
            line_idxs = b_hits_b[0][keep]
            poly_idxs = b_hits_b[1][keep]
            if line_idxs.size > 0:
                order = np.lexsort((poly_idxs, line_idxs))
                ordered_lines = line_idxs[order]
                ordered_polys = poly_idxs[order]
                polys_arr = np.asarray(boundary_polys, dtype=object)
                intersections = shapely.intersection(lines[ordered_lines], polys_arr[ordered_polys])
                inside_lengths = shapely.length(intersections)
                # accumulate inside-length per edge; multiple boundary polys sum naturally
                for k in range(ordered_lines.shape[0]):
                    inside = float(inside_lengths[k])
                    if inside > 0:
                        b_inside[int(ordered_lines[k])] += inside
        outside = np.maximum(edge_lengths - b_inside, 0.0)
        penalty_per_edge += outside * BOUNDARY_EGRESS_PENALTY_PER_METER

    # vectorized edge weight: euclidean + accumulated penalty in one numpy pass
    dx = coords_arr[:, 1, 0] - coords_arr[:, 0, 0]
    dy = coords_arr[:, 1, 1] - coords_arr[:, 0, 1]
    weights = np.hypot(dx, dy) + penalty_per_edge

    for k in range(num_lines):
        if blocked[k]:
            continue
        dist = float(weights[k])
        graph[pair_i[k]].append((pair_j[k], dist))
        graph[pair_j[k]].append((pair_i[k], dist))

    return graph


def _runway_crossing_node_pairs(
    p0: tuple[float, float],
    p1: tuple[float, float],
    surfaces: list[LocalSurface],
) -> list[tuple[float, float]]:
    """foot-of-perpendicular crossing nodes for the line p0->p1 across each surface.

    drops a node pair on each side of every runway centerline at the point where
    the from->to line meets it (clamped to runway extent). feeds the visibility
    graph so A* always has a short crossing edge available alongside any
    go-around the obstacle/zone hull provides.

    coords in local meters; offset is `width/2 + buffer_distance + vertex_buffer_m`
    so nodes land just outside the buffered surface polygon.
    """
    pairs: list[tuple[float, float]] = []
    edx = p1[0] - p0[0]
    edy = p1[1] - p0[1]
    for surface in surfaces:
        cl_coords = list(surface.centerline.coords)
        if len(cl_coords) < 2:
            continue
        start = cl_coords[0]
        end = cl_coords[-1]
        rdx = end[0] - start[0]
        rdy = end[1] - start[1]
        cl_len = math.hypot(rdx, rdy)
        if cl_len == 0:
            continue
        denom = edx * rdy - edy * rdx
        if abs(denom) <= DETERMINANT_DEGENERACY_EPSILON:
            continue
        u = ((p0[1] - start[1]) * edx - (p0[0] - start[0]) * edy) / denom
        u = max(0.0, min(1.0, u))
        proj_x = start[0] + u * rdx
        proj_y = start[1] + u * rdy
        ux, uy = rdx / cl_len, rdy / cl_len
        half_w = surface.width / 2.0 + surface.buffer_distance + settings.vertex_buffer_m
        pairs.append((proj_x - uy * half_w, proj_y + ux * half_w))
        pairs.append((proj_x + uy * half_w, proj_y - ux * half_w))
    return pairs


def _surface_edge_nodes(
    surfaces: list[LocalSurface],
    contains_fn,
) -> list[tuple[float, float]]:
    """surface centerline edge nodes (±half_w spaced at SURFACE_NODE_SPACING).

    walks each surface centerline at SURFACE_NODE_SPACING and emits the two
    perpendicular offsets per step that pass contains_fn(x, y). shared by the
    per-pass A* (`_collect_graph_nodes_in_circle`, search-circle predicate) and
    the inter-pass core (`_surface_edge_nodes_in_region`, dilated-hull
    predicate) so the half_w / num_points spacing stays in lockstep.
    """
    nodes: list[tuple[float, float]] = []
    for surface in surfaces:
        cl_coords = list(surface.centerline.coords)
        if len(cl_coords) < 2:
            continue

        start = cl_coords[0]
        end = cl_coords[-1]
        length = surface.length or surface.centerline.length
        half_w = (surface.width / 2.0) + surface.buffer_distance + settings.vertex_buffer_m

        # direction unit vector along centerline
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        cl_len = math.hypot(dx, dy)
        if cl_len == 0:
            continue
        ux, uy = dx / cl_len, dy / cl_len
        # perpendicular directions (left and right)
        perp_lx, perp_ly = -uy, ux
        perp_rx, perp_ry = uy, -ux

        # walk along centerline at spacing intervals
        num_points = max(2, int(length / SURFACE_NODE_SPACING) + 1)
        for k in range(num_points):
            frac = k / (num_points - 1)
            x = start[0] + (end[0] - start[0]) * frac
            y = start[1] + (end[1] - start[1]) * frac
            xl, yl = x + perp_lx * half_w, y + perp_ly * half_w
            xr, yr = x + perp_rx * half_w, y + perp_ry * half_w
            if contains_fn(xl, yl):
                nodes.append((xl, yl))
            if contains_fn(xr, yr):
                nodes.append((xr, yr))
    return nodes


def _collect_graph_nodes_in_circle(
    endpoints: list[tuple[float, float, float]],
    obstacles: list[LocalObstacle],
    zones: list[LocalZone],
    surfaces: list[LocalSurface] | None,
    center: tuple[float, float],
    radius: Meters,
    buffer_distance_override: float | None = None,
    require_perpendicular_runway_crossing: bool = True,
) -> tuple[list[tuple[float, float, float]], int]:
    """collect nodes within search circle for visibility graph construction.

    includes endpoints, obstacle/zone vertices, surface edge nodes,
    and a regular grid fill in open space. returns (nodes, grid_start_index)
    where grid_start_index marks where grid nodes begin.
    all coordinates in local meters.
    """
    nodes = list(endpoints)

    def in_circle(x: float, y: float) -> bool:
        """check if point is within search radius of center."""
        return euclidean_distance(center[0], center[1], x, y) <= radius

    for obs in obstacles:
        buf = resolve_obstacle_buffer(obs, buffer_distance_override)
        for v in _extract_local_polygon_vertices(obs.polygon, buf):
            if in_circle(v[0], v[1]):
                nodes.append((v[0], v[1], 0.0))

    for zone in zones:
        if zone.zone_type in HARD_ZONE_TYPES:
            for v in _extract_local_polygon_vertices(zone.polygon):
                if in_circle(v[0], v[1]):
                    nodes.append((v[0], v[1], 0.0))

    # surface edge nodes - spaced along centerline at SURFACE_NODE_SPACING
    if surfaces:
        for sx, sy in _surface_edge_nodes(surfaces, in_circle):
            nodes.append((sx, sy, 0.0))

        # perpendicular crossing nodes - shared with compute_inter_pass_transits
        if require_perpendicular_runway_crossing and len(endpoints) >= 2:
            p0, p1 = endpoints[0], endpoints[1]
            for cx, cy in _runway_crossing_node_pairs((p0[0], p0[1]), (p1[0], p1[1]), surfaces):
                if in_circle(cx, cy):
                    nodes.append((cx, cy, 0.0))

    # grid fill - regular 2D grid in navigable open space
    grid_start_index = len(nodes)

    cruise_z = sum(ep[2] for ep in endpoints) / len(endpoints) if endpoints else 0.0

    # pre-build exclusion polygons
    exclusion_polys = []
    for obs in obstacles:
        buf = resolve_obstacle_buffer(obs, buffer_distance_override)
        buffered = obs.polygon.buffer(buf) if buf > 0 else obs.polygon
        exclusion_polys.append(buffered)

    for zone in zones:
        if zone.zone_type in HARD_ZONE_TYPES:
            exclusion_polys.append(zone.polygon)

    # surfaces are no-go for grid fill - LocalSurface.polygon is already inflated
    # by buffer_distance in app.utils.local_projection, so no extra padding here
    if surfaces:
        for surface in surfaces:
            exclusion_polys.append(surface.polygon)

    x_min = center[0] - radius
    x_max = center[0] + radius
    y_min = center[1] - radius
    y_max = center[1] + radius

    x = x_min
    while x <= x_max:
        y = y_min
        while y <= y_max:
            if in_circle(x, y):
                pt = Point(x, y)
                if not any(ep.contains(pt) for ep in exclusion_polys):
                    nodes.append((x, y, cruise_z))
            y += GRID_NODE_SPACING
        x += GRID_NODE_SPACING

    return nodes, grid_start_index


def _run_astar(
    from_local: tuple[float, float, float],
    to_local: tuple[float, float, float],
    obstacles: list[LocalObstacle],
    zones: list[LocalZone],
    surfaces: list[LocalSurface] | None = None,
    buffer_distance_override: float | None = None,
    require_perpendicular_runway_crossing: bool = True,
    boundaries: list[LocalBoundary] | None = None,
    keep_inside_airport_boundary: bool = False,
) -> list[tuple[float, float, float]] | None:
    """circle-based A* pathfinding with expanding search radius on failure.

    builds a visibility graph within a circle centered on the midpoint
    of from_local to to_local. expands the radius and retries if no
    path is found. all coordinates in local meters.
    """
    mid_x = (from_local[0] + to_local[0]) / 2
    mid_y = (from_local[1] + to_local[1]) / 2
    base_dist = euclidean_distance(from_local[0], from_local[1], to_local[0], to_local[1])
    radius = max(base_dist * SEARCH_RADIUS_MARGIN / 2, MIN_SEARCH_RADIUS)

    for attempt in range(MAX_ASTAR_RETRIES):
        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            [from_local, to_local],
            obstacles,
            zones,
            surfaces,
            (mid_x, mid_y),
            radius,
            buffer_distance_override=buffer_distance_override,
            require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        )
        graph = _build_visibility_graph(
            nodes,
            obstacles,
            zones,
            surfaces,
            buffer_distance=(
                buffer_distance_override if buffer_distance_override is not None else 0.0
            ),
            require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
            grid_start_index=grid_start_index,
            boundaries=boundaries,
            keep_inside_airport_boundary=keep_inside_airport_boundary,
        )

        path_indices = astar(graph, 0, 1, nodes, use_euclidean=True)
        if path_indices is not None:
            return [nodes[idx] for idx in path_indices]

        # expand search radius and retry
        radius *= SEARCH_RADIUS_EXPANSION

    return None


def has_line_of_sight(
    point: Point3D,
    target: Point3D,
    local_geoms: LocalGeometries,
    buffer_distance: Meters = 0.0,
) -> bool:
    """check if the line from point to target is clear of obstacles and hard zones."""
    proj = local_geoms.proj
    from_x, from_y = proj.to_local(point.lon, point.lat)
    to_x, to_y = proj.to_local(target.lon, target.lat)
    return not _is_segment_blocked(
        from_x,
        from_y,
        to_x,
        to_y,
        local_geoms.obstacles,
        local_geoms.zones,
        buffer_distance=buffer_distance,
    )


def _max_turn_angle(waypoints: list[WaypointData]) -> Degrees:
    """compute the maximum turn angle between consecutive waypoint headings."""
    max_angle = 0.0
    for i in range(1, len(waypoints)):
        diff = abs(waypoints[i].heading - waypoints[i - 1].heading)
        if diff > 180:
            diff = 360 - diff
        max_angle = max(max_angle, diff)

    return max_angle


def _max_effective_buffer(
    obstacles: list[LocalObstacle],
    buffer_distance_override: float | None,
) -> float:
    """largest effective buffer distance across all obstacles.

    delegates per-obstacle resolution to resolve_obstacle_buffer so the reroute
    search radius follows the same priority chain as every other site.
    """
    return max(
        (resolve_obstacle_buffer(obs, buffer_distance_override) for obs in obstacles),
        default=DEFAULT_OBSTACLE_RADIUS,
    )
