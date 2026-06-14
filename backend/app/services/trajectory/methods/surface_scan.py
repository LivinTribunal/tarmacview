"""surface-scan inspection-method path generator: one serpentine pass imaging pavement."""

import math
from dataclasses import dataclass
from uuid import UUID

from app.core.enums import CameraAction, WaypointType
from app.utils.geo import bearing_between, linestring_length, point_at_distance

from ..config_resolver import _resolve_measurement_speed
from ..helpers import get_surface_centerline_points
from ..types import (
    DEFAULT_SURFACE_SCAN_FRONTLAP_PERCENT,
    DEFAULT_SURFACE_SCAN_GIMBAL,
    DEFAULT_SURFACE_SCAN_HEIGHT,
    DEFAULT_SURFACE_SCAN_SIDELAP_PERCENT,
    Degrees,
    Meters,
    MetersPerSecond,
    Point3D,
    ResolvedConfig,
    WaypointData,
)
from .fly_over import MIN_TILT_BELOW_HORIZONTAL


@dataclass
class ScanPlan:
    """resolved geometry for a serpentine surface scan."""

    axis: Degrees
    origin: Point3D
    surface_alt: Meters
    total_length: Meters
    length_from: Meters
    length_to: Meters
    near_edge: Meters
    far_edge: Meters
    orientation: str
    step_span: Meters
    run_length: Meters
    n_runs: int
    footprint: Meters | None
    along_spacing: Meters | None
    optimal_runs: int | None
    scan_height: Meters
    gimbal: Degrees


def _angular_diff(a: Degrees, b: Degrees) -> Degrees:
    """absolute heading difference wrapped to [0, 180]."""
    d = abs(a - b) % 360.0
    return d if d <= 180.0 else 360.0 - d


def _move(lon: float, lat: float, bearing: Degrees, signed_dist: Meters) -> tuple[float, float]:
    """offset a point by a signed distance along a bearing (negative walks the reciprocal)."""
    if signed_dist >= 0:
        return point_at_distance(lon, lat, bearing % 360.0, signed_dist)
    return point_at_distance(lon, lat, (bearing + 180.0) % 360.0, -signed_dist)


def compute_scan_footprint(scan_height: Meters, gimbal: Degrees, sensor_fov: Degrees | None):
    """per-image ground footprint of a forward-tilted camera, or None when unknown.

    footprint = 2 * (h / cos(theta)) * tan(HFOV / 2), theta = off-nadir tilt
    (90 + gimbal). returns None when sensor_fov is unset/invalid.
    """
    if not sensor_fov or sensor_fov <= 0:
        return None
    theta = math.radians(90.0 + gimbal)
    cos_theta = math.cos(theta)
    if cos_theta <= 0:
        return None
    return 2.0 * (scan_height / cos_theta) * math.tan(math.radians(sensor_fov / 2.0))


def _resolve_axis(surface) -> tuple[list[Point3D], Degrees]:
    """ordered centerline points (axis-aligned) plus the scan axis bearing.

    axis = surface.heading when set, else the centerline first-to-last bearing.
    a reciprocal heading walks the centerline reversed (no-op for runways).
    """
    points = get_surface_centerline_points(surface)
    if len(points) < 2:
        raise ValueError("surface scan requires a surface centerline with at least two vertices")
    centerline_bearing = bearing_between(
        points[0].lon, points[0].lat, points[-1].lon, points[-1].lat
    )
    axis = surface.heading if surface.heading is not None else centerline_bearing
    if _angular_diff(axis, centerline_bearing) > 90.0:
        points = list(reversed(points))
    return points, axis % 360.0


def _resolve_length_interval(config: ResolvedConfig, total_length: Meters) -> tuple[Meters, Meters]:
    """resolve the along-track [from, to] window, clamped to [0, total_length].

    FULL = whole surface; MAX_LENGTH caps the far end at scan_length_to;
    INTERVAL trims both ends. INTERVAL with from >= to is rejected at the
    schema layer (422), so a degenerate window here falls back to FULL.
    """
    mode = (config.scan_length_mode or "FULL").upper()
    if mode == "INTERVAL":
        start = config.scan_length_from if config.scan_length_from is not None else 0.0
        end = config.scan_length_to if config.scan_length_to is not None else total_length
    elif mode == "MAX_LENGTH":
        start = 0.0
        end = config.scan_length_to if config.scan_length_to is not None else total_length
    else:
        start, end = 0.0, total_length

    start = max(0.0, min(start, total_length))
    end = max(0.0, min(end, total_length))
    if end <= start:
        return 0.0, total_length
    return start, end


