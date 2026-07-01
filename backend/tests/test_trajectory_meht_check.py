"""unit tests for meht-check trajectory generation."""

import math
from dataclasses import dataclass, field
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.services.trajectory.helpers import _apply_camera_actions, resolve_meht_height
from app.services.trajectory.methods.meht_check import calculate_meht_check_path
from app.services.trajectory.types import (
    DEFAULT_MEHT_HOVER_DURATION,
    Point3D,
    ResolvedConfig,
    WaypointData,
)
from app.utils.geo import bearing_between
from tests.method_dispatch import dispatch_trajectory, make_context


@dataclass
class FakeInspection:
    """minimal inspection stub."""

    id: object = None
    method: InspectionMethod = InspectionMethod.MEHT_CHECK
    config: object = None
    sequence_order: int = 1

    def __post_init__(self):
        """set default id."""
        if self.id is None:
            self.id = uuid4()


# meht point calculation


class TestMehtPointCalculation:
    """tests for MEHT height formula."""

    def test_standard_3deg_glide_slope(self):
        """3 deg glide slope at 300m distance gives ~15.7m height."""
        distance = 300.0
        glide_slope = 3.0
        height = distance * math.tan(math.radians(glide_slope))
        assert abs(height - 15.72) < 0.1

    def test_steeper_glide_slope(self):
        """steeper angle produces higher MEHT."""
        distance = 300.0
        h3 = distance * math.tan(math.radians(3.0))
        h4 = distance * math.tan(math.radians(4.0))
        assert h4 > h3

    def test_zero_distance_gives_zero_height(self):
        """zero distance from threshold means zero MEHT height."""
        height = 0.0 * math.tan(math.radians(3.0))
        assert height == 0.0


# trajectory generation


