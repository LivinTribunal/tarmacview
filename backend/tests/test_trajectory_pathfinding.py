"""unit tests for trajectory pathfinding - visibility graph, A*, collision resolution."""

import os
import random
import time
from uuid import uuid4

import pytest
from shapely.geometry import Point, box

from app.core.config import settings
from app.core.enums import CameraAction, SafetyZoneType, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.models.airport import Airport, Obstacle, Runway, Taxiway
from app.services.trajectory.pathfinding import (
    _build_visibility_graph,
    _check_cruise_clearance,
    _collect_graph_nodes_in_circle,
    _max_effective_buffer,
    _max_turn_angle,
    _run_astar,
    compute_transit_path,
    resolve_inspection_collisions,
)
from app.services.trajectory.types import (
    DEFAULT_OBSTACLE_RADIUS,
    GRID_EDGE_RADIUS,
    LocalObstacle,
    LocalZone,
    Point3D,
    WaypointData,
)
from app.utils.geo import astar, bearing_between, euclidean_distance, total_path_distance
from app.utils.local_projection import LocalProjection, build_local_geometries

# _max_turn_angle


class TestMaxTurnAngle:
    """tests for maximum heading change between consecutive waypoints."""

    def test_no_turn(self):
        """identical headings produce zero turn angle."""
        wps = [
            WaypointData(lon=0, lat=0, alt=100, heading=90.0),
            WaypointData(lon=1, lat=0, alt=100, heading=90.0),
            WaypointData(lon=2, lat=0, alt=100, heading=90.0),
        ]
        assert _max_turn_angle(wps) == 0.0

    def test_simple_turn(self):
        """detects a 45 degree turn."""
        wps = [
            WaypointData(lon=0, lat=0, alt=100, heading=0.0),
            WaypointData(lon=1, lat=0, alt=100, heading=45.0),
            WaypointData(lon=2, lat=0, alt=100, heading=45.0),
        ]
        assert _max_turn_angle(wps) == 45.0

    def test_wrap_around(self):
        """handles 350 to 10 degree transition (20 degree turn, not 340)."""
        wps = [
            WaypointData(lon=0, lat=0, alt=100, heading=350.0),
            WaypointData(lon=1, lat=0, alt=100, heading=10.0),
        ]
        assert _max_turn_angle(wps) == 20.0

    def test_single_waypoint(self):
        """single waypoint produces zero turn angle."""
        wps = [WaypointData(lon=0, lat=0, alt=100, heading=90.0)]
        assert _max_turn_angle(wps) == 0.0

    def test_max_of_multiple_turns(self):
        """returns the maximum turn across all segments."""
        wps = [
            WaypointData(lon=0, lat=0, alt=100, heading=0.0),
            WaypointData(lon=1, lat=0, alt=100, heading=10.0),
            WaypointData(lon=2, lat=0, alt=100, heading=70.0),  # 60 degree turn
            WaypointData(lon=3, lat=0, alt=100, heading=80.0),
        ]
        assert _max_turn_angle(wps) == 60.0

    def test_opposite_heading(self):
        """180 degree turn is the max possible."""
        wps = [
            WaypointData(lon=0, lat=0, alt=100, heading=0.0),
            WaypointData(lon=1, lat=0, alt=100, heading=180.0),
        ]
        assert _max_turn_angle(wps) == 180.0


# Point3D


class TestPoint3D:
    """tests for Point3D helper methods."""

    def test_to_tuple(self):
        """converts to (lon, lat, alt) tuple."""
        p = Point3D(lon=14.26, lat=50.1, alt=300.0)
        assert p.to_tuple() == (14.26, 50.1, 300.0)

    def test_from_tuple(self):
        """creates from (lon, lat, alt) tuple."""
        p = Point3D.from_tuple((14.26, 50.1, 300.0))
        assert p.lon == 14.26
        assert p.lat == 50.1
        assert p.alt == 300.0

    def test_center(self):
        """arithmetic mean of points."""
        pts = [
            Point3D(lon=10.0, lat=20.0, alt=100.0),
            Point3D(lon=20.0, lat=40.0, alt=200.0),
        ]
        c = Point3D.center(pts)
        assert c.lon == 15.0
        assert c.lat == 30.0
        assert c.alt == 150.0

    def test_center_empty_raises(self):
        """raises ValueError for empty list."""
        with pytest.raises(ValueError, match="no points"):
            Point3D.center([])


# WaypointData defaults


class TestWaypointDataDefaults:
    """tests for WaypointData default values."""

    def test_defaults(self):
        """verify default field values."""
        wp = WaypointData(lon=14.0, lat=50.0, alt=300.0)
        assert wp.heading == 0.0
        assert wp.speed == 5.0
        assert wp.waypoint_type == WaypointType.MEASUREMENT
        assert wp.camera_action == CameraAction.PHOTO_CAPTURE
        assert wp.camera_target is None
        assert wp.inspection_id is None
        assert wp.hover_duration is None
        assert wp.gimbal_pitch is None


# transit path computation


class TestTransitPathGeometry:
    """tests for transit path waypoint properties."""

    def test_transit_waypoint_type(self):
        """transit waypoints should have TRANSIT type and NONE camera action."""
        wp = WaypointData(
            lon=14.26,
            lat=50.1,
            alt=350.0,
            heading=90.0,
            speed=8.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        )
        assert wp.waypoint_type == WaypointType.TRANSIT
        assert wp.camera_action == CameraAction.NONE


# test the `or` pattern fix in orchestrator (issue #2 and #6)


class TestNullableFloatOrPattern:
    """tests that 0.0 is handled correctly as a valid value (not falsy)."""

    def test_zero_buffer_distance_not_substituted(self):
        """0.0 buffer distance should be used, not replaced with default."""
        # simulates the fixed logic
        default_buffer = 0.0
        fallback = 5.0

        result = default_buffer if default_buffer is not None else fallback
        assert result == 0.0

    def test_none_buffer_distance_uses_fallback(self):
        """None buffer distance should use fallback."""
        default_buffer = None
        fallback = 5.0

        result = default_buffer if default_buffer is not None else fallback
        assert result == 5.0

    def test_zero_transit_agl_not_substituted(self):
        """0.0 transit_agl should be used, not replaced with default."""
        transit_agl = 0.0
        default = 5.0

        result = transit_agl if transit_agl is not None else default
        assert result == 0.0

    def test_none_transit_agl_uses_fallback(self):
        """None transit_agl should use fallback."""
        transit_agl = None
        default = 5.0

        result = transit_agl if transit_agl is not None else default
        assert result == 5.0

    def test_positive_value_preserved(self):
        """positive value should be preserved."""
        val = 3.5
        fallback = 5.0

        result = val if val is not None else fallback
        assert result == 3.5


# regression - zero buffer_distance_override must not collapse reroute search radius


class TestMaxEffectiveBuffer:
    """tests for _max_effective_buffer with zero/None/positive overrides."""

    def test_zero_override_falls_back_to_per_obstacle(self):
        """a 0.0 override should not zero out the search radius."""
        from shapely.geometry import box

        from app.services.trajectory.types import LocalObstacle

        obstacles = [
            LocalObstacle(
                polygon=box(0, 0, 1, 1),
                name="a",
                height=10.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
            LocalObstacle(
                polygon=box(0, 0, 1, 1),
                name="b",
                height=10.0,
                base_alt=0.0,
                buffer_distance=10.0,
            ),
        ]
        assert _max_effective_buffer(obstacles, 0.0) == 10.0

    def test_none_override_uses_per_obstacle_max(self):
        """None override uses max per-obstacle buffer."""
        from shapely.geometry import box

        from app.services.trajectory.types import LocalObstacle

        obstacles = [
            LocalObstacle(
                polygon=box(0, 0, 1, 1),
                name="a",
                height=10.0,
                base_alt=0.0,
                buffer_distance=3.0,
            ),
            LocalObstacle(
                polygon=box(0, 0, 1, 1),
                name="b",
                height=10.0,
                base_alt=0.0,
                buffer_distance=7.0,
            ),
        ]
        assert _max_effective_buffer(obstacles, None) == 7.0

    def test_positive_override_used_when_obstacles_present(self):
        """positive override replaces per-obstacle values."""
        from shapely.geometry import box

        from app.services.trajectory.types import LocalObstacle

        obstacles = [
            LocalObstacle(
                polygon=box(0, 0, 1, 1),
                name="a",
                height=10.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
        ]
        assert _max_effective_buffer(obstacles, 20.0) == 20.0

    def test_positive_override_no_obstacles_uses_default(self):
        """positive override with no obstacles falls back to DEFAULT_OBSTACLE_RADIUS."""
        assert _max_effective_buffer([], 20.0) == DEFAULT_OBSTACLE_RADIUS

    def test_empty_obstacles_none_override(self):
        """empty obstacles + None override returns DEFAULT_OBSTACLE_RADIUS."""
        assert _max_effective_buffer([], None) == DEFAULT_OBSTACLE_RADIUS


# regression - buffer_distance_override must reach fast-path segment check


def _build_local_geoms(db_session, airport, surfaces, obstacles=None, zones=None):
    """build LocalGeometries from db objects for test use."""
    if obstacles:
        for obs in obstacles:
            db_session.refresh(obs)
    for surf in surfaces:
        db_session.refresh(surf)
    proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
    return build_local_geometries(proj, obstacles or [], zones or [], surfaces)


class TestFastPathBufferOverride:
    """regression: compute_transit_path must pass buffer_distance_override to the
    fast-path _is_segment_blocked call, not just the A* branch."""

    def test_override_triggers_fast_path_detour(self, db_session):
        """buffer override must reach the fast-path check, not just the A* branch."""
        airport, runway = _make_perpendicular_runway_airport(db_session)

        # straight line endpoints well north of the runway to avoid runway crossing
        from_pt = Point3D(lon=14.262, lat=50.1100, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1100, alt=350.0)

        obstacle = Obstacle(
            id=uuid4(),
            airport_id=airport.id,
            name="side-block",
            height=80.0,
            type="BUILDING",
            buffer_distance=2.0,
            boundary=(
                "POLYGON Z ((14.25998 50.11027 300, 14.26002 50.11027 300, "
                "14.26002 50.11030 300, 14.25998 50.11030 300, "
                "14.25998 50.11027 300))"
            ),
        )
        db_session.add(obstacle)
        db_session.commit()

        local_geoms = _build_local_geoms(db_session, airport, [runway], [obstacle])

        # baseline: no override - fast-path returns single waypoint (straight line)
        wps_no_override = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            buffer_distance_override=None,
            require_perpendicular_runway_crossing=False,
        )
        assert len(wps_no_override) == 1, (
            f"without override, fast-path should return direct path (1 waypoint), "
            f"got {len(wps_no_override)}"
        )

        try:
            wps_with_override = compute_transit_path(
                from_pt,
                to_pt,
                local_geoms,
                speed=8.0,
                buffer_distance_override=50.0,
                require_perpendicular_runway_crossing=False,
            )
        except TrajectoryGenerationError as exc:
            assert "no obstacle-free transit path found" in str(exc)
        else:
            assert len(wps_with_override) > 1, (
                f"with override, fast-path must reject the direct path; "
                f"got {len(wps_with_override)} waypoints (straight-line fallback bug)"
            )


# perpendicular vs shortest-geodesic runway crossing flag


_ICAO_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _unique_icao(db_session=None) -> str:
    """generate a unique 4-letter ICAO code so tests don't collide on the unique constraint.

    when a db session is provided, retries until the generated code is not already
    present in the airport table - guards against random collisions with codes
    committed by other test modules in the same session.
    """
    for _ in range(50):
        code = "".join(random.choice(_ICAO_ALPHABET) for _ in range(4))
        if db_session is None:
            return code
        exists = db_session.query(Airport).filter(Airport.icao_code == code).first()
        if exists is None:
            return code
    raise RuntimeError("could not generate unique ICAO after 50 attempts")


def _make_perpendicular_runway_airport(db_session):
    """build airport with a single east-west runway centered at (14.26, 50.10)."""
    airport = Airport(
        id=uuid4(),
        icao_code=_unique_icao(db_session),
        name="Flag Test Airport",
        elevation=300.0,
        location="POINT Z (14.26 50.10 300)",
    )
    runway = Runway(
        id=uuid4(),
        airport_id=airport.id,
        identifier="09/27",
        surface_type="RUNWAY",
        geometry="LINESTRING Z (14.255 50.10 300, 14.265 50.10 300)",
        heading=90.0,
        length=700.0,
        width=45.0,
        buffer_distance=5.0,
    )
    db_session.add(airport)
    db_session.add(runway)
    db_session.commit()
    db_session.refresh(airport)
    db_session.refresh(runway)
    return airport, runway


def _bearings(waypoints, from_pt):
    """consecutive segment bearings starting from from_pt."""
    pts = [(from_pt.lon, from_pt.lat)] + [(w.lon, w.lat) for w in waypoints]
    out = []
    for i in range(1, len(pts)):
        out.append(bearing_between(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
    return out


def _path_distance(waypoints, from_pt):
    """total geodesic distance from from_pt through waypoints."""
    pts = [(from_pt.lon, from_pt.lat, from_pt.alt)] + [(w.lon, w.lat, w.alt) for w in waypoints]
    return total_path_distance(pts)


class TestRequirePerpendicularRunwayCrossing:
    """flag toggles between perpendicular-anchored A* and shortest-geodesic crossing."""

    def test_flag_true_keeps_perpendicular_segment(self, db_session):
        """with the flag on, A* must include a segment near runway-perpendicular."""
        _, runway = _make_perpendicular_runway_airport(db_session)
        local_geoms = _build_local_geoms(db_session, None, [runway])

        from_pt = Point3D(lon=14.262, lat=50.0975, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1025, alt=350.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )

        bearings = _bearings(wps, from_pt)

        def perp_delta(b):
            return min(abs(b - 0.0), abs(b - 180.0), abs(b - 360.0))

        assert any(perp_delta(b) <= 5.0 for b in bearings), (
            f"no perpendicular segment found in bearings {bearings}"
        )

    def test_flag_false_is_strictly_shorter_and_clears_runway(self, db_session):
        """flag off lets A* (or the fast-path) pick the shortest geodesic crossing."""
        _, runway = _make_perpendicular_runway_airport(db_session)
        local_geoms = _build_local_geoms(db_session, None, [runway])

        from_pt = Point3D(lon=14.262, lat=50.0975, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1025, alt=350.0)

        perp_wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )
        short_wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=False,
        )

        perp_dist = _path_distance(perp_wps, from_pt)
        short_dist = _path_distance(short_wps, from_pt)
        assert short_dist < perp_dist, (
            f"shortest-geodesic distance {short_dist:.1f} not < perpendicular {perp_dist:.1f}"
        )

    def test_flag_false_still_avoids_obstacle(self, db_session):
        """flag off must still detour around an obstacle on the straight line."""
        airport, runway = _make_perpendicular_runway_airport(db_session)

        from_pt = Point3D(lon=14.262, lat=50.0975, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1025, alt=350.0)

        obstacle = Obstacle(
            id=uuid4(),
            airport_id=airport.id,
            name="block",
            height=80.0,
            type="BUILDING",
            buffer_distance=5.0,
            boundary=(
                "POLYGON Z ((14.2598 50.0998 300, 14.2602 50.0998 300, "
                "14.2602 50.1002 300, 14.2598 50.1002 300, "
                "14.2598 50.0998 300))"
            ),
        )
        db_session.add(obstacle)
        db_session.commit()

        local_geoms = _build_local_geoms(db_session, airport, [runway], [obstacle])

        wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=False,
        )

        straight = total_path_distance(
            [(from_pt.lon, from_pt.lat, from_pt.alt), (to_pt.lon, to_pt.lat, to_pt.alt)]
        )
        rerouted = _path_distance(wps, from_pt)
        assert rerouted > straight, (
            f"rerouted distance {rerouted:.1f} not greater than straight {straight:.1f}"
        )

    def test_flag_false_no_runways_matches_default(self, db_session):
        """without any runways, both flag values produce the same straight-line path."""
        airport = Airport(
            id=uuid4(),
            icao_code=_unique_icao(db_session),
            name="No Runway Airport",
            elevation=300.0,
            location="POINT Z (14.26 50.10 300)",
        )
        db_session.add(airport)
        db_session.flush()

        local_geoms = _build_local_geoms(db_session, airport, [])

        from_pt = Point3D(lon=14.262, lat=50.0975, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1025, alt=350.0)

        wps_true = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )
        wps_false = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=False,
        )
        # both fast-path single-segment, same endpoint
        assert len(wps_true) == 1 and len(wps_false) == 1
        assert wps_true[0].lon == wps_false[0].lon
        assert wps_true[0].lat == wps_false[0].lat

    def test_flag_forwarded_through_resolve_collisions(self, db_session):
        """resolve_inspection_collisions forwards the flag into _run_astar."""
        airport, runway = _make_perpendicular_runway_airport(db_session)

        center = Point3D(lon=14.26, lat=50.10, alt=300.0)

        obstacle = Obstacle(
            id=uuid4(),
            airport_id=airport.id,
            name="reroute-block",
            height=80.0,
            type="BUILDING",
            buffer_distance=5.0,
            boundary=(
                "POLYGON Z ((14.2595 50.0985 300, 14.2605 50.0985 300, "
                "14.2605 50.0995 300, 14.2595 50.0995 300, "
                "14.2595 50.0985 300))"
            ),
        )
        db_session.add(obstacle)
        db_session.commit()

        local_geoms = _build_local_geoms(db_session, airport, [runway], [obstacle])

        wps = [
            WaypointData(lon=14.260, lat=50.096, alt=350.0, heading=0.0),
            WaypointData(lon=14.260, lat=50.099, alt=350.0, heading=0.0),
            WaypointData(lon=14.260, lat=50.104, alt=350.0, heading=0.0),
        ]

        result_perp = resolve_inspection_collisions(
            wps,
            local_geoms,
            center,
            buffer_distance_override=50.0,
            require_perpendicular_runway_crossing=True,
        )
        result_short = resolve_inspection_collisions(
            wps,
            local_geoms,
            center,
            buffer_distance_override=50.0,
            require_perpendicular_runway_crossing=False,
        )

        perp_pts = [(w.lon, w.lat, w.alt) for w in result_perp]
        short_pts = [(w.lon, w.lat, w.alt) for w in result_short]
        perp_dist = total_path_distance(perp_pts)
        short_dist = total_path_distance(short_pts)

        assert short_dist < perp_dist, (
            f"flag=False reroute {short_dist:.1f} not shorter than flag=True {perp_dist:.1f}"
        )


