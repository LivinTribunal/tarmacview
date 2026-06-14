"""tests for the trajectory safety validator (T3): altitude, speed, geofence, obstacle checks."""

import math

from app.services.trajectory.types import WaypointData

# altitude constraint


def test_altitude_above_max():
    """waypoint above max altitude triggers hard violation."""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=600.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "ALTITUDE",
            "min_altitude": 50.0,
            "max_altitude": 500.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None
    assert not result.is_warning
    assert "above max" in result.message


def test_altitude_below_min():
    """waypoint below min altitude triggers violation."""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=30.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "ALTITUDE",
            "min_altitude": 50.0,
            "max_altitude": 500.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None
    assert "below min" in result.message


# speed constraint


def test_speed_exceeds_max():
    """speed above max triggers soft warning."""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=300.0, speed=30.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "SPEED",
            "max_horizontal_speed": 25.0,
            "is_hard_constraint": False,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None
    assert result.is_warning


# spatial constraint types now run in Shapely - no db session required


def test_geofence_constraint_outside_polygon_violates():
    """geofence constraint flags waypoints outside the WKT polygon as hard violations."""
    from app.services.trajectory.safety_validator import _check_constraint

    # tiny polygon around (0, 0) - waypoint is far outside
    boundary_wkt = "POLYGON Z ((0 0 0, 0.001 0 0, 0.001 0.001 0, 0 0.001 0, 0 0 0))"
    wp = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "GEOFENCE",
            "boundary": boundary_wkt,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])
    assert result is not None
    assert result.is_warning is False
    assert "outside geofence" in result.message
    assert result.violation_kind == "constraint"


def test_runway_buffer_constraint_no_runways_no_violation():
    """runway buffer constraint with no surfaces is a no-op (no violation)."""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "RUNWAY_BUFFER",
            "lateral_buffer": 100.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    assert _check_constraint(None, wp, constraint, []) is None


# drone constraints


def test_drone_max_altitude():
    """waypoint exceeding drone max altitude returns violation."""
    from app.services.trajectory.safety_validator import check_drone_constraints

    wp = WaypointData(lon=14.26, lat=50.10, alt=600.0)
    drone = type("D", (), {"max_altitude": 500.0, "max_speed": 23.0})()

    assert check_drone_constraints(wp, drone) is not None


def test_drone_within_limits():
    """waypoint within drone limits returns no violation."""
    from app.services.trajectory.safety_validator import check_drone_constraints

    wp = WaypointData(lon=14.26, lat=50.10, alt=200.0, speed=10.0)
    drone = type("D", (), {"max_altitude": 500.0, "max_speed": 23.0})()

    assert check_drone_constraints(wp, drone) is None


# battery


def test_battery_exceeded():
    """flight duration exceeding battery endurance returns violation."""
    from app.services.trajectory.safety_validator import check_battery

    drone = type("D", (), {"endurance_minutes": 55.0})()

    assert check_battery(3600.0, drone, 0.15) is not None


def test_battery_ok():
    """flight within battery endurance returns no violation."""
    from app.services.trajectory.safety_validator import check_battery

    drone = type("D", (), {"endurance_minutes": 55.0})()

    assert check_battery(1000.0, drone, 0.15) is None


def test_battery_unknown_endurance_emits_suggestion():
    """drone without endurance_minutes returns a soft suggestion instead of None."""
    from app.services.trajectory.safety_validator import check_battery

    drone = type("D", (), {"endurance_minutes": None})()

    result = check_battery(3000.0, drone, 0.15)

    assert result is not None
    assert result.is_warning is True
    assert result.violation_kind == "battery"
    assert "endurance unknown" in result.message


def test_battery_no_drone_emits_suggestion():
    """missing drone profile also surfaces the skipped-check suggestion."""
    from app.services.trajectory.safety_validator import check_battery

    result = check_battery(3000.0, None, 0.15)

    assert result is not None
    assert result.is_warning is True
    assert result.violation_kind == "battery"
    assert "endurance unknown" in result.message


