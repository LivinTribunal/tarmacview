"""trajectory helpers: lha/runway-geometry lookups, vp angle bookends, terrain-delta rebuilds."""

import logging
import math

from app.core.constants import (
    DEFAULT_GLIDE_SLOPE_DEG,
    MAX_VERTICAL_PROFILE_ANGLE_DEG,
    MIN_TRANSIT_ALTITUDE_AGL_M,
    MIN_VERTICAL_PROFILE_ANGLE_DEG,
)
from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.core.geometry import wkt_to_geojson
from app.utils.geo import distance_between, elevation_angle, point_at_distance

from .types import (
    DEFAULT_HEADING,
    DEFAULT_HORIZONTAL_DISTANCE,
    DEFAULT_SWEEP_ANGLE,
    DEFAULT_VERTICAL_PROFILE_END,
    DEFAULT_VERTICAL_PROFILE_START,
    MIN_ARC_RADIUS,
    Degrees,
    Point3D,
    ResolvedConfig,
    WaypointData,
)

logger = logging.getLogger(__name__)


def _designator_sort_key(designator: str | None) -> tuple:
    """sort key that orders numeric designators numerically and alpha ones lexically."""
    d = designator or ""
    try:
        return (0, int(d), "")
    except (ValueError, TypeError):
        # middle slot is a stable filler so the tuple shape matches the numeric branch
        return (1, 0, d)


def _opposite_bearing(heading: Degrees) -> Degrees:
    """bearing 180 degrees opposite of given heading, wrapped to [0, 360)."""
    return (heading + 180) % 360


def get_ordered_lha_positions(template, lha_ids: list | None = None) -> list[Point3D]:
    """extract LHA positions sorted by unit_designator within each AGL."""
    lha_id_set = {str(i) for i in lha_ids} if lha_ids else None

    positions = []
    for agl in template.targets:
        ordered = sorted(
            (lha for lha in agl.lhas if lha.position),
            key=lambda lha: _designator_sort_key(lha.unit_designator),
        )
        for lha in ordered:
            if lha_id_set and str(lha.id) not in lha_id_set:
                continue
            pos = _parse_lha_position(lha)
            if pos is None:
                continue
            positions.append(pos)

    return positions


def _parse_lha_position(lha) -> Point3D | None:
    """parse an LHA's WKT position into Point3D, or None when missing/invalid."""
    if not lha.position:
        return None
    try:
        geojson = wkt_to_geojson(lha.position)
        c = geojson.get("coordinates") if geojson else None
        if not c or len(c) < 3:
            return None
    except (KeyError, ValueError, TypeError):
        return None
    return Point3D(lon=c[0], lat=c[1], alt=c[2])


def find_lha_by_id(template, lha_id) -> tuple[Point3D, object] | None:
    """locate a single LHA position by id across all template AGLs.

    returns (position, parent_agl) or None when not found.
    """
    target = str(lha_id)
    for agl in template.targets:
        for lha in agl.lhas:
            if str(lha.id) != target:
                continue
            pos = _parse_lha_position(lha)
            if pos is None:
                return None
            return pos, agl

    return None


def find_lha_in_surfaces(surfaces, lha_id) -> tuple[Point3D, object] | None:
    """locate a single LHA position by id across all AGLs of a surface list.

    used for AGL-agnostic methods (hover-point-lock) where the template does
    not constrain which LHA the operator may choose.
    returns (position, parent_agl) or None when not found.
    """
    target = str(lha_id)
    for surface in surfaces:
        for agl in surface.agls:
            for lha in agl.lhas:
                if str(lha.id) != target:
                    continue
                pos = _parse_lha_position(lha)
                if pos is None:
                    return None
                return pos, agl

    return None


def get_lha_positions(template, lha_ids: list | None = None) -> list[Point3D]:
    """extract 3D positions from LHA units, optionally filtered by lha_ids."""
    # precompute set to avoid O(m*n) list rebuild per iteration
    lha_id_set = {str(i) for i in lha_ids} if lha_ids else None

    positions = []
    for agl in template.targets:
        for lha in agl.lhas:
            if lha_id_set and str(lha.id) not in lha_id_set:
                continue
            pos = _parse_lha_position(lha)
            if pos is None:
                continue
            positions.append(pos)

    return positions


