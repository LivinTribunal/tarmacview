"""unit tests for the surface-scan serpentine trajectory generator (T3)."""

import math
from dataclasses import dataclass
from uuid import uuid4

import pytest

from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.services.trajectory.methods.surface_scan import (
    calculate_surface_scan_path,
    compute_scan_footprint,
    plan_surface_scan,
    scan_path_distance,
)
from app.services.trajectory.types import (
    DEFAULT_SURFACE_SCAN_GIMBAL,
    DEFAULT_SURFACE_SCAN_HEIGHT,
    Point3D,
    ResolvedConfig,
)
from app.utils.geo import distance_between, point_at_distance
from tests.method_dispatch import dispatch_trajectory


@dataclass
class FakeSurface:
    """minimal AirfieldSurface stub with a centerline geometry."""

    id: str = "surf-1"
    identifier: str = "09/27"
    surface_type: str = "RUNWAY"
    heading: float | None = 90.0
    width: float | None = 45.0
    length: float | None = 1000.0
    geometry: str = ""

    def __post_init__(self):
        """build a default ~1000 m east-west centerline at 290 m MSL."""
        if not self.geometry:
            end_lon, _ = point_at_distance(18.0, 49.0, 90.0, self.length or 1000.0)
            self.geometry = f"LINESTRING Z (18.0 49.0 290, {end_lon} 49.0 290)"


@dataclass
class FakeInspection:
    """minimal inspection stub for the dispatch path."""

    id: object = None
    method: InspectionMethod = InspectionMethod.SURFACE_SCAN
    config: object = None

    def __post_init__(self):
        """set a default id."""
        if self.id is None:
            self.id = uuid4()


def _cfg(**kw) -> ResolvedConfig:
    """build a ResolvedConfig with surface-scan defaults applied."""
    cfg = ResolvedConfig()
    cfg.capture_mode = kw.pop("capture_mode", "VIDEO_CAPTURE")
    cfg.altitude_offset = kw.pop("altitude_offset", 0.0)
    for k, v in kw.items():
        setattr(cfg, k, v)
    return cfg


class TestFootprintAndRunCount:
    """FOV footprint formula and auto vs. override run counts."""

    def test_footprint_formula(self):
        """footprint = 2 * (h / cos(theta)) * tan(HFOV/2)."""
        fp = compute_scan_footprint(10.0, -70.0, 80.0)
        theta = math.radians(20.0)
        expected = 2.0 * (10.0 / math.cos(theta)) * math.tan(math.radians(40.0))
        assert fp == pytest.approx(expected, rel=1e-6)

    def test_footprint_none_without_fov(self):
        """no sensor FOV means no derivable footprint."""
        assert compute_scan_footprint(10.0, -70.0, None) is None

    def test_auto_run_count_from_fov(self):
        """auto run count tiles the footprint across the band width."""
        surface = FakeSurface(width=45.0)
        plan = plan_surface_scan(surface, _cfg(), sensor_fov=80.0)
        fp = compute_scan_footprint(10.0, -70.0, 80.0)
        expected = math.ceil(45.0 / (fp * 0.8))
        assert plan.n_runs == expected
        assert plan.optimal_runs == expected

    def test_override_run_count_wins(self):
        """an explicit run count overrides the auto value."""
        surface = FakeSurface(width=45.0)
        plan = plan_surface_scan(surface, _cfg(scan_run_count=7), sensor_fov=80.0)
        assert plan.n_runs == 7
        # optimal is still computed for the suggestion comparison
        assert plan.optimal_runs is not None and plan.optimal_runs != 7

    def test_missing_fov_with_no_override_raises(self):
        """no FOV and no run count cannot auto-derive - clear error."""
        with pytest.raises(ValueError, match="sensor_fov|sensor FOV"):
            plan_surface_scan(FakeSurface(), _cfg(), sensor_fov=None)

    def test_missing_fov_with_override_ok(self):
        """an explicit run count rescues the missing-FOV case."""
        plan = plan_surface_scan(FakeSurface(), _cfg(scan_run_count=4), sensor_fov=None)
        assert plan.n_runs == 4
        assert plan.footprint is None

    def test_sidelap_increases_run_count(self):
        """higher sidelap packs more runs into the same width."""
        surface = FakeSurface(width=45.0)
        low = plan_surface_scan(surface, _cfg(scan_sidelap_percent=0), sensor_fov=80.0)
        high = plan_surface_scan(surface, _cfg(scan_sidelap_percent=60), sensor_fov=80.0)
        assert high.n_runs > low.n_runs