def _resolve_width_band(config: ResolvedConfig, surface) -> tuple[Meters, Meters]:
    """resolve the perpendicular band as signed offsets (positive = right of axis).

    full width (no scan_width) centers on the centerline; a narrowed band sits on
    the LEFT or RIGHT of the bearing. returns (near_edge, far_edge).
    """
    full_width = surface.width if surface.width and surface.width > 0 else 0.0
    if config.scan_width is None or config.scan_width <= 0:
        half = full_width / 2.0
        return -half, half

    band = config.scan_width
    side = (config.scan_width_side or "RIGHT").upper()
    if side == "LEFT":
        return 0.0, -band
    return 0.0, band


def plan_surface_scan(surface, config: ResolvedConfig, sensor_fov: Degrees | None) -> ScanPlan:
    """resolve the full scan geometry: axis, interval, band, run count, footprint.

    raises ValueError when the gimbal is near horizontal or when the run count
    must be auto-derived but the sensor FOV is unavailable.
    """
    scan_height = (
        config.scan_height if config.scan_height is not None else DEFAULT_SURFACE_SCAN_HEIGHT
    )
    gimbal = (
        config.camera_gimbal_angle
        if config.camera_gimbal_angle is not None
        else DEFAULT_SURFACE_SCAN_GIMBAL
    )
    if gimbal > -MIN_TILT_BELOW_HORIZONTAL:
        raise ValueError(
            f"surface scan requires camera_gimbal_angle <= -{MIN_TILT_BELOW_HORIZONTAL:.0f} "
            f"(got {gimbal:.2f}); a near-horizontal gimbal cannot frame the pavement"
        )
    sidelap = (
        config.scan_sidelap_percent
        if config.scan_sidelap_percent is not None
        else DEFAULT_SURFACE_SCAN_SIDELAP_PERCENT
    )
    frontlap = (
        config.scan_frontlap_percent
        if config.scan_frontlap_percent is not None
        else DEFAULT_SURFACE_SCAN_FRONTLAP_PERCENT
    )

    points, axis = _resolve_axis(surface)
    origin = points[0]
    surface_alt = sum(p.alt for p in points) / len(points)
    total_length = linestring_length([p.to_tuple() for p in points])

    start, end = _resolve_length_interval(config, total_length)
    length_extent = end - start
    near_edge, far_edge = _resolve_width_band(config, surface)
    width_extent = abs(far_edge - near_edge)

    orientation = (config.scan_run_orientation or "LENGTH_WISE").upper()
    # step_span is the dimension the runs tile to reach the target sidelap;
    # run_length is the dimension each run sweeps.
    if orientation == "WIDTH_WISE":
        step_span, run_length = length_extent, width_extent
    else:
        step_span, run_length = width_extent, length_extent

    footprint = compute_scan_footprint(scan_height, gimbal, sensor_fov)
    optimal = None
    # along-track sample spacing: frontlap shrinks the footprint forward step
    # (0% reproduces the original footprint-spacing tiling). guard the
    # divide-down at high frontlap, mirroring the sidelap effective-step clamp.
    along_spacing = None
    if footprint and footprint > 0:
        effective = footprint * (1.0 - sidelap / 100.0)
        if effective <= 0:
            effective = footprint
        optimal = max(1, math.ceil(step_span / effective)) if step_span > 0 else 1

        along_spacing = footprint * (1.0 - frontlap / 100.0)
        if along_spacing <= 0:
            along_spacing = footprint

    override = config.scan_run_count
    if override is not None and override >= 1:
        n_runs = int(override)
    elif optimal is not None:
        n_runs = optimal
    else:
        raise ValueError(
            "surface scan needs the drone sensor FOV to auto-compute the run count "
            "- set the drone's sensor_fov or provide an explicit run count"
        )

    return ScanPlan(
        axis=axis,
        origin=origin,
        surface_alt=surface_alt,
        total_length=total_length,
        length_from=start,
        length_to=end,
        near_edge=near_edge,
        far_edge=far_edge,
        orientation=orientation,
        step_span=step_span,
        run_length=run_length,
        n_runs=n_runs,
        footprint=footprint,
        along_spacing=along_spacing,
        optimal_runs=optimal,
        scan_height=scan_height,
        gimbal=gimbal,
    )


def scan_path_distance(plan: ScanPlan) -> Meters:
    """approximate total flown length of the serpentine: runs plus cross-steps."""
    spacing = plan.step_span / plan.n_runs if plan.n_runs else 0.0
    return plan.n_runs * plan.run_length + max(0, plan.n_runs - 1) * spacing


def _samples_along(a: Meters, b: Meters, spacing: Meters | None, is_video: bool) -> list[Meters]:
    """ordered sample distances along a run, a -> b.

    video keeps just the run endpoints; photo tiles capture points by the
    along-track spacing (footprint reduced by frontlap; falling back to
    endpoints when the spacing is unknown).
    """
    if is_video or not spacing or spacing <= 0:
        return [a, b]
    span = abs(b - a)
    steps = max(1, math.ceil(span / spacing))
    sign = 1.0 if b >= a else -1.0
    step = span / steps
    return [a + sign * step * k for k in range(steps + 1)]