def test_battery_default_reserve_margin_is_shared_constant():
    """check_battery default reserve_margin is the shared constant, value 0.15."""
    import inspect

    from app.services.trajectory.safety_validator import check_battery
    from app.services.trajectory.types import DEFAULT_RESERVE_MARGIN

    default = inspect.signature(check_battery).parameters["reserve_margin"].default

    assert default is DEFAULT_RESERVE_MARGIN
    assert default == 0.15


def test_battery_default_arg_matches_explicit_value():
    """omitting reserve_margin behaves identically to passing 0.15 explicitly."""
    from app.services.trajectory.safety_validator import check_battery

    drone = type("D", (), {"endurance_minutes": 55.0})()

    over_default = check_battery(3600.0, drone)
    over_explicit = check_battery(3600.0, drone, 0.15)
    assert over_default is not None and over_explicit is not None
    assert over_default.message == over_explicit.message

    within_default = check_battery(1000.0, drone)
    within_explicit = check_battery(1000.0, drone, 0.15)
    assert within_default is None and within_explicit is None


# transit AGL hard / measurement AGL soft split


class _FlatElevation:
    """stub elevation provider returning a constant ground height."""

    def __init__(self, ground: float):
        """remember ground level."""
        self.ground = ground

    def get_elevations_batch(self, points):
        """return ground elevation for every requested point."""
        return [self.ground] * len(points)


def test_transit_below_min_agl_is_hard_violation():
    """transit waypoint below MIN_TRANSIT_ALTITUDE_AGL_M returns a hard violation."""
    from app.core.enums import WaypointType
    from app.services.trajectory.safety_validator import _batch_check_minimum_agl

    provider = _FlatElevation(300.0)
    waypoints = [
        WaypointData(
            lon=14.0,
            lat=50.0,
            alt=302.0,
            waypoint_type=WaypointType.TRANSIT,
        ),
    ]

    violations = _batch_check_minimum_agl(waypoints, provider)

    assert len(violations) == 1
    assert violations[0].is_warning is False
    assert violations[0].violation_kind == "altitude"
    assert "elevation provider" in violations[0].message


def test_measurement_below_min_agl_stays_soft():
    """measurement waypoint dipping below the threshold remains a soft warning."""
    from app.core.enums import WaypointType
    from app.services.trajectory.safety_validator import _batch_check_minimum_agl

    provider = _FlatElevation(300.0)
    waypoints = [
        WaypointData(
            lon=14.0,
            lat=50.0,
            alt=302.0,
            waypoint_type=WaypointType.MEASUREMENT,
        ),
    ]

    violations = _batch_check_minimum_agl(waypoints, provider)

    assert len(violations) == 1
    assert violations[0].is_warning is True
    assert violations[0].violation_kind == "altitude"


def test_hover_below_min_agl_stays_soft():
    """hover waypoint dipping below the threshold remains a soft warning."""
    from app.core.enums import WaypointType
    from app.services.trajectory.safety_validator import _batch_check_minimum_agl

    provider = _FlatElevation(300.0)
    waypoints = [
        WaypointData(
            lon=14.0,
            lat=50.0,
            alt=302.0,
            waypoint_type=WaypointType.HOVER,
        ),
    ]

    violations = _batch_check_minimum_agl(waypoints, provider)

    assert len(violations) == 1
    assert violations[0].is_warning is True


def test_transit_above_min_agl_passes():
    """transit waypoint above the threshold produces no violation."""
    from app.core.enums import WaypointType
    from app.services.trajectory.safety_validator import _batch_check_minimum_agl

    provider = _FlatElevation(300.0)
    waypoints = [
        WaypointData(
            lon=14.0,
            lat=50.0,
            alt=340.0,
            waypoint_type=WaypointType.TRANSIT,
        ),
    ]

    assert _batch_check_minimum_agl(waypoints, provider) == []


