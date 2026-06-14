"""unit tests for approach-descent trajectory generation (ZEPHYR procedure e)."""

import math
from dataclasses import dataclass, field
from uuid import uuid4

import pytest

from app.core.constants import MIN_TRANSIT_ALTITUDE_AGL_M
from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.services.trajectory.helpers import (
    _apply_papi_glide_slope_terrain,
    get_touchpoint_position,
)
from app.services.trajectory.methods._prepare import _prepare_approach_descent
from app.services.trajectory.methods.approach_descent import (
    calculate_approach_descent_path,
    resolve_descent_angle,
)
from app.services.trajectory.types import (
    DEFAULT_DESCENT_START_DISTANCE,
    Point3D,
    ResolvedConfig,
    WaypointData,
)
from app.utils.geo import bearing_between, distance_between
from tests.method_dispatch import dispatch_trajectory, make_context


@dataclass
class FakeInspection:
    """minimal inspection stub."""

    id: object = None
    method: InspectionMethod = InspectionMethod.APPROACH_DESCENT
    config: object = None
    sequence_order: int = 1

    def __post_init__(self):
        """set default id."""
        if self.id is None:
            self.id = uuid4()


@dataclass
class FakeAgl:
    """minimal AGL stub for prepare tests."""

    surface_id: object = None

    def __post_init__(self):
        """set default surface_id."""
        if self.surface_id is None:
            self.surface_id = uuid4()


@dataclass
class FakeSurface:
    """minimal surface stub carrying touchpoint columns."""

    id: object = None
    touchpoint_latitude: float | None = None
    touchpoint_longitude: float | None = None
    touchpoint_altitude: float | None = None

    def __post_init__(self):
        """set default id."""
        if self.id is None:
            self.id = uuid4()


@dataclass
class FakeTemplate:
    """minimal template stub for prepare tests."""

    targets: list = field(default_factory=list)
    name: str = "Approach Descent"


class FlatProvider:
    """elevation provider returning a constant ground level everywhere."""

    def __init__(self, elevation: float):
        """store the flat ground level."""
        self.elevation = elevation

    def get_elevations_batch(self, points):
        """return the flat elevation for every point."""
        return [self.elevation] * len(points)


# fixed reference geometry - touchpoint with PAPI offset to one side
TOUCHPOINT = Point3D(lon=14.26, lat=50.10, alt=380.0)
LHA_CENTER = Point3D(lon=14.262, lat=50.101, alt=380.5)
RUNWAY_HEADING = 90.0


# descent angle resolution


class TestResolveDescentAngle:
    """tests for descent glide slope resolution."""

    def test_papi_derived_angle_used_by_default(self):
        """without an override the PAPI-derived glide slope is used."""
        assert resolve_descent_angle(ResolvedConfig(), 3.0) == 3.0

    def test_override_wins_over_papi_angle(self):
        """descent_glide_slope_override takes precedence over the PAPI angle."""
        cfg = ResolvedConfig(descent_glide_slope_override=4.5)
        assert resolve_descent_angle(cfg, 3.0) == 4.5


# generator geometry