class TestDefaultsAndWaypoints:
    """defaults (10 m, -70 deg) and the serpentine waypoint shape."""

    def test_defaults_applied(self):
        """scan height and gimbal default to 10 m / -70 deg."""
        plan = plan_surface_scan(FakeSurface(), _cfg(), sensor_fov=80.0)
        assert plan.scan_height == DEFAULT_SURFACE_SCAN_HEIGHT
        assert plan.gimbal == DEFAULT_SURFACE_SCAN_GIMBAL

    def test_video_two_waypoints_per_run(self):
        """video keeps just the run endpoints, two per run."""
        surface = FakeSurface()
        plan = plan_surface_scan(surface, _cfg(capture_mode="VIDEO_CAPTURE"), sensor_fov=80.0)
        wps = calculate_surface_scan_path(surface, _cfg(), None, 3.0, sensor_fov=80.0)
        assert len(wps) == plan.n_runs * 2

    def test_altitude_is_surface_plus_height(self):
        """waypoint altitude = surface elevation + scan height + offset."""
        wps = calculate_surface_scan_path(
            FakeSurface(), _cfg(altitude_offset=2.0), None, 3.0, sensor_fov=80.0
        )
        assert wps[0].alt == pytest.approx(290.0 + 10.0 + 2.0)

    def test_gimbal_and_target_set(self):
        """every waypoint carries the fixed gimbal pitch and an imaged target."""
        wps = calculate_surface_scan_path(FakeSurface(), _cfg(), None, 3.0, sensor_fov=80.0)
        assert all(wp.gimbal_pitch == DEFAULT_SURFACE_SCAN_GIMBAL for wp in wps)
        assert all(wp.camera_target is not None for wp in wps)
        assert all(wp.waypoint_type == WaypointType.MEASUREMENT for wp in wps)

    def test_serpentine_alternates_heading(self):
        """consecutive runs sweep in opposite directions."""
        surface = FakeSurface(heading=90.0)
        wps = calculate_surface_scan_path(
            surface, _cfg(scan_run_count=2), None, 3.0, sensor_fov=80.0
        )
        # run 0 endpoints share heading; run 1 is reciprocal
        run0_heading = wps[0].heading
        run1_heading = wps[2].heading
        assert abs(((run0_heading - run1_heading) % 360) - 180) < 1.0


class TestLengthModes:
    """FULL / MAX_LENGTH / INTERVAL along-track windows."""

    def test_full_spans_whole_length(self):
        """FULL covers [0, length]."""
        plan = plan_surface_scan(FakeSurface(length=1000.0), _cfg(), sensor_fov=80.0)
        assert plan.length_from == pytest.approx(0.0)
        assert plan.length_to == pytest.approx(plan.total_length, abs=1.0)

    def test_max_length_caps_far_end(self):
        """MAX_LENGTH scans [0, scan_length_to]."""
        plan = plan_surface_scan(
            FakeSurface(),
            _cfg(scan_length_mode="MAX_LENGTH", scan_length_to=400.0),
            sensor_fov=80.0,
        )
        assert plan.length_from == pytest.approx(0.0)
        assert plan.length_to == pytest.approx(400.0)

    def test_interval_trims_both_ends(self):
        """INTERVAL scans [from, to]."""
        plan = plan_surface_scan(
            FakeSurface(),
            _cfg(scan_length_mode="INTERVAL", scan_length_from=200.0, scan_length_to=600.0),
            sensor_fov=80.0,
        )
        assert plan.length_from == pytest.approx(200.0)
        assert plan.length_to == pytest.approx(600.0)

    def test_interval_clamped_to_length(self):
        """an interval past the surface end is clamped."""
        plan = plan_surface_scan(
            FakeSurface(length=1000.0),
            _cfg(scan_length_mode="INTERVAL", scan_length_from=100.0, scan_length_to=9999.0),
            sensor_fov=80.0,
        )
        assert plan.length_to <= plan.total_length + 1.0