def get_lha_positions_from_surfaces(surfaces, lha_ids: list) -> list[Point3D]:
    """resolve LHA positions from all airport surfaces instead of template targets.

    used for AGL-agnostic methods (hover-point-lock) where the template has
    no target AGLs and the operator selects LHAs from any surface.
    """
    lha_id_set = {str(i) for i in lha_ids}
    positions = []
    for surface in surfaces:
        for agl in surface.agls:
            for lha in agl.lhas:
                if str(lha.id) not in lha_id_set:
                    continue
                pos = _parse_lha_position(lha)
                if pos is None:
                    continue
                positions.append(pos)

    return positions


def get_lha_setting_angle_by_id(template, lha_id) -> Degrees | None:
    """return setting angle of a specific lha by id, or none if not found."""
    target_id = str(lha_id)
    for agl in template.targets:
        for lha in agl.lhas:
            if str(lha.id) == target_id:
                return lha.setting_angle
    return None


def get_lha_setting_angles(template, lha_ids=None) -> list[Degrees]:
    """collect and sort setting angles from all LHA units in template."""
    # precompute set to avoid O(m*n) list rebuild per iteration
    lha_id_set = {str(i) for i in lha_ids} if lha_ids else None

    angles = []
    for agl in template.targets:
        for lha in agl.lhas:
            if lha_id_set and str(lha.id) not in lha_id_set:
                continue
            if lha.setting_angle is not None:
                angles.append(lha.setting_angle)

    return sorted(angles)


def get_average_lens_height_agl(template, lha_ids: list | None = None) -> float | None:
    """average lens_height_agl_m across selected PAPI LHAs, or None when none set."""
    lha_id_set = {str(i) for i in lha_ids} if lha_ids else None
    heights = []
    for agl in template.targets:
        for lha in agl.lhas:
            if lha_id_set and str(lha.id) not in lha_id_set:
                continue
            if lha.lens_height_agl_m is not None:
                heights.append(lha.lens_height_agl_m)
    if not heights:
        return None
    return sum(heights) / len(heights)


def resolve_center_height_offset(config: ResolvedConfig, template, lha_ids) -> float:
    """meters to raise the LHA-centroid aim altitude per the center-height reference.

    GROUND -> 0; LENS -> average selected lens_height_agl_m (0 when none set);
    CUSTOM -> operator height (0 when unset).
    """
    ref = (config.papi_center_height_reference or "GROUND").upper()
    if ref == "LENS":
        avg = get_average_lens_height_agl(template, lha_ids)
        return avg if avg is not None else 0.0
    if ref == "CUSTOM":
        return config.papi_center_height_custom_m or 0.0
    return 0.0


def derive_observation_angle(
    setting_angles: list[Degrees],
    angle_offset: Degrees,
) -> Degrees:
    """derive papi observation angle from max lha setting angle + offset.

    places the drone in the all-white zone above all papi transition sectors.
    """
    return max(setting_angles) + angle_offset


def check_missing_setting_angles(template, lha_ids=None) -> list[str]:
    """return unit_designators of lhas with missing setting_angle."""
    lha_id_set = {str(i) for i in lha_ids} if lha_ids else None
    missing = []
    for agl in template.targets:
        for lha in agl.lhas:
            if lha_id_set and str(lha.id) not in lha_id_set:
                continue
            if lha.setting_angle is None:
                missing.append(lha.unit_designator)

    return sorted(missing)


def get_glide_slope_angle(template) -> Degrees:
    """return the first non-null glide slope angle from template targets, or default."""
    for agl in template.targets:
        if agl.glide_slope_angle is not None:
            angle = agl.glide_slope_angle
            if not (0 < angle < 90):
                raise ValueError(f"glide slope angle {angle} out of valid range (0-90)")
            return angle

    return DEFAULT_GLIDE_SLOPE_DEG


def get_runway_heading(template, surfaces) -> Degrees:
    """return the heading of the runway surface associated with the template."""
    for agl in template.targets:
        for surface in surfaces:
            if surface.id == agl.surface_id and surface.heading:
                return surface.heading

    return DEFAULT_HEADING


