"""bookend transit path + shared keepout helpers consumed by the inter-pass core."""

from shapely.geometry import Point

from app.core.enums import CameraAction, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.utils.geo import bearing_between

from ..safety_validator import (
    resolve_obstacle_buffer,
    segment_runway_crossing_length,
    segments_intersect_obstacle,
    segments_intersect_zone,
)
from ..types import (
    HARD_ZONE_TYPES,
    TRANSIT_AGL,
    LocalGeometries,
    LocalObstacle,
    Meters,
    MetersPerSecond,
    Point3D,
    WaypointData,
)
from ._graph import (
    _is_segment_blocked,
    _run_astar,
    _segment_exits_airport_boundary,
)


def _adjust_transit_altitude_for_terrain(
    waypoints: list[WaypointData],
    elevation_provider,
    transit_agl: Meters = TRANSIT_AGL,
) -> None:
    """set transit waypoint altitudes to transit_agl above terrain."""
    if not elevation_provider or not waypoints:
        return

    points = [(wp.lat, wp.lon) for wp in waypoints]
    elevations = elevation_provider.get_elevations_batch(points)
    if len(elevations) != len(points):
        raise TrajectoryGenerationError(f"expected {len(points)} elevations, got {len(elevations)}")

    for wp, ground in zip(waypoints, elevations):
        wp.alt = ground + transit_agl


def _check_cruise_clearance(
    waypoints: list[WaypointData],
    local_geoms: LocalGeometries,
) -> None:
    """re-validate transit segments after altitude rewrite.

    after we rewrite transit altitudes to the cruise level, the segments
    could in principle cross an obstacle/zone that was fine at the old
    altitude. obstacles are checked in 2.5-D (segment intersects polygon AND
    segment altitude band overlaps [base_alt, base_alt + height]) so a short
    obstacle below cruise no longer raises; hard zones stay 2-D.
    """
    if not waypoints:
        return

    proj = local_geoms.proj
    for k in range(1, len(waypoints)):
        prev, cur = waypoints[k - 1], waypoints[k]
        from_x, from_y = proj.to_local(prev.lon, prev.lat)
        to_x, to_y = proj.to_local(cur.lon, cur.lat)

        seg_min_alt = min(prev.alt, cur.alt)
        seg_max_alt = max(prev.alt, cur.alt)
        for obs in local_geoms.obstacles:
            if not segments_intersect_obstacle(from_x, from_y, to_x, to_y, obs):
                continue
            obs_top = obs.base_alt + obs.height
            if seg_max_alt >= obs.base_alt and seg_min_alt <= obs_top:
                raise TrajectoryGenerationError("cruise altitude conflicts with obstacle clearance")

        for zone in local_geoms.zones:
            if zone.zone_type not in HARD_ZONE_TYPES:
                continue
            if segments_intersect_zone(from_x, from_y, to_x, to_y, zone.polygon):
                raise TrajectoryGenerationError("cruise altitude conflicts with obstacle clearance")