class TestLengthAnchor:
    """THRESHOLD / ENDPOINT anchor reflects the along-track window."""

    def test_threshold_max_length_unchanged(self):
        """null anchor == THRESHOLD: MAX_LENGTH stays [0, to] byte-for-byte."""
        plan = plan_surface_scan(
            FakeSurface(),
            _cfg(scan_length_mode="MAX_LENGTH", scan_length_to=400.0),
            sensor_fov=80.0,
        )
        assert plan.length_from == pytest.approx(0.0)
        assert plan.length_to == pytest.approx(400.0)

    def test_endpoint_max_length(self):
        """ENDPOINT reflects MAX_LENGTH [0, 400] -> [total - 400, total]."""
        plan = plan_surface_scan(
            FakeSurface(),
            _cfg(
                scan_length_mode="MAX_LENGTH",
                scan_length_to=400.0,
                scan_length_anchor="ENDPOINT",
            ),
            sensor_fov=80.0,
        )
        assert plan.length_from == pytest.approx(plan.total_length - 400.0, abs=1.0)
        assert plan.length_to == pytest.approx(plan.total_length, abs=1.0)

    def test_endpoint_interval(self):
        """ENDPOINT reflects INTERVAL [200, 600] -> [total - 600, total - 200]."""
        plan = plan_surface_scan(
            FakeSurface(),
            _cfg(
                scan_length_mode="INTERVAL",
                scan_length_from=200.0,
                scan_length_to=600.0,
                scan_length_anchor="ENDPOINT",
            ),
            sensor_fov=80.0,
        )
        assert plan.length_from == pytest.approx(plan.total_length - 600.0, abs=1.0)
        assert plan.length_to == pytest.approx(plan.total_length - 200.0, abs=1.0)

    def test_explicit_threshold_interval_matches_default(self):
        """explicit THRESHOLD equals the null-anchor result."""
        kw = dict(scan_length_mode="INTERVAL", scan_length_from=200.0, scan_length_to=600.0)
        default = plan_surface_scan(FakeSurface(), _cfg(**kw), sensor_fov=80.0)
        explicit = plan_surface_scan(
            FakeSurface(), _cfg(scan_length_anchor="THRESHOLD", **kw), sensor_fov=80.0
        )
        assert explicit.length_from == pytest.approx(default.length_from)
        assert explicit.length_to == pytest.approx(default.length_to)

    def test_full_mode_anchor_invariant(self):
        """FULL spans [0, total] regardless of anchor (reflects to itself)."""
        plan = plan_surface_scan(
            FakeSurface(), _cfg(scan_length_anchor="ENDPOINT"), sensor_fov=80.0
        )
        assert plan.length_from == pytest.approx(0.0)
        assert plan.length_to == pytest.approx(plan.total_length, abs=1.0)

    @pytest.mark.parametrize("anchor", ["THRESHOLD", "ENDPOINT"])
    def test_anchor_direction_orthogonal(self, anchor):
        """direction only reorders the imaged strip; the anchor moves where it sits.

        the waypoints themselves carry a fly-over back-offset whose direction
        flips with the run heading, so the imaged camera_target points - not the
        offset waypoints - are the direction-invariant quantity to compare.
        """
        surface = FakeSurface()

        def imaged(rev):
            """waypoints + rounded imaged-target set for one direction at this anchor."""
            wps = calculate_surface_scan_path(
                surface,
                _cfg(
                    scan_length_mode="MAX_LENGTH",
                    scan_length_to=400.0,
                    scan_length_anchor=anchor,
                    direction_reversed=rev,
                ),
                None,
                3.0,
                sensor_fov=80.0,
            )
            targets = {(round(w.camera_target.lon, 6), round(w.camera_target.lat, 6)) for w in wps}
            return wps, targets

        natural_wps, natural_set = imaged(False)
        reversed_wps, reversed_set = imaged(True)
        # direction only reorders: the imaged strip is identical
        assert natural_set == reversed_set
        # but the traversal start flips to the opposite end of the run
        first_nat = (round(natural_wps[0].camera_target.lon, 6),)
        first_rev = (round(reversed_wps[0].camera_target.lon, 6),)
        assert first_nat != first_rev

    def test_threshold_and_endpoint_sit_at_opposite_ends(self):
        """the THRESHOLD window and the ENDPOINT window image disjoint positions."""
        surface = FakeSurface()

        def imaged_set(anchor):
            """rounded along-track imaged-target longitudes for an anchor."""
            wps = calculate_surface_scan_path(
                surface,
                _cfg(
                    scan_length_mode="MAX_LENGTH",
                    scan_length_to=400.0,
                    scan_length_anchor=anchor,
                ),
                None,
                3.0,
                sensor_fov=80.0,
            )
            return {round(w.camera_target.lon, 5) for w in wps}

        assert imaged_set("THRESHOLD").isdisjoint(imaged_set("ENDPOINT"))