# safety zone + obstacle


def test_safety_zone_no_geometry():
    """zone with no geometry is skipped."""
    from app.services.trajectory.safety_validator import check_safety_zone

    wp = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    zone = type(
        "Z",
        (),
        {
            "type": "RESTRICTED",
            "name": "Test",
            "altitude_floor": 0.0,
            "altitude_ceiling": 500.0,
            "geometry": None,
        },
    )()

    assert check_safety_zone(None, wp, zone) is None


def test_obstacle_check_local_no_containment():
    """obstacle check returns False when waypoint is outside."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Test",
        height=40.0,
        base_alt=0.0,
        buffer_distance=5.0,
    )
    # point outside the obstacle
    assert check_obstacle(20.0, 20.0, 5.0, obs) is False


def test_obstacle_check_local_inside_below_top():
    """obstacle check returns True when inside and below obstacle top."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Test",
        height=40.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    # point inside the obstacle, alt below top
    assert check_obstacle(5.0, 5.0, 30.0, obs) is True


def test_obstacle_check_local_inside_above_top():
    """obstacle check returns False when inside but above obstacle top."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Test",
        height=40.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    # point inside but alt above top
    assert check_obstacle(5.0, 5.0, 50.0, obs) is False


# zero-value constraint checks - regression tests for truthiness bug


def test_altitude_constraint_zero_min():
    """constraint with min_altitude=0 must still fire when waypoint is below 0"""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=-5.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "ALTITUDE",
            "min_altitude": 0.0,
            "max_altitude": 500.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None
    assert "below min" in result.message


def test_altitude_constraint_zero_max():
    """constraint with max_altitude=0 must still fire when waypoint is above 0"""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=5.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "ALTITUDE",
            "min_altitude": None,
            "max_altitude": 0.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None
    assert "above max" in result.message


def test_speed_constraint_zero_max():
    """constraint with max_horizontal_speed=0 must fire when waypoint has any speed"""
    from app.services.trajectory.safety_validator import _check_constraint

    wp = WaypointData(lon=14.26, lat=50.10, alt=300.0, speed=1.0)
    constraint = type(
        "C",
        (),
        {
            "constraint_type": "SPEED",
            "max_horizontal_speed": 0.0,
            "is_hard_constraint": True,
            "id": "test-id",
        },
    )()

    result = _check_constraint(None, wp, constraint, [])

    assert result is not None


def test_drone_zero_max_altitude():
    """drone with max_altitude=0 must trigger violation"""
    from app.services.trajectory.safety_validator import check_drone_constraints

    wp = WaypointData(lon=14.26, lat=50.10, alt=5.0)
    drone = type("D", (), {"max_altitude": 0.0, "max_speed": 23.0})()

    assert check_drone_constraints(wp, drone) is not None


def test_drone_zero_max_speed():
    """drone with max_speed=0 must trigger violation"""
    from app.services.trajectory.safety_validator import check_drone_constraints

    wp = WaypointData(lon=14.26, lat=50.10, alt=100.0, speed=1.0)
    drone = type("D", (), {"max_altitude": 500.0, "max_speed": 0.0})()

    assert check_drone_constraints(wp, drone) is not None


# Shapely-based segment intersection tests


def test_segments_intersect_obstacle_crossing():
    """line crossing obstacle polygon returns True."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import segments_intersect_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(4, 4, 6, 6),
        name="Test",
        height=10.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    assert segments_intersect_obstacle(0, 5, 10, 5, obs) is True


