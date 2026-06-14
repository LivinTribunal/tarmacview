"""per-method pre-computation - path distance, default speed, target resolution."""

import math

from app.core.exceptions import TrajectoryGenerationError
from app.utils.geo import distance_between, linestring_length, point_at_distance

from ..helpers import (
    determine_end_position,
    determine_start_position,
    find_lha_by_id,
    find_lha_in_surfaces,
    get_runway_centerline_midpoint,
    get_threshold_position,
    get_touchpoint_position,
    resolve_scan_surface,
)
from ..types import (
    DEFAULT_DESCENT_START_DISTANCE,
    DEFAULT_FLY_OVER_SPEED,
    DEFAULT_PARALLEL_SPEED,
    DEFAULT_SURFACE_SCAN_SPEED,
    MethodContext,
    MethodPrep,
    Point3D,
)
from .surface_scan import plan_surface_scan, scan_path_distance


def _label(ctx: MethodContext) -> str:
    """inspection label used in error messages: '<template name> #<sequence>'."""
    return f"{ctx.template.name} #{ctx.inspection.sequence_order}"


# note: determine_start_position / determine_end_position return symmetric arc
# endpoints; config.direction_reversed does not flow through these helpers and
# is consumed inside calculate_arc_path. path_dist (chord length) is symmetric,
# so it stays correct - but a future refactor that uses start/end for orientation
# or runway-cross prediction must read direction_reversed off config directly.
def _prepare_horizontal_range(ctx: MethodContext) -> MethodPrep:
    """pre-computation for horizontal range."""
    start = determine_start_position(
        ctx.center, ctx.config, ctx.inspection.method, ctx.runway_heading, ctx.glide_slope
    )
    end = determine_end_position(
        ctx.center, ctx.config, ctx.inspection.method, ctx.runway_heading, ctx.glide_slope
    )
    path_dist = distance_between(start.lon, start.lat, end.lon, end.lat)
    return MethodPrep(
        path_distance=path_dist,
        default_speed=ctx.default_speed,
        density_for_speed=ctx.config.measurement_density,
        needs_fov_check=True,
    )


# same symmetric-endpoint caveat as _prepare_horizontal_range above.
def _prepare_vertical_profile(ctx: MethodContext) -> MethodPrep:
    """pre-computation for vertical profile."""
    setting_angles = ctx.setting_angles or []
    start = determine_start_position(
        ctx.center,
        ctx.config,
        ctx.inspection.method,
        ctx.runway_heading,
        ctx.glide_slope,
        setting_angles=setting_angles,
    )
    end = determine_end_position(
        ctx.center,
        ctx.config,
        ctx.inspection.method,
        ctx.runway_heading,
        ctx.glide_slope,
        setting_angles=setting_angles,
    )
    path_dist = distance_between(start.lon, start.lat, end.lon, end.lat)
    return MethodPrep(
        path_distance=path_dist,
        default_speed=ctx.default_speed,
        density_for_speed=ctx.config.measurement_density,
        needs_fov_check=True,
    )


def _prepare_approach_descent(ctx: MethodContext) -> MethodPrep:
    """pre-computation for approach descent."""
    touchpoint = get_touchpoint_position(ctx.template, ctx.surfaces)
    if touchpoint is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: approach-descent requires a runway touchpoint "
            "- set the touchpoint on the runway surface"
        )
    descent_distance = (
        ctx.config.descent_start_distance
        if ctx.config.descent_start_distance is not None
        else DEFAULT_DESCENT_START_DISTANCE
    )
    return MethodPrep(
        path_distance=descent_distance,
        default_speed=ctx.default_speed,
        density_for_speed=ctx.config.measurement_density,
        touchpoint=touchpoint,
    )


def _prepare_fly_over(ctx: MethodContext) -> MethodPrep:
    """pre-computation for fly-over."""
    path_dist = linestring_length([p.to_tuple() for p in ctx.ordered_lhas])
    return MethodPrep(
        path_distance=path_dist,
        default_speed=DEFAULT_FLY_OVER_SPEED,
        density_for_speed=max(len(ctx.ordered_lhas), 2),
    )


def _prepare_parallel_side_sweep(ctx: MethodContext) -> MethodPrep:
    """pre-computation for parallel side sweep."""
    runway_center = get_runway_centerline_midpoint(ctx.template, ctx.surfaces)
    if runway_center is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: parallel-side-sweep requires a runway surface "
            "with a centerline for its target AGL"
        )
    path_dist = linestring_length([p.to_tuple() for p in ctx.ordered_lhas])
    return MethodPrep(
        path_distance=path_dist,
        default_speed=DEFAULT_PARALLEL_SPEED,
        density_for_speed=max(len(ctx.ordered_lhas), 2),
        runway_center=runway_center,
    )