class TestWidthAndSide:
    """width band + LEFT/RIGHT side selection."""

    def test_full_width_centered(self):
        """no scan_width centers the band on the centerline."""
        plan = plan_surface_scan(FakeSurface(width=45.0), _cfg(), sensor_fov=80.0)
        assert plan.near_edge == pytest.approx(-22.5)
        assert plan.far_edge == pytest.approx(22.5)

    def test_right_side_band(self):
        """RIGHT places the band on the +perp side of the centerline."""
        plan = plan_surface_scan(
            FakeSurface(), _cfg(scan_width=20.0, scan_width_side="RIGHT"), sensor_fov=80.0
        )
        assert plan.near_edge == pytest.approx(0.0)
        assert plan.far_edge == pytest.approx(20.0)

    def test_left_side_band(self):
        """LEFT places the band on the -perp side of the centerline."""
        plan = plan_surface_scan(
            FakeSurface(), _cfg(scan_width=20.0, scan_width_side="LEFT"), sensor_fov=80.0
        )
        assert plan.near_edge == pytest.approx(0.0)
        assert plan.far_edge == pytest.approx(-20.0)

    def test_left_right_imaged_on_opposite_sides(self):
        """LEFT and RIGHT single runs image opposite sides of the centerline."""
        right = calculate_surface_scan_path(
            FakeSurface(),
            _cfg(scan_width=20.0, scan_width_side="RIGHT", scan_run_count=1),
            None,
            3.0,
            sensor_fov=80.0,
        )
        left = calculate_surface_scan_path(
            FakeSurface(),
            _cfg(scan_width=20.0, scan_width_side="LEFT", scan_run_count=1),
            None,
            3.0,
            sensor_fov=80.0,
        )
        # axis is east (90 deg), so RIGHT (perp +90 = south) images lat < 49,
        # LEFT (north) images lat > 49 - the two land on opposite sides.
        assert right[0].camera_target.lat < 49.0
        assert left[0].camera_target.lat > 49.0
        assert right[0].camera_target.lat != pytest.approx(left[0].camera_target.lat)


class TestSingleRunCenterline:
    """full width with one run flies the centerline (strip-centered rule)."""

    def test_single_full_width_run_on_centerline(self):
        """a single full-width run images the centerline."""
        wps = calculate_surface_scan_path(
            FakeSurface(), _cfg(scan_run_count=1), None, 3.0, sensor_fov=80.0
        )
        assert all(wp.camera_target.lat == pytest.approx(49.0, abs=1e-6) for wp in wps)


