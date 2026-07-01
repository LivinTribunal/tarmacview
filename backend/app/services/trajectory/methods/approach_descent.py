"""approach-descent inspection-method path generator: on-axis glide-slope descent to meht hover."""

import math
from uuid import UUID

from app.core.enums import CameraAction, WaypointType
from app.utils.geo import bearing_between, elevation_angle, point_at_distance

from ..config_resolver import _resolve_measurement_speed
from ..helpers import _opposite_bearing
from ..types import (
    DEFAULT_DESCENT_START_DISTANCE,
    DEFAULT_MEHT_HOVER_DURATION,
    Degrees,
    MetersPerSecond,
    Point3D,
    ResolvedConfig,
    WaypointData,
)


def resolve_descent_angle(config: ResolvedConfig, glide_slope: Degrees) -> Degrees:
    """pick the descent glide slope: operator override > PAPI-derived glide slope."""
    if config.descent_glide_slope_override is not None:
        return config.descent_glide_slope_override
    return glide_slope


def calculate_approach_descent_path(
    meht_point: Point3D,
    lha_center: Point3D,
    runway_heading: Degrees,
    glide_slope: Degrees,
    config: ResolvedConfig,
    inspection_id: UUID | None,
    speed: MetersPerSecond,
) -> list[WaypointData]:
    """generate an on-axis approach descent that ends at the MEHT hover over the threshold.

    the drone starts `descent_start_distance` back of the threshold on the
    approach side, descends along the PAPI-derived glide slope, and terminates
    with a hover + capture at the MEHT point over the threshold - so one approach
    inspection yields both the descent series and the MEHT measurement.
    """
    density = config.measurement_density
    descent_distance = (
        config.descent_start_distance
        if config.descent_start_distance is not None
        else DEFAULT_DESCENT_START_DISTANCE
    )
    angle = resolve_descent_angle(config, glide_slope)
    measurement_speed = _resolve_measurement_speed(config, speed)
    hover_dur = (
        config.hover_duration if config.hover_duration is not None else DEFAULT_MEHT_HOVER_DURATION
    )

    # start point sits back of the threshold along the approach axis
    approach_bearing = _opposite_bearing(runway_heading)
    start_lon, start_lat = point_at_distance(
        meht_point.lon, meht_point.lat, approach_bearing, descent_distance
    )

    cam_action = (
        CameraAction.RECORDING
        if config.capture_mode == "VIDEO_CAPTURE"
        else CameraAction.PHOTO_CAPTURE
    )

    waypoints = []
    for i in range(density):
        # frac runs 0 (start, back of threshold) -> 1 (meht point over threshold)
        frac = i / (density - 1) if density > 1 else 1.0
        lon = start_lon + (meht_point.lon - start_lon) * frac
        lat = start_lat + (meht_point.lat - start_lat) * frac

        remaining = descent_distance * (1.0 - frac)
        alt = meht_point.alt + remaining * math.tan(math.radians(angle)) + config.altitude_offset

        heading = bearing_between(lon, lat, lha_center.lon, lha_center.lat)
        pitch = elevation_angle(lon, lat, alt, lha_center.lon, lha_center.lat, lha_center.alt)

        # the terminal waypoint at the meht point is a hover + capture (the MEHT
        # measurement); the rest are the descent measurement series.
        is_terminal = i == density - 1
        waypoints.append(
            WaypointData(
                lon=lon,
                lat=lat,
                alt=alt,
                heading=heading,
                speed=measurement_speed,
                waypoint_type=WaypointType.HOVER if is_terminal else WaypointType.MEASUREMENT,
                camera_action=cam_action,
                camera_target=lha_center,
                inspection_id=inspection_id,
                hover_duration=hover_dur if is_terminal else None,
                gimbal_pitch=pitch,
            )
        )

    return waypoints