def test_segments_intersect_obstacle_no_crossing():
    """line not crossing obstacle polygon returns False."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import segments_intersect_obstacle
    from app.services.trajectory.types import LocalObstacle

    # box at (4,40,6,42); even with the resolver's DEFAULT_OBSTACLE_RADIUS
    # fallback the buffered footprint sits well clear of the line at y=0.
    obs = LocalObstacle(
        polygon=box(4, 40, 6, 42),
        name="Test",
        height=10.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    assert segments_intersect_obstacle(0, 0, 10, 0, obs) is False


def test_segments_intersect_zone_crossing():
    """line crossing zone polygon returns True."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import segments_intersect_zone

    zone_poly = box(4, 4, 6, 6)
    assert segments_intersect_zone(0, 5, 10, 5, zone_poly) is True


def test_segment_runway_crossing_length_positive():
    """line crossing runway polygon returns positive length."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import segment_runway_crossing_length

    runway_poly = box(-100, -25, 100, 25)
    length = segment_runway_crossing_length(0, -50, 0, 50, runway_poly)
    assert length > 0
    assert abs(length - 50.0) < 1.0


def test_segment_runway_crossing_length_no_crossing():
    """line not crossing runway polygon returns 0."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import segment_runway_crossing_length

    runway_poly = box(-100, -25, 100, 25)
    length = segment_runway_crossing_length(0, 30, 10, 30, runway_poly)
    assert length == 0.0


# check_speed_framerate fallback branch


def test_speed_framerate_fallback_no_optimal():
    """fallback fires when optimal_speed is None and speed exceeds max_speed margin"""
    from app.services.trajectory.config_resolver import check_speed_framerate

    drone = type("D", (), {"camera_frame_rate": 30, "max_speed": 10.0})()
    warning = check_speed_framerate(speed=9.5, drone=drone, optimal_speed=None)

    assert warning is not None
    assert "too high" in warning


def test_speed_framerate_fallback_skipped_with_optimal():
    """fallback does not fire when optimal_speed is computed"""
    from app.services.trajectory.config_resolver import check_speed_framerate

    drone = type("D", (), {"camera_frame_rate": 30, "max_speed": 10.0})()
    warning = check_speed_framerate(speed=4.0, drone=drone, optimal_speed=5.0)

    assert warning is None


# obstacle altitude band tests


def test_obstacle_below_base_alt_no_violation():
    """waypoint below obstacle base_alt should not trigger violation."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Elevated",
        height=20.0,
        base_alt=10.0,
        buffer_distance=0.0,
    )
    # waypoint inside 2d footprint but below base_alt
    assert check_obstacle(5.0, 5.0, 5.0, obs) is False


def test_obstacle_ground_level_inside_violation():
    """waypoint at ground level inside a ground-level obstacle triggers violation."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Ground",
        height=20.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    # waypoint at alt=0 inside ground-level obstacle
    assert check_obstacle(5.0, 5.0, 0.0, obs) is True


def test_obstacle_high_side_clip_flagged_on_slope():
    """sloped obstacle with high-corner base catches the clip the old min(z) band missed.

    boundary corners span 300-310 m (10 m slope), height 30 m, drone at 335 m
    inside footprint. old engine modeled the band as [300, 330] and cleared 335.
    new high-corner stance models [310, 340] and flags the clip as a hard hit.
    """
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    high_corner_z = 310.0
    obs = LocalObstacle(
        polygon=box(0, 0, 20, 20),
        name="Sloped",
        height=30.0,
        base_alt=high_corner_z,
        buffer_distance=0.0,
    )
    # waypoint above old top (330) but inside new band [310, 340]
    assert check_obstacle(10.0, 10.0, 335.0, obs) is True


