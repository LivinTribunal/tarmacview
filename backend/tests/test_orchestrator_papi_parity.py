"""generate-vs-revalidate PAPI parity for the shared _papi_band_violations seam.

issue #545 unified the two previously-inline PAPI-band dispatches (one in
_generate_trajectory_inner, one in revalidate_existing_plan) behind a single
helper. these tests pin the helper output against the exact validator call the
old inline branches made, so the two paths provably cannot diverge.

documented revalidate delta: the old revalidate HORIZONTAL_RANGE branch did an
early `continue` when setting angles were missing; the new code instead lets the
shared helper return [] and falls through to an empty remap + a no-op
_format_soft_warnings. the persisted (warnings, violations, suggestions) output
is byte-identical - the test below asserts the empty result explicitly.
"""

import math

from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.services.trajectory.helpers import resolve_vertical_profile_angles
from app.services.trajectory.orchestrator import _papi_band_violations
from app.services.trajectory.safety_validator import (
    validate_papi_angle_band,
    validate_vertical_profile_angle_band,
)
from app.services.trajectory.types import Point3D, ResolvedConfig, WaypointData
from app.utils.geo import elevation_angle, point_at_distance


def _arc(center, radius_m, glide_slope_deg, density=5):
    """synthetic HORIZONTAL_RANGE arc pass at a fixed glide slope."""
    arc_alt = center.alt + radius_m * math.tan(math.radians(glide_slope_deg))
    half_sweep = 7.5
    wps = []
    for i in range(density):
        natural = -half_sweep + (2 * half_sweep / (density - 1)) * i
        lon, lat = point_at_distance(center.lon, center.lat, 180.0 + natural, radius_m)
        pitch = elevation_angle(lon, lat, arc_alt, center.lon, center.lat, center.alt)
        wps.append(
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
    return wps


def _vertical(center, distance_m, elevations_deg):
    """synthetic VERTICAL_PROFILE climb at fixed angles relative to the LHA."""
    lon, lat = point_at_distance(center.lon, center.lat, 180.0, distance_m)
    wps = []
    for elev in elevations_deg:
        alt = center.alt + distance_m * math.tan(math.radians(elev))
        pitch = elevation_angle(lon, lat, alt, center.lon, center.lat, center.alt)
        wps.append(
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
    return wps


def test_hr_helper_matches_old_inline_branch_clean():
    """HR + setting angles: helper == validate_papi_angle_band(wps, center, max(sa)).

    this is the verbatim call both the old generate and old revalidate HR
    branches made, so matching it proves the two paths converge.
    """
    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    wps = _arc(center, radius_m=350.0, glide_slope_deg=3.5)
    setting_angles = [3.0, 2.5]
    config = ResolvedConfig()

    expected = validate_papi_angle_band(wps, center, max(setting_angles))
    got = _papi_band_violations(
        wps, center, setting_angles, config, InspectionMethod.HORIZONTAL_RANGE
    )

    assert got == expected


def test_hr_helper_matches_old_inline_branch_with_violations():
    """HR parity holds when the band actually trips (non-empty violation list)."""
    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    # a measurement far out but barely above the LHA -> tiny elevation angle,
    # well below the 3 deg + tolerance edge, so the band fires.
    lon, lat = point_at_distance(center.lon, center.lat, 180.0, 600.0)
    low = WaypointData(
        lon=lon,
        lat=lat,
        alt=center.alt + 2.0,
        heading=0.0,
        speed=5.0,
        waypoint_type=WaypointType.MEASUREMENT,
        camera_action=CameraAction.PHOTO_CAPTURE,
        camera_target=center,
    )
    setting_angles = [3.0]
    config = ResolvedConfig()

    expected = validate_papi_angle_band([low], center, max(setting_angles))
    got = _papi_band_violations(
        [low], center, setting_angles, config, InspectionMethod.HORIZONTAL_RANGE
    )

    assert expected, "fixture should trip the all-white-zone band"
    assert got == expected


def test_vp_helper_matches_old_inline_branch():
    """VP: helper == validate_vertical_profile_angle_band with the same resolved bookends.

    the old generate and old revalidate VP branches both resolved
    (angle_start, angle_end) via resolve_vertical_profile_angles(config, sa) and
    passed config.angle_source or "CUSTOM"; the helper must reproduce that exactly.
    """
    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    wps = _vertical(center, 400.0, [1.9, 3.0, 4.5, 6.5])
    setting_angles = [3.0]
    config = ResolvedConfig()

    angle_start, angle_end = resolve_vertical_profile_angles(config, setting_angles)
    expected = validate_vertical_profile_angle_band(
        wps,
        center,
        setting_angles,
        angle_start,
        angle_end,
        config.angle_source or "CUSTOM",
    )
    got = _papi_band_violations(
        wps, center, setting_angles, config, InspectionMethod.VERTICAL_PROFILE
    )

    assert got == expected


def test_hr_without_setting_angles_delta_is_empty_on_both_paths():
    """documented revalidate delta: old `continue` vs new fall-through agree.

    old generate HR branch required `setting_angles` truthy in the `if`, so
    HR-without-setting-angles extended nothing. old revalidate HR branch did an
    early `continue`. both produced no PAPI-band output; the shared helper now
    returns [] for both, and the empty list drives an empty remap + no-op
    _format_soft_warnings, so the persisted output is unchanged.
    """
    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    wps = _arc(center, radius_m=350.0, glide_slope_deg=3.5)

    out = _papi_band_violations(
        wps, center, [], ResolvedConfig(), InspectionMethod.HORIZONTAL_RANGE
    )

    assert out == []