def get_threshold_position(template, surfaces) -> Point3D | None:
    """return the threshold position of the runway linked to the template's first AGL."""
    for agl in template.targets:
        for surface in surfaces:
            if surface.id != agl.surface_id or surface.threshold_position is None:
                continue
            try:
                geojson = wkt_to_geojson(surface.threshold_position)
                c = geojson.get("coordinates") if geojson else None
                if not c or len(c) < 3:
                    continue
            except (KeyError, ValueError, TypeError):
                continue
            return Point3D(lon=c[0], lat=c[1], alt=c[2])

    return None


def get_touchpoint_position(template, surfaces) -> Point3D | None:
    """return the touchpoint of the runway linked to the template's first AGL.

    approach-descent terminates at the touchdown point; the columns are
    all-or-nothing (enforced at the schema level), so a partial set is treated
    as missing.
    """
    for agl in template.targets:
        for surface in surfaces:
            if surface.id != agl.surface_id:
                continue
            lat = surface.touchpoint_latitude
            lon = surface.touchpoint_longitude
            alt = surface.touchpoint_altitude
            if lat is None or lon is None or alt is None:
                continue
            return Point3D(lon=lon, lat=lat, alt=alt)

    return None


def resolve_scan_surface(surfaces, scan_surface_id):
    """locate the AirfieldSurface targeted by a surface scan, or None.

    AGL-agnostic - the surface is named directly on the config, not derived
    from a template AGL.
    """
    if scan_surface_id is None:
        return None
    target = str(scan_surface_id)
    for surface in surfaces:
        if str(surface.id) == target:
            return surface
    return None


def get_surface_centerline_points(surface) -> list[Point3D]:
    """parse a surface's centerline geometry into ordered Point3D vertices."""
    if surface is None or surface.geometry is None:
        return []
    try:
        line = wkt_to_geojson(surface.geometry)
    except (KeyError, ValueError, TypeError):
        return []
    coords = line.get("coordinates") if line else []
    points = []
    for c in coords:
        if len(c) < 2:
            continue
        alt = c[2] if len(c) >= 3 else 0.0
        points.append(Point3D(lon=c[0], lat=c[1], alt=alt))
    return points


def get_surface_centerline_midpoint(surface) -> Point3D | None:
    """midpoint of a surface's centerline (first/last vertex average)."""
    points = get_surface_centerline_points(surface)
    if len(points) < 2:
        return None
    start = points[0]
    end = points[-1]
    return Point3D(
        lon=(start.lon + end.lon) / 2,
        lat=(start.lat + end.lat) / 2,
        alt=(start.alt + end.alt) / 2,
    )


def get_runway_centerline_midpoint(template, surfaces) -> Point3D | None:
    """return the midpoint of the runway centerline for the template's surface.

    parallel-side-sweep needs a point ON the runway centerline to orient the
    perpendicular offset direction away from the runway. the LHA row centroid
    is NOT a substitute - both perpendicular candidates are equidistant from it.
    """
    for agl in template.targets:
        for surface in surfaces:
            if surface.id != agl.surface_id or surface.geometry is None:
                continue
            mid = get_surface_centerline_midpoint(surface)
            if mid is None:
                continue
            return mid

    return None


def determine_start_position(
    center: Point3D,
    config: ResolvedConfig,
    method: InspectionMethod,
    runway_heading: Degrees,
    glide_slope: Degrees,
    setting_angles: list[Degrees] | None = None,
) -> Point3D:
    """compute start position of inspection pass based on method and geometry."""
    # arc sweep is on the approach side (facing the PAPI front)
    approach = _opposite_bearing(runway_heading)

    match method:
        case InspectionMethod.HORIZONTAL_RANGE:
            radius = config.horizontal_distance or MIN_ARC_RADIUS
            half_sweep = DEFAULT_SWEEP_ANGLE if config.sweep_angle is None else config.sweep_angle
            angle = approach - half_sweep
            lon, lat = point_at_distance(center.lon, center.lat, angle, radius)
            alt = center.alt + radius * math.tan(math.radians(glide_slope))

            return Point3D(lon=lon, lat=lat, alt=alt + config.altitude_offset)

        case InspectionMethod.VERTICAL_PROFILE:
            distance = (
                config.horizontal_distance
                if config.horizontal_distance is not None
                else DEFAULT_HORIZONTAL_DISTANCE
            )
            start_angle, _ = resolve_vertical_profile_angles(config, setting_angles)
            lon, lat = point_at_distance(center.lon, center.lat, approach, distance)
            alt = center.alt + distance * math.tan(math.radians(start_angle))

            return Point3D(lon=lon, lat=lat, alt=alt + config.altitude_offset)

    raise ValueError(f"unsupported inspection method: {method}")