def compute_transit_path(
    from_point: Point3D,
    to_point: Point3D,
    local_geoms: LocalGeometries,
    speed: MetersPerSecond,
    elevation_provider=None,
    transit_agl: Meters = TRANSIT_AGL,
    buffer_distance_override: float | None = None,
    require_perpendicular_runway_crossing: bool = True,
    keep_inside_airport_boundary: bool = False,
) -> list[WaypointData]:
    """compute A* transit path - shortest obstacle-free route with runway crossing penalties.

    all returned transit waypoints share ground + transit_agl as their altitude
    so the vertical profile stays flat between inspection passes.

    when require_perpendicular_runway_crossing is False, runway crossings are
    treated like any other clear segment so the planner picks the shortest
    geodesic, minimising the runway-closure window the operator must request.
    """
    proj = local_geoms.proj
    from_x, from_y = proj.to_local(from_point.lon, from_point.lat)
    to_x, to_y = proj.to_local(to_point.lon, to_point.lat)

    # straight-line if path is clear and doesn't cross runway.
    # explicit fast path so we skip graph construction when a direct segment is clear;
    # _run_astar's graph would also reach the same straight segment, just slower.
    fast_path_buffer = buffer_distance_override if buffer_distance_override is not None else 0.0
    if not _is_segment_blocked(
        from_x,
        from_y,
        to_x,
        to_y,
        local_geoms.obstacles,
        local_geoms.zones,
        buffer_distance=fast_path_buffer,
    ):
        crosses_runway = False
        if local_geoms.surfaces and require_perpendicular_runway_crossing:
            for surface in local_geoms.surfaces:
                crossing = segment_runway_crossing_length(
                    from_x, from_y, to_x, to_y, surface.polygon
                )
                if crossing > 0:
                    crosses_runway = True
                    break

        # if the direct line exits the airport boundary while keep-inside is
        # on, fall through to A* so the solver can consider a detour that stays
        # inside the geofence polygon
        violates_boundary = _segment_exits_airport_boundary(
            from_x,
            from_y,
            to_x,
            to_y,
            local_geoms.boundary_zones,
            keep_inside_airport_boundary,
        )

        # if direct path crosses runway or wrong-sides the boundary, fall through to A*
        if not crosses_runway and not violates_boundary:
            wps = [
                WaypointData(
                    lon=to_point.lon,
                    lat=to_point.lat,
                    alt=to_point.alt,
                    heading=bearing_between(
                        from_point.lon, from_point.lat, to_point.lon, to_point.lat
                    ),
                    speed=speed,
                    waypoint_type=WaypointType.TRANSIT,
                    camera_action=CameraAction.NONE,
                )
            ]
            _adjust_transit_altitude_for_terrain(wps, elevation_provider, transit_agl)
            _check_cruise_clearance(wps, local_geoms)
            return wps

    # A* through visibility graph with runway penalties in local coords
    from_local = (from_x, from_y, from_point.alt)
    to_local = (to_x, to_y, to_point.alt)

    path = _run_astar(
        from_local,
        to_local,
        local_geoms.obstacles,
        local_geoms.zones,
        local_geoms.surfaces,
        buffer_distance_override=buffer_distance_override,
        require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        boundaries=local_geoms.boundary_zones,
        keep_inside_airport_boundary=keep_inside_airport_boundary,
    )
    if path is None:
        raise TrajectoryGenerationError("no obstacle-free transit path found")

    fallback_alt = max(from_point.alt, to_point.alt)

    # convert back to WGS84 and build TRANSIT waypoints (skip from_point at index 0)
    transit_wps = []
    for k in range(1, len(path)):
        prev_lon, prev_lat = proj.to_wgs84(path[k - 1][0], path[k - 1][1])
        cur_lon, cur_lat = proj.to_wgs84(path[k][0], path[k][1])
        transit_wps.append(
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

    _adjust_transit_altitude_for_terrain(transit_wps, elevation_provider, transit_agl)
    _check_cruise_clearance(transit_wps, local_geoms)

    return transit_wps


# shared keepout helpers consumed by `_inter_pass`


def _buffered_polygon_for(obs: LocalObstacle, buffer_distance_override: float | None):
    """return obstacle polygon expanded by its keepout buffer."""
    buf = resolve_obstacle_buffer(obs, buffer_distance_override)
    if buf > 0:
        return obs.polygon.buffer(buf)
    return obs.polygon


def _polygon_exterior_vertices(geom) -> list[tuple[float, float]]:
    """flatten Polygon/MultiPolygon/Collection exterior rings to (x, y) vertices.

    handles degenerate hulls (points/linestrings from collinear pass endpoints) and
    GeometryCollection results from unary_union mixing line + polygon parts.
    """
    coords: list[tuple[float, float]] = []
    if geom.is_empty:
        return coords
    if geom.geom_type in ("Polygon",):
        ring = list(geom.exterior.coords)
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        coords.extend((c[0], c[1]) for c in ring)
    elif geom.geom_type == "MultiPolygon":
        for poly in geom.geoms:
            ring = list(poly.exterior.coords)
            if len(ring) > 1 and ring[0] == ring[-1]:
                ring = ring[:-1]
            coords.extend((c[0], c[1]) for c in ring)
    elif geom.geom_type in ("LineString", "Point"):
        coords.extend((c[0], c[1]) for c in geom.coords)
    elif geom.geom_type in ("MultiLineString", "MultiPoint", "GeometryCollection"):
        for sub in geom.geoms:
            coords.extend(_polygon_exterior_vertices(sub))
    return coords


def _check_endpoint_outside_obstacles(
    point: Point3D,
    local_geoms: LocalGeometries,
    buffer_distance_override: float | None,
) -> None:
    """raise if a transit endpoint sits inside any obstacle's buffered keepout."""
    px, py = local_geoms.proj.to_local(point.lon, point.lat)
    pt = Point(px, py)
    for obs in local_geoms.obstacles:
        buffered = _buffered_polygon_for(obs, buffer_distance_override)
        if buffered.contains(pt):
            raise TrajectoryGenerationError("inspection endpoint inside obstacle keepout")