def calculate_surface_scan_path(
    surface,
    config: ResolvedConfig,
    inspection_id: UUID | None,
    speed: MetersPerSecond,
    sensor_fov: Degrees | None = None,
    elevation_provider=None,
    plan: ScanPlan | None = None,
) -> list[WaypointData]:
    """generate one serpentine pass sweeping a surface at low altitude.

    runs are laid parallel to the surface axis (LENGTH_WISE) or across it
    (WIDTH_WISE), centered in evenly-spaced strips. each waypoint is trailed back
    along its run by the fly-over offset so the forward-tilted camera images the
    intended strip; altitude follows terrain to preserve the commanded AGL.
    """
    if plan is None:
        plan = plan_surface_scan(surface, config, sensor_fov)

    perp_right = (plan.axis + 90.0) % 360.0
    back_offset = plan.scan_height * math.tan(math.radians(90.0 + plan.gimbal))
    measurement_speed = _resolve_measurement_speed(config, speed)
    is_video = config.capture_mode == "VIDEO_CAPTURE"
    cam_action = CameraAction.RECORDING if is_video else CameraAction.PHOTO_CAPTURE

    # NATURAL starts run 0 forward; REVERSED starts from the opposite end.
    base_forward = not config.direction_reversed

    def at(along: Meters, perp: Meters) -> tuple[float, float]:
        """imaged ground point at an along-track distance and signed perp offset."""
        lon, lat = _move(plan.origin.lon, plan.origin.lat, plan.axis, along)
        return _move(lon, lat, perp_right, perp)

    waypoints: list[WaypointData] = []
    for i in range(plan.n_runs):
        forward = base_forward if i % 2 == 0 else not base_forward
        if plan.orientation == "WIDTH_WISE":
            spacing = plan.step_span / plan.n_runs if plan.n_runs else 0.0
            along = plan.length_from + (i + 0.5) * spacing
            w_from, w_to = (
                (plan.near_edge, plan.far_edge) if forward else (plan.far_edge, plan.near_edge)
            )
            run_heading = perp_right if w_to >= w_from else (perp_right + 180.0) % 360.0
            samples = _samples_along(w_from, w_to, plan.along_spacing, is_video)
            run_points = [at(along, s) for s in samples]
        else:
            spacing = plan.step_span / plan.n_runs if plan.n_runs else 0.0
            sign = 1.0 if plan.far_edge >= plan.near_edge else -1.0
            perp = plan.near_edge + sign * (i + 0.5) * spacing
            l_from, l_to = (
                (plan.length_from, plan.length_to)
                if forward
                else (plan.length_to, plan.length_from)
            )
            run_heading = plan.axis if l_to >= l_from else (plan.axis + 180.0) % 360.0
            samples = _samples_along(l_from, l_to, plan.along_spacing, is_video)
            run_points = [at(s, perp) for s in samples]

        reverse_heading = (run_heading + 180.0) % 360.0
        for lon, lat in run_points:
            imaged = Point3D(lon=lon, lat=lat, alt=plan.surface_alt)
            if abs(back_offset) > 0:
                wp_lon, wp_lat = point_at_distance(lon, lat, reverse_heading, back_offset)
            else:
                wp_lon, wp_lat = lon, lat
            waypoints.append(
                WaypointData(
                    lon=wp_lon,
                    lat=wp_lat,
                    alt=plan.surface_alt + plan.scan_height + config.altitude_offset,
                    heading=run_heading,
                    speed=measurement_speed,
                    waypoint_type=WaypointType.MEASUREMENT,
                    camera_action=cam_action,
                    camera_target=imaged,
                    inspection_id=inspection_id,
                    gimbal_pitch=plan.gimbal,
                )
            )

    _apply_scan_terrain(waypoints, plan.surface_alt, elevation_provider)
    return waypoints


def _apply_scan_terrain(
    waypoints: list[WaypointData], surface_alt: Meters, elevation_provider
) -> None:
    """lift each waypoint by the terrain delta from the surface so AGL is preserved.

    mirrors parallel-side-sweep: the commanded altitude is surface ground +
    scan_height; over undulating terrain the waypoint is bumped by
    (terrain_at_wp - terrain_at_surface) so the height above local ground holds.
    """
    if not elevation_provider or not waypoints:
        return
    points = [(wp.lat, wp.lon) for wp in waypoints]
    elevations = elevation_provider.get_elevations_batch(points)
    if len(elevations) != len(waypoints):
        return
    for wp, terrain in zip(waypoints, elevations):
        wp.alt += terrain - surface_alt