def _clamp_vp_angle(angle: Degrees) -> Degrees:
    """clamp a vertical-profile angle into the [MIN, MAX] vertical-profile envelope."""
    if angle < MIN_VERTICAL_PROFILE_ANGLE_DEG:
        return MIN_VERTICAL_PROFILE_ANGLE_DEG
    if angle > MAX_VERTICAL_PROFILE_ANGLE_DEG:
        return MAX_VERTICAL_PROFILE_ANGLE_DEG
    return angle


def resolve_vertical_profile_angles(
    config: ResolvedConfig,
    setting_angles: list[Degrees] | None = None,
) -> tuple[Degrees, Degrees]:
    """resolve (start, end) climb angles for VERTICAL_PROFILE.

    PAPI mode: start = min(setting_angles) - angle_offset_below,
    end = max(setting_angles) + angle_offset_above. both clamped to the
    [MIN, MAX]_VERTICAL_PROFILE_ANGLE envelope. falls back to legacy custom
    bounds if setting_angles is empty.

    CUSTOM mode (or unspecified): operator-supplied angle_start / angle_end,
    each clamped, with legacy 1.9°/6.5° fallbacks when not set.
    """
    source = (config.angle_source or "CUSTOM").upper()
    if source == "PAPI" and setting_angles:
        offset_above = config.angle_offset_above if config.angle_offset_above is not None else 0.0
        offset_below = config.angle_offset_below if config.angle_offset_below is not None else 0.0
        start = min(setting_angles) - offset_below
        end = max(setting_angles) + offset_above
    else:
        start = (
            config.angle_start if config.angle_start is not None else DEFAULT_VERTICAL_PROFILE_START
        )
        end = config.angle_end if config.angle_end is not None else DEFAULT_VERTICAL_PROFILE_END

    start = _clamp_vp_angle(start)
    end = _clamp_vp_angle(end)
    if start >= end:
        # tolerate degenerate input by falling back to the legacy band so the
        # trajectory still produces a non-zero climb.
        start = MIN_VERTICAL_PROFILE_ANGLE_DEG
        end = MAX_VERTICAL_PROFILE_ANGLE_DEG
    return start, end


def determine_end_position(
    center: Point3D,
    config: ResolvedConfig,
    method: InspectionMethod,
    runway_heading: Degrees,
    glide_slope: Degrees,
    setting_angles: list[Degrees] | None = None,
) -> Point3D:
    """compute end position of inspection pass based on method and geometry."""
    approach = _opposite_bearing(runway_heading)

    match method:
        case InspectionMethod.HORIZONTAL_RANGE:
            radius = config.horizontal_distance or MIN_ARC_RADIUS
            half_sweep = DEFAULT_SWEEP_ANGLE if config.sweep_angle is None else config.sweep_angle
            angle = approach + half_sweep
            lon, lat = point_at_distance(center.lon, center.lat, angle, radius)
            alt = center.alt + radius * math.tan(math.radians(glide_slope))

            return Point3D(lon=lon, lat=lat, alt=alt + config.altitude_offset)

        case InspectionMethod.VERTICAL_PROFILE:
            distance = (
                config.horizontal_distance
                if config.horizontal_distance is not None
                else DEFAULT_HORIZONTAL_DISTANCE
            )
            _, end_angle = resolve_vertical_profile_angles(config, setting_angles)
            lon, lat = point_at_distance(center.lon, center.lat, approach, distance)
            alt = center.alt + distance * math.tan(math.radians(end_angle))

            return Point3D(lon=lon, lat=lat, alt=alt + config.altitude_offset)

    raise ValueError(f"unsupported inspection method: {method}")


