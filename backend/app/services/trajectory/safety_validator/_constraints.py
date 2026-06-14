"""per-waypoint drone limits, battery endurance, safety-zone and constraint-rule checks."""

from __future__ import annotations

from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.core.enums import ConstraintType, SafetyZoneType, SurfaceType
from app.models.airport import AirfieldSurface, SafetyZone
from app.models.flight_plan import ConstraintRule
from app.models.mission import DroneProfile
from app.models.value_objects import Speed
from app.utils.local_projection import LocalProjection, wkt_to_local_linestring

from ..types import (
    DEFAULT_RESERVE_MARGIN,
    DEFAULT_RUNWAY_BUFFER,
    HARD_ZONE_TYPES,
    Violation,
    WaypointData,
)
from ._geometry import _polygon_contains_lonlat_2d


def check_drone_constraints(wp: WaypointData, drone: DroneProfile) -> Violation | None:
    """check if waypoint exceeds drone altitude or speed limits."""
    if drone.max_altitude is not None and wp.alt > drone.max_altitude:
        return Violation(
            is_warning=False,
            violation_kind="drone",
            message=(
                f"waypoint alt {wp.alt:.0f}m exceeds drone max altitude {drone.max_altitude:.0f}m"
            ),
        )

    # validate speed as value object
    try:
        Speed(wp.speed)
    except ValueError:
        return Violation(
            is_warning=False, violation_kind="drone", message=f"invalid speed value: {wp.speed}"
        )

    if drone.max_speed is not None and wp.speed > drone.max_speed:
        return Violation(
            is_warning=False,
            violation_kind="drone",
            message=(
                f"waypoint speed {wp.speed:.1f} m/s exceeds "
                f"drone max speed {drone.max_speed:.1f} m/s"
            ),
        )

    return None


def check_battery(
    cumulative_duration_s: float,
    drone: DroneProfile | None,
    reserve_margin: float = DEFAULT_RESERVE_MARGIN,
) -> Violation | None:
    """soft warning if cumulative flight time exceeds battery capacity.

    when drone metadata is missing endurance, surfaces a soft suggestion so
    operators see the gap instead of getting a silent pass.
    """
    if drone is None or drone.endurance_minutes is None:
        return Violation(
            is_warning=True,
            violation_kind="battery",
            message="battery check skipped - drone endurance unknown",
        )

    available_s = drone.endurance_minutes * 60 * (1 - reserve_margin)
    if cumulative_duration_s > available_s:
        return Violation(
            is_warning=True,
            violation_kind="battery",
            message=(
                f"estimated flight time {cumulative_duration_s:.0f}s exceeds "
                f"battery capacity {available_s:.0f}s "
                f"(with {reserve_margin:.0%} reserve)"
            ),
        )

    return None


def check_safety_zone(db: Session | None, wp: WaypointData, zone: SafetyZone) -> Violation | None:
    """check if waypoint is inside a safety zone's geometry and altitude band.

    airport boundary zones use inverted semantics - waypoint outside the
    polygon produces a soft geofence violation. ``db`` is unused; kept for
    backward call-site compatibility.
    """
    if not zone.geometry:
        return None

    contained = _polygon_contains_lonlat_2d(zone.geometry, wp.lon, wp.lat)

    if zone.type == SafetyZoneType.AIRPORT_BOUNDARY.value:
        if contained is True:
            return None
        # soft until boundary-aware A* routing lands; see follow-up issue.
        return Violation(
            is_warning=True,
            violation_kind="geofence",
            message=f"waypoint outside airport boundary: {zone.name}",
        )

    if contained is not True:
        return None

    if zone.altitude_floor is not None and wp.alt < zone.altitude_floor:
        return None
    if zone.altitude_ceiling is not None and wp.alt > zone.altitude_ceiling:
        return None

    is_hard = zone.type in HARD_ZONE_TYPES

    return Violation(
        is_warning=not is_hard,
        violation_kind="safety_zone",
        message=f"waypoint inside {zone.type} zone: {zone.name}",
    )


def _check_constraint(
    db: Session | None,
    wp: WaypointData,
    constraint: ConstraintRule,
    surfaces: list[AirfieldSurface],
) -> Violation | None:
    """dispatch waypoint check based on constraint type."""
    ctype = constraint.constraint_type

    if ctype == ConstraintType.ALTITUDE:
        if constraint.min_altitude is not None and wp.alt < constraint.min_altitude:
            return _violation(
                constraint,
                f"alt {wp.alt:.0f}m below min {constraint.min_altitude:.0f}m",
            )
        if constraint.max_altitude is not None and wp.alt > constraint.max_altitude:
            return _violation(
                constraint,
                f"alt {wp.alt:.0f}m above max {constraint.max_altitude:.0f}m",
            )

    elif ctype == ConstraintType.SPEED:
        max_speed = constraint.max_horizontal_speed
        if max_speed is not None and wp.speed > max_speed:
            return _violation(
                constraint,
                f"speed {wp.speed:.1f} exceeds max {constraint.max_horizontal_speed:.1f} m/s",
            )

    elif ctype == ConstraintType.GEOFENCE and constraint.boundary:
        contained = _polygon_contains_lonlat_2d(constraint.boundary, wp.lon, wp.lat)
        if contained is not True:
            return _violation(constraint, "waypoint outside geofence boundary")

    elif ctype == ConstraintType.RUNWAY_BUFFER:
        v = _check_runway_buffer(db, wp, constraint, surfaces)
        if v:
            return v

    return None


def _check_runway_buffer(
    db: Session | None,
    wp: WaypointData,
    constraint: ConstraintRule,
    surfaces: list[AirfieldSurface],
) -> Violation | None:
    """check if waypoint is within lateral buffer of a runway centerline.

    projects centerline and waypoint onto a local Cartesian frame anchored at
    the waypoint and measures the 2D distance with Shapely in meters; ``db``
    is unused.
    """
    buffer_m = constraint.lateral_buffer or DEFAULT_RUNWAY_BUFFER

    for surface in surfaces:
        if surface.surface_type != SurfaceType.RUNWAY:
            continue
        if not surface.geometry:
            continue

        proj = LocalProjection(ref_lon=wp.lon, ref_lat=wp.lat)
        line = wkt_to_local_linestring(proj, surface.geometry)
        if line is None:
            continue
        # waypoint sits at the projection origin
        if line.distance(Point(0.0, 0.0)) <= buffer_m:
            return _violation(
                constraint,
                f"waypoint within {buffer_m:.0f}m of runway {surface.identifier}",
            )

    return None


def _violation(constraint: ConstraintRule, message: str) -> Violation:
    """create a violation from a constraint, inheriting its hard/soft flag."""
    return Violation(
        is_warning=not constraint.is_hard_constraint,
        violation_kind="constraint",
        message=message,
        constraint_id=str(constraint.id),
    )