def test_obstacle_above_max_corner_band_top_no_violation():
    """waypoint above the high-corner top is correctly cleared."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 20, 20),
        name="Sloped",
        height=30.0,
        base_alt=310.0,
        buffer_distance=0.0,
    )
    # waypoint above top (340) is genuinely above the obstacle - no violation
    assert check_obstacle(10.0, 10.0, 345.0, obs) is False


def test_obstacle_flat_terrain_unchanged():
    """flat-terrain obstacle (base_alt=0) still produces the same band as before."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import check_obstacle
    from app.services.trajectory.types import LocalObstacle

    obs = LocalObstacle(
        polygon=box(0, 0, 10, 10),
        name="Flat",
        height=10.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    # inside footprint at alt=5 - within [0, 10] band
    assert check_obstacle(5.0, 5.0, 5.0, obs) is True
    # above top - cleared
    assert check_obstacle(5.0, 5.0, 15.0, obs) is False


# unified buffer resolver - priority chain


def test_resolve_obstacle_buffer_priority_chain():
    """override > obs.buffer_distance > DEFAULT_OBSTACLE_RADIUS, in that order."""
    from shapely.geometry import box

    from app.services.trajectory.safety_validator import resolve_obstacle_buffer
    from app.services.trajectory.types import DEFAULT_OBSTACLE_RADIUS, LocalObstacle

    obs_with_buf = LocalObstacle(
        polygon=box(0, 0, 1, 1),
        name="with-buf",
        height=10.0,
        base_alt=0.0,
        buffer_distance=4.0,
    )
    obs_zero_buf = LocalObstacle(
        polygon=box(0, 0, 1, 1),
        name="zero-buf",
        height=10.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )

    # 1) positive override wins regardless of obs.buffer_distance
    assert resolve_obstacle_buffer(obs_with_buf, 7.0) == 7.0
    assert resolve_obstacle_buffer(obs_zero_buf, 7.0) == 7.0

    # 2) zero/None override falls through to obs.buffer_distance when > 0
    assert resolve_obstacle_buffer(obs_with_buf, 0.0) == 4.0
    assert resolve_obstacle_buffer(obs_with_buf, None) == 4.0

    # 3) both unset (or zero) falls through to DEFAULT_OBSTACLE_RADIUS
    assert resolve_obstacle_buffer(obs_zero_buf, 0.0) == DEFAULT_OBSTACLE_RADIUS
    assert resolve_obstacle_buffer(obs_zero_buf, None) == DEFAULT_OBSTACLE_RADIUS


# papi angle-band invariant after terrain delta


class _CannedElevationProvider:
    """returns a pre-canned elevation per (lat, lon) lookup; flat fallback otherwise."""

    def __init__(self, lookup: dict[tuple[float, float], float], default: float = 0.0):
        self._lookup = lookup
        self._default = default

    def get_elevations_batch(self, points):
        """batch query - call order is wp1..wpN, then center per _apply_terrain_delta."""
        return [self._lookup.get(p, self._default) for p in points]

    def get_elevation(self, lat, lon):
        """single-point query for terrain-aware checks."""
        return self._lookup.get((lat, lon), self._default)


def _make_arc_waypoints(
    center,
    radius_m: float,
    glide_slope_deg: float,
    half_sweep_deg: float = 7.5,
    density: int = 5,
):
    """build a synthetic horizontal-range arc pass at a fixed glide slope."""
    import math

    from app.core.enums import CameraAction, WaypointType
    from app.utils.geo import elevation_angle, point_at_distance

    arc_alt = center.alt + radius_m * math.tan(math.radians(glide_slope_deg))
    approach = 180.0  # arbitrary - center sits south of the approach
    waypoints = []
    for i in range(density):
        natural = -half_sweep_deg + (2 * half_sweep_deg / (density - 1)) * i
        lon, lat = point_at_distance(center.lon, center.lat, approach + natural, radius_m)
        pitch = elevation_angle(lon, lat, arc_alt, center.lon, center.lat, center.alt)
        waypoints.append(
            WaypointData(
                lon=lon,
                lat=lat,
                alt=arc_alt,
                heading=0.0,
                speed=5.0,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=CameraAction.PHOTO_CAPTURE,
                camera_target=center,
                gimbal_pitch=pitch,
            )
        )
    return waypoints


def _make_vertical_waypoints(center, distance_m: float, elevations_deg: list[float]):
    """build a synthetic vertical-profile climb at fixed angles relative to LHA."""
    import math

    from app.core.enums import CameraAction, WaypointType
    from app.utils.geo import elevation_angle, point_at_distance

    approach = 180.0
    lon, lat = point_at_distance(center.lon, center.lat, approach, distance_m)
    waypoints = []
    for elev in elevations_deg:
        alt = center.alt + distance_m * math.tan(math.radians(elev))
        pitch = elevation_angle(lon, lat, alt, center.lon, center.lat, center.alt)
        waypoints.append(
            WaypointData(
                lon=lon,
                lat=lat,
                alt=alt,
                heading=0.0,
                speed=5.0,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=CameraAction.PHOTO_CAPTURE,
                camera_target=center,
                gimbal_pitch=pitch,
            )
        )
    return waypoints


class _PapiCannedElevationProvider:
    """returns a pre-canned elevation per (lat, lon) lookup; flat fallback otherwise.

    new helper queries waypoint terrains only - no center query - so this drops
    the trailing-center entry from the per-call expectation.
    """

    def __init__(self, lookup: dict[tuple[float, float], float], default: float = 0.0):
        self._lookup = lookup
        self._default = default

    def get_elevations_batch(self, points):
        """batch query - call order is wp1..wpN per _apply_papi_glide_slope_terrain."""
        return [self._lookup.get(p, self._default) for p in points]

    def get_elevation(self, lat, lon):
        """single-point query for terrain-aware checks."""
        return self._lookup.get((lat, lon), self._default)


def test_papi_angle_band_flat_terrain_no_warning():
    """flat terrain leaves arc altitudes unshifted, so no warnings fire."""
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.safety_validator import validate_papi_angle_band
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5)
    provider = _PapiCannedElevationProvider(lookup={}, default=100.0)

    _apply_papi_glide_slope_terrain(waypoints, center, fixed_angle=3.5, elevation_provider=provider)
    violations = validate_papi_angle_band(waypoints, center, setting_angle_used=3.0)

    assert violations == []