def _insert_video_hover_waypoints(
    waypoints: list[WaypointData],
    config: ResolvedConfig,
) -> list[WaypointData]:
    """annotate first/last measurement with RECORDING_START / RECORDING_STOP.

    multi-waypoint case (VP / HR / FO / SS / approach-descent): earlier shape
    wrapped the pass with two standalone HOVER bookends sharing
    `(lat, lon, alt)` with the first/last measurement. that left three
    placemarks collocated at the same physical point, so the inter-placemark
    legs collapsed to 0 - which broke the WPML damping range, made
    `gimbalEvenlyRotate` rates undefined, and forced the drone to
    brake-thread-accelerate at every measurement boundary. instead the
    recording dwell now rides directly on the first and last measurement:
    the drone slows to those waypoints, holds for
    `config.recording_setup_duration` so the camera latency is absorbed,
    fires `startRecord` / `stopRecord` on arrival, and the rest of the
    measurements fly through as one continuous arc/climb. mirrors the
    structure of DJI's own `docs/specs/PAPI 22.kmz` reference export.

    single-waypoint case (HOVER_POINT_LOCK / MEHT_CHECK): the drone parks at
    a single hover position by design, so collocated bookends cannot be
    avoided - the start and stop actions cannot ride on the same waypoint
    or one overwrites the other. fall back to the legacy wrap (HOVER_START,
    original, HOVER_STOP) which preserves both actions and the dwell sequence
    that single-hover inspections need.
    """
    if not waypoints:
        return waypoints

    setup_dur = config.recording_setup_duration

    if len(waypoints) == 1:
        only = waypoints[0]
        start_hover = WaypointData(
            lon=only.lon,
            lat=only.lat,
            alt=only.alt,
            heading=only.heading,
            speed=only.speed,
            waypoint_type=WaypointType.HOVER,
            camera_action=CameraAction.RECORDING_START,
            camera_target=only.camera_target,
            inspection_id=only.inspection_id,
            hover_duration=setup_dur,
            gimbal_pitch=only.gimbal_pitch,
        )
        stop_hover = WaypointData(
            lon=only.lon,
            lat=only.lat,
            alt=only.alt,
            heading=only.heading,
            speed=only.speed,
            waypoint_type=WaypointType.HOVER,
            camera_action=CameraAction.RECORDING_STOP,
            camera_target=only.camera_target,
            inspection_id=only.inspection_id,
            hover_duration=setup_dur,
            gimbal_pitch=only.gimbal_pitch,
        )
        return [start_hover, only, stop_hover]

    waypoints[0].camera_action = CameraAction.RECORDING_START
    waypoints[0].hover_duration = setup_dur
    waypoints[-1].camera_action = CameraAction.RECORDING_STOP
    waypoints[-1].hover_duration = setup_dur
    return waypoints


def _apply_terrain_delta(
    waypoints: list[WaypointData],
    center: Point3D,
    elevation_provider,
) -> None:
    """shift waypoint altitudes by terrain difference from center point.

    center.alt is the LHA target altitude (the surveyed PAPI position - NOT a
    ground-truthed terrain reading). each waypoint's altitude is bumped by
    `terrain_at_wp - terrain_at_center` so the commanded AGL is preserved as
    the path follows terrain undulation. gimbal pitch is recomputed against the
    shifted altitude. note that this preserves AGL by construction, not the
    elevation angle from the LHA - PAPI methods use
    `_apply_papi_glide_slope_terrain` instead so the angle is preserved.
    """
    if not elevation_provider or not waypoints:
        return

    # batch query all waypoint positions + center
    points = [(wp.lat, wp.lon) for wp in waypoints]
    points.append((center.lat, center.lon))
    elevations = elevation_provider.get_elevations_batch(points)
    if len(elevations) != len(points):
        raise TrajectoryGenerationError(f"expected {len(points)} elevations, got {len(elevations)}")

    ground_at_center = elevations[-1]
    for i, wp in enumerate(waypoints):
        terrain_delta = elevations[i] - ground_at_center
        wp.alt += terrain_delta

        # recalculate gimbal pitch - original was computed at pre-terrain altitude
        if wp.camera_target:
            wp.gimbal_pitch = elevation_angle(
                wp.lon,
                wp.lat,
                wp.alt,
                center.lon,
                center.lat,
                center.alt,
            )


