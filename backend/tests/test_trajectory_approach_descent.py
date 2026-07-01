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
    DEFAULT_MEHT_HOVER_DURATION,
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
    distance_from_threshold: float | None = None
    meht_height_m: float | None = None

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


# fixed reference geometry - the meht point sits over the threshold, meht_height
# above the threshold ground; the PAPI lha is offset to one side.
THRESHOLD_GROUND = 380.0
MEHT_HEIGHT = 20.0
MEHT_POINT = Point3D(lon=14.26, lat=50.10, alt=THRESHOLD_GROUND + MEHT_HEIGHT)
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
        """one waypoint per density step; the last is the MEHT hover."""
        cfg = ResolvedConfig(measurement_density=6)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert len(wps) == 6
        assert all(wp.waypoint_type == WaypointType.MEASUREMENT for wp in wps[:-1])
        assert wps[-1].waypoint_type == WaypointType.HOVER

    def test_final_waypoint_is_hover_at_meht(self):
        """the descent terminates with a hover + capture at the MEHT point."""
        cfg = ResolvedConfig(measurement_density=8, capture_mode="PHOTO_CAPTURE")
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        last = wps[-1]
        assert last.waypoint_type == WaypointType.HOVER
        assert last.lon == pytest.approx(MEHT_POINT.lon)
        assert last.lat == pytest.approx(MEHT_POINT.lat)
        assert last.alt == pytest.approx(MEHT_POINT.alt)
        assert last.hover_duration == DEFAULT_MEHT_HOVER_DURATION
        assert last.camera_action == CameraAction.PHOTO_CAPTURE

    def test_final_hover_records_under_video(self):
        """under video the terminal MEHT hover carries RECORDING (pre-wrap)."""
        cfg = ResolvedConfig(measurement_density=4, capture_mode="VIDEO_CAPTURE")
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert wps[-1].waypoint_type == WaypointType.HOVER
        assert wps[-1].camera_action == CameraAction.RECORDING

    def test_start_point_distance_back_of_threshold(self):
        """the first waypoint sits descent_start_distance back of the MEHT point."""
        cfg = ResolvedConfig(measurement_density=5, descent_start_distance=800.0)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        first = wps[0]
        dist = distance_between(first.lon, first.lat, MEHT_POINT.lon, MEHT_POINT.lat)
        assert dist == pytest.approx(800.0, rel=1e-3)

    def test_start_point_on_approach_side(self):
        """start point lies on the approach side of the MEHT point."""
        cfg = ResolvedConfig(measurement_density=3, descent_start_distance=1000.0)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        first = wps[0]
        bearing = bearing_between(MEHT_POINT.lon, MEHT_POINT.lat, first.lon, first.lat)
        # approach bearing = (runway_heading + 180) % 360
        assert bearing == pytest.approx((RUNWAY_HEADING + 180) % 360, abs=0.5)

    def test_start_altitude_follows_glide_slope(self):
        """start altitude = meht alt + distance * tan(glide slope)."""
        cfg = ResolvedConfig(measurement_density=4, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        expected = MEHT_POINT.alt + 1000.0 * math.tan(math.radians(angle))
        assert wps[0].alt == pytest.approx(expected, rel=1e-6)

    def test_altitude_descends_monotonically(self):
        """altitude strictly decreases from start to the MEHT point."""
        cfg = ResolvedConfig(measurement_density=10)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        alts = [wp.alt for wp in wps]
        assert alts == sorted(alts, reverse=True)
        assert alts[0] > alts[-1]
        assert alts[-1] == pytest.approx(MEHT_POINT.alt)

    def test_default_descent_distance(self):
        """unset descent_start_distance falls back to the 1000 m default."""
        cfg = ResolvedConfig(measurement_density=3)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        dist = distance_between(wps[0].lon, wps[0].lat, MEHT_POINT.lon, MEHT_POINT.lat)
        assert dist == pytest.approx(DEFAULT_DESCENT_START_DISTANCE, rel=1e-3)

    def test_glide_slope_override_changes_start_altitude(self):
        """a steeper override raises the start altitude above the PAPI-derived one."""
        base = calculate_approach_descent_path(
            MEHT_POINT,
            LHA_CENTER,
            RUNWAY_HEADING,
            3.0,
            ResolvedConfig(measurement_density=3, descent_start_distance=1000.0),
            uuid4(),
            speed=5.0,
        )
        steeper = calculate_approach_descent_path(
            MEHT_POINT,
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
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        shifted = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg_offset, uuid4(), speed=5.0
        )
        for b, s in zip(base, shifted):
            assert s.alt == pytest.approx(b.alt + 10.0)

    def test_camera_target_is_lha_center(self):
        """camera target aims at the PAPI LHA center for every waypoint."""
        cfg = ResolvedConfig(measurement_density=5)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_target == LHA_CENTER for wp in wps)

    def test_heading_toward_lha_center(self):
        """waypoint heading points toward the PAPI LHA center."""
        cfg = ResolvedConfig(measurement_density=5)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        wp = wps[0]
        expected = bearing_between(wp.lon, wp.lat, LHA_CENTER.lon, LHA_CENTER.lat)
        assert wp.heading == pytest.approx(expected, abs=0.5)

    def test_photo_capture_mode(self):
        """photo capture emits PHOTO_CAPTURE on every waypoint incl. the terminal hover."""
        cfg = ResolvedConfig(measurement_density=3, capture_mode="PHOTO_CAPTURE")
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_action == CameraAction.PHOTO_CAPTURE for wp in wps)

    def test_video_capture_mode(self):
        """video capture emits RECORDING on every waypoint incl. the terminal hover."""
        cfg = ResolvedConfig(measurement_density=3, capture_mode="VIDEO_CAPTURE")
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert all(wp.camera_action == CameraAction.RECORDING for wp in wps)

    def test_single_density_emits_meht_hover(self):
        """density 1 emits a single terminal MEHT hover at the meht point."""
        cfg = ResolvedConfig(measurement_density=1, descent_start_distance=1000.0)
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, 3.0, cfg, uuid4(), speed=5.0
        )
        assert len(wps) == 1
        assert wps[0].waypoint_type == WaypointType.HOVER
        assert wps[0].lon == pytest.approx(MEHT_POINT.lon)
        assert wps[0].lat == pytest.approx(MEHT_POINT.lat)
        assert wps[0].alt == pytest.approx(MEHT_POINT.alt)


