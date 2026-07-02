"""unit tests for the RUNWAY_HORIZONTAL_RANGE method - REL arc around the touchpoint."""

import math
from dataclasses import dataclass
from uuid import uuid4

from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.services.trajectory.methods._dispatch import _runway_horizontal_range_handler
from app.services.trajectory.methods.horizontal_range import calculate_arc_path
from app.services.trajectory.types import (
    DEFAULT_RUNWAY_HORIZONTAL_RANGE_HEIGHT,
    MethodContext,
    MethodPrep,
    Point3D,
    ResolvedConfig,
)
from app.utils.geo import distance_between, elevation_angle


@dataclass
class FakeInspection:
    """minimal inspection stub carrying an id + method."""

    id: object = None
    method: InspectionMethod = InspectionMethod.RUNWAY_HORIZONTAL_RANGE
    config: object = None

    def __post_init__(self):
        """default the id."""
        if self.id is None:
            self.id = uuid4()


def _touchpoint() -> Point3D:
    """runway touchpoint used as the arc center."""
    return Point3D(lon=14.274, lat=50.098, alt=380.0)


def _config(**kw) -> ResolvedConfig:
    """resolved config with photo capture so no video hover wrap is applied."""
    base = dict(
        measurement_density=8,
        horizontal_distance=350.0,
        sweep_angle=15.0,
        height_above_lights=20.0,
        altitude_offset=5.0,
        capture_mode="PHOTO_CAPTURE",
    )
    base.update(kw)
    return ResolvedConfig(**base)


def _handler(config: ResolvedConfig, center: Point3D):
    """run the runway-HR handler with a minimal context."""
    ctx = MethodContext(
        inspection=FakeInspection(),
        config=config,
        center=center,
        runway_heading=243.0,
        glide_slope=0.0,
        speed=5.0,
        default_speed=5.0,
        setting_angles=[],
        template=None,
        surfaces=[],
        drone=None,
        elevation_provider=None,
        ordered_lhas=[],
    )
    return _runway_horizontal_range_handler(ctx, MethodPrep())


class TestRunwayHorizontalRangeGenerator:
    """arc geometry, altitude, camera aim, and PAPI-inert behavior."""

    def test_waypoint_count_and_type(self):
        """one measurement waypoint per density point."""
        center = _touchpoint()
        wps = _handler(_config(measurement_density=8), center)
        assert len(wps) == 8
        assert all(wp.waypoint_type == WaypointType.MEASUREMENT for wp in wps)

    def test_constant_altitude_no_glide_term(self):
        """arc altitude = touchpoint.alt + height + offset, constant across the arc."""
        center = _touchpoint()
        wps = _handler(_config(height_above_lights=20.0, altitude_offset=5.0), center)
        for wp in wps:
            assert abs(wp.alt - (center.alt + 20.0 + 5.0)) < 0.01

    def test_camera_aims_at_touchpoint(self):
        """every waypoint targets the touchpoint with a downward gimbal pitch."""
        center = _touchpoint()
        wps = _handler(_config(), center)
        for wp in wps:
            assert wp.camera_target == center
            expected = elevation_angle(wp.lon, wp.lat, wp.alt, center.lon, center.lat, center.alt)
            assert abs(wp.gimbal_pitch - expected) < 0.01
            assert wp.gimbal_pitch < 0

    def test_arc_radius_matches_horizontal_distance(self):
        """each waypoint sits at horizontal_distance from the touchpoint."""
        center = _touchpoint()
        wps = _handler(_config(horizontal_distance=350.0), center)
        for wp in wps:
            radius = distance_between(center.lon, center.lat, wp.lon, wp.lat)
            assert abs(radius - 350.0) < 1.0

    def test_direction_reversed_flips_sweep(self):
        """reversing direction swaps first/last endpoints, altitude unchanged."""
        center = _touchpoint()
        fwd = _handler(_config(), center)
        rev = _handler(_config(direction_reversed=True), center)
        assert abs(fwd[0].lon - rev[-1].lon) < 1e-9
        assert abs(fwd[0].lat - rev[-1].lat) < 1e-9
        assert abs(fwd[0].alt - rev[0].alt) < 0.01

    def test_papi_fields_inert(self):
        """PAPI glide-slope fields do not change the constant-altitude arc."""
        center = _touchpoint()
        baseline = _handler(_config(), center)
        papi = _handler(
            _config(
                angle_offset_above=1.5,
                papi_center_height_reference="LENS",
                papi_center_height_custom_m=3.0,
            ),
            center,
        )
        for a, b in zip(baseline, papi):
            assert abs(a.alt - b.alt) < 1e-9
            assert abs(a.lon - b.lon) < 1e-9
            assert abs(a.lat - b.lat) < 1e-9

    def test_height_default_when_unset(self):
        """a null height_above_lights falls back to the runway-HR default height."""
        center = _touchpoint()
        wps = _handler(_config(height_above_lights=None, altitude_offset=5.0), center)
        for wp in wps:
            expected = center.alt + DEFAULT_RUNWAY_HORIZONTAL_RANGE_HEIGHT + 5.0
            assert abs(wp.alt - expected) < 0.01

    def test_camera_action_photo_in_photo_mode(self):
        """photo capture mode tags each waypoint PHOTO_CAPTURE."""
        center = _touchpoint()
        wps = _handler(_config(capture_mode="PHOTO_CAPTURE"), center)
        assert all(wp.camera_action == CameraAction.PHOTO_CAPTURE for wp in wps)


def test_calculate_arc_path_span_matches_sweep():
    """arc spans approach +/- sweep around the touchpoint."""
    center = _touchpoint()
    config = _config(measurement_density=2, sweep_angle=15.0)
    wps = calculate_arc_path(center, 243.0, 0.0, config, uuid4(), 5.0, height_override=20.0)
    # approach = opposite of runway heading; endpoints sit +/-15 deg around it
    from app.utils.geo import bearing_between

    b0 = bearing_between(center.lon, center.lat, wps[0].lon, wps[0].lat)
    b1 = bearing_between(center.lon, center.lat, wps[-1].lon, wps[-1].lat)
    span = abs((b1 - b0 + 180.0) % 360.0 - 180.0)
    assert abs(span - 30.0) < 0.5
    assert math.isclose(wps[0].alt, wps[-1].alt)