# hybrid grid generation


class TestGridGeneration:
    """tests for grid fill in _collect_graph_nodes_in_circle."""

    def test_grid_covers_open_space(self):
        """grid nodes fill the circle area when no obstacles or zones."""
        center = (0.0, 0.0)
        radius = 500.0
        endpoints = [(200.0, 0.0, 350.0), (-200.0, 0.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [], [], None, center, radius
        )

        grid_nodes = nodes[grid_start_index:]
        assert len(grid_nodes) > 100, f"expected >100 grid nodes, got {len(grid_nodes)}"

        # all grid nodes within circle
        for x, y, z in grid_nodes:
            assert euclidean_distance(center[0], center[1], x, y) <= radius + 1.0

    def test_grid_excludes_obstacle_interior(self):
        """no grid nodes inside buffered obstacle polygon."""
        obs = LocalObstacle(
            polygon=box(40, 40, 60, 60),
            name="block",
            height=10.0,
            base_alt=0.0,
            buffer_distance=5.0,
        )
        center = (50.0, 50.0)
        radius = 200.0
        endpoints = [(0.0, 50.0, 350.0), (100.0, 50.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [obs], [], None, center, radius
        )

        buffered_obs = obs.polygon.buffer(obs.buffer_distance)
        grid_nodes = nodes[grid_start_index:]
        for x, y, z in grid_nodes:
            assert not buffered_obs.contains(Point(x, y)), (
                f"grid node ({x}, {y}) inside buffered obstacle"
            )

    def test_grid_excludes_hard_zone_interior(self):
        """no grid nodes inside prohibited safety zone polygon."""
        zone = LocalZone(
            polygon=box(-30, -30, 30, 30),
            zone_type=SafetyZoneType.PROHIBITED,
            name="no-fly",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        center = (0.0, 0.0)
        radius = 200.0
        endpoints = [(-100.0, 0.0, 350.0), (100.0, 0.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [], [zone], None, center, radius
        )

        grid_nodes = nodes[grid_start_index:]
        for x, y, z in grid_nodes:
            assert not zone.polygon.contains(Point(x, y)), f"grid node ({x}, {y}) inside hard zone"

    def test_grid_nodes_use_cruise_altitude(self):
        """grid nodes z-coordinate equals average of endpoint altitudes."""
        endpoints = [(0.0, 0.0, 300.0), (100.0, 0.0, 400.0)]
        center = (50.0, 0.0)
        radius = 200.0

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [], [], None, center, radius
        )

        expected_z = 350.0
        grid_nodes = nodes[grid_start_index:]
        assert len(grid_nodes) > 0
        for x, y, z in grid_nodes:
            assert z == expected_z, f"grid node z={z}, expected {expected_z}"

    def test_grid_start_index_separates_feature_and_grid_nodes(self):
        """grid_start_index equals count of non-grid nodes."""
        obs = LocalObstacle(
            polygon=box(80, 80, 90, 90),
            name="tiny",
            height=10.0,
            base_alt=0.0,
            buffer_distance=2.0,
        )
        center = (50.0, 50.0)
        radius = 200.0
        endpoints = [(0.0, 50.0, 350.0), (100.0, 50.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [obs], [], None, center, radius
        )

        # grid_start_index should be at least len(endpoints)
        assert grid_start_index >= len(endpoints)

        # nodes before grid_start_index are endpoints + obstacle vertices
        # nodes after are grid nodes on a regular spacing
        grid_nodes = nodes[grid_start_index:]
        assert len(grid_nodes) > 0


class TestGridAStarPath:
    """tests for A* pathfinding with hybrid grid."""

    def test_open_space_path_is_near_straight(self):
        """path through grid in open space is close to straight-line distance."""
        from_local = (-200.0, 0.0, 350.0)
        to_local = (200.0, 0.0, 350.0)

        path = _run_astar(from_local, to_local, [], [])
        assert path is not None, "A* should find path in open space"

        straight = euclidean_distance(from_local[0], from_local[1], to_local[0], to_local[1])
        path_len = sum(
            euclidean_distance(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
            for i in range(len(path) - 1)
        )
        assert path_len < straight * 1.15, (
            f"path {path_len:.1f}m is >15% longer than straight {straight:.1f}m"
        )

    def test_grid_path_avoids_obstacle(self):
        """path routes around an obstacle between endpoints."""
        obs = LocalObstacle(
            polygon=box(-20, -20, 20, 20),
            name="center-block",
            height=50.0,
            base_alt=0.0,
            buffer_distance=5.0,
        )

        from_local = (-150.0, 0.0, 350.0)
        to_local = (150.0, 0.0, 350.0)

        path = _run_astar(from_local, to_local, [obs], [])
        assert path is not None, "A* should find path around obstacle"

        buffered = obs.polygon.buffer(obs.buffer_distance)
        for node in path[1:-1]:
            assert not buffered.contains(Point(node[0], node[1])), (
                f"path node ({node[0]:.1f}, {node[1]:.1f}) inside obstacle"
            )

        straight = euclidean_distance(from_local[0], from_local[1], to_local[0], to_local[1])
        path_len = sum(
            euclidean_distance(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
            for i in range(len(path) - 1)
        )
        assert path_len > straight, "path around obstacle must be longer than straight line"

    def test_grid_to_grid_edges_respect_radius(self):
        """grid-to-grid edges in visibility graph do not exceed GRID_EDGE_RADIUS."""
        center = (0.0, 0.0)
        radius = 300.0
        endpoints = [(-100.0, 0.0, 350.0), (100.0, 0.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [], [], None, center, radius
        )
        graph = _build_visibility_graph(nodes, [], [], grid_start_index=grid_start_index)

        for i in range(grid_start_index, len(nodes)):
            for j, dist in graph[i]:
                if j >= grid_start_index:
                    assert dist <= GRID_EDGE_RADIUS + 0.1, (
                        f"grid-to-grid edge {i}->{j} dist={dist:.1f} "
                        f"exceeds GRID_EDGE_RADIUS={GRID_EDGE_RADIUS}"
                    )

    def test_circular_obstacle_detour_is_efficient(self):
        """path around circular obstacle (no axis-aligned corners) finds efficient detour."""
        circle = Point(0, 0).buffer(50)
        obs = LocalObstacle(
            polygon=circle,
            name="round-tower",
            height=50.0,
            base_alt=0.0,
            buffer_distance=5.0,
        )

        from_local = (-200.0, 0.0, 350.0)
        to_local = (200.0, 0.0, 350.0)

        path = _run_astar(from_local, to_local, [obs], [])
        assert path is not None, "should find path around circular obstacle"

        buffered = circle.buffer(obs.buffer_distance)
        for node in path[1:-1]:
            assert not buffered.contains(Point(node[0], node[1])), (
                f"path node ({node[0]:.1f}, {node[1]:.1f}) inside buffered obstacle"
            )

        straight = euclidean_distance(from_local[0], from_local[1], to_local[0], to_local[1])
        path_len = sum(
            euclidean_distance(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
            for i in range(len(path) - 1)
        )
        assert path_len < straight * 1.25, (
            f"detour {path_len:.1f}m is >25% longer than straight {straight:.1f}m"
        )

    def test_grid_nodes_strictly_required_for_circular_obstacle(self):
        """vertex-only graph fails for circular obstacle - grid nodes are strictly necessary.

        buffer vertices lie on the obstacle boundary so every edge to/from
        them triggers intersects() and is blocked. only grid nodes in the
        surrounding open space can form unobstructed edges.
        """
        circle = Point(0, 0).buffer(50)
        obs = LocalObstacle(
            polygon=circle,
            name="round-tower",
            height=50.0,
            base_alt=0.0,
            buffer_distance=5.0,
        )

        from_local = (-200.0, 0.0, 350.0)
        to_local = (200.0, 0.0, 350.0)
        center = (0.0, 0.0)
        radius = 300.0
        obstacles = [obs]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            [from_local, to_local], obstacles, [], None, center, radius
        )

        # vertex-only graph: all edges touch obstacle boundary, A* fails
        vertex_nodes = nodes[:grid_start_index]
        vertex_graph = _build_visibility_graph(vertex_nodes, obstacles, [])
        vertex_path = astar(vertex_graph, 0, 1, vertex_nodes, use_euclidean=True)
        assert vertex_path is None, (
            "vertex-only graph should not find path - all edges touch the obstacle boundary"
        )

        # full graph with grid nodes routes around the obstacle
        full_graph = _build_visibility_graph(
            nodes, obstacles, [], grid_start_index=grid_start_index
        )
        grid_path_indices = astar(full_graph, 0, 1, nodes, use_euclidean=True)
        assert grid_path_indices is not None, "grid-enhanced A* must find path"

        # path avoids the buffered obstacle
        buffered = circle.buffer(obs.buffer_distance)
        grid_path = [nodes[idx] for idx in grid_path_indices]
        for node in grid_path[1:-1]:
            assert not buffered.contains(Point(node[0], node[1])), (
                f"path node ({node[0]:.1f}, {node[1]:.1f}) inside buffered obstacle"
            )

        # grid nodes are strictly necessary
        grid_in_path = [idx for idx in grid_path_indices[1:-1] if idx >= grid_start_index]
        assert len(grid_in_path) > 0, (
            "path must use grid nodes - obstacle vertices can't form edges"
        )


class TestGridPerformance:
    """performance envelope tests for hybrid grid."""

    def test_node_count_at_default_spacing(self):
        """500m radius circle at 50m spacing produces roughly pi*10^2 ~ 314 grid nodes."""
        center = (0.0, 0.0)
        radius = 500.0
        endpoints = [(-200.0, 0.0, 350.0), (200.0, 0.0, 350.0)]

        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints, [], [], None, center, radius
        )
        grid_count = len(nodes) - grid_start_index
        assert 200 <= grid_count <= 400, f"expected 200-400 grid nodes, got {grid_count}"

    @pytest.mark.slow
    def test_solve_time_within_budget(self):
        """full A* solve with 500m radius grid completes in < 2 seconds."""
        from_local = (-250.0, 0.0, 350.0)
        to_local = (250.0, 0.0, 350.0)

        start = time.monotonic()
        path = _run_astar(from_local, to_local, [], [])
        elapsed = time.monotonic() - start

        assert path is not None
        assert elapsed < 2.0, f"A* solve took {elapsed:.2f}s, expected < 2s"


# 2.5-D cruise clearance check


def _segment_geoms(obstacles=None, zones=None):
    """build LocalGeometries with the test segment running through (-100, 0) -> (100, 0)."""
    from app.utils.local_projection import LocalGeometries, LocalProjection

    proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
    return LocalGeometries(
        proj=proj,
        obstacles=list(obstacles or []),
        zones=list(zones or []),
        boundary_zones=[],
        surfaces=[],
    )


def _make_transit_pair(alt: float):
    """two TRANSIT waypoints near (14.26, 50.10) bracketing the local origin."""
    # the segment in local coords runs roughly along y=0; both waypoints share alt.
    return [
        WaypointData(
            lon=14.2585,
            lat=50.10,
            alt=alt,
            heading=90.0,
            speed=8.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
        WaypointData(
            lon=14.2615,
            lat=50.10,
            alt=alt,
            heading=90.0,
            speed=8.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
    ]


class TestCheckCruiseClearance:
    """2.5-D cruise clearance check - obstacles compare segment alt vs [base, base+height]."""

    def test_low_obstacle_below_cruise_passes(self):
        """5 m fence at base 0 below 30 m transit should not raise."""
        obstacle = LocalObstacle(
            polygon=box(-10, -10, 10, 10),
            name="fence",
            height=5.0,
            base_alt=0.0,
            buffer_distance=0.0,
        )
        geoms = _segment_geoms(obstacles=[obstacle])
        wps = _make_transit_pair(alt=30.0)

        # must not raise
        _check_cruise_clearance(wps, geoms)

    def test_tall_obstacle_above_cruise_raises(self):
        """50 m tower at base 0 above 30 m transit must still raise."""
        obstacle = LocalObstacle(
            polygon=box(-10, -10, 10, 10),
            name="tower",
            height=50.0,
            base_alt=0.0,
            buffer_distance=0.0,
        )
        geoms = _segment_geoms(obstacles=[obstacle])
        wps = _make_transit_pair(alt=30.0)

        with pytest.raises(
            TrajectoryGenerationError, match="cruise altitude conflicts with obstacle clearance"
        ):
            _check_cruise_clearance(wps, geoms)

    def test_obstacle_off_segment_passes(self):
        """tall obstacle laterally separated from the segment must not raise."""
        obstacle = LocalObstacle(
            polygon=box(500, 500, 510, 510),
            name="tower-far",
            height=200.0,
            base_alt=0.0,
            buffer_distance=0.0,
        )
        geoms = _segment_geoms(obstacles=[obstacle])
        wps = _make_transit_pair(alt=30.0)

        _check_cruise_clearance(wps, geoms)

    def test_hard_zone_still_blocks(self):
        """hard zones remain 2-D - any segment intersection raises regardless of altitude."""
        zone = LocalZone(
            polygon=box(-10, -10, 10, 10),
            zone_type=SafetyZoneType.PROHIBITED,
            name="no-fly",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        geoms = _segment_geoms(zones=[zone])
        wps = _make_transit_pair(alt=30.0)

        with pytest.raises(
            TrajectoryGenerationError, match="cruise altitude conflicts with obstacle clearance"
        ):
            _check_cruise_clearance(wps, geoms)

    def test_elevated_obstacle_below_segment_passes(self):
        """obstacle whose top is below the segment alt does not raise."""
        # obstacle base 10, height 5 -> top 15. segment at 30 m flies above it.
        obstacle = LocalObstacle(
            polygon=box(-10, -10, 10, 10),
            name="elevated-fence",
            height=5.0,
            base_alt=10.0,
            buffer_distance=0.0,
        )
        geoms = _segment_geoms(obstacles=[obstacle])
        wps = _make_transit_pair(alt=30.0)

        _check_cruise_clearance(wps, geoms)


# resolve_inspection_collisions: pass-boundary obstacle


def _box_polygon(cx: float, cy: float, half: float):
    """axis-aligned square polygon in local coords."""
    from shapely.geometry import Polygon

    return Polygon(
        [
            (cx - half, cy - half),
            (cx + half, cy - half),
            (cx + half, cy + half),
            (cx - half, cy + half),
        ]
    )


class TestResolveInspectionCollisionsBoundary:
    """defends the documented `obstacle at measurement pass boundary` error
    when the colliding waypoint is the very first or last of the pass and
    no anchor exists for an A* reroute (pathfinding.py:480-483)."""

    def _setup(self, obstacle_x: float, num_waypoints: int = 5):
        """build N collinear waypoints on y=0 plus a single obstacle in local coords."""
        from app.services.trajectory.types import LocalGeometries
        from app.utils.local_projection import LocalProjection

        proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
        waypoints = []
        for i in range(num_waypoints):
            x = i * 50.0
            lon, lat = proj.to_wgs84(x, 0.0)
            waypoints.append(WaypointData(lon=lon, lat=lat, alt=350.0, heading=90.0))

        obs = LocalObstacle(
            polygon=_box_polygon(obstacle_x, 0.0, 20.0),
            name="boundary-block",
            height=400.0,
            base_alt=0.0,
            buffer_distance=10.0,
        )
        local_geoms = LocalGeometries(
            proj=proj,
            obstacles=[obs],
            zones=[],
            boundary_zones=[],
            surfaces=[],
        )
        return waypoints, local_geoms

    def test_obstacle_at_first_waypoint_raises(self):
        """obstacle straddling waypoints[0] raises the documented boundary error."""
        waypoints, local_geoms = self._setup(obstacle_x=0.0)
        center = Point3D(lon=14.0, lat=50.0, alt=300.0)
        with pytest.raises(
            TrajectoryGenerationError,
            match="obstacle at measurement pass boundary",
        ):
            resolve_inspection_collisions(waypoints, local_geoms, center)

    def test_obstacle_at_last_waypoint_raises(self):
        """obstacle straddling waypoints[-1] raises the documented boundary error."""
        waypoints, local_geoms = self._setup(obstacle_x=4 * 50.0)
        center = Point3D(lon=14.0, lat=50.0, alt=300.0)
        with pytest.raises(
            TrajectoryGenerationError,
            match="obstacle at measurement pass boundary",
        ):
            resolve_inspection_collisions(waypoints, local_geoms, center)


# resolve_inspection_collisions: source-field preservation across methods


def _setup_reroute_local_geoms(obstacle_x: float = 200.0, obstacle_half: float = 25.0):
    """build a LocalGeometries with one obstacle blocking a mid-pass waypoint."""
    from app.services.trajectory.types import LocalGeometries
    from app.utils.local_projection import LocalProjection

    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
    obs = LocalObstacle(
        polygon=_box_polygon(obstacle_x, 0.0, obstacle_half),
        name="mid-block",
        height=400.0,
        base_alt=0.0,
        buffer_distance=5.0,
    )
    local_geoms = LocalGeometries(
        proj=proj,
        obstacles=[obs],
        zones=[],
        boundary_zones=[],
        surfaces=[],
    )
    return proj, local_geoms


class _StubElevationProvider:
    """deterministic elevation provider keyed on local-x position via to_local."""

    def __init__(self, proj, slope_per_meter: float = 0.0, base: float = 0.0):
        """slope_per_meter is the rise per meter of local x; base is at x=0."""
        self.proj = proj
        self.slope = slope_per_meter
        self.base = base
        self.calls: list[tuple[float, float]] = []

    def get_elevations_batch(self, points):
        """return elevations from the linear x-slope model."""
        out = []
        for lat, lon in points:
            x, _ = self.proj.to_local(lon, lat)
            self.calls.append((lat, lon))
            out.append(self.base + self.slope * x)
        return out


class TestResolveInspectionCollisionsSourcePreservation:
    """rerouted waypoints inherit source method-specific fields, not hardcoded defaults."""

    def test_preserves_video_recording_action(self):
        """video-mode RECORDING action survives the reroute - no PHOTO_CAPTURE between bookends."""
        proj, local_geoms = _setup_reroute_local_geoms()
        center = Point3D(lon=14.0, lat=50.0, alt=300.0)

        def _wp(x, *, alt, wtype, action, target=None):
            lon, lat = proj.to_wgs84(x, 0.0)
            return WaypointData(
                lon=lon,
                lat=lat,
                alt=alt,
                heading=90.0,
                waypoint_type=wtype,
                camera_action=action,
                camera_target=target,
            )

        wps = [
            _wp(0.0, alt=350.0, wtype=WaypointType.HOVER, action=CameraAction.RECORDING_START),
            _wp(100.0, alt=350.0, wtype=WaypointType.MEASUREMENT, action=CameraAction.RECORDING),
            _wp(200.0, alt=350.0, wtype=WaypointType.MEASUREMENT, action=CameraAction.RECORDING),
            _wp(300.0, alt=350.0, wtype=WaypointType.MEASUREMENT, action=CameraAction.RECORDING),
            _wp(400.0, alt=350.0, wtype=WaypointType.HOVER, action=CameraAction.RECORDING_STOP),
        ]

        result = resolve_inspection_collisions(wps, local_geoms, center)

        # bookends untouched
        assert result[0].camera_action == CameraAction.RECORDING_START
        assert result[-1].camera_action == CameraAction.RECORDING_STOP

        # no PHOTO_CAPTURE anywhere between bookends after reroute
        inner = result[1:-1]
        assert len(inner) >= 1
        for wp in inner:
            assert wp.camera_action != CameraAction.PHOTO_CAPTURE
            assert wp.waypoint_type == WaypointType.MEASUREMENT

    def test_preserves_fly_over_per_lha_target_and_alt(self):
        """per-LHA camera_target and altitude survive reroute (not collapsed to centroid)."""
        proj, local_geoms = _setup_reroute_local_geoms()
        # centroid of the LHA row is the "center" passed by the orchestrator
        center = Point3D(lon=14.0, lat=50.0, alt=295.0)

        # three LHAs along the row at increasing altitudes
        lha_alts = [300.0, 305.0, 310.0]
        wp_alts = [a + 20.0 for a in lha_alts]
        targets = []
        wps = []
        for i, x in enumerate([100.0, 200.0, 300.0]):
            lon, lat = proj.to_wgs84(x, 0.0)
            target = Point3D(lon=lon, lat=lat, alt=lha_alts[i])
            targets.append(target)
            wps.append(
                WaypointData(
                    lon=lon,
                    lat=lat,
                    alt=wp_alts[i],
                    heading=90.0,
                    waypoint_type=WaypointType.MEASUREMENT,
                    camera_action=CameraAction.PHOTO_CAPTURE,
                    camera_target=target,
                )
            )

        # outer anchors (clear of obstacle): pad with two extra waypoints
        anchor_lon_l, anchor_lat_l = proj.to_wgs84(50.0, 0.0)
        anchor_lon_r, anchor_lat_r = proj.to_wgs84(350.0, 0.0)
        wps = [
            WaypointData(
                lon=anchor_lon_l,
                lat=anchor_lat_l,
                alt=wp_alts[0],
                heading=90.0,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=CameraAction.PHOTO_CAPTURE,
                camera_target=targets[0],
            ),
            *wps,
            WaypointData(
                lon=anchor_lon_r,
                lat=anchor_lat_r,
                alt=wp_alts[-1],
                heading=90.0,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=CameraAction.PHOTO_CAPTURE,
                camera_target=targets[-1],
            ),
        ]

        result = resolve_inspection_collisions(wps, local_geoms, center)

        # anchors retained
        assert result[0].camera_target == targets[0]
        assert result[-1].camera_target == targets[-1]

        # rerouted middle waypoints should have a per-LHA target (not the centroid)
        # and altitude drawn from one of the source LHAs, not the anchor's alt only
        inner = result[1:-1]
        assert len(inner) >= 1
        seen_alts = set()
        for wp in inner:
            assert wp.camera_target is not None
            # per-LHA target, NOT the centroid (different alt)
            assert wp.camera_target.alt in lha_alts
            # alt should match one of the source per-LHA waypoint alts
            assert wp.alt in wp_alts
            seen_alts.add(wp.alt)

        # at least one rerouted alt must differ from the original anchor's alt
        # (would have been all wp_alts[0] before the fix)
        assert seen_alts.intersection(wp_alts)

    def test_preserves_parallel_side_sweep_terrain_delta(self):
        """elevation_provider is re-queried at rerouted (lon, lat) for terrain delta."""
        proj, local_geoms = _setup_reroute_local_geoms()
        center = Point3D(lon=14.0, lat=50.0, alt=295.0)

        # synthetic terrain: ground rises 0.1 m per meter of local x
        provider = _StubElevationProvider(proj, slope_per_meter=0.1, base=0.0)

        wps = []
        for x in [50.0, 150.0, 200.0, 250.0, 350.0]:
            lon, lat = proj.to_wgs84(x, 0.0)
            target = Point3D(lon=lon, lat=lat, alt=300.0)
            # source alt encodes terrain delta at the source position (delta = 0.1 * x)
            wps.append(
                WaypointData(
                    lon=lon,
                    lat=lat,
                    alt=350.0 + 0.1 * x,
                    heading=90.0,
                    waypoint_type=WaypointType.MEASUREMENT,
                    camera_action=CameraAction.PHOTO_CAPTURE,
                    camera_target=target,
                )
            )

        result = resolve_inspection_collisions(
            wps,
            local_geoms,
            center,
            elevation_provider=provider,
        )

        # rerouted waypoints sit off the y=0 axis; their alt must reflect terrain
        # at their actual (lon, lat), not the source's terrain
        anchor_alts = {wps[0].alt, wps[-1].alt}
        inner = result[1:-1]
        assert len(inner) >= 1
        for wp in inner:
            x, _ = proj.to_local(wp.lon, wp.lat)
            # if alt was just copied from source without terrain re-query, it
            # would equal a discrete source value; with re-query it tracks the
            # rerouted x's terrain
            expected_floor = 350.0 + 0.1 * (x - 1.0)
            expected_ceil = 350.0 + 0.1 * (x + 1.0)
            # allow some leeway for floating point
            assert wp.alt > min(anchor_alts) - 5.0
            assert expected_floor - 50.0 < wp.alt < expected_ceil + 50.0

    def test_preserves_vertical_profile_altitude_band(self):
        """rerouted altitudes stay within the source slice's altitude band."""
        proj, local_geoms = _setup_reroute_local_geoms()
        center = Point3D(lon=14.0, lat=50.0, alt=290.0)

        # synthetic VP-like pass: altitudes increase along x
        wps = []
        alts = [320.0, 330.0, 340.0, 350.0, 360.0]
        for x, alt in zip([50.0, 150.0, 200.0, 250.0, 350.0], alts):
            lon, lat = proj.to_wgs84(x, 0.0)
            wps.append(
                WaypointData(
                    lon=lon,
                    lat=lat,
                    alt=alt,
                    heading=90.0,
                    waypoint_type=WaypointType.MEASUREMENT,
                    camera_action=CameraAction.PHOTO_CAPTURE,
                    camera_target=Point3D(lon=14.0, lat=50.0, alt=290.0),
                )
            )

        result = resolve_inspection_collisions(wps, local_geoms, center)

        # source slice is wps[1:4] -> alts 330, 340, 350. anchor_before alt = 320
        # (would-be hardcoded value before the fix). rerouted alts must come from
        # source slice, not the anchor.
        source_alts = {330.0, 340.0, 350.0}
        inner = result[1:-1]
        assert len(inner) >= 1
        for wp in inner:
            assert wp.alt in source_alts, (
                f"rerouted alt {wp.alt} should be inherited from source slice "
                f"{source_alts}, not flattened to anchor_before.alt"
            )


# _build_visibility_graph: STRtree + prep() regression net


def _reference_visibility_graph(
    nodes,
    obstacles,
    zones,
    surfaces=None,
    buffer_distance=0.0,
    require_perpendicular_runway_crossing=True,
    grid_start_index=-1,
):
    """flat-scan reference adjacency, kept in the test file as a regression baseline.

    matches the pre-STRtree implementation byte-for-byte: the STRtree path must
    produce the same dict for any input.
    """
    from shapely.geometry import LineString as _LineString

    from app.services.trajectory.safety_validator import (
        resolve_obstacle_buffer as _resolve_obstacle_buffer,
    )
    from app.services.trajectory.safety_validator import (
        segment_runway_crossing_length as _segment_runway_crossing_length,
    )
    from app.services.trajectory.types import (
        HARD_ZONE_TYPES as _HARD_ZONE_TYPES,
    )
    from app.services.trajectory.types import (
        RUNWAY_CROSSING_PENALTY_PER_METER as _PENALTY,
    )

    graph: dict[int, list[tuple[int, float]]] = {i: [] for i in range(len(nodes))}

    buffered_polys = []
    for obs in obstacles:
        buf = _resolve_obstacle_buffer(obs, buffer_distance)
        buffered_polys.append(obs.polygon.buffer(buf) if buf > 0 else obs.polygon)

    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            xi, yi = nodes[i][0], nodes[i][1]
            xj, yj = nodes[j][0], nodes[j][1]

            if grid_start_index >= 0 and i >= grid_start_index and j >= grid_start_index:
                if euclidean_distance(xi, yi, xj, yj) > GRID_EDGE_RADIUS:
                    continue

            line = _LineString([(xi, yi), (xj, yj)])
            blocked = False
            for poly in buffered_polys:
                if line.intersects(poly):
                    blocked = True
                    break
            if not blocked:
                for zone in zones:
                    if zone.zone_type not in _HARD_ZONE_TYPES:
                        continue
                    if line.intersects(zone.polygon):
                        blocked = True
                        break
            if blocked:
                continue

            dist = euclidean_distance(xi, yi, xj, yj)

            if surfaces and require_perpendicular_runway_crossing:
                for surface in surfaces:
                    crossing = _segment_runway_crossing_length(xi, yi, xj, yj, surface.polygon)
                    if crossing > 0:
                        dist += crossing * _PENALTY

            graph[i].append((j, dist))
            graph[j].append((i, dist))

    return graph


def _normalize_adjacency(graph):
    """sort each neighbor list so dict equality compares structure, not ordering."""
    return {i: sorted(neighbors) for i, neighbors in graph.items()}


def _adjacency_close(a, b, *, rel=1e-9, abs_tol=1e-9):
    """compare two adjacency dicts with floating-point tolerance on weights."""
    if set(a) != set(b):
        return False
    for i in a:
        na = sorted(a[i])
        nb = sorted(b[i])
        if len(na) != len(nb):
            return False
        for (ja, wa), (jb, wb) in zip(na, nb):
            if ja != jb:
                return False
            if wa != pytest.approx(wb, rel=rel, abs=abs_tol):
                return False
    return True


class TestVisibilityGraphSTRtreeEquivalence:
    """STRtree-backed _build_visibility_graph must match the flat-scan reference."""

    def test_strtree_graph_matches_reference_adjacency(self):
        """≥30 nodes + ≥5 obstacles - resulting adjacency matches the flat-scan reference.

        most polygon bboxes don't overlap most edges so the STRtree path
        meaningfully prunes work; this fixture is the equivalence regression net.
        """
        rng = random.Random(20260504)
        nodes: list[tuple[float, float, float]] = []
        # endpoints first so grid_start_index can mark a synthetic split later
        nodes.append((-450.0, 0.0, 350.0))
        nodes.append((450.0, 0.0, 350.0))
        # vertex-like nodes spread across the area
        for _ in range(28):
            nodes.append((rng.uniform(-400.0, 400.0), rng.uniform(-300.0, 300.0), 350.0))

        obstacles = [
            LocalObstacle(
                polygon=box(-300, -50, -260, 50),
                name="ob-a",
                height=40.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
            LocalObstacle(
                polygon=box(-100, -200, -60, -140),
                name="ob-b",
                height=40.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
            LocalObstacle(
                polygon=box(40, 80, 100, 140),
                name="ob-c",
                height=40.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
            LocalObstacle(
                polygon=box(180, -100, 220, -60),
                name="ob-d",
                height=40.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
            LocalObstacle(
                polygon=Point(320, 60).buffer(25),
                name="ob-round",
                height=40.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
        ]
        zones = [
            LocalZone(
                polygon=box(-20, 200, 20, 260),
                zone_type=SafetyZoneType.PROHIBITED,
                name="hard-zone",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
            LocalZone(
                polygon=box(-500, -500, -490, -490),
                zone_type=SafetyZoneType.RESTRICTED,
                name="soft-zone-ignored",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
        ]

        actual = _build_visibility_graph(nodes, obstacles, zones)
        expected = _reference_visibility_graph(nodes, obstacles, zones)

        assert _adjacency_close(actual, expected), (
            "STRtree adjacency differs from flat-scan reference"
        )

    def test_strtree_graph_matches_reference_with_grid_start_index(self):
        """grid_start_index pruning still matches the flat-scan reference."""
        nodes = [
            (-150.0, 0.0, 350.0),  # endpoint
            (150.0, 0.0, 350.0),  # endpoint
            # synthetic 'grid' nodes - some farther apart than GRID_EDGE_RADIUS
            (-50.0, -50.0, 350.0),
            (-50.0, 50.0, 350.0),
            (50.0, -50.0, 350.0),
            (50.0, 50.0, 350.0),
            (200.0, 0.0, 350.0),  # > GRID_EDGE_RADIUS from (-50, -50)
        ]
        obstacles = [
            LocalObstacle(
                polygon=box(-10, -10, 10, 10),
                name="center",
                height=20.0,
                base_alt=0.0,
                buffer_distance=2.0,
            ),
        ]

        grid_start_index = 2  # index 2 onward is treated as grid
        actual = _build_visibility_graph(nodes, obstacles, [], grid_start_index=grid_start_index)
        expected = _reference_visibility_graph(
            nodes, obstacles, [], grid_start_index=grid_start_index
        )
        assert _adjacency_close(actual, expected)

    def test_strtree_blocked_and_clear_edges(self):
        """known-blocked edge is absent; known-clear edge has expected euclidean weight."""
        nodes = [
            (-100.0, 0.0, 350.0),  # 0
            (100.0, 0.0, 350.0),  # 1 - blocked from 0 by central obstacle
            (-100.0, 200.0, 350.0),  # 2 - clear from 0
        ]
        obstacles = [
            LocalObstacle(
                polygon=box(-20, -20, 20, 20),
                name="center-block",
                height=50.0,
                base_alt=0.0,
                buffer_distance=5.0,
            ),
        ]

        graph = _build_visibility_graph(nodes, obstacles, [])

        blocked_neighbors = [j for j, _ in graph[0]]
        assert 1 not in blocked_neighbors, "edge 0->1 must be blocked by obstacle"

        clear = next(((j, w) for j, w in graph[0] if j == 2), None)
        assert clear is not None, "edge 0->2 must be present"
        expected_dist = euclidean_distance(-100.0, 0.0, -100.0, 200.0)
        assert clear[1] == pytest.approx(expected_dist)

    def test_strtree_runway_crossing_penalty_preserved(self):
        """edge crossing a single surface gets crossing_len * RUNWAY_CROSSING_PENALTY_PER_METER."""
        from shapely.geometry import LineString as _LineString

        from app.services.trajectory.types import (
            RUNWAY_CROSSING_PENALTY_PER_METER as _PENALTY,
        )
        from app.utils.local_projection import LocalSurface

        # 60 m wide runway oriented north-south, centered at x=0
        surface = LocalSurface(
            polygon=box(-30, -200, 30, 200),
            centerline=_LineString([(0, -200), (0, 200)]),
            identifier="RW-EQ",
            surface_type="runway",
            width=60.0,
            length=400.0,
            heading=0.0,
        )

        nodes = [
            (-100.0, 0.0, 350.0),
            (100.0, 0.0, 350.0),
        ]

        graph = _build_visibility_graph(
            nodes,
            obstacles=[],
            zones=[],
            surfaces=[surface],
            require_perpendicular_runway_crossing=True,
        )

        edge = next(((j, w) for j, w in graph[0] if j == 1), None)
        assert edge is not None

        euclid = euclidean_distance(-100.0, 0.0, 100.0, 0.0)
        crossing_len = 60.0  # segment cuts surface from x=-30 to x=30 along y=0
        expected = euclid + crossing_len * _PENALTY
        assert edge[1] == pytest.approx(expected)

        # disabling the penalty drops the weight back to euclidean
        no_penalty = _build_visibility_graph(
            nodes,
            obstacles=[],
            zones=[],
            surfaces=[surface],
            require_perpendicular_runway_crossing=False,
        )
        flat_edge = next(((j, w) for j, w in no_penalty[0] if j == 1), None)
        assert flat_edge is not None
        assert flat_edge[1] == pytest.approx(euclid)

    def test_strtree_empty_obstacles_zones_and_surfaces(self):
        """empty inputs - tree is None and the all-pairs euclidean graph is preserved."""
        nodes = [
            (-100.0, 0.0, 350.0),
            (0.0, 0.0, 350.0),
            (100.0, 0.0, 350.0),
        ]

        graph = _build_visibility_graph(nodes, obstacles=[], zones=[], surfaces=None)

        # all unique pairs present, euclidean weights, symmetric adjacency
        assert sorted(j for j, _ in graph[0]) == [1, 2]
        assert sorted(j for j, _ in graph[1]) == [0, 2]
        assert sorted(j for j, _ in graph[2]) == [0, 1]

        for i in range(len(nodes)):
            for j, w in graph[i]:
                assert w == pytest.approx(
                    euclidean_distance(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1])
                )


# _build_visibility_graph: shapely 2.x vectorized regression net


class TestVisibilityGraphVectorizedEquivalence:
    """vectorized _build_visibility_graph must still match the flat-scan reference.

    Shapely 2.x batch predicates (`creation.linestrings` + `STRtree.query(predicate=...)`)
    must produce byte-for-byte identical adjacency vs the per-edge Python loop. The
    fixture is denser than the STRtree-only suite (≥50 nodes, ≥10 obstacles, ≥3
    surfaces) so a per-line FP drift would surface in at least one accumulated weight.
    """

    @staticmethod
    def _dense_fixture(seed: int = 20260504):
        """seeded dense fixture: 50+ nodes, 10+ obstacles, 3+ surfaces."""
        from shapely.geometry import LineString as _LineString

        from app.utils.local_projection import LocalSurface

        rng = random.Random(seed)
        nodes: list[tuple[float, float, float]] = []
        # explicit endpoints first so callers can reuse them as graph entries
        nodes.append((-450.0, -50.0, 350.0))
        nodes.append((450.0, 50.0, 350.0))
        # 50 vertex-like nodes spread across the area
        for _ in range(50):
            nodes.append((rng.uniform(-400.0, 400.0), rng.uniform(-300.0, 300.0), 350.0))

        obstacles = []
        # 10 mixed-shape obstacles spread across the search area
        for k, (cx, cy) in enumerate(
            [
                (-300, -50),
                (-100, -200),
                (40, 80),
                (180, -100),
                (320, 60),
                (-220, 180),
                (260, 220),
                (-50, -50),
                (100, -180),
                (-360, 90),
            ]
        ):
            if k % 2 == 0:
                poly = box(cx - 25, cy - 20, cx + 25, cy + 20)
            else:
                poly = Point(cx, cy).buffer(20)
            obstacles.append(
                LocalObstacle(
                    polygon=poly,
                    name=f"ob-{k}",
                    height=40.0,
                    base_alt=0.0,
                    buffer_distance=5.0,
                )
            )

        zones = [
            LocalZone(
                polygon=box(-20, 200, 20, 260),
                zone_type=SafetyZoneType.PROHIBITED,
                name="hard-zone",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
            LocalZone(
                polygon=box(-500, -500, -490, -490),
                zone_type=SafetyZoneType.RESTRICTED,
                name="soft-zone-ignored",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
        ]

        # 3 overlapping surfaces so multi-surface penalty accumulation matters
        surfaces = [
            LocalSurface(
                polygon=box(-30, -250, 30, 250),
                centerline=_LineString([(0, -250), (0, 250)]),
                identifier="RW-NS",
                surface_type="runway",
                width=60.0,
                length=500.0,
                heading=0.0,
            ),
            LocalSurface(
                polygon=box(-250, -25, 250, 25),
                centerline=_LineString([(-250, 0), (250, 0)]),
                identifier="RW-EW",
                surface_type="runway",
                width=50.0,
                length=500.0,
                heading=90.0,
            ),
            LocalSurface(
                polygon=box(-200, 100, 200, 140),
                centerline=_LineString([(-200, 120), (200, 120)]),
                identifier="TWY-A",
                surface_type="taxiway",
                width=40.0,
                length=400.0,
                heading=90.0,
            ),
        ]
        return nodes, obstacles, zones, surfaces

    def test_dense_fixture_matches_reference_adjacency(self):
        """50+ nodes, 10+ obstacles, 3+ overlapping surfaces - byte-for-byte match."""
        nodes, obstacles, zones, surfaces = self._dense_fixture()
        actual = _build_visibility_graph(nodes, obstacles, zones, surfaces=surfaces)
        expected = _reference_visibility_graph(nodes, obstacles, zones, surfaces=surfaces)
        assert _adjacency_close(actual, expected), (
            "vectorized adjacency differs from flat-scan reference on dense fixture"
        )

    def test_dense_fixture_with_grid_start_index_matches_reference(self):
        """grid-radius pruning preserved end-to-end on the dense fixture."""
        nodes, obstacles, zones, surfaces = self._dense_fixture(seed=20260505)
        # treat the second half of nodes as 'grid' so the radius cutoff bites
        grid_start_index = len(nodes) // 2
        actual = _build_visibility_graph(
            nodes,
            obstacles,
            zones,
            surfaces=surfaces,
            grid_start_index=grid_start_index,
        )
        expected = _reference_visibility_graph(
            nodes,
            obstacles,
            zones,
            surfaces=surfaces,
            grid_start_index=grid_start_index,
        )
        assert _adjacency_close(actual, expected)

    def test_empty_obstacles_and_surfaces_produces_full_graph(self):
        """zero-length blocking and surface arrays - vectorized path stays connected."""
        rng = random.Random(20260506)
        nodes = [(rng.uniform(-100.0, 100.0), rng.uniform(-100.0, 100.0), 0.0) for _ in range(8)]

        actual = _build_visibility_graph(nodes, obstacles=[], zones=[], surfaces=None)
        expected = _reference_visibility_graph(nodes, obstacles=[], zones=[], surfaces=None)
        assert _adjacency_close(actual, expected)

        # complete graph: every pair connected, weight == euclidean
        for i in range(len(nodes)):
            assert sorted(j for j, _ in actual[i]) == [k for k in range(len(nodes)) if k != i]

    def test_empty_eligible_pairs_returns_empty_graph(self):
        """grid-radius cutoff that excludes every pair must not crash the vector path."""
        # all nodes far apart in 'grid' so the radius cutoff drops every pair
        far = GRID_EDGE_RADIUS * 3
        nodes = [
            (0.0, 0.0, 0.0),
            (far, 0.0, 0.0),
            (0.0, far, 0.0),
        ]
        obstacles = [
            LocalObstacle(
                polygon=box(-1000, -1000, 1000, 1000),
                name="any",
                height=10.0,
                base_alt=0.0,
                buffer_distance=0.0,
            ),
        ]
        # grid_start_index=0 → every (i, j) pair counts as grid-to-grid
        graph = _build_visibility_graph(nodes, obstacles, [], surfaces=None, grid_start_index=0)
        for i in range(len(nodes)):
            assert graph[i] == []

    def test_runway_crossing_penalty_matches_reference_when_multiple_surfaces_overlap(self):
        """multi-surface overlap accumulates in surface-list order vs reference."""
        from shapely.geometry import LineString as _LineString

        from app.services.trajectory.types import (
            RUNWAY_CROSSING_PENALTY_PER_METER as _PENALTY,
        )
        from app.utils.local_projection import LocalSurface

        # two overlapping runways: NS and EW, intersecting at origin
        surfaces = [
            LocalSurface(
                polygon=box(-30, -200, 30, 200),
                centerline=_LineString([(0, -200), (0, 200)]),
                identifier="RW-NS",
                surface_type="runway",
                width=60.0,
                length=400.0,
                heading=0.0,
            ),
            LocalSurface(
                polygon=box(-200, -25, 200, 25),
                centerline=_LineString([(-200, 0), (200, 0)]),
                identifier="RW-EW",
                surface_type="runway",
                width=50.0,
                length=400.0,
                heading=90.0,
            ),
        ]
        # diagonal segment crosses both surfaces
        nodes = [(-150.0, -150.0, 350.0), (150.0, 150.0, 350.0)]

        actual = _build_visibility_graph(
            nodes,
            obstacles=[],
            zones=[],
            surfaces=surfaces,
            require_perpendicular_runway_crossing=True,
        )
        expected = _reference_visibility_graph(
            nodes,
            obstacles=[],
            zones=[],
            surfaces=surfaces,
            require_perpendicular_runway_crossing=True,
        )
        assert _adjacency_close(actual, expected)

        # weight strictly greater than euclidean (penalty is non-zero)
        edge = next(((j, w) for j, w in actual[0] if j == 1), None)
        assert edge is not None
        euclid = euclidean_distance(nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1])
        assert edge[1] > euclid + _PENALTY * 0.1

    def test_dense_fixture_no_perpendicular_flag_drops_penalty(self):
        """flag off skips surface penalty; vectorized path matches reference."""
        nodes, obstacles, zones, surfaces = self._dense_fixture(seed=20260507)
        actual = _build_visibility_graph(
            nodes,
            obstacles,
            zones,
            surfaces=surfaces,
            require_perpendicular_runway_crossing=False,
        )
        expected = _reference_visibility_graph(
            nodes,
            obstacles,
            zones,
            surfaces=surfaces,
            require_perpendicular_runway_crossing=False,
        )
        assert _adjacency_close(actual, expected)


# AirfieldSurface.buffer_distance is honored by A* (visibility graph + perp nodes)


def _make_perpendicular_surface_airport(
    db_session,
    *,
    surface_cls,
    surface_type: str,
    width: float,
    buffer_distance: float,
):
    """build an airport with a single east-west surface (runway or taxiway)."""
    airport = Airport(
        id=uuid4(),
        icao_code=_unique_icao(db_session),
        name="Buffer Test Airport",
        elevation=300.0,
        location="POINT Z (14.26 50.10 300)",
    )
    surface = surface_cls(
        id=uuid4(),
        airport_id=airport.id,
        identifier="09/27" if surface_type == "RUNWAY" else "A1",
        surface_type=surface_type,
        geometry="LINESTRING Z (14.255 50.10 300, 14.265 50.10 300)",
        heading=90.0,
        length=700.0,
        width=width,
        buffer_distance=buffer_distance,
    )
    db_session.add(airport)
    db_session.add(surface)
    db_session.commit()
    db_session.refresh(airport)
    db_session.refresh(surface)
    return airport, surface


class TestSurfaceBufferDistanceHonoredByPlanner:
    """`AirfieldSurface.buffer_distance` must inflate the planner's no-go region.

    regression: prior to this fix the centerline was buffered only by
    half_width, so A*'s visibility-graph crossing penalty and the perpendicular
    candidate-node spacing both ignored the operator-set keepout.
    """

    def test_runway_buffer_inflates_local_surface_polygon(self, db_session):
        """LocalSurface.polygon contains a point 1 m past the raw runway edge."""
        _, runway = _make_perpendicular_surface_airport(
            db_session,
            surface_cls=Runway,
            surface_type="RUNWAY",
            width=45.0,
            buffer_distance=20.0,
        )
        local_geoms = _build_local_geoms(db_session, None, [runway])
        local_surface = local_geoms.surfaces[0]
        assert local_surface.buffer_distance == 20.0

        # candidate node at half_width + 1m past raw edge - inside the buffered region
        cl_coords = list(local_surface.centerline.coords)
        cx = (cl_coords[0][0] + cl_coords[-1][0]) / 2
        candidate = Point(cx, runway.width / 2.0 + 1.0)
        assert local_surface.polygon.contains(candidate), (
            "candidate node 1m past raw runway edge must lie inside the buffered no-go region"
        )

    def test_runway_perpendicular_node_spacing_includes_buffer(self, db_session):
        """perpendicular crossing nodes must sit at width/2 + buffer + vertex_buffer_m."""
        _, runway = _make_perpendicular_surface_airport(
            db_session,
            surface_cls=Runway,
            surface_type="RUNWAY",
            width=45.0,
            buffer_distance=20.0,
        )
        local_geoms = _build_local_geoms(db_session, None, [runway])

        # endpoints north and south of the runway force perpendicular projection
        from_local = (0.0, -200.0, 350.0)
        to_local = (0.0, 200.0, 350.0)

        nodes, _ = _collect_graph_nodes_in_circle(
            [from_local, to_local],
            [],
            [],
            local_geoms.surfaces,
            (0.0, 0.0),
            radius=400.0,
            require_perpendicular_runway_crossing=True,
        )

        expected_offset = runway.width / 2.0 + runway.buffer_distance + settings.vertex_buffer_m
        # nodes added by the perpendicular-crossing branch sit at (x≈0, y≈±expected_offset)
        perp_nodes = [
            n for n in nodes if abs(n[0]) < 1.0 and abs(abs(n[1]) - expected_offset) < 0.5
        ]
        assert len(perp_nodes) >= 2, (
            f"expected perpendicular nodes near y=±{expected_offset:.1f}, "
            f"found nodes near runway: "
            f"{[(round(n[0], 1), round(n[1], 1)) for n in nodes if abs(n[0]) < 1.0]}"
        )

        # also assert no perpendicular node sits inside the raw rectangle (half_width only)
        raw_half = runway.width / 2.0
        for n in perp_nodes:
            assert abs(n[1]) > raw_half, (
                f"perpendicular node at y={n[1]:.1f} sits within raw half-width {raw_half}"
            )

    def test_taxiway_buffer_inflates_local_surface_polygon(self, db_session):
        """taxiway buffer behaves identically to runway buffer (no surface_type filter)."""
        _, taxiway = _make_perpendicular_surface_airport(
            db_session,
            surface_cls=Taxiway,
            surface_type="TAXIWAY",
            width=20.0,
            buffer_distance=10.0,
        )
        local_geoms = _build_local_geoms(db_session, None, [taxiway])
        local_surface = local_geoms.surfaces[0]
        assert local_surface.buffer_distance == 10.0

        cl_coords = list(local_surface.centerline.coords)
        cx = (cl_coords[0][0] + cl_coords[-1][0]) / 2
        # 1m past the raw edge - inside the buffered region
        assert local_surface.polygon.contains(Point(cx, taxiway.width / 2.0 + 1.0))
        # well outside half_width + buffer = 20m
        assert not local_surface.polygon.contains(Point(cx, taxiway.width / 2.0 + 11.0))

    def test_taxiway_perpendicular_node_spacing_includes_buffer(self, db_session):
        """taxiway perpendicular nodes also sit outside the buffered region."""
        _, taxiway = _make_perpendicular_surface_airport(
            db_session,
            surface_cls=Taxiway,
            surface_type="TAXIWAY",
            width=20.0,
            buffer_distance=10.0,
        )
        local_geoms = _build_local_geoms(db_session, None, [taxiway])

        from_local = (0.0, -200.0, 350.0)
        to_local = (0.0, 200.0, 350.0)
        nodes, _ = _collect_graph_nodes_in_circle(
            [from_local, to_local],
            [],
            [],
            local_geoms.surfaces,
            (0.0, 0.0),
            radius=400.0,
            require_perpendicular_runway_crossing=True,
        )

        expected_offset = taxiway.width / 2.0 + taxiway.buffer_distance + settings.vertex_buffer_m
        perp_nodes = [
            n for n in nodes if abs(n[0]) < 1.0 and abs(abs(n[1]) - expected_offset) < 0.5
        ]
        assert len(perp_nodes) >= 2, (
            f"expected perpendicular nodes near y=±{expected_offset:.1f} for taxiway"
        )

    def test_planner_route_keeps_waypoints_outside_buffered_no_go_region(self, db_session):
        """end-to-end A* regression for issue #373: with a non-zero buffer_distance,
        the produced trajectory must keep every waypoint OUTSIDE the buffered
        no-go region (centerline buffered by width/2 + buffer_distance).

        diagonal endpoints force A* off the fast path and onto the perpendicular
        anchors. pre-fix the anchors landed at y=±(width/2 + vertex_buffer) -
        inside the operator-drawn buffer that extends to y=±(width/2 +
        buffer_distance). post-fix they sit at y=±(width/2 + buffer_distance +
        vertex_buffer), outside the buffered no-go region. exercises the
        polygon inflation, the perpendicular node spacing, and the
        visibility-graph crossing penalty in one go.
        """
        _, runway = _make_perpendicular_surface_airport(
            db_session,
            surface_cls=Runway,
            surface_type="RUNWAY",
            width=45.0,
            buffer_distance=20.0,
        )
        local_geoms = _build_local_geoms(db_session, None, [runway])
        proj = local_geoms.proj

        # buffered no-go region built directly from centerline so the assertion
        # doesn't depend on LocalSurface.polygon's construction
        expected_no_go = local_geoms.surfaces[0].centerline.buffer(
            runway.width / 2.0 + runway.buffer_distance, cap_style="flat"
        )

        # diagonal endpoints SE and NW of the runway: A* must produce a
        # perpendicular crossing rather than the (cheaper-when-aligned) direct path.
        from_pt = Point3D(lon=14.262, lat=50.0975, alt=350.0)
        to_pt = Point3D(lon=14.258, lat=50.1025, alt=350.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )

        assert len(wps) > 1, (
            f"A* must produce a multi-waypoint perpendicular crossing, got {len(wps)}"
        )

        for wp in wps:
            x, y = proj.to_local(wp.lon, wp.lat)
            assert not expected_no_go.contains(Point(x, y)), (
                f"trajectory waypoint at local ({x:.1f}, {y:.1f}) sits inside the "
                f"buffered runway no-go region (buffer_distance={runway.buffer_distance}m)"
            )


# avoid runway crossings (issue #378)


def _build_inplane_runway_geoms(
    *,
    width: float = 45.0,
    buffer_distance: float = 10.0,
    half_length: float = 100.0,
    extra_zones: list | None = None,
):
    """build LocalGeometries with a single east-west runway centered at the local origin.

    runway centerline runs from (-half_length, 0) to (half_length, 0). polygon is the
    centerline buffered by width/2 + buffer_distance with flat caps - matches what
    `app.utils.local_projection.build_local_geometries` produces for a real runway.
    """
    from shapely.geometry import LineString

    from app.services.trajectory.types import LocalGeometries, LocalSurface
    from app.utils.local_projection import LocalProjection

    centerline = LineString([(-half_length, 0.0), (half_length, 0.0)])
    polygon = centerline.buffer(width / 2.0 + buffer_distance, cap_style="flat")
    surface = LocalSurface(
        polygon=polygon,
        centerline=centerline,
        identifier="09/27",
        surface_type="RUNWAY",
        width=width,
        length=half_length * 2.0,
        heading=90.0,
        buffer_distance=buffer_distance,
    )
    return LocalGeometries(
        proj=LocalProjection(ref_lon=14.0, ref_lat=50.0),
        obstacles=[],
        zones=list(extra_zones or []),
        boundary_zones=[],
        surfaces=[surface],
    )


class TestAvoidRunwayCrossings:
    """toggle 'avoid runway crossings' (issue #378).

    the legacy field name `require_perpendicular_runway_crossing` is kept; semantics
    changed from 'cross at 90°' to 'avoid crossings when feasible, fall back to
    perpendicular when not'. these tests pin all four branches called out in the issue.
    """

    def test_grid_nodes_excluded_from_buffered_surface_region(self):
        """grid-fill in `_collect_graph_nodes_in_circle` must exclude surfaces (issue #378
        root cause #1). PR #374 added obstacles + hard zones to `exclusion_polys` but
        not surfaces, so grid nodes could land inside the buffered runway region.
        """
        geoms = _build_inplane_runway_geoms(
            width=45.0,
            buffer_distance=20.0,
            half_length=300.0,
        )
        surface = geoms.surfaces[0]

        endpoints = [(-200.0, -100.0, 350.0), (200.0, 100.0, 350.0)]
        nodes, grid_start_index = _collect_graph_nodes_in_circle(
            endpoints,
            [],
            [],
            geoms.surfaces,
            (0.0, 0.0),
            radius=400.0,
            require_perpendicular_runway_crossing=True,
        )

        grid_nodes = nodes[grid_start_index:]
        assert len(grid_nodes) > 0, "expected non-empty grid fill"
        for x, y, _ in grid_nodes:
            assert not surface.polygon.contains(Point(x, y)), (
                f"grid node ({x:.1f}, {y:.1f}) sits inside buffered surface region"
            )

    def test_planner_routes_around_runway_when_corridor_open(self):
        """toggle on + free corridor -> A* picks go-around, never enters surface.polygon.
        endpoints sit on opposite sides of a short runway with no zones blocking the
        ends, so the visibility-graph crossing penalty must dominate the detour cost.
        """
        geoms = _build_inplane_runway_geoms(
            width=45.0,
            buffer_distance=10.0,
            half_length=100.0,
        )
        surface = geoms.surfaces[0]
        proj = geoms.proj

        from_lon, from_lat = proj.to_wgs84(0.0, -500.0)
        to_lon, to_lat = proj.to_wgs84(0.0, 500.0)
        from_pt = Point3D(lon=from_lon, lat=from_lat, alt=350.0)
        to_pt = Point3D(lon=to_lon, lat=to_lat, alt=350.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )

        assert len(wps) > 1, (
            f"expected a detour with multiple waypoints, got {len(wps)} "
            f"(planner may have crossed the runway directly)"
        )

        # walk every segment - none may intersect surface.polygon
        from shapely.geometry import LineString as ShapelyLineString

        prev_x, prev_y = proj.to_local(from_pt.lon, from_pt.lat)
        for wp in wps:
            cur_x, cur_y = proj.to_local(wp.lon, wp.lat)
            seg = ShapelyLineString([(prev_x, prev_y), (cur_x, cur_y)])
            crossing = seg.intersection(surface.polygon)
            assert crossing.is_empty or crossing.length < 1e-6, (
                f"transit segment ({prev_x:.1f}, {prev_y:.1f}) -> "
                f"({cur_x:.1f}, {cur_y:.1f}) enters buffered runway "
                f"(crossing length {crossing.length:.1f} m)"
            )
            prev_x, prev_y = cur_x, cur_y

        # length sanity: detour must be a small multiple of the straight-line distance
        rerouted = _path_distance(wps, from_pt)
        straight = total_path_distance(
            [(from_pt.lon, from_pt.lat, from_pt.alt), (to_pt.lon, to_pt.lat, to_pt.alt)]
        )
        assert rerouted < straight * 2.5, (
            f"go-around {rerouted:.1f} m suspiciously long vs straight-line "
            f"{straight:.1f} m - planner may have picked a pathological detour"
        )

    def test_planner_crosses_perpendicular_when_corridor_blocked(self):
        """toggle on + go-around blocked -> A* falls back to a crossing, and the
        new surface exclusion + perpendicular crossing nodes keep every waypoint
        outside the buffered no-go region.
        """
        # prohibited zones plug both runway ends, leaving the open central
        # corridor (and therefore the runway crossing) as the only path. zones
        # start exactly where the runway buffer ends in x and span the full
        # search-circle y range so the endpoints stay outside the zones.
        zones = [
            LocalZone(
                polygon=box(100.0, -650.0, 700.0, 650.0),
                zone_type=SafetyZoneType.PROHIBITED,
                name="east-block",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
            LocalZone(
                polygon=box(-700.0, -650.0, -100.0, 650.0),
                zone_type=SafetyZoneType.PROHIBITED,
                name="west-block",
                altitude_floor=None,
                altitude_ceiling=None,
            ),
        ]
        geoms = _build_inplane_runway_geoms(
            width=45.0,
            buffer_distance=10.0,
            half_length=100.0,
            extra_zones=zones,
        )
        surface = geoms.surfaces[0]
        proj = geoms.proj

        # endpoints sit on the centerline-perpendicular axis inside the corridor
        from_lon, from_lat = proj.to_wgs84(0.0, -500.0)
        to_lon, to_lat = proj.to_wgs84(0.0, 500.0)
        from_pt = Point3D(lon=from_lon, lat=from_lat, alt=350.0)
        to_pt = Point3D(lon=to_lon, lat=to_lat, alt=350.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )

        # at least one segment must intersect the runway buffer (crossing happened)
        from shapely.geometry import LineString as ShapelyLineString

        prev_x, prev_y = proj.to_local(from_pt.lon, from_pt.lat)
        any_crossing = False
        for wp in wps:
            cur_x, cur_y = proj.to_local(wp.lon, wp.lat)
            seg = ShapelyLineString([(prev_x, prev_y), (cur_x, cur_y)])
            crossing = seg.intersection(surface.polygon)
            if not crossing.is_empty and crossing.length > 1e-6:
                any_crossing = True
            prev_x, prev_y = cur_x, cur_y
        assert any_crossing, (
            "expected at least one segment to cross the runway when go-around is blocked"
        )

        # no waypoint may sit inside the buffered no-go (centerline buffered by
        # width/2 + buffer_distance + vertex_buffer_m)
        half_w = surface.width / 2.0 + surface.buffer_distance + settings.vertex_buffer_m
        epsilon = 0.5
        for wp in wps:
            x, y = proj.to_local(wp.lon, wp.lat)
            # only inside the runway centerline x-range can the y-strip apply
            if -surface.length / 2.0 - epsilon <= x <= surface.length / 2.0 + epsilon:
                assert abs(y) >= half_w - epsilon, (
                    f"waypoint at ({x:.1f}, {y:.1f}) sits inside buffered region "
                    f"(half_w including vertex_buffer = {half_w:.1f} m)"
                )

    def test_inter_pass_transit_uses_perpendicular_crossing_nodes(self):
        """compute_inter_pass_transits drops perpendicular crossing nodes into its
        hull-vertex-only graph so A* has a short crossing edge available - without
        them, A* walks the runway perimeter even when crossing would be shorter
        (issue #378 follow-up; before this fix the screenshotted U-shape detour was
        the cheapest path A* could construct).

        fixture: long runway with two passes parallel to it (one each side). pass
        endpoints sit JUST outside the buffered region in y but well inside the
        runway in x, so any path that doesn't use the crossing nodes has to take
        an L-shape through a hull corner that itself slices the runway buffer.
        """
        from app.services.trajectory.pathfinding import compute_inter_pass_transits

        geoms = _build_inplane_runway_geoms(
            width=45.0,
            buffer_distance=10.0,
            half_length=1500.0,
        )
        surface = geoms.surfaces[0]
        proj = geoms.proj

        def to_pt(x, y, alt=350.0):
            """build a Point3D at local-meter (x, y) on the test runway projection."""
            lon, lat = proj.to_wgs84(x, y)
            return Point3D(lon=lon, lat=lat, alt=alt)

        pass_endpoints = [
            (to_pt(-1000.0, -100.0), to_pt(1000.0, -100.0)),
            (to_pt(-1000.0, 100.0), to_pt(1000.0, 100.0)),
        ]

        transits, _ = compute_inter_pass_transits(
            pass_endpoints,
            geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=True,
        )

        assert len(transits) == 1
        wps = transits[0]
        assert len(wps) > 1, "expected the slow A* path, not the straight-line fast path"

        # at least one intermediate waypoint should sit at the perpendicular foot
        # (x ≈ 0). a hull-corner L-shape would route through x = ±1000 instead.
        intermediate_xs = [proj.to_local(wp.lon, wp.lat)[0] for wp in wps[:-1]]
        assert any(abs(x) < 50.0 for x in intermediate_xs), (
            f"expected an intermediate waypoint near the perpendicular foot (x ≈ 0), "
            f"got intermediates at x = {[round(x, 1) for x in intermediate_xs]} - planner "
            f"likely fell back to a hull-perimeter detour"
        )

        # and the transit must actually cross the runway, not detour around it
        from shapely.geometry import LineString as ShapelyLineString

        prev_x, prev_y = proj.to_local(pass_endpoints[0][1].lon, pass_endpoints[0][1].lat)
        any_crossing = False
        for wp in wps:
            cur_x, cur_y = proj.to_local(wp.lon, wp.lat)
            seg = ShapelyLineString([(prev_x, prev_y), (cur_x, cur_y)])
            if not seg.intersection(surface.polygon).is_empty:
                any_crossing = True
            prev_x, prev_y = cur_x, cur_y
        assert any_crossing, (
            "expected at least one transit segment to cross the buffered runway "
            "(perpendicular crossing); the planner walked the perimeter instead"
        )

    def test_inter_pass_grid_fill_populates_navigable_hull_interior(self):
        """`_grid_fill_in_region` covers the hull interior at GRID_NODE_SPACING,
        with buffered obstacles, hard zones, and surfaces excluded.

        proves the MEASUREMENTS_ONLY core has grid fill (issue #378 follow-up):
        without it, the inter-pass A* could only route through obstacle/hull
        corner vertices and produced runway-perimeter detours on mission
        9862000b-ccb3-44fe-b629-d124d92db5fb. degenerate hulls produce no
        grid nodes (zero-area is_empty / area==0).
        """
        from shapely.geometry import MultiPoint, Polygon
        from shapely.geometry import Point as _ShapelyPoint

        from app.services.trajectory.pathfinding import _grid_fill_in_region
        from app.services.trajectory.types import GRID_NODE_SPACING

        # 600 m square hull centered at origin
        hull = MultiPoint(
            [(-300.0, -300.0), (300.0, -300.0), (300.0, 300.0), (-300.0, 300.0)]
        ).convex_hull

        # one buffered obstacle near the centre - a 50 m square at (0, 0)
        obs_poly = Polygon([(-25.0, -25.0), (25.0, -25.0), (25.0, 25.0), (-25.0, 25.0)])
        obs = LocalObstacle(
            polygon=obs_poly,
            name="middle",
            height=20.0,
            base_alt=0.0,
            buffer_distance=10.0,
        )
        intersecting = [(obs, obs_poly.buffer(10.0))]

        nodes = _grid_fill_in_region(hull, intersecting, [], [])

        # at 50 m spacing the 600x600 hull yields ~13x13 = 169 candidate cells,
        # minus those falling inside the buffered obstacle (~35x35 area = ~1).
        assert len(nodes) > 100, f"expected dense grid fill, got {len(nodes)} nodes"

        # no node sits inside the buffered obstacle
        buffered = obs_poly.buffer(10.0)
        for x, y in nodes:
            assert not buffered.contains(_ShapelyPoint(x, y)), (
                f"grid fill leaked node ({x}, {y}) inside buffered obstacle"
            )

        # all nodes sit inside the hull
        for x, y in nodes:
            assert hull.contains(_ShapelyPoint(x, y))

        # hard zone exclusion: a zone covering the upper half drops every node above y=0
        hard_zone = LocalZone(
            polygon=Polygon([(-300.0, 0.0), (300.0, 0.0), (300.0, 300.0), (-300.0, 300.0)]),
            zone_type="PROHIBITED",
            name="upper",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        zoned_nodes = _grid_fill_in_region(hull, intersecting, [hard_zone], [])
        # strict-contains policy: boundary points (y=0) are treated as outside,
        # matching `test_endpoint_on_buffered_obstacle_boundary_treated_as_outside`.
        assert all(y <= 0 for _, y in zoned_nodes), (
            f"grid fill leaked node into hard zone interior (y > 0): "
            f"{[n for n in zoned_nodes if n[1] > 0]}"
        )
        assert len(zoned_nodes) > 0

        # spacing matches GRID_NODE_SPACING along the x-axis
        xs_below_zero = sorted({x for x, y in zoned_nodes if abs(y - (-50.0)) < 1e-6})
        if len(xs_below_zero) >= 2:
            spacing = xs_below_zero[1] - xs_below_zero[0]
            assert abs(spacing - GRID_NODE_SPACING) < 1e-6

        # degenerate hull - single point - produces no grid nodes
        point_hull = MultiPoint([(0.0, 0.0)]).convex_hull
        assert _grid_fill_in_region(point_hull, [], [], []) == []

    def test_planner_geodesic_crossing_when_toggle_off(self):
        """toggle off -> previous geodesic-crossing behavior preserved, no detour.
        same fixture as the corridor-open test but with the flag flipped, so the
        fast-path branch kicks in and returns a single straight-line waypoint.
        """
        geoms = _build_inplane_runway_geoms(
            width=45.0,
            buffer_distance=10.0,
            half_length=100.0,
        )
        proj = geoms.proj

        from_lon, from_lat = proj.to_wgs84(0.0, -500.0)
        to_lon, to_lat = proj.to_wgs84(0.0, 500.0)
        from_pt = Point3D(lon=from_lon, lat=from_lat, alt=350.0)
        to_pt = Point3D(lon=to_lon, lat=to_lat, alt=350.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            geoms,
            speed=8.0,
            require_perpendicular_runway_crossing=False,
        )

        assert len(wps) == 1, (
            f"toggle off should pick a single straight-line waypoint via fast path, "
            f"got {len(wps)} waypoints"
        )
        assert abs(wps[0].lon - to_pt.lon) < 1e-9
        assert abs(wps[0].lat - to_pt.lat) < 1e-9


# compute_inter_pass_transits parallel-vs-sequential equivalence


class TestComputeInterPassTransitsParallelEquivalence:
    """parallel ThreadPoolExecutor path must match the sequential reference.

    fixture has 4+ transits (5+ pass endpoints) routed around buffered obstacles so
    every transit hits the slow A* path, exercising the per-worker cache rebuild.
    """

    @staticmethod
    def _fixture():
        """build LocalGeometries + 5 pass endpoints with one A*-routed transit.

        transits 1, 3, 4 use the fast straight-line path; transit 2 hits a
        buffered obstacle and is routed through the dilated visibility graph,
        with a far obstacle supplying Δ for the dilation step.
        """
        from app.services.trajectory.types import LocalGeometries, LocalObstacle, Point3D
        from app.utils.local_projection import LocalProjection

        proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
        obstacles = [
            LocalObstacle(
                polygon=box(340.0, -40.0, 360.0, -30.0),
                name="block",
                height=20.0,
                base_alt=0.0,
                buffer_distance=10.0,
            ),
            LocalObstacle(
                polygon=box(440.0, -300.0, 460.0, -290.0),
                name="far-delta",
                height=20.0,
                base_alt=0.0,
                buffer_distance=20.0,
            ),
        ]
        geoms = LocalGeometries(
            proj=proj,
            obstacles=obstacles,
            zones=[],
            boundary_zones=[],
            surfaces=[],
        )

        def to_pt(x, y, alt=100.0):
            lon, lat = proj.to_wgs84(x, y)
            return Point3D(lon=lon, lat=lat, alt=alt)

        endpoints = [
            (to_pt(0.0, -50.0), to_pt(100.0, -50.0)),
            (to_pt(200.0, -50.0), to_pt(300.0, -50.0)),
            (to_pt(400.0, -50.0), to_pt(500.0, -50.0)),
            (to_pt(600.0, -50.0), to_pt(700.0, -50.0)),
            (to_pt(800.0, -50.0), to_pt(900.0, -50.0)),
        ]
        return geoms, endpoints

    @staticmethod
    def _wp_signature(wps):
        """tuple-of-tuples view used for waypoint-by-waypoint equality."""
        return tuple((wp.lon, wp.lat, wp.alt, wp.heading, wp.speed, wp.waypoint_type) for wp in wps)

    @staticmethod
    def _run(parallel: str):
        """invoke compute_inter_pass_transits with TRAJECTORY_PARALLEL_VG override."""
        from app.services.trajectory.pathfinding import compute_inter_pass_transits

        geoms, endpoints = TestComputeInterPassTransitsParallelEquivalence._fixture()
        prev = os.environ.get("TRAJECTORY_PARALLEL_VG")
        os.environ["TRAJECTORY_PARALLEL_VG"] = parallel
        try:
            return compute_inter_pass_transits(endpoints, geoms, speed=5.0)
        finally:
            if prev is None:
                os.environ.pop("TRAJECTORY_PARALLEL_VG", None)
            else:
                os.environ["TRAJECTORY_PARALLEL_VG"] = prev

    def test_parallel_matches_sequential(self):
        """waypoints, transit count, and warnings match across both modes."""
        seq_transits, seq_warnings = self._run("0")
        par_transits, par_warnings = self._run("1")

        assert len(par_transits) == len(seq_transits) == 4
        assert par_warnings == seq_warnings
        for par_wps, seq_wps in zip(par_transits, seq_transits):
            assert self._wp_signature(par_wps) == self._wp_signature(seq_wps)

    def test_parallel_is_deterministic_across_runs(self):
        """5 repeated parallel runs produce identical waypoints and warnings."""
        first_transits, first_warnings = self._run("1")
        first_sig = [self._wp_signature(wps) for wps in first_transits]
        for _ in range(4):
            transits, warnings = self._run("1")
            assert warnings == first_warnings
            assert [self._wp_signature(wps) for wps in transits] == first_sig


# keep-inside-airport-boundary toggle - per-edge penalty + fast-path falls through to A*


class TestVisibilityGraphKeepInsideBoundary:
    """keep-inside penalty must mirror the runway-crossing block.

    keep-inside off produces byte-identical weights to the no-preference shape.
    keep-inside on penalizes the per-meter outside-the-boundary slice.
    multi-polygon boundaries sum their inside contributions.
    """

    @staticmethod
    def _setup():
        """build a square boundary at x in [-50, 50] and a horizontal nodes pair."""
        from app.services.trajectory.types import LocalBoundary

        boundary_poly = box(-50, -200, 50, 200)
        boundary = LocalBoundary(polygon=boundary_poly, name="test-fence")
        nodes = [
            (-100.0, 0.0, 350.0),  # outside
            (100.0, 0.0, 350.0),  # outside (other side)
        ]
        return nodes, [boundary]

    def test_keep_inside_off_preserves_baseline_weights(self):
        """keep-inside off produces the same weights as no boundaries at all."""
        nodes, boundaries = self._setup()
        baseline = _build_visibility_graph(nodes, [], [])
        actual = _build_visibility_graph(
            nodes, [], [], boundaries=boundaries, keep_inside_airport_boundary=False
        )
        for i in range(len(nodes)):
            for (j_b, w_b), (j_a, w_a) in zip(baseline[i], actual[i]):
                assert j_a == j_b
                assert w_a == pytest.approx(w_b)

    def test_keep_inside_on_penalizes_outside_length(self):
        """keep-inside on adds penalty for the per-meter portion outside the boundary."""
        from app.services.trajectory.types import (
            BOUNDARY_EGRESS_PENALTY_PER_METER as _PEN,
        )

        nodes, boundaries = self._setup()
        graph = _build_visibility_graph(
            nodes,
            [],
            [],
            boundaries=boundaries,
            keep_inside_airport_boundary=True,
        )

        edge = next(((j, w) for j, w in graph[0] if j == 1), None)
        assert edge is not None
        euclid = euclidean_distance(-100.0, 0.0, 100.0, 0.0)
        # segment crosses boundary at x=-50 and x=50; outside portion is 100m total
        outside_len = 100.0
        expected = euclid + outside_len * _PEN
        assert edge[1] == pytest.approx(expected)

    def test_no_boundaries_no_penalty(self):
        """missing boundaries means the keep-inside branch is skipped entirely."""
        nodes, _ = self._setup()
        baseline = _build_visibility_graph(nodes, [], [])
        actual = _build_visibility_graph(
            nodes,
            [],
            [],
            boundaries=None,
            keep_inside_airport_boundary=True,
        )
        for i in range(len(nodes)):
            for (j_b, w_b), (j_a, w_a) in zip(baseline[i], actual[i]):
                assert j_a == j_b
                assert w_a == pytest.approx(w_b)


class TestComputeTransitPathKeepInsideBoundary:
    """fast-path must fall through to A* when the direct line exits the boundary."""

    @staticmethod
    def _local_geoms_with_boundary():
        """clean local_geoms with one boundary polygon; no obstacles, no surfaces."""
        from shapely.geometry import Polygon

        from app.services.trajectory.types import LocalBoundary, LocalGeometries

        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        corners_local = [(-200, -200), (200, -200), (200, 200), (-200, 200)]
        boundary = LocalBoundary(polygon=Polygon(corners_local), name="fence")

        return LocalGeometries(
            proj=proj, obstacles=[], zones=[], boundary_zones=[boundary], surfaces=[]
        )

    def test_keep_inside_off_keeps_fast_path(self):
        """keep-inside off preserves the single-waypoint fast path on a clean direct line."""
        local_geoms = self._local_geoms_with_boundary()
        # endpoints inside the boundary, no obstacles - fast path returns 1 waypoint
        from_pt = Point3D(lon=14.2580, lat=50.099, alt=400.0)
        to_pt = Point3D(lon=14.2620, lat=50.099, alt=400.0)
        wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=5.0,
            keep_inside_airport_boundary=False,
        )
        assert len(wps) == 1
        assert wps[0].lon == pytest.approx(to_pt.lon)
        assert wps[0].lat == pytest.approx(to_pt.lat)

    @staticmethod
    def _polyline_inside_outside(wps, from_pt, proj, polygon):
        """sum (inside, outside) length over from_pt -> wp1 -> ... -> wp_last in local meters."""
        from shapely.geometry import LineString as _LS

        pts = [proj.to_local(from_pt.lon, from_pt.lat)]
        for wp in wps:
            pts.append(proj.to_local(wp.lon, wp.lat))
        inside_total = 0.0
        outside_total = 0.0
        for i in range(len(pts) - 1):
            seg = _LS([pts[i], pts[i + 1]])
            seg_len = seg.length
            inside = seg.intersection(polygon).length if seg.intersects(polygon) else 0.0
            inside_total += inside
            outside_total += max(seg_len - inside, 0.0)
        return inside_total, outside_total

    def test_keep_inside_detours_through_concave_boundary(self):
        """U-shaped boundary; the direct line cuts the notch; A* detours through the bottom."""
        from shapely.geometry import Polygon

        from app.services.trajectory.types import LocalBoundary, LocalGeometries

        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # U-shape opening upward - a rectangular notch is removed from the top center
        u_ring = [
            (-300, -150),
            (300, -150),
            (300, 150),
            (100, 150),
            (100, -50),
            (-100, -50),
            (-100, 150),
            (-300, 150),
        ]
        boundary = LocalBoundary(polygon=Polygon(u_ring), name="u-fence")
        local_geoms = LocalGeometries(
            proj=proj, obstacles=[], zones=[], boundary_zones=[boundary], surfaces=[]
        )

        # endpoints inside the left and right arms of the U at y=0; direct line cuts the notch
        from_lon, from_lat = proj.to_wgs84(-200.0, 0.0)
        to_lon, to_lat = proj.to_wgs84(200.0, 0.0)
        from_pt = Point3D(lon=from_lon, lat=from_lat, alt=400.0)
        to_pt = Point3D(lon=to_lon, lat=to_lat, alt=400.0)

        wps = compute_transit_path(
            from_pt,
            to_pt,
            local_geoms,
            speed=5.0,
            keep_inside_airport_boundary=True,
        )

        assert len(wps) > 1
        # direct line has ~200m outside the polygon (the notch); the detour must stay inside.
        _, outside = self._polyline_inside_outside(wps, from_pt, proj, boundary.polygon)
        assert outside < 5.0, f"keep-inside detour still spends {outside:.1f}m outside the fence"


class TestTrajectoryGenerationEnclosingBoundaryBaseline:
    """end-to-end: with the default keep-inside-airport-boundary toggle on, a
    boundary that fully encloses the inspection geometry adds zero outside-length
    to every transit edge, so the flight plan stays byte-identical to the
    no-boundary baseline. proves the visibility-graph branch is inert under the
    common geometry (operator + LHAs + takeoff/landing all inside the geofence)
    even with the toggle on - the soft penalty only kicks in when a transit
    actually has to leave the polygon.
    """

    @staticmethod
    def _setup_minimal_mission(client, icao):
        """build a minimal HORIZONTAL_RANGE mission. returns (mission_id, airport_id)."""
        from tests.data.trajectory import (
            DEFAULT_LANDING,
            DEFAULT_TAKEOFF,
            TRAJECTORY_AGL_PAYLOAD,
            TRAJECTORY_AIRPORT_PAYLOAD,
            TRAJECTORY_DRONE_PAYLOAD,
            TRAJECTORY_SURFACE_PAYLOAD,
            make_lha_payload,
        )

        airport = client.post(
            "/api/v1/airports", json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao}
        ).json()
        surface = client.post(
            f"/api/v1/airports/{airport['id']}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
        ).json()
        agl = client.post(
            f"/api/v1/airports/{airport['id']}/surfaces/{surface['id']}/agls",
            json=TRAJECTORY_AGL_PAYLOAD,
        ).json()
        for i in range(1, 5):
            client.post(
                f"/api/v1/airports/{airport['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
                json=make_lha_payload(i),
            )
        template = client.post(
            "/api/v1/inspection-templates",
            json={
                "name": f"Template {icao}",
                "methods": ["HORIZONTAL_RANGE"],
                "target_agl_ids": [agl["id"]],
                "default_config": {"measurement_density": 6},
            },
        ).json()
        drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()
        mission = client.post(
            "/api/v1/missions",
            json={
                "name": f"Mission {icao}",
                "airport_id": airport["id"],
                "drone_profile_id": drone["id"],
                "default_speed": 5.0,
                "takeoff_coordinate": DEFAULT_TAKEOFF,
                "landing_coordinate": DEFAULT_LANDING,
            },
        ).json()
        client.post(
            f"/api/v1/missions/{mission['id']}/inspections",
            json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
        )
        return mission["id"], airport["id"]

    @staticmethod
    def _snapshot(fp):
        """deterministic flight-plan snapshot, excluding non-output IDs."""
        from app.core.geometry import point_lonlatalt

        snap = []
        for w in sorted(fp.waypoints, key=lambda x: x.sequence_order):
            target = point_lonlatalt(w.camera_target) if w.camera_target else None
            snap.append(
                (
                    w.sequence_order,
                    w.waypoint_type,
                    point_lonlatalt(w.position),
                    w.heading,
                    w.speed,
                    w.camera_action,
                    w.gimbal_pitch,
                    w.hover_duration,
                    target,
                )
            )
        return snap

    def test_default_keep_inside_byte_identical_for_enclosing_boundary(self, client, db_engine):
        """end-to-end fixture mission: default keep-inside-airport-boundary=true must
        produce identical flight-plan output before and after attaching an AIRPORT_BOUNDARY
        zone that fully encloses the inspection geometry. the soft penalty fires per-edge,
        but every edge sits inside the boundary so the added cost is zero. asserts the full
        waypoint sequence (positions + headings + camera actions + gimbal pitch + hover
        durations + camera targets) is byte-identical, going beyond the visibility-graph
        weight comparison.
        """
        from sqlalchemy.orm import Session

        from app.services.trajectory.orchestrator import generate_trajectory

        mission_id, airport_id = self._setup_minimal_mission(client, "BLBI")

        # baseline: airport with no AIRPORT_BOUNDARY zone -> boundary branch never fires
        with Session(db_engine) as db:
            baseline_fp, _ = generate_trajectory(db, mission_id)
            baseline_snapshot = self._snapshot(baseline_fp)
            db.commit()

        # add an AIRPORT_BOUNDARY zone fully enclosing the inspection area; with default
        # keep-inside=true the planner reads it but every edge sits inside so the penalty
        # contribution is zero everywhere
        add = client.post(
            f"/api/v1/airports/{airport_id}/safety-zones",
            json={
                "name": "Test Boundary",
                "type": "AIRPORT_BOUNDARY",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [14.250, 50.090, 0],
                            [14.290, 50.090, 0],
                            [14.290, 50.110, 0],
                            [14.250, 50.110, 0],
                            [14.250, 50.090, 0],
                        ]
                    ],
                },
            },
        )
        assert add.status_code == 201, add.text

        # regenerate the same mission with the boundary now present
        with Session(db_engine) as db:
            actual_fp, _ = generate_trajectory(db, mission_id)
            actual_snapshot = self._snapshot(actual_fp)
            db.commit()

        assert actual_snapshot == baseline_snapshot


# _surface_edge_nodes - shared centerline ±half_w walk (issue #546 refactor)


class TestSurfaceEdgeNodes:
    """`_surface_edge_nodes` is the single walk shared by
    `_collect_graph_nodes_in_circle` (search-circle predicate) and
    `_surface_edge_nodes_in_region` (dilated-hull predicate); the half_w /
    num_points spacing must stay byte-identical across both call sites.
    """

    @staticmethod
    def _ns_runway(width=60.0, buffer_distance=0.0, length=400.0):
        """north-south LocalSurface centered on x=0 spanning y in [-200, 200]."""
        from shapely.geometry import LineString as _LineString

        from app.utils.local_projection import LocalSurface

        return LocalSurface(
            polygon=box(-width / 2, -200, width / 2, 200),
            centerline=_LineString([(0.0, -200.0), (0.0, 200.0)]),
            identifier="RW-NS",
            surface_type="runway",
            width=width,
            length=length,
            heading=0.0,
            buffer_distance=buffer_distance,
        )

    def test_permissive_predicate_emits_two_nodes_per_centerline_step(self):
        """count == 2 * num_points; nodes sit at x = ±half_w on a vertical centerline."""
        from app.services.trajectory.pathfinding import _surface_edge_nodes
        from app.services.trajectory.types import SURFACE_NODE_SPACING

        surface = self._ns_runway(width=60.0, buffer_distance=20.0, length=400.0)
        half_w = 30.0 + 20.0 + settings.vertex_buffer_m
        num_points = max(2, int(400.0 / SURFACE_NODE_SPACING) + 1)

        nodes = _surface_edge_nodes([surface], lambda x, y: True)

        assert len(nodes) == 2 * num_points
        assert sorted({round(x, 9) for x, _ in nodes}) == [
            round(-half_w, 9),
            round(half_w, 9),
        ]
        assert sorted({round(y, 6) for _, y in nodes}) == [-200.0, 0.0, 200.0]

    def test_circle_predicate_is_a_strict_subset_of_permissive(self):
        """a search-circle contains_fn drops nodes outside the radius."""
        from app.services.trajectory.pathfinding import _surface_edge_nodes

        surface = self._ns_runway(width=60.0, buffer_distance=0.0, length=400.0)
        all_nodes = set(_surface_edge_nodes([surface], lambda x, y: True))

        def in_circle(x, y):
            return euclidean_distance(0.0, 0.0, x, y) <= 60.0

        circle_nodes = _surface_edge_nodes([surface], in_circle)
        assert circle_nodes
        assert set(circle_nodes) < all_nodes
        for x, y in circle_nodes:
            assert euclidean_distance(0.0, 0.0, x, y) <= 60.0

    def test_degenerate_surfaces_are_skipped(self):
        """centerline with <2 coords or zero length contributes no nodes."""
        from shapely.geometry import LineString as _LineString

        from app.services.trajectory.pathfinding import _surface_edge_nodes
        from app.utils.local_projection import LocalSurface

        empty_cl = LocalSurface(
            polygon=box(-1, -1, 1, 1),
            centerline=_LineString(),
            identifier="EMPTY",
            surface_type="runway",
            width=10.0,
            length=0.0,
            heading=None,
        )
        zero_len = LocalSurface(
            polygon=box(-1, -1, 1, 1),
            centerline=_LineString([(5.0, 5.0), (5.0, 5.0)]),
            identifier="ZERO",
            surface_type="runway",
            width=10.0,
            length=0.0,
            heading=None,
        )
        assert _surface_edge_nodes([empty_cl, zero_len], lambda x, y: True) == []

    def test_hypot_matches_sqrt_reference_within_ulp(self):
        """cl_len unified sqrt->hypot; node coords stay equal within 1e-9.

        regression net for the single deliberate arithmetic change in the
        issue #546 refactor: the per-pass site formerly used
        math.sqrt(dx*dx+dy*dy), the inter-pass site math.hypot(dx, dy). they
        differ by at most a ULP, far below SURFACE_NODE_SPACING.
        """
        import math

        from shapely.geometry import LineString as _LineString

        from app.services.trajectory.pathfinding import _surface_edge_nodes
        from app.services.trajectory.types import SURFACE_NODE_SPACING
        from app.utils.local_projection import LocalSurface

        # off-axis centerline so dx, dy are both non-trivial
        surface = LocalSurface(
            polygon=box(-50, -50, 350, 350),
            centerline=_LineString([(13.0, 7.0), (317.0, 211.0)]),
            identifier="RW-DIAG",
            surface_type="runway",
            width=45.0,
            length=500.0,
            heading=None,
            buffer_distance=12.0,
        )

        actual = _surface_edge_nodes([surface], lambda x, y: True)

        # reference: identical walk but cl_len via the pre-refactor sqrt form
        cl = list(surface.centerline.coords)
        start, end = cl[0], cl[-1]
        half_w = surface.width / 2.0 + surface.buffer_distance + settings.vertex_buffer_m
        dx, dy = end[0] - start[0], end[1] - start[1]
        cl_len = math.sqrt(dx * dx + dy * dy)
        ux, uy = dx / cl_len, dy / cl_len
        num_points = max(2, int(surface.length / SURFACE_NODE_SPACING) + 1)
        expected: list[tuple[float, float]] = []
        for k in range(num_points):
            frac = k / (num_points - 1)
            x = start[0] + (end[0] - start[0]) * frac
            y = start[1] + (end[1] - start[1]) * frac
            expected.append((x + -uy * half_w, y + ux * half_w))
            expected.append((x + uy * half_w, y + -ux * half_w))

        assert len(actual) == len(expected) == 2 * num_points
        for (ax, ay), (ex, ey) in zip(actual, expected):
            assert abs(ax - ex) < 1e-9
            assert abs(ay - ey) < 1e-9


# _compute_one_transit - module-level lifted helper (issue #546 refactor)


class TestComputeOneTransitLifted:
    """`_compute_one_transit` is module-level and takes an explicit
    `_TransitContext`; per-worker cache/dilation stays function-local so calls
    are independent and order-invariant.
    """

    @staticmethod
    def _ctx(obstacles, surfaces=None, *, require_perp=True):
        """build a _TransitContext over 5 pass endpoints along y=-50.

        mirrors the proven `TestComputeInterPassTransitsParallelEquivalence`
        geometry: transit 0 is a clear straight line (fast path), transit 1 is
        routed through the dilated visibility graph when the block + far-delta
        obstacles are supplied.
        """
        from shapely.geometry import MultiPoint

        from app.services.trajectory.pathfinding import _TransitContext
        from app.services.trajectory.types import TRANSIT_AGL, LocalGeometries
        from app.utils.local_projection import LocalProjection

        proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)

        def to_pt(x, y, alt=100.0):
            lon, lat = proj.to_wgs84(x, y)
            return Point3D(lon=lon, lat=lat, alt=alt)

        endpoints = [
            (to_pt(0.0, -50.0), to_pt(100.0, -50.0)),
            (to_pt(200.0, -50.0), to_pt(300.0, -50.0)),
            (to_pt(400.0, -50.0), to_pt(500.0, -50.0)),
            (to_pt(600.0, -50.0), to_pt(700.0, -50.0)),
            (to_pt(800.0, -50.0), to_pt(900.0, -50.0)),
        ]
        geoms = LocalGeometries(
            proj=proj,
            obstacles=obstacles,
            zones=[],
            boundary_zones=[],
            surfaces=surfaces or [],
        )
        all_local: list[tuple[float, float]] = []
        for first, last in endpoints:
            all_local.append(proj.to_local(first.lon, first.lat))
            all_local.append(proj.to_local(last.lon, last.lat))
        hull = MultiPoint(all_local).convex_hull
        return _TransitContext(
            pass_endpoints=endpoints,
            local_geoms=geoms,
            proj=proj,
            hull=hull,
            speed=5.0,
            elevation_provider=None,
            transit_agl=TRANSIT_AGL,
            buffer_distance_override=None,
            require_perpendicular_runway_crossing=require_perp,
            keep_inside_airport_boundary=False,
        )

    @staticmethod
    def _routed_obstacles():
        """block (forces transit 1 onto A*) + far-delta (supplies dilation Δ)."""
        return [
            LocalObstacle(
                polygon=box(340.0, -40.0, 360.0, -30.0),
                name="block",
                height=20.0,
                base_alt=0.0,
                buffer_distance=10.0,
            ),
            LocalObstacle(
                polygon=box(440.0, -300.0, 460.0, -290.0),
                name="far-delta",
                height=20.0,
                base_alt=0.0,
                buffer_distance=20.0,
            ),
        ]

    @staticmethod
    def _sig(wps):
        """waypoint-by-waypoint identity view."""
        return tuple((wp.lon, wp.lat, wp.alt, wp.heading, wp.waypoint_type) for wp in wps)

    def test_fast_path_returns_single_transit_and_no_warnings(self):
        """clear straight line -> one TRANSIT waypoint, empty warnings."""
        from app.services.trajectory.pathfinding import _compute_one_transit

        wps, warnings = _compute_one_transit(self._ctx([]), 0)

        assert warnings == []
        assert len(wps) == 1
        assert wps[0].waypoint_type == WaypointType.TRANSIT

    def test_context_is_immutable(self):
        """_TransitContext is a NamedTuple - workers cannot mutate shared state."""
        ctx = self._ctx([])
        with pytest.raises(AttributeError):
            ctx.cur_dilation = 99.0

    def test_slow_path_returns_waypoints_and_str_warnings(self):
        """a blocked straight line routes through the dilated visibility graph."""
        from app.services.trajectory.pathfinding import _compute_one_transit

        wps, warnings = _compute_one_transit(self._ctx(self._routed_obstacles()), 1)

        assert isinstance(wps, list) and len(wps) >= 1
        assert all(w.waypoint_type == WaypointType.TRANSIT for w in wps)
        assert all(isinstance(w, str) for w in warnings)

    def test_no_path_raises_trajectory_error(self, monkeypatch):
        """astar failure with no enclosable obstacles -> TrajectoryGenerationError."""
        from shapely.geometry import LineString as _LineString

        import app.services.trajectory.pathfinding as pf
        from app.utils.local_projection import LocalSurface

        # surface across transit 0 forces the fast path to bail; with no
        # obstacles the dilation loop has nothing to expand toward
        surface = LocalSurface(
            polygon=box(120.0, -200.0, 160.0, 200.0),
            centerline=_LineString([(140.0, -200.0), (140.0, 200.0)]),
            identifier="RW-CROSS",
            surface_type="runway",
            width=40.0,
            length=400.0,
            heading=0.0,
        )
        monkeypatch.setattr(pf, "astar", lambda *a, **k: None)

        with pytest.raises(TrajectoryGenerationError):
            pf._compute_one_transit(self._ctx([], [surface]), 0)

    def test_calls_are_order_invariant(self):
        """transit i is independent of whether transit j ran first (no cache leak).

        transit 1 dilates its local hull; transit 0 is the clear fast path. if
        `cur_dilation` / `local_cache` leaked across calls, running 1 before 0
        would perturb 0's result.
        """
        from app.services.trajectory.pathfinding import _compute_one_transit

        ctx = self._ctx(self._routed_obstacles())

        forward = [_compute_one_transit(ctx, i) for i in (0, 1)]
        reverse = {i: _compute_one_transit(ctx, i) for i in (1, 0)}

        assert self._sig(forward[0][0]) == self._sig(reverse[0][0])
        assert self._sig(forward[1][0]) == self._sig(reverse[1][0])
        assert forward[0][1] == reverse[0][1]
        assert forward[1][1] == reverse[1][1]