def test_papi_angle_band_terrain_dip_at_one_waypoint_no_warning_after_recompute():
    """5 m terrain dip no longer drops a measurement below the all-white-zone edge.

    pre-fix `_apply_terrain_delta` would have shifted the bumped wp down 5 m and
    tripped the soft warning; the recompute rebuilds altitude from setting_angle
    so the angle survives terrain undulation.
    """
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.safety_validator import validate_papi_angle_band
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5, density=5)
    pre_alts = [wp.alt for wp in waypoints]

    bumped_idx = 2
    bumped_key = (waypoints[bumped_idx].lat, waypoints[bumped_idx].lon)
    provider = _PapiCannedElevationProvider(lookup={bumped_key: 95.0}, default=100.0)

    _apply_papi_glide_slope_terrain(waypoints, center, fixed_angle=3.5, elevation_provider=provider)
    violations = validate_papi_angle_band(waypoints, center, setting_angle_used=3.0)

    # angle preserved -> no warning regardless of where the bump landed
    assert violations == []
    # geometric altitude is unchanged (within haversine vs chord precision) because
    # the design arc was already at the angle-preserving altitude; the dip falls
    # below the AGL floor only if local terrain forces an upward clamp, which
    # doesn't happen at -5 m here.
    for wp, pre in zip(waypoints, pre_alts):
        assert abs(wp.alt - pre) < 1e-3


def test_papi_angle_band_sub_tolerance_no_warning():
    """small terrain dip leaves the drone in the white zone after recompute."""
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.safety_validator import validate_papi_angle_band
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5, density=5)

    bumped_idx = 1
    bumped_key = (waypoints[bumped_idx].lat, waypoints[bumped_idx].lon)
    provider = _PapiCannedElevationProvider(lookup={bumped_key: 99.8}, default=100.0)

    _apply_papi_glide_slope_terrain(waypoints, center, fixed_angle=3.5, elevation_provider=provider)
    violations = validate_papi_angle_band(waypoints, center, setting_angle_used=3.0)

    assert violations == []