class TestOrientations:
    """both run orientations produce valid snakes."""

    def test_length_wise_runs_along_axis(self):
        """LENGTH_WISE runs head along the axis bearing."""
        wps = calculate_surface_scan_path(
            FakeSurface(heading=90.0),
            _cfg(scan_run_orientation="LENGTH_WISE", scan_run_count=2),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert wps[0].heading == pytest.approx(90.0, abs=1.0)

    def test_width_wise_runs_across_axis(self):
        """WIDTH_WISE runs head perpendicular to the axis bearing."""
        plan = plan_surface_scan(
            FakeSurface(heading=90.0),
            _cfg(scan_run_orientation="WIDTH_WISE"),
            sensor_fov=80.0,
        )
        wps = calculate_surface_scan_path(
            FakeSurface(heading=90.0),
            _cfg(scan_run_orientation="WIDTH_WISE"),
            None,
            3.0,
            sensor_fov=80.0,
        )
        # perpendicular to 90 deg is 0/180
        assert wps[0].heading in (pytest.approx(0.0, abs=1.0), pytest.approx(180.0, abs=1.0))
        # width-wise tiles along the length, so run count scales with length
        assert plan.step_span == pytest.approx(plan.total_length, abs=1.0)


class TestDirectionReversed:
    """REVERSED starts the snake from the opposite end."""

    def test_reversed_flips_first_run_direction(self):
        """REVERSED run 0 heads the opposite way along the axis."""
        natural = calculate_surface_scan_path(
            FakeSurface(heading=90.0),
            _cfg(scan_run_count=2, direction_reversed=False),
            None,
            3.0,
            sensor_fov=80.0,
        )
        reversed_ = calculate_surface_scan_path(
            FakeSurface(heading=90.0),
            _cfg(scan_run_count=2, direction_reversed=True),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert abs(((natural[0].heading - reversed_[0].heading) % 360) - 180) < 1.0


class TestCaptureModes:
    """PHOTO spacing vs. VIDEO bookends."""

    def test_photo_emits_spaced_capture_waypoints(self):
        """PHOTO tiles capture points by the footprint forward spacing."""
        surface = FakeSurface(length=1000.0)
        plan = plan_surface_scan(surface, _cfg(capture_mode="PHOTO_CAPTURE"), sensor_fov=80.0)
        wps = calculate_surface_scan_path(
            surface, _cfg(capture_mode="PHOTO_CAPTURE"), None, 3.0, sensor_fov=80.0
        )
        # more than two per run, all PHOTO_CAPTURE
        assert len(wps) > plan.n_runs * 2
        assert all(wp.camera_action == CameraAction.PHOTO_CAPTURE for wp in wps)

    def test_video_wraps_recording_bookends(self):
        """VIDEO mode (via compute_measurement_trajectory) wraps recording start/stop."""
        insp = FakeInspection()
        surface = FakeSurface()
        wps = dispatch_trajectory(
            insp,
            _cfg(capture_mode="VIDEO_CAPTURE"),
            Point3D(18.0, 49.0, 290.0),
            90.0,
            3.0,
            3.0,
            [],
            scan_surface=surface,
            sensor_fov=80.0,
        )
        assert wps[0].camera_action == CameraAction.RECORDING_START
        assert wps[-1].camera_action == CameraAction.RECORDING_STOP


class TestFrontlap:
    """along-track forward-overlap knob (scan_frontlap_percent)."""

    def test_default_frontlap_spacing_is_footprint(self):
        """frontlap defaults to 0, so along-track spacing equals the footprint."""
        plan = plan_surface_scan(FakeSurface(), _cfg(), sensor_fov=80.0)
        assert plan.along_spacing == pytest.approx(plan.footprint)

    def test_frontlap_zero_matches_footprint_spacing(self):
        """an explicit 0% frontlap reproduces the default footprint-spaced tiling."""
        surface = FakeSurface(length=1000.0)
        default_wps = calculate_surface_scan_path(
            surface, _cfg(capture_mode="PHOTO_CAPTURE"), None, 3.0, sensor_fov=80.0
        )
        zero_wps = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="PHOTO_CAPTURE", scan_frontlap_percent=0),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert len(zero_wps) == len(default_wps)

    def test_frontlap_increases_along_track_density(self):
        """75% frontlap quarters the spacing, so a run packs ~4x the photo samples."""
        surface = FakeSurface(length=1000.0)
        low = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="PHOTO_CAPTURE", scan_run_count=1, scan_frontlap_percent=0),
            None,
            3.0,
            sensor_fov=80.0,
        )
        high = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="PHOTO_CAPTURE", scan_run_count=1, scan_frontlap_percent=75),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert len(high) > 3 * len(low)

    def test_sample_spacing_equals_footprint_times_frontlap(self):
        """consecutive photo samples sit ~footprint*(1-frontlap/100) apart."""
        surface = FakeSurface(length=1000.0)
        plan = plan_surface_scan(
            surface, _cfg(scan_run_count=1, scan_frontlap_percent=60), sensor_fov=80.0
        )
        assert plan.along_spacing == pytest.approx(plan.footprint * 0.4)
        wps = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="PHOTO_CAPTURE", scan_run_count=1, scan_frontlap_percent=60),
            None,
            3.0,
            sensor_fov=80.0,
        )
        a, b = wps[0].camera_target, wps[1].camera_target
        dist = distance_between(a.lon, a.lat, b.lon, b.lat)
        assert dist == pytest.approx(plan.along_spacing, rel=0.05)

    def test_high_frontlap_bounded_no_overflow(self):
        """80% frontlap stays finite: spacing > 0 and a bounded sample count."""
        surface = FakeSurface(length=1000.0)
        plan = plan_surface_scan(
            surface, _cfg(scan_run_count=1, scan_frontlap_percent=80), sensor_fov=80.0
        )
        assert plan.along_spacing is not None and plan.along_spacing > 0
        wps = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="PHOTO_CAPTURE", scan_run_count=1, scan_frontlap_percent=80),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert 0 < len(wps) < 2000

    def test_video_ignores_frontlap(self):
        """video keeps two waypoints per run regardless of frontlap."""
        surface = FakeSurface()
        plan = plan_surface_scan(
            surface,
            _cfg(capture_mode="VIDEO_CAPTURE", scan_frontlap_percent=75),
            sensor_fov=80.0,
        )
        wps = calculate_surface_scan_path(
            surface,
            _cfg(capture_mode="VIDEO_CAPTURE", scan_frontlap_percent=75),
            None,
            3.0,
            sensor_fov=80.0,
        )
        assert len(wps) == plan.n_runs * 2

    def test_frontlap_does_not_change_run_count(self):
        """frontlap is along-track only - the run count (sidelap axis) is invariant."""
        surface = FakeSurface(width=45.0)
        base = plan_surface_scan(surface, _cfg(scan_frontlap_percent=0), sensor_fov=80.0)
        high = plan_surface_scan(surface, _cfg(scan_frontlap_percent=80), sensor_fov=80.0)
        assert high.n_runs == base.n_runs
        assert high.optimal_runs == base.optimal_runs


