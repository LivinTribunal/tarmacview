"""fly-over inspection-method path generator: pass over each LHA, offset back for tilted axis."""

import math
from uuid import UUID

from app.core.constants import NEGLIGIBLE_OFFSET_M
from app.core.enums import CameraAction, WaypointType
from app.utils.geo import bearing_between, point_at_distance

from ..config_resolver import _resolve_measurement_speed
from ..types import (
    DEFAULT_FLY_OVER_GIMBAL,
    DEFAULT_FLY_OVER_HEIGHT,
    MetersPerSecond,
    Point3D,
    ResolvedConfig,
    WaypointData,
)

# minimum tilt magnitude away from horizontal - keeps tan bounded.
# rejects camera gimbal angles in (-1, 0] where tan(90 + gimbal) explodes
# and the back-offset becomes unreasonably large or numerically unstable.
MIN_TILT_BELOW_HORIZONTAL: float = 1.0


def calculate_fly_over_path(
    lha_positions: list[Point3D],
    config: ResolvedConfig,
    inspection_id: UUID | None,
    speed: MetersPerSecond,
) -> list[WaypointData]:
    """generate fly-over path: drone flies directly over a row of lights end-to-end."""
    if len(lha_positions) < 2:
        raise ValueError("fly-over requires at least two LHA positions")

    height = (
        config.height_above_lights
        if config.height_above_lights is not None
        else DEFAULT_FLY_OVER_HEIGHT
    )
    gimbal = (
        config.camera_gimbal_angle
        if config.camera_gimbal_angle is not None
        else DEFAULT_FLY_OVER_GIMBAL
    )

    # camera must tilt down enough to keep tan bounded; horizontal or upward
    # gimbals would produce a runaway offset and cannot frame the LHA below
    if gimbal > -MIN_TILT_BELOW_HORIZONTAL:
        raise ValueError(
            f"fly-over requires camera_gimbal_angle <= -{MIN_TILT_BELOW_HORIZONTAL:.0f} "
            f"(got {gimbal:.2f}); near-horizontal gimbal cannot frame the LHA"
        )

    first = lha_positions[0]
    last = lha_positions[-1]
    heading = bearing_between(first.lon, first.lat, last.lon, last.lat)

    # back-offset along the reverse heading so the tilted optical axis lands on the LHA.
    # geometry: with gimbal = -(90 - tilt) the camera looks tilt degrees forward of down,
    # so the drone must trail the LHA by H * tan(tilt) = H * tan(90 + gimbal).
    back_offset_m = height * math.tan(math.radians(90.0 + gimbal))
    reverse_heading = (heading + 180.0) % 360.0

    cam_action = (
        CameraAction.RECORDING
        if config.capture_mode == "VIDEO_CAPTURE"
        else CameraAction.PHOTO_CAPTURE
    )

    measurement_speed = _resolve_measurement_speed(config, speed)

    waypoints = []
    for lha in lha_positions:
        if abs(back_offset_m) > NEGLIGIBLE_OFFSET_M:
            wp_lon, wp_lat = point_at_distance(lha.lon, lha.lat, reverse_heading, back_offset_m)
        else:
            wp_lon, wp_lat = lha.lon, lha.lat

        waypoints.append(
            WaypointData(
                lon=wp_lon,
                lat=wp_lat,
                alt=lha.alt + height + config.altitude_offset,
                heading=heading,
                speed=measurement_speed,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=cam_action,
                camera_target=lha,
                inspection_id=inspection_id,
                gimbal_pitch=gimbal,
            )
        )

    return waypoints
