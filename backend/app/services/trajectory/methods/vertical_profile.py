"""vertical-profile inspection-method path generator: fixed-standoff climb sweeping angle band."""

import math
from uuid import UUID

from app.core.enums import CameraAction, WaypointType
from app.utils.geo import bearing_between, elevation_angle, point_at_distance

from ..config_resolver import _resolve_measurement_speed
from ..helpers import _opposite_bearing, resolve_vertical_profile_angles
from ..types import (
    DEFAULT_HORIZONTAL_DISTANCE,
    Degrees,
    MetersPerSecond,
    Point3D,
    ResolvedConfig,
    WaypointData,
)


def calculate_vertical_path(
    center: Point3D,
    runway_heading: Degrees,
    config: ResolvedConfig,
    inspection_id: UUID | None,
    speed: MetersPerSecond,
    setting_angles: list[Degrees],
) -> list[WaypointData]:
    """generate vertical profile path as one continuous measurement pass.

    angle_start and angle_end come from `resolve_vertical_profile_angles`. PAPI
    mode pulls them from setting_angles + offsets; CUSTOM mode uses operator
    values (with legacy 1.9°/6.5° fallbacks). setting_angles is still in the
    signature so PAPI mode can resolve bookends without extra wiring.
    """
    density = config.measurement_density
    distance = (
        config.horizontal_distance
        if config.horizontal_distance is not None
        else DEFAULT_HORIZONTAL_DISTANCE
    )
    measurement_speed = _resolve_measurement_speed(config, speed)

    approach_heading = _opposite_bearing(runway_heading)
    lon, lat = point_at_distance(center.lon, center.lat, approach_heading, distance)
    heading_to_center = bearing_between(lon, lat, center.lon, center.lat)

    angle_start, angle_end = resolve_vertical_profile_angles(config, setting_angles)

    cam_action = (
        CameraAction.RECORDING
        if config.capture_mode == "VIDEO_CAPTURE"
        else CameraAction.PHOTO_CAPTURE
    )

    waypoints = []
    for i in range(density):
        if density > 1:
            elevation = angle_start + (angle_end - angle_start) / (density - 1) * i
        else:
            elevation = (angle_start + angle_end) / 2

        alt = center.alt + distance * math.tan(math.radians(elevation)) + config.altitude_offset
        pitch = elevation_angle(lon, lat, alt, center.lon, center.lat, center.alt)

        waypoints.append(
            WaypointData(
                lon=lon,
                lat=lat,
                alt=alt,
                heading=heading_to_center,
                speed=measurement_speed,
                waypoint_type=WaypointType.MEASUREMENT,
                camera_action=cam_action,
                camera_target=center,
                inspection_id=inspection_id,
                hover_duration=None,
                gimbal_pitch=pitch,
            )
        )

    return waypoints