class TestApproachDescentPath:
    """tests for the approach-descent path generator."""

    def test_waypoint_count_matches_density(self):
        """one measurement waypoint per density step."""
        cfg = ResolvedConfig(measurement_density=6)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert len(wps) == 6
        assert all(wp.waypoint_type == WaypointType.MEASUREMENT for wp in wps)

    def test_final_waypoint_is_touchpoint(self):
        """the descent terminates exactly at the runway touchpoint."""
        cfg = ResolvedConfig(measurement_density=8)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        last = wps[-1]
        assert last.lon == pytest.approx(TOUCHPOINT.lon)
        assert last.lat == pytest.approx(TOUCHPOINT.lat)
        assert last.alt == pytest.approx(TOUCHPOINT.alt)

    def test_start_point_distance_back_of_touchpoint(self):
        """the first waypoint sits descent_start_distance back of the touchpoint."""
        cfg = ResolvedConfig(measurement_density=5, descent_start_distance=800.0)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        first = wps[0]
        dist = distance_between(first.lon, first.lat, TOUCHPOINT.lon, TOUCHPOINT.lat)
        assert dist == pytest.approx(800.0, rel=1e-3)

    def test_start_point_on_approach_side(self):
        """start point lies on the approach side - bearing from touchpoint is the approach axis."""
        cfg = ResolvedConfig(measurement_density=3, descent_start_distance=1000.0)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        first = wps[0]
        bearing = bearing_between(TOUCHPOINT.lon, TOUCHPOINT.lat, first.lon, first.lat)
        # approach bearing = (runway_heading + 180) % 360
        assert bearing == pytest.approx((RUNWAY_HEADING + 180) % 360, abs=0.5)

    def test_start_altitude_follows_glide_slope(self):
        """start altitude = touchpoint alt + distance * tan(glide slope)."""
        cfg = ResolvedConfig(measurement_density=4, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        expected = TOUCHPOINT.alt + 1000.0 * math.tan(math.radians(angle))
        assert wps[0].alt == pytest.approx(expected, rel=1e-6)

    def test_altitude_descends_monotonically(self):
        """altitude strictly decreases from start to touchpoint."""
        cfg = ResolvedConfig(measurement_density=10)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        alts = [wp.alt for wp in wps]
        assert alts == sorted(alts, reverse=True)
        assert alts[0] > alts[-1]

    def test_default_descent_distance(self):
        """unset descent_start_distance falls back to the 1000 m default."""
        cfg = ResolvedConfig(measurement_density=3)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        dist = distance_between(wps[0].lon, wps[0].lat, TOUCHPOINT.lon, TOUCHPOINT.lat)
        assert dist == pytest.approx(DEFAULT_DESCENT_START_DISTANCE, rel=1e-3)

    def test_glide_slope_override_changes_start_altitude(self):
        """a steeper override raises the start altitude above the PAPI-derived one."""
        base = calculate_approach_descent_path(
            TOUCHPOINT,
            LHA_CENTER,
            RUNWAY_HEADING,
            3.0,
            ResolvedConfig(measurement_density=3, descent_start_distance=1000.0),
            uuid4(),
            speed=5.0,
        )
        steeper = calculate_approach_descent_path(
            TOUCHPOINT,
            LHA_CENTER,
            RUNWAY_HEADING,
            3.0,
            ResolvedConfig(
                measurement_density=3,
                descent_start_distance=1000.0,
                descent_glide_slope_override=5.0,
            ),
            uuid4(),
            speed=5.0,
        )
        assert steeper[0].alt > base[0].alt

    def test_altitude_offset_applied(self):
        """altitude_offset shifts every waypoint up by the offset."""
        cfg = ResolvedConfig(measurement_density=4, descent_start_distance=1000.0)
        cfg_offset = ResolvedConfig(
            measurement_density=4, descent_start_distance=1000.0, altitude_offset=10.0
        )
        base = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        shifted = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg_offset, uuid4(), speed=5.0
        )
        for b, s in zip(base, shifted):
            assert s.alt == pytest.approx(b.alt + 10.0)

    def test_camera_target_is_lha_center(self):
        """camera target aims at the PAPI LHA center for every waypoint."""
        cfg = ResolvedConfig(measurement_density=5)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_target == LHA_CENTER for wp in wps)

    def test_heading_toward_lha_center(self):
        """waypoint heading points toward the PAPI LHA center."""
        cfg = ResolvedConfig(measurement_density=5)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        wp = wps[0]
        expected = bearing_between(wp.lon, wp.lat, LHA_CENTER.lon, LHA_CENTER.lat)
        assert wp.heading == pytest.approx(expected, abs=0.5)

    def test_photo_capture_mode(self):
        """photo capture emits PHOTO_CAPTURE camera actions."""
        cfg = ResolvedConfig(measurement_density=3, capture_mode="PHOTO_CAPTURE")
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_action == CameraAction.PHOTO_CAPTURE for wp in wps)

    def test_video_capture_mode(self):
        """video capture emits RECORDING camera actions."""
        cfg = ResolvedConfig(measurement_density=3, capture_mode="VIDEO_CAPTURE")
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_action == CameraAction.RECORDING for wp in wps)

    def test_single_density_emits_start_point(self):
        """density 1 emits a single waypoint at the descent start."""
        cfg = ResolvedConfig(measurement_density=1, descent_start_distance=1000.0)
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert len(wps) == 1
        dist = distance_between(wps[0].lon, wps[0].lat, TOUCHPOINT.lon, TOUCHPOINT.lat)
        assert dist == pytest.approx(1000.0, rel=1e-3)


# terrain handling