def _apply_papi_glide_slope_terrain(
    waypoints: list[WaypointData],
    center: Point3D,
    fixed_angle: Degrees | None,
    elevation_provider,
    altitude_offset: float = 0.0,
) -> None:
    """recompute PAPI waypoint altitudes from per-waypoint elevation angle to LHA.

    the terrain-following invariant for PAPI methods is "preserve elevation angle
    from LHA," not "preserve AGL." `_apply_terrain_delta` shifts by terrain delta
    and silently drifts the angle below the all-white-zone edge on rough terrain.
    this helper rebuilds each measurement/hover altitude geometrically so the
    angle survives undulation.

    `fixed_angle` carries the constant arc-side angle for HORIZONTAL_RANGE
    (typically `max(setting_angles) + offset`) and the descent angle for
    APPROACH_DESCENT. when None - the VERTICAL_PROFILE case - the per-waypoint
    commanded angle is recovered from the pre-shift altitude, which is itself
    geometric (`center.alt + horiz * tan(angle)`).

    `center` is the geometry anchor for the altitude rebuild: the LHA centroid
    (raised by the center-height reference offset when LENS / CUSTOM) for
    HORIZONTAL_RANGE / VERTICAL_PROFILE, the runway touchpoint for
    APPROACH_DESCENT (its glide slope is anchored on the touchpoint, not the
    PAPI). gimbal pitch is recomputed toward each waypoint's own camera_target,
    which is that same LHA centroid for every PAPI method.

    `altitude_offset` is the operator-set vertical bias from `ResolvedConfig`
    that every PAPI generator bakes into `wp.alt` at emission time. the rebuild
    branch (`fixed_angle is not None and horiz > 0`) discards `wp.alt` for the
    geometric formula, so it must re-add the offset; the `else` branch keeps
    `wp.alt` and the offset rides through untouched - re-adding there would
    double-count.

    AGL floor: if the geometric altitude would put a waypoint below
    `MIN_TRANSIT_ALTITUDE_AGL_M` over local terrain, the altitude is clamped
    upward to that floor. clamping breaks the angle invariant for that single
    waypoint but keeps the drone safe; downstream PAPI angle-band validation
    becomes a regression net for cases the clamp could not rescue (no glide-slope
    solution exists at all). non-PAPI methods keep `_apply_terrain_delta`.
    """
    if not elevation_provider or not waypoints:
        return

    points = [(wp.lat, wp.lon) for wp in waypoints]
    elevations = elevation_provider.get_elevations_batch(points)
    if len(elevations) != len(points):
        raise TrajectoryGenerationError(f"expected {len(points)} elevations, got {len(elevations)}")

    for wp, terrain in zip(waypoints, elevations):
        if wp.waypoint_type not in (WaypointType.MEASUREMENT, WaypointType.HOVER):
            continue

        horiz = distance_between(wp.lon, wp.lat, center.lon, center.lat)
        if fixed_angle is not None and horiz > 0:
            geometric_alt = (
                center.alt + horiz * math.tan(math.radians(fixed_angle)) + altitude_offset
            )
        else:
            # VERTICAL_PROFILE wps share (lon, lat) and encode angle in pre-shift alt;
            # zero horiz also falls back to the pre-shift altitude. both branches
            # keep the generator's altitude_offset baked in - do not re-add it.
            geometric_alt = wp.alt

        agl_floor = terrain + MIN_TRANSIT_ALTITUDE_AGL_M
        wp.alt = max(geometric_alt, agl_floor)

        # gimbal aims at the LHA center - carried on camera_target by every PAPI
        # method. for HR/VP camera_target IS `center`, so this is angle-neutral.
        if wp.camera_target:
            target = wp.camera_target
            wp.gimbal_pitch = elevation_angle(
                wp.lon,
                wp.lat,
                wp.alt,
                target.lon,
                target.lat,
                target.alt,
            )


def _apply_camera_actions(waypoints: list[WaypointData]):
    """set lead-in and lead-out waypoints to NONE camera action.

    preserves RECORDING_START/RECORDING_STOP on video capture hover waypoints.
    """
    if len(waypoints) >= 2:
        if waypoints[0].camera_action not in (
            CameraAction.RECORDING_START,
            CameraAction.RECORDING_STOP,
        ):
            waypoints[0].camera_action = CameraAction.NONE
        if waypoints[-1].camera_action not in (
            CameraAction.RECORDING_START,
            CameraAction.RECORDING_STOP,
        ):
            waypoints[-1].camera_action = CameraAction.NONE