def test_papi_glide_slope_vertical_profile_bookends_preserved():
    """vertical profile bookends keep their commanded climb angle through terrain delta."""
    from app.core.enums import WaypointType
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.safety_validator import validate_papi_angle_band
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    distance = 400.0
    # commanded angles span all-white-zone edge (3.5) up to the climb top (7.0)
    waypoints = _make_vertical_waypoints(center, distance, [3.5, 3.6, 6.0, 7.0])
    pre_alts = [wp.alt for wp in waypoints]

    class _IndexedProvider:
        """returns a pre-canned elevation per call-order index."""

        def __init__(self, elevations):
            self._elevations = elevations

        def get_elevations_batch(self, points):
            return list(self._elevations)

        def get_elevation(self, lat, lon):
            return 100.0

    # 5 m dip on the bottom bookend (idx 0); other waypoints share flat terrain
    provider = _IndexedProvider([95.0, 95.0, 100.0, 100.0])

    # vertical profile - per-wp angle recovery, no fixed_angle
    _apply_papi_glide_slope_terrain(
        waypoints, center, fixed_angle=None, elevation_provider=provider
    )
    raw_violations = validate_papi_angle_band(waypoints, center, setting_angle_used=3.0)

    mh_indices = [
        i
        for i, wp in enumerate(waypoints)
        if wp.waypoint_type in (WaypointType.MEASUREMENT, WaypointType.HOVER)
    ]
    bookend_idxs = {mh_indices[0], mh_indices[-1]}
    filtered = [v for v in raw_violations if v.waypoint_index in bookend_idxs]

    # angle preserved at every bookend -> no warning under the orchestrator filter
    assert filtered == []
    # altitudes unchanged because terrain dip doesn't touch the AGL floor
    for wp, pre in zip(waypoints, pre_alts):
        assert abs(wp.alt - pre) < 1e-6


def test_papi_glide_slope_terrain_clamps_to_min_agl():
    """terrain so high that the geometric altitude falls below MIN_TRANSIT_ALTITUDE_AGL_M
    forces an upward clamp; the drone is no longer angle-preserved at that wp but stays safe.
    """
    from app.core.constants import MIN_TRANSIT_ALTITUDE_AGL_M
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5, density=3)
    bumped_idx = 1
    bumped_key = (waypoints[bumped_idx].lat, waypoints[bumped_idx].lon)
    # the geometric arc altitude sits ~21 m above center.alt -> 321 m. terrain at
    # 320 m forces the clamp to terrain + min_agl = 325 m, lifting the wp up.
    provider = _PapiCannedElevationProvider(lookup={bumped_key: 320.0}, default=100.0)

    _apply_papi_glide_slope_terrain(waypoints, center, fixed_angle=3.5, elevation_provider=provider)

    bumped_wp = waypoints[bumped_idx]
    assert bumped_wp.alt >= 320.0 + MIN_TRANSIT_ALTITUDE_AGL_M - 1e-6
    # neighbouring wps stay at the geometric altitude (flat terrain at default)
    for i, wp in enumerate(waypoints):
        if i == bumped_idx:
            continue
        assert abs(wp.alt - (center.alt + 350.0 * math.tan(math.radians(3.5)))) < 0.5


def test_papi_glide_slope_terrain_flat_noop():
    """flat terrain leaves altitudes within great-circle precision of the design path."""
    from app.services.trajectory.helpers import _apply_papi_glide_slope_terrain
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5, density=3)
    pre_alts = [wp.alt for wp in waypoints]
    provider = _PapiCannedElevationProvider(lookup={}, default=50.0)

    _apply_papi_glide_slope_terrain(waypoints, center, fixed_angle=3.5, elevation_provider=provider)

    # arc waypoints use straight-line radius; recompute uses haversine distance,
    # so altitudes match only within sub-mm precision (cosine-ish error vs a chord).
    for wp, pre in zip(waypoints, pre_alts):
        assert abs(wp.alt - pre) < 1e-3


