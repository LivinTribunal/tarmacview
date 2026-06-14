"""per-pass validation: drone/constraint/obstacle/zone/AGL checks and PAPI angle bands."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.constants import MIN_TRANSIT_ALTITUDE_AGL_M
from app.core.enums import WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.models.flight_plan import ConstraintRule
from app.models.mission import DroneProfile
from app.utils.geo import elevation_angle

from ..types import (
    HARD_ZONE_TYPES,
    HOVER_ANGLE_TOLERANCE,
    MINIMUM_ALTITUDE_THRESHOLD,
    Degrees,
    LocalGeometries,
    Meters,
    Point3D,
    Violation,
    WaypointData,
)
from ._constraints import _check_constraint, check_drone_constraints
from ._geometry import resolve_obstacle_buffer

# waypoint types exempt from AGL minimum check - these literally touch the ground
_GROUND_LEVEL_WAYPOINT_TYPES = (WaypointType.TAKEOFF, WaypointType.LANDING)


def validate_inspection_pass(
    waypoints: list[WaypointData],
    drone: DroneProfile | None,
    constraints: list[ConstraintRule],
    local_geoms: LocalGeometries,
    elevation_provider=None,
    buffer_distance: Meters = 0.0,
    db: Session | None = None,
    keep_inside_airport_boundary: bool = False,
) -> list[Violation]:
    """validate all waypoints in an inspection pass.

    drone and constraint checks run per-waypoint (no spatial queries).
    obstacle and zone checks use Shapely in local coordinates.
    AGL altitude check uses elevation provider for terrain-aware validation.
    buffer_distance inflates obstacle boundaries by this many meters.
    """
    violations = []

    for i, wp in enumerate(waypoints):
        if drone:
            violation = check_drone_constraints(wp, drone)
            if violation:
                violation.waypoint_index = i
                violations.append(violation)

        for constraint in constraints:
            violation = _check_constraint(db, wp, constraint, [])
            if violation:
                violation.waypoint_index = i
                violations.append(violation)

    violations.extend(
        _batch_check_obstacles(waypoints, local_geoms, buffer_distance=buffer_distance)
    )
    violations.extend(
        _batch_check_zones(
            waypoints,
            local_geoms,
            keep_inside_airport_boundary=keep_inside_airport_boundary,
        )
    )

    # AGL altitude check against terrain
    if elevation_provider:
        violations.extend(_batch_check_minimum_agl(waypoints, elevation_provider))

    return violations


def _batch_check_obstacles(
    waypoints: list[WaypointData],
    local_geoms: LocalGeometries,
    buffer_distance: Meters = 0.0,
) -> list[Violation]:
    """batch obstacle containment using Shapely in local coordinates.

    buffer is resolved through resolve_obstacle_buffer for every obstacle so the
    safety envelope follows the same priority chain as the visibility graph.
    """
    if not local_geoms.obstacles or not waypoints:
        return []

    proj = local_geoms.proj
    violations = []

    for wp_idx, wp in enumerate(waypoints):
        pt = proj.point_to_local(wp.lon, wp.lat)

        for obs in local_geoms.obstacles:
            buf = resolve_obstacle_buffer(obs, buffer_distance)
            poly = obs.polygon.buffer(buf) if buf > 0 else obs.polygon
            if poly.contains(pt):
                obs_top = obs.base_alt + obs.height
                if wp.alt >= obs.base_alt and wp.alt <= obs_top:
                    violations.append(
                        Violation(
                            is_warning=False,
                            violation_kind="obstacle",
                            message=(
                                f"waypoint at {wp.alt:.0f}m intersects obstacle "
                                f"'{obs.name}' (top: {obs_top:.0f}m)"
                            ),
                            waypoint_index=wp_idx,
                        )
                    )

    return violations


def _batch_check_zones(
    waypoints: list[WaypointData],
    local_geoms: LocalGeometries,
    keep_inside_airport_boundary: bool = False,
) -> list[Violation]:
    """batch safety zone containment using Shapely in local coordinates.

    when keep_inside_airport_boundary is on, transit / takeoff / landing
    waypoints outside the boundary emit a soft warning. measurement and hover
    waypoints are exempt - inspections inherently cross the boundary by design.
    """
    violations: list[Violation] = []
    violations.extend(
        _batch_check_boundary_zones(
            waypoints,
            local_geoms,
            keep_inside_airport_boundary=keep_inside_airport_boundary,
        )
    )

    if not local_geoms.zones or not waypoints:
        return violations

    proj = local_geoms.proj

    for wp_idx, wp in enumerate(waypoints):
        pt = proj.point_to_local(wp.lon, wp.lat)

        for zone in local_geoms.zones:
            if not zone.polygon.contains(pt):
                continue

            # altitude band check
            if zone.altitude_floor is not None and wp.alt < zone.altitude_floor:
                continue
            if zone.altitude_ceiling is not None and wp.alt > zone.altitude_ceiling:
                continue

            is_hard = zone.zone_type in HARD_ZONE_TYPES
            violations.append(
                Violation(
                    is_warning=not is_hard,
                    violation_kind="safety_zone",
                    message=f"waypoint inside {zone.zone_type} zone: {zone.name}",
                    waypoint_index=wp_idx,
                )
            )

    return violations


# waypoint types subject to the keep-inside-boundary soft warning.
# measurement and hover are exempt by design - inspections inherently sit at
# or just outside the boundary edge to frame the LHAs.
_BOUNDARY_EGRESS_WAYPOINT_TYPES = (
    WaypointType.TRANSIT,
    WaypointType.TAKEOFF,
    WaypointType.LANDING,
)


def _batch_check_boundary_zones(
    waypoints: list[WaypointData],
    local_geoms: LocalGeometries,
    keep_inside_airport_boundary: bool = False,
) -> list[Violation]:
    """boundary-egress soft warning for non-measurement waypoints.

    fires only on transit / takeoff / landing waypoints when keep-inside is on
    and the waypoint sits outside the boundary polygon. measurement and hover
    waypoints are always exempt - inspections inherently sit at or just outside
    the boundary edge to frame the LHAs.
    """
    if not local_geoms.boundary_zones or not waypoints or not keep_inside_airport_boundary:
        return []

    proj = local_geoms.proj
    violations: list[Violation] = []

    for boundary in local_geoms.boundary_zones:
        for wp_idx, wp in enumerate(waypoints):
            if wp.waypoint_type not in _BOUNDARY_EGRESS_WAYPOINT_TYPES:
                continue
            pt = proj.point_to_local(wp.lon, wp.lat)
            if boundary.polygon.contains(pt):
                continue
            if wp.waypoint_type == WaypointType.TRANSIT:
                wp_label = "transit waypoint"
            elif wp.waypoint_type == WaypointType.TAKEOFF:
                wp_label = "takeoff position"
            else:
                wp_label = "landing position"
            violations.append(
                Violation(
                    is_warning=True,
                    violation_kind="geofence",
                    message=(
                        f"{wp_label} is outside airport boundary "
                        f"'{boundary.name}' - keep-inside preference is on"
                    ),
                    waypoint_index=wp_idx,
                )
            )

    return violations


def _batch_check_minimum_agl(
    waypoints: list[WaypointData],
    elevation_provider,
    min_agl: float = MINIMUM_ALTITUDE_THRESHOLD,
) -> list[Violation]:
    """check in-flight waypoints maintain minimum height above ground level.

    measurement and hover waypoints emit soft warnings - PAPI approach paths
    inherently place measurement waypoints below 30m AGL by design (3 deg
    glide slope at ~400m distance = ~21m AGL). transit waypoints are already
    hard-clamped in _adjust_transit_altitude_for_terrain, so anything below
    MIN_TRANSIT_ALTITUDE_AGL_M here implies the elevation provider failed
    and is reported as a hard violation. TAKEOFF and LANDING waypoints are
    exempt by design - they sit on the ground.
    """
    if not waypoints:
        return []

    # pre-filter ground-level waypoints to skip unnecessary elevation lookups
    indexed_wps = [
        (i, wp)
        for i, wp in enumerate(waypoints)
        if wp.waypoint_type not in _GROUND_LEVEL_WAYPOINT_TYPES
    ]
    if not indexed_wps:
        return []

    points = [(wp.lat, wp.lon) for _, wp in indexed_wps]
    elevations = elevation_provider.get_elevations_batch(points)
    if len(elevations) != len(points):
        raise TrajectoryGenerationError(f"expected {len(points)} elevations, got {len(elevations)}")

    violations = []
    for (i, wp), ground in zip(indexed_wps, elevations):
        agl = wp.alt - ground
        is_transit = wp.waypoint_type == WaypointType.TRANSIT
        threshold = MIN_TRANSIT_ALTITUDE_AGL_M if is_transit else min_agl
        if agl < threshold:
            if is_transit:
                message = (
                    f"transit at {wp.alt:.0f}m is only {agl:.1f}m AGL "
                    f"(min {threshold:.0f}m) - elevation provider may have failed "
                    f"to clamp transit altitude"
                )
            else:
                message = (
                    f"{wp.waypoint_type} at {wp.alt:.0f}m is only {agl:.1f}m AGL "
                    f"(min {threshold:.0f}m)"
                )
            violations.append(
                Violation(
                    is_warning=not is_transit,
                    violation_kind="altitude",
                    message=message,
                    waypoint_index=i,
                )
            )

    return violations


def validate_papi_angle_band(
    waypoints: list[WaypointData],
    center: Point3D,
    setting_angle_used: Degrees,
) -> list[Violation]:
    """regression net for HORIZONTAL_RANGE waypoints below the all-white-zone edge.

    `_apply_papi_glide_slope_terrain` rebuilds each measurement/hover altitude
    geometrically so the elevation angle from the LHA is preserved over terrain
    undulation. this check fires only on edge cases the recompute could not
    rescue - degenerate geometry or a configured offset that already places the
    design angle below `setting_angle_used + HOVER_ANGLE_TOLERANCE`. routine
    terrain following must not warn here. non-MEASUREMENT/HOVER waypoints are
    skipped.

    use `validate_vertical_profile_angle_band` for VERTICAL_PROFILE - it checks
    the climb bookends precisely against the PAPI band instead of treating
    every waypoint as if it were on the all-white-zone edge.
    """
    violations: list[Violation] = []
    threshold = setting_angle_used + HOVER_ANGLE_TOLERANCE
    for i, wp in enumerate(waypoints):
        if wp.waypoint_type not in (WaypointType.MEASUREMENT, WaypointType.HOVER):
            continue
        actual = elevation_angle(
            center.lon,
            center.lat,
            center.alt,
            wp.lon,
            wp.lat,
            wp.alt,
        )
        if actual < threshold:
            violations.append(
                Violation(
                    is_warning=True,
                    violation_kind="papi_angle_band",
                    message=(
                        f"waypoint {i} elevation angle {actual:.2f} deg is below "
                        f"PAPI all-white-zone edge {threshold:.2f} deg "
                        f"(setting angle {setting_angle_used:.2f} deg)"
                    ),
                    waypoint_index=i,
                )
            )
    return violations


def validate_vertical_profile_angle_band(
    waypoints: list[WaypointData],
    center: Point3D,
    setting_angles: list[Degrees],
    angle_start_resolved: Degrees,
    angle_end_resolved: Degrees,
    angle_source: str,
) -> list[Violation]:
    """precise per-bookend check for VERTICAL_PROFILE climbs.

    the climb is intentionally a continuous sweep through angles below and above
    the PAPI setting band, so the HR-style "every measurement above the all-white
    edge" rule produces a false positive on every healthy VP run.

    instead this checks two specific properties:
      * the first MEASUREMENT/HOVER waypoint sits at the resolved `angle_start`
        (within HOVER_ANGLE_TOLERANCE) - if not, the AGL clamp drifted the
        bookend beyond tolerance.
      * the last MEASUREMENT/HOVER waypoint sits at the resolved `angle_end`
        (within HOVER_ANGLE_TOLERANCE) - same reason.

    additionally, when `angle_source == "PAPI"` and at least one setting angle
    is known, emit a soft "band not fully covered" warning if the climb does
    not span the [min, max] of setting_angles - that's PAPI coverage intent.
    """
    violations: list[Violation] = []
    mh = [
        (i, wp)
        for i, wp in enumerate(waypoints)
        if wp.waypoint_type in (WaypointType.MEASUREMENT, WaypointType.HOVER)
    ]
    if not mh:
        return violations

    first_idx, first_wp = mh[0]
    last_idx, last_wp = mh[-1]
    first_actual = elevation_angle(
        center.lon, center.lat, center.alt, first_wp.lon, first_wp.lat, first_wp.alt
    )
    last_actual = elevation_angle(
        center.lon, center.lat, center.alt, last_wp.lon, last_wp.lat, last_wp.alt
    )

    if abs(first_actual - angle_start_resolved) > HOVER_ANGLE_TOLERANCE:
        violations.append(
            Violation(
                is_warning=True,
                violation_kind="papi_angle_band",
                message=(
                    f"climb start angle {first_actual:.2f} deg differs from "
                    f"resolved {angle_start_resolved:.2f} deg by more than tolerance"
                ),
                waypoint_index=first_idx,
            )
        )

    if abs(last_actual - angle_end_resolved) > HOVER_ANGLE_TOLERANCE:
        violations.append(
            Violation(
                is_warning=True,
                violation_kind="papi_angle_band",
                message=(
                    f"climb end angle {last_actual:.2f} deg differs from "
                    f"resolved {angle_end_resolved:.2f} deg by more than tolerance"
                ),
                waypoint_index=last_idx,
            )
        )

    if (angle_source or "").upper() == "PAPI" and setting_angles:
        papi_min = min(setting_angles)
        papi_max = max(setting_angles)
        if (
            angle_start_resolved > papi_min + HOVER_ANGLE_TOLERANCE
            or angle_end_resolved < papi_max - HOVER_ANGLE_TOLERANCE
        ):
            violations.append(
                Violation(
                    is_warning=True,
                    violation_kind="papi_angle_band",
                    message=(
                        f"climb {angle_start_resolved:.2f} - {angle_end_resolved:.2f} deg "
                        f"does not fully cover PAPI band "
                        f"{papi_min:.2f} - {papi_max:.2f} deg"
                    ),
                )
            )

    return violations