class TestTerrainFollowing:
    """terrain-following preserves the commanded AGL."""

    def test_terrain_delta_preserves_agl(self):
        """a terrain bump shifts the waypoint by the same delta."""

        class Provider:
            """elevation provider that returns surface ground + 5 m everywhere."""

            def get_elevations_batch(self, points):
                """uniform +5 m terrain over the surface reference (290)."""
                return [295.0] * len(points)

        wps = calculate_surface_scan_path(
            FakeSurface(), _cfg(), None, 3.0, sensor_fov=80.0, elevation_provider=Provider()
        )
        # base 290 + 10 = 300; terrain delta +5 -> 305 (AGL still 10 above 295)
        assert wps[0].alt == pytest.approx(305.0)


class TestPathDistanceAndAxis:
    """snake length estimate and the axis/heading derivation (#834)."""

    def test_path_distance_grows_with_runs(self):
        """more runs means a longer flown snake."""
        few = plan_surface_scan(FakeSurface(), _cfg(scan_run_count=2), sensor_fov=80.0)
        many = plan_surface_scan(FakeSurface(), _cfg(scan_run_count=6), sensor_fov=80.0)
        assert scan_path_distance(many) > scan_path_distance(few)

    def test_taxiway_uses_derived_heading(self):
        """a taxiway scan resolves its axis from the surface heading (#834)."""
        taxiway = FakeSurface(identifier="A", surface_type="TAXIWAY", heading=45.0, width=20.0)
        plan = plan_surface_scan(taxiway, _cfg(), sensor_fov=80.0)
        assert plan.axis == pytest.approx(45.0)

    def test_axis_falls_back_to_centerline_bearing(self):
        """with no surface heading, the axis is the centerline first-to-last bearing."""
        surface = FakeSurface(heading=None)
        plan = plan_surface_scan(surface, _cfg(), sensor_fov=80.0)
        assert plan.axis == pytest.approx(90.0, abs=1.0)

    def test_reciprocal_heading_walks_centerline_reversed(self):
        """a reciprocal surface heading flips the walked origin (no-op endpoints)."""
        # centerline runs west->east (bearing 90); heading set to 270 (reciprocal)
        surface = FakeSurface(heading=270.0)
        plan = plan_surface_scan(surface, _cfg(), sensor_fov=80.0)
        # origin becomes the east end after the reversal
        assert plan.origin.lon > 18.0


class TestGimbalGuard:
    """near-horizontal gimbal is rejected."""

    def test_horizontal_gimbal_rejected(self):
        """a gimbal above the tilt floor cannot frame the pavement."""
        with pytest.raises(ValueError, match="gimbal"):
            calculate_surface_scan_path(
                FakeSurface(), _cfg(camera_gimbal_angle=0.0), None, 3.0, sensor_fov=80.0
            )