def _prepare_hover_point_lock(ctx: MethodContext) -> MethodPrep:
    """pre-computation for hover-point-lock."""
    selected_id = ctx.config.selected_lha_id
    if selected_id is None:
        raise TrajectoryGenerationError(f"{_label(ctx)}: hover-point-lock requires a selected LHA")
    match = find_lha_by_id(ctx.template, selected_id)
    if match is None:
        match = find_lha_in_surfaces(ctx.surfaces, selected_id)
    if match is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: selected LHA {selected_id} not found in airport"
        )
    target_lha_pos, target_agl = match
    target_agl_type = target_agl.agl_type

    heading_override = None
    for surface in ctx.surfaces:
        if surface.id == target_agl.surface_id and surface.heading:
            heading_override = surface.heading
            break

    return MethodPrep(
        path_distance=0.0,
        default_speed=ctx.default_speed,
        density_for_speed=ctx.config.measurement_density,
        target_lha_pos=target_lha_pos,
        target_agl_type=target_agl_type,
        rwy_heading_override=heading_override,
    )


def _prepare_surface_scan(ctx: MethodContext) -> MethodPrep:
    """pre-computation for surface-scan."""
    surface = resolve_scan_surface(ctx.surfaces, ctx.config.scan_surface_id)
    if surface is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: surface scan requires a target surface - set scan_surface_id"
        )

    sensor_fov = ctx.drone.sensor_fov if ctx.drone is not None else None
    try:
        plan = plan_surface_scan(surface, ctx.config, sensor_fov)
    except ValueError as e:
        raise TrajectoryGenerationError(f"{_label(ctx)}: {e}")

    path_dist = scan_path_distance(plan)
    density = ctx.config.measurement_density
    # along_spacing folds in frontlap, so the speed/frame-rate check sees the
    # actual photo density (equals footprint spacing when frontlap is 0).
    if plan.along_spacing and plan.along_spacing > 0:
        density = max(2, math.ceil(path_dist / plan.along_spacing) + 1)

    # flag an override that is not the FOV-optimal value via the suggestion channel.
    suggestion = None
    if (
        ctx.config.scan_run_count is not None
        and plan.optimal_runs is not None
        and ctx.config.scan_run_count != plan.optimal_runs
    ):
        sidelap = int(ctx.config.scan_sidelap_percent or 0)
        suggestion = (
            f"run count {ctx.config.scan_run_count} may be suboptimal for "
            f"{sidelap}% sidelap - recommended {plan.optimal_runs}"
        )

    return MethodPrep(
        path_distance=path_dist,
        default_speed=DEFAULT_SURFACE_SCAN_SPEED,
        density_for_speed=density,
        rwy_heading_override=plan.axis,
        scan_surface=surface,
        scan_run_count=plan.n_runs,
        scan_footprint=plan.footprint,
        suggestion=suggestion,
    )


def _prepare_meht_check(ctx: MethodContext) -> MethodPrep:
    """pre-computation for meht-check."""
    threshold = get_threshold_position(ctx.template, ctx.surfaces)
    if threshold is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: MEHT check requires runway threshold position"
        )

    # glide slope is already resolved by the orchestrator
    meht_glide_slope = ctx.glide_slope
    dist_from_threshold = None
    for agl in ctx.template.targets:
        if agl.distance_from_threshold is not None:
            dist_from_threshold = agl.distance_from_threshold
            break

    if dist_from_threshold is None:
        raise TrajectoryGenerationError(
            f"{_label(ctx)}: MEHT check requires distance_from_threshold on AGL"
        )

    meht_height = dist_from_threshold * math.tan(math.radians(meht_glide_slope))

    # offset from threshold along reciprocal heading (pilot eye position on glide path)
    approach_bearing = (ctx.runway_heading + 180) % 360
    lon, lat = point_at_distance(
        threshold.lon, threshold.lat, approach_bearing, dist_from_threshold
    )
    meht_point = Point3D(
        lon=lon,
        lat=lat,
        alt=threshold.alt + meht_height + ctx.config.altitude_offset,
    )

    # heading override from linked surface
    heading_override = None
    for agl in ctx.template.targets:
        for surface in ctx.surfaces:
            if surface.id == agl.surface_id and surface.heading is not None:
                heading_override = surface.heading
                break
        if heading_override is not None:
            break

    return MethodPrep(
        path_distance=0.0,
        default_speed=ctx.default_speed,
        target_lha_pos=meht_point,
        target_agl_type="PAPI",
        rwy_heading_override=heading_override,
    )