class TestApproachDescentTerrain:
    """tests for the PAPI glide-slope terrain post-processing on the descent."""

    def test_flat_terrain_preserves_glide_slope(self):
        """over flat terrain a mid-descent waypoint keeps its geometric altitude."""
        cfg = ResolvedConfig(measurement_density=10, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        provider = FlatProvider(TOUCHPOINT.alt)
        _apply_papi_glide_slope_terrain(wps, TOUCHPOINT, angle, provider)

        # a high waypoint (well above the AGL floor) preserves the glide slope
        wp = wps[2]
        horiz = distance_between(wp.lon, wp.lat, TOUCHPOINT.lon, TOUCHPOINT.lat)
        expected = TOUCHPOINT.alt + horiz * math.tan(math.radians(angle))
        assert wp.alt == pytest.approx(expected, rel=1e-6)

    def test_low_waypoints_clamped_to_agl_floor(self):
        """waypoints near the touchpoint are clamped to the minimum AGL floor."""
        cfg = ResolvedConfig(measurement_density=10, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        provider = FlatProvider(TOUCHPOINT.alt)
        _apply_papi_glide_slope_terrain(wps, TOUCHPOINT, angle, provider)

        # the final waypoint sits at the touchpoint; geometric alt would be
        # ground level, so it is clamped up to the safety floor.
        assert wps[-1].alt == pytest.approx(TOUCHPOINT.alt + MIN_TRANSIT_ALTITUDE_AGL_M, abs=1e-6)

    def test_terrain_rise_clamps_waypoint_up(self):
        """a terrain bump under a waypoint lifts it to keep clearance."""
        cfg = ResolvedConfig(measurement_density=6, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            TOUCHPOINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        # terrain spikes 60 m under the second-to-last waypoint
        elevations = [TOUCHPOINT.alt] * len(wps)
        elevations[-2] = TOUCHPOINT.alt + 60.0

        class SpikeProvider:
            def get_elevations_batch(self, points):
                return list(elevations)

        before = wps[-2].alt
        _apply_papi_glide_slope_terrain(wps, TOUCHPOINT, angle, SpikeProvider())
        assert wps[-2].alt > before
        assert wps[-2].alt >= TOUCHPOINT.alt + 60.0 + MIN_TRANSIT_ALTITUDE_AGL_M - 1e-6


# altitude_offset survives DEM/elevation-provider terrain post-processing
#
# the PAPI generators (HR, VP, AD) bake config.altitude_offset into wp.alt at
# emission time. _apply_papi_glide_slope_terrain rebuilds altitude geometrically
# from `center.alt + horiz * tan(angle)` on the fixed-angle branch, discarding
# wp.alt - so the offset MUST be plumbed through and re-added there or every
# DEM/elevation-provider airport silently drops the operator's vertical bias.
# the family-wide unit-tests here pin the contract at the helper boundary; the
# integration test below exercises it through compute_measurement_trajectory.


class TestPapiGlideSlopeTerrainOffset:
    """`_apply_papi_glide_slope_terrain` honours altitude_offset on the rebuild branch."""

    def _make_wp(self, lon: float, lat: float, alt: float, target: Point3D) -> WaypointData:
        """build a minimal MEASUREMENT waypoint for the helper."""
        from app.core.enums import CameraAction

        return WaypointData(
            lon=lon,
            lat=lat,
            alt=alt,
            heading=0.0,
            speed=5.0,
            waypoint_type=WaypointType.MEASUREMENT,
            camera_action=CameraAction.PHOTO_CAPTURE,
            camera_target=target,
            inspection_id=uuid4(),
            hover_duration=None,
            gimbal_pitch=0.0,
        )

    def test_offset_re_added_on_horizontal_range_arc(self):
        """HR-shape rebuild adds altitude_offset back when wp.alt is discarded."""
        angle = 3.0
        # waypoint ~400 m horizontal from LHA, far above the AGL floor
        wp_lon = LHA_CENTER.lon + 0.005
        wp = self._make_wp(wp_lon, LHA_CENTER.lat, 999.0, LHA_CENTER)
        horiz = distance_between(wp.lon, wp.lat, LHA_CENTER.lon, LHA_CENTER.lat)
        # flat terrain well below the geometric altitude so the floor never clamps
        provider = FlatProvider(LHA_CENTER.alt - 100.0)

        _apply_papi_glide_slope_terrain(
            [wp],
            LHA_CENTER,
            fixed_angle=angle,
            elevation_provider=provider,
            altitude_offset=7.5,
        )

        expected = LHA_CENTER.alt + horiz * math.tan(math.radians(angle)) + 7.5
        assert wp.alt == pytest.approx(expected, rel=1e-6)

    def test_offset_re_added_on_approach_descent_rebuild(self):
        """AD-shape rebuild (anchor=touchpoint) carries altitude_offset through."""
        angle = 3.0
        # waypoint ~500 m back of the touchpoint along the approach
        wp_lon = TOUCHPOINT.lon - 0.007
        wp = self._make_wp(wp_lon, TOUCHPOINT.lat, 999.0, LHA_CENTER)
        horiz = distance_between(wp.lon, wp.lat, TOUCHPOINT.lon, TOUCHPOINT.lat)
        provider = FlatProvider(TOUCHPOINT.alt - 100.0)

        _apply_papi_glide_slope_terrain(
            [wp],
            TOUCHPOINT,
            fixed_angle=angle,
            elevation_provider=provider,
            altitude_offset=12.0,
        )

        expected = TOUCHPOINT.alt + horiz * math.tan(math.radians(angle)) + 12.0
        assert wp.alt == pytest.approx(expected, rel=1e-6)

    def test_offset_not_double_counted_on_vp_fallback_branch(self):
        """VP-shape (fixed_angle=None) falls through to wp.alt - no second add."""
        # the generator already baked the offset into wp.alt; the helper must
        # not re-apply it on the `else` branch or VP altitudes shift twice.
        wp = self._make_wp(LHA_CENTER.lon, LHA_CENTER.lat, LHA_CENTER.alt + 100.0, LHA_CENTER)
        provider = FlatProvider(LHA_CENTER.alt - 100.0)
        original = wp.alt

        _apply_papi_glide_slope_terrain(
            [wp],
            LHA_CENTER,
            fixed_angle=None,
            elevation_provider=provider,
            altitude_offset=8.0,
        )

        # else branch reads wp.alt verbatim; non-zero offset must not double-add
        assert wp.alt == pytest.approx(original, rel=1e-6)

    def test_offset_default_preserves_legacy_call_sites(self):
        """legacy callers that omit altitude_offset see byte-identical behavior."""
        angle = 3.0
        wp_lon = LHA_CENTER.lon + 0.005
        wp = self._make_wp(wp_lon, LHA_CENTER.lat, 999.0, LHA_CENTER)
        horiz = distance_between(wp.lon, wp.lat, LHA_CENTER.lon, LHA_CENTER.lat)
        provider = FlatProvider(LHA_CENTER.alt - 100.0)

        _apply_papi_glide_slope_terrain(
            [wp],
            LHA_CENTER,
            fixed_angle=angle,
            elevation_provider=provider,
        )

        expected = LHA_CENTER.alt + horiz * math.tan(math.radians(angle))
        assert wp.alt == pytest.approx(expected, rel=1e-6)

    def test_offset_survives_full_approach_descent_pipeline(self):
        """end-to-end: compute_measurement_trajectory plumbs offset into the rebuild."""
        # the bug shape this protects against: generator adds offset, dispatcher
        # runs the terrain step without forwarding it, every measurement waypoint
        # lands at the bare geometric altitude on every DEM airport.
        insp = FakeInspection()
        cfg_base = ResolvedConfig(
            measurement_density=6,
            descent_start_distance=1000.0,
            capture_mode="PHOTO_CAPTURE",
        )
        cfg_offset = ResolvedConfig(
            measurement_density=6,
            descent_start_distance=1000.0,
            capture_mode="PHOTO_CAPTURE",
            altitude_offset=15.0,
        )
        # flat ground far below the descent so the AGL floor never clamps mid-arc
        provider = FlatProvider(TOUCHPOINT.alt - 200.0)

        base = dispatch_trajectory(
            insp,
            cfg_base,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            elevation_provider=provider,
            touchpoint=TOUCHPOINT,
        )
        shifted = dispatch_trajectory(
            insp,
            cfg_offset,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            elevation_provider=provider,
            touchpoint=TOUCHPOINT,
        )

        # every measurement waypoint above the AGL floor sits exactly 15 m higher
        lifted = [
            (b, s)
            for b, s in zip(base, shifted)
            if b.waypoint_type == WaypointType.MEASUREMENT
            and s.alt > provider.elevation + MIN_TRANSIT_ALTITUDE_AGL_M + 1.0
        ]
        assert lifted, "test fixture must leave at least one waypoint above the floor"
        for b, s in lifted:
            assert s.alt == pytest.approx(b.alt + 15.0, abs=1e-6)


# orchestrator dispatch


class TestApproachDescentDispatch:
    """tests for compute_measurement_trajectory routing to approach-descent."""

    def test_dispatch_produces_descent(self):
        """the dispatcher routes APPROACH_DESCENT to the generator."""
        insp = FakeInspection()
        cfg = ResolvedConfig(measurement_density=5, capture_mode="PHOTO_CAPTURE")
        wps = dispatch_trajectory(
            insp,
            cfg,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            touchpoint=TOUCHPOINT,
        )
        assert len(wps) == 5
        assert wps[-1].lon == pytest.approx(TOUCHPOINT.lon)
        assert wps[-1].lat == pytest.approx(TOUCHPOINT.lat)

    def test_dispatch_requires_touchpoint(self):
        """the dispatcher rejects approach-descent without a touchpoint."""
        insp = FakeInspection()
        cfg = ResolvedConfig(measurement_density=5)
        with pytest.raises(ValueError, match="touchpoint"):
            dispatch_trajectory(
                insp,
                cfg,
                center=LHA_CENTER,
                runway_heading=RUNWAY_HEADING,
                glide_slope=3.0,
                speed=5.0,
                setting_angles=[3.0],
                touchpoint=None,
            )

    def test_dispatch_applies_terrain_post_processing(self):
        """dispatch runs the PAPI terrain step, clamping the touchpoint waypoint."""
        insp = FakeInspection()
        cfg = ResolvedConfig(
            measurement_density=8,
            descent_start_distance=1000.0,
            capture_mode="PHOTO_CAPTURE",
        )
        wps = dispatch_trajectory(
            insp,
            cfg,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            elevation_provider=FlatProvider(TOUCHPOINT.alt),
            touchpoint=TOUCHPOINT,
        )
        assert wps[-1].alt == pytest.approx(TOUCHPOINT.alt + MIN_TRANSIT_ALTITUDE_AGL_M, abs=1e-6)


# touchpoint resolution + prepare step


class TestTouchpointResolution:
    """tests for get_touchpoint_position and _prepare_approach_descent."""

    def test_get_touchpoint_position_reads_surface(self):
        """get_touchpoint_position resolves the touchpoint of the linked runway."""
        surface_id = uuid4()
        surface = FakeSurface(
            id=surface_id,
            touchpoint_latitude=50.10,
            touchpoint_longitude=14.26,
            touchpoint_altitude=380.0,
        )
        template = FakeTemplate(targets=[FakeAgl(surface_id=surface_id)])
        pos = get_touchpoint_position(template, [surface])
        assert pos is not None
        assert pos.lat == 50.10
        assert pos.lon == 14.26
        assert pos.alt == 380.0

    def test_get_touchpoint_position_missing_returns_none(self):
        """a runway with no touchpoint set resolves to None."""
        surface_id = uuid4()
        surface = FakeSurface(id=surface_id)
        template = FakeTemplate(targets=[FakeAgl(surface_id=surface_id)])
        assert get_touchpoint_position(template, [surface]) is None

    def test_prepare_resolves_touchpoint(self):
        """_prepare_approach_descent carries the resolved touchpoint."""
        surface_id = uuid4()
        surface = FakeSurface(
            id=surface_id,
            touchpoint_latitude=50.10,
            touchpoint_longitude=14.26,
            touchpoint_altitude=380.0,
        )
        template = FakeTemplate(targets=[FakeAgl(surface_id=surface_id)])
        prep = _prepare_approach_descent(
            make_context(
                FakeInspection(),
                ResolvedConfig(measurement_density=5, descent_start_distance=900.0),
                center=LHA_CENTER,
                runway_heading=RUNWAY_HEADING,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[surface],
            )
        )
        assert prep.touchpoint is not None
        assert prep.touchpoint.alt == 380.0
        assert prep.path_distance == 900.0

    def test_prepare_missing_touchpoint_raises(self):
        """a runway without a touchpoint raises a clear validation error, not a crash."""
        surface_id = uuid4()
        surface = FakeSurface(id=surface_id)
        template = FakeTemplate(targets=[FakeAgl(surface_id=surface_id)])
        with pytest.raises(TrajectoryGenerationError, match="touchpoint"):
            _prepare_approach_descent(
                make_context(
                    FakeInspection(),
                    ResolvedConfig(measurement_density=5),
                    center=LHA_CENTER,
                    runway_heading=RUNWAY_HEADING,
                    glide_slope=3.0,
                    default_speed=5.0,
                    template=template,
                    surfaces=[surface],
                )
            )