class TestMehtCheckPath:
    """tests for meht-check trajectory generator."""

    def test_single_hover_waypoint(self):
        """produces exactly one hover waypoint."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert len(wps) == 1
        assert wps[0].waypoint_type == WaypointType.HOVER

    def test_default_hover_duration(self):
        """uses default meht hover duration when config has none."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].hover_duration == DEFAULT_MEHT_HOVER_DURATION

    def test_custom_hover_duration(self):
        """config hover_duration overrides default."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig(hover_duration=20.0)
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].hover_duration == 20.0

    def test_position_matches_meht_point(self):
        """waypoint position is exactly the meht point."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].lon == meht.lon
        assert wps[0].lat == meht.lat
        assert wps[0].alt == meht.alt

    def test_heading_toward_lha_center(self):
        """drone heading points from meht toward the PAPI lha center."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        # lha center is east of meht
        lha_center = Point3D(lon=14.265, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        expected = bearing_between(meht.lon, meht.lat, lha_center.lon, lha_center.lat)
        assert abs(wps[0].heading - expected) < 1.0

    def test_gimbal_pitch_computed(self):
        """gimbal pitch is computed from meht point to lha center."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        # meht is above lha center, so gimbal should be negative (looking down)
        assert wps[0].gimbal_pitch is not None
        assert wps[0].gimbal_pitch < 0

    def test_gimbal_override(self):
        """config camera_gimbal_angle overrides computed pitch."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig(camera_gimbal_angle=-45.0)
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].gimbal_pitch == -45.0

    def test_camera_target_is_lha_center(self):
        """camera target is set to lha center."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig()
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].camera_target == lha_center

    def test_photo_mode(self):
        """photo capture mode emits PHOTO_CAPTURE camera action."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig(capture_mode="PHOTO_CAPTURE")
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].camera_action == CameraAction.PHOTO_CAPTURE

    def test_video_mode(self):
        """video capture mode emits RECORDING camera action."""
        meht = Point3D(lon=14.26, lat=50.1, alt=395.0)
        lha_center = Point3D(lon=14.263, lat=50.1, alt=380.0)
        cfg = ResolvedConfig(capture_mode="VIDEO_CAPTURE")
        wps = calculate_meht_check_path(meht, lha_center, cfg, uuid4(), speed=0.0)
        assert wps[0].camera_action == CameraAction.RECORDING

    def test_dispatch_requires_target(self):
        """dispatcher rejects meht-check without a computed meht position."""
        insp = FakeInspection(method=InspectionMethod.MEHT_CHECK)
        cfg = ResolvedConfig()
        with pytest.raises(ValueError):
            dispatch_trajectory(
                insp,
                cfg,
                center=Point3D(lon=14.26, lat=50.1, alt=380.0),
                runway_heading=0.0,
                glide_slope=3.0,
                speed=0.0,
                setting_angles=[],
                target_lha_position=None,
                target_agl_type="PAPI",
            )


# prepare step


@dataclass
class FakeAgl:
    """minimal AGL stub for prepare tests."""

    surface_id: object = None
    distance_from_threshold: float | None = 300.0
    meht_height_m: float | None = None

    def __post_init__(self):
        """set default surface_id."""
        if self.surface_id is None:
            self.surface_id = uuid4()


@dataclass
class FakeSurface:
    """minimal surface stub for prepare tests."""

    id: object = None
    heading: float | None = None
    threshold_position: object = None

    def __post_init__(self):
        """set default id."""
        if self.id is None:
            self.id = uuid4()


@dataclass
class FakeTemplate:
    """minimal template stub for prepare tests."""

    targets: list = field(default_factory=list)
    name: str = "MEHT Check"


class TestPrepareMehtCheck:
    """tests for _prepare_meht_check over-threshold positioning."""

    @patch("app.services.trajectory.methods._prepare.get_threshold_position")
    def test_meht_point_over_threshold(self, mock_threshold):
        """meht point sits directly over the threshold lat/lon (on centerline)."""
        from app.services.trajectory.methods import _prepare_meht_check

        threshold = Point3D(lon=14.26, lat=50.1, alt=380.0)
        mock_threshold.return_value = threshold

        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=300.0)
        surface = FakeSurface(id=surface_id, heading=90.0)
        template = FakeTemplate(targets=[agl])

        result = _prepare_meht_check(
            make_context(
                FakeInspection(),
                ResolvedConfig(),
                center=Point3D(lon=14.26, lat=50.1, alt=380.0),
                runway_heading=90.0,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[surface],
            )
        )

        pos = result.target_lha_pos
        assert pos is not None
        assert pos.lon == threshold.lon
        assert pos.lat == threshold.lat

    @patch("app.services.trajectory.methods._prepare.get_threshold_position")
    def test_meht_point_altitude_correct(self, mock_threshold):
        """altitude = threshold alt + derived meht height + altitude offset."""
        from app.services.trajectory.methods import _prepare_meht_check

        threshold = Point3D(lon=14.26, lat=50.1, alt=380.0)
        mock_threshold.return_value = threshold

        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=300.0)
        template = FakeTemplate(targets=[agl])

        config = ResolvedConfig(altitude_offset=5.0)
        result = _prepare_meht_check(
            make_context(
                FakeInspection(),
                config,
                center=Point3D(lon=14.26, lat=50.1, alt=380.0),
                runway_heading=90.0,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[FakeSurface(id=surface_id)],
            )
        )

        expected_height = 300.0 * math.tan(math.radians(3.0))
        expected_alt = 380.0 + expected_height + 5.0
        assert abs(result.target_lha_pos.alt - expected_alt) < 0.01

    @patch("app.services.trajectory.methods._prepare.get_threshold_position")
    def test_surveyed_height_overrides_derived(self, mock_threshold):
        """a surveyed meht_height_m sets the hover altitude, ignoring distance*tan."""
        from app.services.trajectory.methods import _prepare_meht_check

        threshold = Point3D(lon=14.26, lat=50.1, alt=380.0)
        mock_threshold.return_value = threshold

        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=300.0, meht_height_m=18.0)
        template = FakeTemplate(targets=[agl])

        config = ResolvedConfig(altitude_offset=2.0)
        result = _prepare_meht_check(
            make_context(
                FakeInspection(),
                config,
                center=Point3D(lon=14.26, lat=50.1, alt=380.0),
                runway_heading=90.0,
                glide_slope=3.0,
                default_speed=5.0,
                template=template,
                surfaces=[FakeSurface(id=surface_id)],
            )
        )

        # surveyed 18 m wins over the derived 300*tan(3) ~= 15.7 m
        assert result.target_lha_pos.alt == pytest.approx(380.0 + 18.0 + 2.0)

    @patch("app.services.trajectory.methods._prepare.get_threshold_position")
    def test_missing_height_raises(self, mock_threshold):
        """no surveyed height and no distance raises a clear validation error."""
        from app.core.exceptions import TrajectoryGenerationError
        from app.services.trajectory.methods import _prepare_meht_check

        mock_threshold.return_value = Point3D(lon=14.26, lat=50.1, alt=380.0)

        surface_id = uuid4()
        agl = FakeAgl(surface_id=surface_id, distance_from_threshold=None, meht_height_m=None)
        template = FakeTemplate(targets=[agl])

        with pytest.raises(TrajectoryGenerationError, match="meht_height_m"):
            _prepare_meht_check(
                make_context(
                    FakeInspection(),
                    ResolvedConfig(),
                    center=Point3D(lon=14.26, lat=50.1, alt=380.0),
                    runway_heading=90.0,
                    glide_slope=3.0,
                    default_speed=5.0,
                    template=template,
                    surfaces=[FakeSurface(id=surface_id)],
                )
            )


class TestResolveMehtHeight:
    """tests for the shared surveyed-else-derived meht-height resolver."""

    def test_surveyed_value_returned_verbatim(self):
        """meht_height_m wins over the derived formula when set."""
        agl = FakeAgl(distance_from_threshold=300.0, meht_height_m=18.0)
        assert resolve_meht_height(agl, 3.0) == 18.0

    def test_derived_when_only_distance_set(self):
        """falls back to distance * tan(glide_slope) when meht_height_m is null."""
        agl = FakeAgl(distance_from_threshold=300.0, meht_height_m=None)
        expected = 300.0 * math.tan(math.radians(3.0))
        assert resolve_meht_height(agl, 3.0) == pytest.approx(expected)

    def test_none_when_neither_set(self):
        """returns None when neither surveyed height nor distance is available."""
        agl = FakeAgl(distance_from_threshold=None, meht_height_m=None)
        assert resolve_meht_height(agl, 3.0) is None


class TestApplyCameraActionsHoverGuard:
    """the terminal HOVER capture survives _apply_camera_actions."""

    def _wp(self, wtype, action):
        """build a minimal waypoint of the given type and camera action."""
        return WaypointData(
            lon=14.26,
            lat=50.1,
            alt=395.0,
            heading=0.0,
            speed=5.0,
            waypoint_type=wtype,
            camera_action=action,
            camera_target=None,
            inspection_id=uuid4(),
            hover_duration=None,
            gimbal_pitch=0.0,
        )

    def test_terminal_hover_capture_preserved(self):
        """a MEASUREMENT, MEASUREMENT, HOVER(PHOTO_CAPTURE) list keeps the hover capture."""
        wps = [
            self._wp(WaypointType.MEASUREMENT, CameraAction.PHOTO_CAPTURE),
            self._wp(WaypointType.MEASUREMENT, CameraAction.PHOTO_CAPTURE),
            self._wp(WaypointType.HOVER, CameraAction.PHOTO_CAPTURE),
        ]
        _apply_camera_actions(wps)
        # the lead-in measurement is blanked, the terminal hover keeps its capture
        assert wps[0].camera_action == CameraAction.NONE
        assert wps[-1].camera_action == CameraAction.PHOTO_CAPTURE


# update_agl autocompute branch


class TestUpdateAglAutocomputeNoneGuard:
    """tests for the None guard on agl.position in update_agl's autocompute branch."""

    def test_update_agl_no_crash_when_position_and_distance_are_none(self):
        """update must not raise AttributeError when position is None and distance is None."""
        from unittest.mock import MagicMock

        from app.models.agl import AGL
        from app.models.airport import AirfieldSurface, Airport
        from app.schemas.infrastructure import AGLUpdate
        from app.services.airport_service import update_agl

        airport_id = uuid4()
        surface_id = uuid4()
        agl_id = uuid4()

        airport = Airport(id=airport_id, icao_code="LZAB", name="Test")
        surface = AirfieldSurface(
            id=surface_id, airport_id=airport_id, surface_type="RUNWAY", identifier="RWY"
        )
        agl = AGL(
            id=agl_id,
            surface_id=surface_id,
            agl_type="PAPI",
            name="PAPI RWY",
            position=None,
            distance_from_threshold=None,
        )

        # db.query(...).filter(...).first() returns surface -> agl -> airport in order
        results = [surface, agl, airport]
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = results

        schema = AGLUpdate(name="updated")

        # before the fix this raised AttributeError from agl.position.data on None
        result = update_agl(db, airport_id, surface_id, agl_id, schema)

        assert result is agl
        # autocompute must have been skipped, leaving distance_from_threshold untouched
        assert agl.distance_from_threshold is None
