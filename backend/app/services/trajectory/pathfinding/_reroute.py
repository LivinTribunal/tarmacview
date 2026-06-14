"""A*-based rerouting of measurement waypoints around obstacles and safety zones."""

from app.core.exceptions import TrajectoryGenerationError
from app.utils.geo import elevation_angle, euclidean_distance, total_path_distance

from ..safety_validator import check_obstacle, resolve_obstacle_buffer
from ..types import (
    MAX_REROUTE_DEVIATION,
    MAX_TURN_ANGLE,
    REROUTE_SEARCH_RADIUS_MULTIPLIER,
    LocalGeometries,
    Point3D,
    WaypointData,
)
from ._graph import (
    _collect_nearby_objects_local,
    _max_effective_buffer,
    _max_turn_angle,
    _run_astar,
    has_line_of_sight,
)


def resolve_inspection_collisions(
    waypoints: list[WaypointData],
    local_geoms: LocalGeometries,
    center: Point3D,
    buffer_distance_override: float | None = None,
    require_perpendicular_runway_crossing: bool = True,
    elevation_provider=None,
    keep_inside_airport_boundary: bool = False,
) -> list[WaypointData]:
    """A*-based rerouting of measurement waypoints around obstacles and safety zones.

    finds alternative positions that preserve measurement geometry (distance
    to center, line-of-sight to PAPI, max turn angle).

    each rerouted waypoint inherits `waypoint_type`, `camera_action`,
    `camera_target`, `alt`, `speed`, `inspection_id`, and `hover_duration` from
    the nearest source waypoint in the original `[seg_start, seg_end]` slice
    so video-mode RECORDING actions, per-LHA targets, and method-specific
    altitude bands survive the reroute. when `elevation_provider` is supplied,
    altitudes are shifted by `terrain_at_rerouted - terrain_at_source` so
    parallel-side-sweep terrain compensation tracks the new (lon, lat).
    """
    proj = local_geoms.proj

    # find colliding waypoints
    collisions = [False] * len(waypoints)
    for i, wp in enumerate(waypoints):
        wx, wy = proj.to_local(wp.lon, wp.lat)
        for obs in local_geoms.obstacles:
            buf = resolve_obstacle_buffer(obs, buffer_distance_override)
            if check_obstacle(wx, wy, wp.alt, obs, buffer_distance=buf):
                collisions[i] = True
                break

    if not any(collisions):
        return waypoints

    # find contiguous collision segments
    segments: list[tuple[int, int]] = []
    seg_start = None
    for i, hit in enumerate(collisions):
        if hit and seg_start is None:
            seg_start = i
        elif not hit and seg_start is not None:
            segments.append((seg_start, i - 1))
            seg_start = None
    if seg_start is not None:
        segments.append((seg_start, len(waypoints) - 1))

    result = list(waypoints)

    for seg_start, seg_end in segments:
        if seg_start == 0 or seg_end == len(waypoints) - 1:
            raise TrajectoryGenerationError(
                "obstacle at measurement pass boundary - cannot reroute"
            )

        anchor_before = result[seg_start - 1]
        anchor_after = result[seg_end + 1]
        from_pt = Point3D(lon=anchor_before.lon, lat=anchor_before.lat, alt=anchor_before.alt)
        to_pt = Point3D(lon=anchor_after.lon, lat=anchor_after.lat, alt=anchor_after.alt)

        # collect nearby obstacles AND safety zones
        mid_lon = (from_pt.lon + to_pt.lon) / 2
        mid_lat = (from_pt.lat + to_pt.lat) / 2
        mid_x, mid_y = proj.to_local(mid_lon, mid_lat)
        max_buffer = _max_effective_buffer(local_geoms.obstacles, buffer_distance_override)
        search_radius = max_buffer * REROUTE_SEARCH_RADIUS_MULTIPLIER
        nearby_obs, nearby_zones = _collect_nearby_objects_local(
            local_geoms,
            mid_x,
            mid_y,
            search_radius,
            buffer_distance_override=buffer_distance_override,
        )

        from_local = (*proj.to_local(from_pt.lon, from_pt.lat), from_pt.alt)
        to_local = (*proj.to_local(to_pt.lon, to_pt.lat), to_pt.alt)

        # A* through local visibility graph
        path = _run_astar(
            from_local,
            to_local,
            nearby_obs,
            nearby_zones,
            local_geoms.surfaces,
            buffer_distance_override=buffer_distance_override,
            require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
            boundaries=local_geoms.boundary_zones,
            keep_inside_airport_boundary=keep_inside_airport_boundary,
        )
        if path is None:
            raise TrajectoryGenerationError("no obstacle-free reroute path found")

        # source slice the rerouted waypoints replace - method-specific fields
        # (waypoint_type, camera_action, camera_target, alt, ...) are inherited
        # from the nearest source by 2D distance so RECORDING bookends, per-LHA
        # targets, and altitude bands survive the reroute
        source_slice = result[seg_start : seg_end + 1]
        source_local = [proj.to_local(wp.lon, wp.lat) for wp in source_slice]

        rerouted_locals = [(node[0], node[1]) for node in path[1:-1]]

        # batch terrain queries: source positions + rerouted positions in one call
        source_terrains: list[float] | None = None
        rerouted_terrains: list[float] | None = None
        if elevation_provider is not None and rerouted_locals:
            terrain_pts = [(wp.lat, wp.lon) for wp in source_slice]
            for x, y in rerouted_locals:
                lon, lat = proj.to_wgs84(x, y)
                terrain_pts.append((lat, lon))
            elevations = elevation_provider.get_elevations_batch(terrain_pts)
            if len(elevations) != len(terrain_pts):
                raise TrajectoryGenerationError(
                    f"expected {len(terrain_pts)} elevations, got {len(elevations)}"
                )
            source_terrains = elevations[: len(source_slice)]
            rerouted_terrains = elevations[len(source_slice) :]

        # convert path back to WGS84 and build rerouted waypoints (skip anchors)
        rerouted_wps = []
        for k, (x, y) in enumerate(rerouted_locals):
            lon, lat = proj.to_wgs84(x, y)

            nearest_idx = min(
                range(len(source_local)),
                key=lambda i: euclidean_distance(x, y, source_local[i][0], source_local[i][1]),
            )
            src = source_slice[nearest_idx]

            new_alt = src.alt
            if rerouted_terrains is not None and source_terrains is not None:
                new_alt = src.alt + (rerouted_terrains[k] - source_terrains[nearest_idx])

            # heading is inherited from source so row-direction methods (fly-over,
            # parallel-side-sweep) keep their along-row heading; recomputing toward
            # the target would inject per-waypoint heading swings that trip the
            # MAX_TURN_ANGLE guard
            target = src.camera_target if src.camera_target is not None else center
            pitch = elevation_angle(lon, lat, new_alt, target.lon, target.lat, target.alt)

            rerouted_wps.append(
                WaypointData(
                    lon=lon,
                    lat=lat,
                    alt=new_alt,
                    heading=src.heading,
                    speed=src.speed,
                    waypoint_type=src.waypoint_type,
                    camera_action=src.camera_action,
                    camera_target=src.camera_target,
                    inspection_id=src.inspection_id,
                    hover_duration=src.hover_duration,
                    gimbal_pitch=pitch,
                )
            )

        if not rerouted_wps:
            raise TrajectoryGenerationError(
                "reroute produced no intermediate waypoints"
                " - obstacle may be too close to flight path"
            )

        # validate: path deviation
        original_pts = [
            (result[k].lon, result[k].lat, result[k].alt) for k in range(seg_start, seg_end + 1)
        ]
        rerouted_pts = [(w.lon, w.lat, w.alt) for w in rerouted_wps]
        original_dist = total_path_distance(original_pts)
        rerouted_dist = total_path_distance(rerouted_pts) if rerouted_pts else 0.0

        if original_dist > 0 and rerouted_dist > original_dist * (1 + MAX_REROUTE_DEVIATION):
            raise TrajectoryGenerationError(
                f"rerouted path {rerouted_dist:.0f}m exceeds {MAX_REROUTE_DEVIATION:.0%} deviation"
            )

        # validate: line-of-sight to PAPI center
        for wp in rerouted_wps:
            wp_pt = Point3D(lon=wp.lon, lat=wp.lat, alt=wp.alt)
            if not has_line_of_sight(wp_pt, center, local_geoms):
                raise TrajectoryGenerationError("rerouted path blocks camera line-of-sight to PAPI")

        # validate: turn angle
        if rerouted_wps and _max_turn_angle(rerouted_wps) > MAX_TURN_ANGLE:
            raise TrajectoryGenerationError(
                f"rerouted path exceeds max turn angle {MAX_TURN_ANGLE}"
            )

        result[seg_start : seg_end + 1] = rerouted_wps

    return result