# terrain handling


class TestApproachDescentTerrain:
    """tests for the PAPI glide-slope terrain post-processing on the descent."""

    def test_flat_terrain_preserves_glide_slope(self):
        """over flat terrain a mid-descent waypoint keeps its geometric altitude."""
        cfg = ResolvedConfig(measurement_density=10, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        # ground far below the descent so nothing clamps to the AGL floor
        provider = FlatProvider(THRESHOLD_GROUND - 100.0)
        _apply_papi_glide_slope_terrain(wps, MEHT_POINT, angle, provider)

        wp = wps[2]
        horiz = distance_between(wp.lon, wp.lat, MEHT_POINT.lon, MEHT_POINT.lat)
        expected = MEHT_POINT.alt + horiz * math.tan(math.radians(angle))
        assert wp.alt == pytest.approx(expected, rel=1e-6)

    def test_terminal_hover_not_clamped(self):
        """the MEHT hover sits meht_height above ground, above the AGL floor - no clamp."""
        cfg = ResolvedConfig(measurement_density=10, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        provider = FlatProvider(THRESHOLD_GROUND)
        _apply_papi_glide_slope_terrain(wps, MEHT_POINT, angle, provider)

        # meht.alt (ground + 20) stays well above ground + MIN_TRANSIT floor
        assert wps[-1].alt == pytest.approx(MEHT_POINT.alt)
        assert wps[-1].alt > THRESHOLD_GROUND + MIN_TRANSIT_ALTITUDE_AGL_M

    def test_terrain_rise_clamps_waypoint_up(self):
        """a terrain bump under a waypoint lifts it to keep clearance."""
        cfg = ResolvedConfig(measurement_density=6, descent_start_distance=1000.0)
        angle = 3.0
        wps = calculate_approach_descent_path(
            MEHT_POINT, LHA_CENTER, RUNWAY_HEADING, angle, cfg, uuid4(), speed=5.0
        )
        # terrain spikes 60 m under the second-to-last waypoint
        elevations = [THRESHOLD_GROUND] * len(wps)
        elevations[-2] = THRESHOLD_GROUND + 60.0

        class SpikeProvider:
            def get_elevations_batch(self, points):
                return list(elevations)

        before = wps[-2].alt
        _apply_papi_glide_slope_terrain(wps, MEHT_POINT, angle, SpikeProvider())
        assert wps[-2].alt > before
        assert wps[-2].alt >= THRESHOLD_GROUND + 60.0 + MIN_TRANSIT_ALTITUDE_AGL_M - 1e-6


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
        """AD-shape rebuild (anchor=meht point) carries altitude_offset through."""
        angle = 3.0
        # waypoint ~500 m back of the meht point along the approach
        wp_lon = MEHT_POINT.lon - 0.007
        wp = self._make_wp(wp_lon, MEHT_POINT.lat, 999.0, LHA_CENTER)
        horiz = distance_between(wp.lon, wp.lat, MEHT_POINT.lon, MEHT_POINT.lat)
        provider = FlatProvider(MEHT_POINT.alt - 100.0)

        _apply_papi_glide_slope_terrain(
            [wp],
            MEHT_POINT,
            fixed_angle=angle,
            elevation_provider=provider,
            altitude_offset=12.0,
        )

        expected = MEHT_POINT.alt + horiz * math.tan(math.radians(angle)) + 12.0
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
        provider = FlatProvider(MEHT_POINT.alt - 200.0)

        base = dispatch_trajectory(
            insp,
            cfg_base,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            elevation_provider=provider,
            meht_point=MEHT_POINT,
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
            meht_point=MEHT_POINT,
        )

        # every waypoint above the AGL floor sits exactly 15 m higher
        lifted = [
            (b, s)
            for b, s in zip(base, shifted)
            if s.alt > provider.elevation + MIN_TRANSIT_ALTITUDE_AGL_M + 1.0
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
            meht_point=MEHT_POINT,
        )
        assert len(wps) == 5
        assert wps[-1].waypoint_type == WaypointType.HOVER
        assert wps[-1].lon == pytest.approx(MEHT_POINT.lon)
        assert wps[-1].lat == pytest.approx(MEHT_POINT.lat)

    def test_dispatch_requires_meht_point(self):
        """the dispatcher rejects approach-descent without a MEHT point."""
        insp = FakeInspection()
        cfg = ResolvedConfig(measurement_density=5)
        with pytest.raises(ValueError, match="MEHT point"):
            dispatch_trajectory(
                insp,
                cfg,
                center=LHA_CENTER,
                runway_heading=RUNWAY_HEADING,
                glide_slope=3.0,
                speed=5.0,
                setting_angles=[3.0],
                meht_point=None,
            )

    def test_dispatch_applies_terrain_post_processing(self):
        """dispatch runs the PAPI terrain step - a high floor lifts the MEHT hover."""
        insp = FakeInspection()
        cfg = ResolvedConfig(
            measurement_density=8,
            descent_start_distance=1000.0,
            capture_mode="PHOTO_CAPTURE",
        )
        # ground sits just below the meht point so the AGL floor lifts the terminal hover
        provider = FlatProvider(MEHT_POINT.alt - 1.0)
        wps = dispatch_trajectory(
            insp,
            cfg,
            center=LHA_CENTER,
            runway_heading=RUNWAY_HEADING,
            glide_slope=3.0,
            speed=5.0,
            setting_angles=[3.0],
            elevation_provider=provider,
            meht_point=MEHT_POINT,
        )
        expected = MEHT_POINT.alt - 1.0 + MIN_TRANSIT_ALTITUDE_AGL_M
        assert wps[-1].alt == pytest.approx(expected, abs=1e-6)


# touchpoint accessor - kept; only the approach-descent path stopped calling it


class TestTouchpointResolution:
    """tests for get_touchpoint_position (the accessor stays available)."""

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


# prepare step - anchors on the MEHT point over the threshold


class TestPrepareApproachDescent:
    """tests for _prepare_approach_descent MEHT-point anchoring."""

    def test_prepare_anchors_on_meht_point(self, monkeypatch):
        """the prep carries the meht point over the threshold at the derived height."""
        threshold = Point3D(lon=14.26, lat=50.10, alt=380.0)
        monkeypatch.setattr(
            "app.services.trajectory.methods._prepare.get_threshold_position",
            lambda template, surfaces: threshold,
        )
        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=300.0)
        template = FakeTemplate(targets=[agl])

        prep = _prepare_approach_descent(
            make_context(
                FakeInspection(),
                ResolvedConfig(measurement_density=5, descent_start_distance=900.0),
                center=LHA_CENTER,
                runway_heading=RUNWAY_HEADING,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[FakeSurface(id=surface_id)],
            )
        )
        assert prep.meht_point is not None
        assert prep.meht_point.lon == threshold.lon
        assert prep.meht_point.lat == threshold.lat
        # anchor alt excludes altitude_offset (the handler + terrain re-add it)
        derived = 300.0 * math.tan(math.radians(3.0))
        assert prep.meht_point.alt == pytest.approx(threshold.alt + derived)
        assert prep.path_distance == 900.0

    def test_prepare_surveyed_height_overrides_derived(self, monkeypatch):
        """a surveyed meht_height_m sets the anchor altitude, ignoring distance*tan."""
        threshold = Point3D(lon=14.26, lat=50.10, alt=380.0)
        monkeypatch.setattr(
            "app.services.trajectory.methods._prepare.get_threshold_position",
            lambda template, surfaces: threshold,
        )
        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=300.0, meht_height_m=22.0)
        template = FakeTemplate(targets=[agl])

        prep = _prepare_approach_descent(
            make_context(
                FakeInspection(),
                ResolvedConfig(measurement_density=5),
                center=LHA_CENTER,
                runway_heading=RUNWAY_HEADING,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[FakeSurface(id=surface_id)],
            )
        )
        assert prep.meht_point.alt == pytest.approx(threshold.alt + 22.0)

    def test_prepare_missing_threshold_raises(self, monkeypatch):
        """no runway threshold raises a clear validation error."""
        monkeypatch.setattr(
            "app.services.trajectory.methods._prepare.get_threshold_position",
            lambda template, surfaces: None,
        )
        surface_id = uuid4()
        template = FakeTemplate(targets=[FakeAgl(surface_id=surface_id)])
        with pytest.raises(TrajectoryGenerationError, match="threshold"):
            _prepare_approach_descent(
                make_context(
                    FakeInspection(),
                    ResolvedConfig(measurement_density=5),
                    center=LHA_CENTER,
                    runway_heading=RUNWAY_HEADING,
                    glide_slope=3.0,
                    default_speed=5.0,
                    template=template,
                    surfaces=[FakeSurface(id=surface_id)],
                )
            )

    def test_prepare_missing_meht_height_raises(self, monkeypatch):
        """no surveyed height and no distance raises a clear validation error."""
        threshold = Point3D(lon=14.26, lat=50.10, alt=380.0)
        monkeypatch.setattr(
            "app.services.trajectory.methods._prepare.get_threshold_position",
            lambda template, surfaces: threshold,
        )
        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=None, meht_height_m=None)
        template = FakeTemplate(targets=[agl])
        with pytest.raises(TrajectoryGenerationError, match="meht_height_m"):
            _prepare_approach_descent(
                make_context(
                    FakeInspection(),
                    ResolvedConfig(measurement_density=5),
                    center=LHA_CENTER,
                    runway_heading=RUNWAY_HEADING,
                    glide_slope=3.0,
                    default_speed=5.0,
                    template=template,
                    surfaces=[FakeSurface(id=surface_id)],
                )
            )