def test_apply_terrain_delta_flat_regression():
    """flat terrain leaves altitudes unchanged for the legacy AGL-preserving helper."""
    from app.services.trajectory.helpers import _apply_terrain_delta
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_arc_waypoints(center, radius_m=350.0, glide_slope_deg=3.5, density=3)
    pre_alts = [wp.alt for wp in waypoints]
    pre_pitches = [wp.gimbal_pitch for wp in waypoints]
    provider = _CannedElevationProvider(lookup={}, default=50.0)

    _apply_terrain_delta(waypoints, center, provider)

    assert [wp.alt for wp in waypoints] == pre_alts
    for wp, pre in zip(waypoints, pre_pitches):
        assert wp.gimbal_pitch == pre


# vertical profile angle band tests


def test_vertical_profile_angle_band_clean_pass():
    """a healthy VP run returns no warnings - bookends match resolved angles."""
    from app.services.trajectory.safety_validator import (
        validate_vertical_profile_angle_band,
    )
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    # climb spans 1.9 -> 6.5 deg
    waypoints = _make_vertical_waypoints(center, 400.0, [1.9, 3.0, 4.5, 6.5])

    violations = validate_vertical_profile_angle_band(
        waypoints,
        center,
        setting_angles=[3.0, 3.5],
        angle_start_resolved=1.9,
        angle_end_resolved=6.5,
        angle_source="CUSTOM",
    )

    assert violations == []


def test_vertical_profile_angle_band_drifted_bookend_warns():
    """bookend that drifts beyond HOVER_ANGLE_TOLERANCE produces a warning."""
    from app.services.trajectory.safety_validator import (
        validate_vertical_profile_angle_band,
    )
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    waypoints = _make_vertical_waypoints(center, 400.0, [3.0, 4.5, 6.5])

    # resolved start was 1.9 but bookend ended up at 3.0 - this is the AGL clamp drift
    violations = validate_vertical_profile_angle_band(
        waypoints,
        center,
        setting_angles=[],
        angle_start_resolved=1.9,
        angle_end_resolved=6.5,
        angle_source="CUSTOM",
    )

    assert any(v.violation_kind == "papi_angle_band" for v in violations)
    assert all(v.is_warning for v in violations)


def test_vertical_profile_angle_band_papi_coverage_warning():
    """PAPI mode warns when climb does not span the [min, max] of setting_angles."""
    from app.services.trajectory.safety_validator import (
        validate_vertical_profile_angle_band,
    )
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    # climb sits inside the band 3.0 - 3.5 instead of spanning it
    waypoints = _make_vertical_waypoints(center, 400.0, [3.1, 3.2, 3.3])

    violations = validate_vertical_profile_angle_band(
        waypoints,
        center,
        setting_angles=[3.0, 3.5],
        angle_start_resolved=3.1,
        angle_end_resolved=3.3,
        angle_source="PAPI",
    )

    coverage = [
        v for v in violations if v.violation_kind == "papi_angle_band" and "PAPI band" in v.message
    ]
    assert len(coverage) == 1
    assert coverage[0].is_warning


def test_vertical_profile_angle_band_papi_no_warning_when_band_covered():
    """PAPI mode does not warn when bookends bracket the setting angle band."""
    from app.services.trajectory.safety_validator import (
        validate_vertical_profile_angle_band,
    )
    from app.services.trajectory.types import Point3D

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    # bookends bracket the [3.0, 3.5] PAPI band
    waypoints = _make_vertical_waypoints(center, 400.0, [2.5, 3.0, 3.5, 4.0])

    violations = validate_vertical_profile_angle_band(
        waypoints,
        center,
        setting_angles=[3.0, 3.5],
        angle_start_resolved=2.5,
        angle_end_resolved=4.0,
        angle_source="PAPI",
    )

    assert violations == []
