"""per-method handlers - dispatch a resolved inspection to its path computation."""

from ..types import (
    DEFAULT_RUNWAY_HORIZONTAL_RANGE_HEIGHT,
    MethodContext,
    MethodPrep,
    WaypointData,
)
from .approach_descent import calculate_approach_descent_path
from .fly_over import calculate_fly_over_path
from .horizontal_range import calculate_arc_path
from .hover_point_lock import calculate_hover_point_lock_path
from .meht_check import calculate_meht_check_path
from .parallel_side_sweep import calculate_parallel_side_sweep_path
from .surface_scan import calculate_surface_scan_path
from .vertical_profile import calculate_vertical_path


def _horizontal_range_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for HORIZONTAL_RANGE method."""
    return calculate_arc_path(
        ctx.center, ctx.runway_heading, ctx.glide_slope, ctx.config, ctx.inspection.id, ctx.speed
    )


def _runway_horizontal_range_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for RUNWAY_HORIZONTAL_RANGE - constant-altitude REL arc around the touchpoint."""
    height = (
        ctx.config.height_above_lights
        if ctx.config.height_above_lights is not None
        else DEFAULT_RUNWAY_HORIZONTAL_RANGE_HEIGHT
    )
    # angle is unused when height_override is set; center is the touchpoint.
    return calculate_arc_path(
        ctx.center,
        ctx.runway_heading,
        0.0,
        ctx.config,
        ctx.inspection.id,
        ctx.speed,
        height_override=height,
    )


def _vertical_profile_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for VERTICAL_PROFILE method."""
    return calculate_vertical_path(
        ctx.center, ctx.runway_heading, ctx.config, ctx.inspection.id, ctx.speed, ctx.setting_angles
    )


def _approach_descent_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for APPROACH_DESCENT method."""
    if prep.meht_point is None:
        raise ValueError("approach-descent requires a MEHT point")
    return calculate_approach_descent_path(
        prep.meht_point,
        ctx.center,
        ctx.runway_heading,
        ctx.glide_slope,
        ctx.config,
        ctx.inspection.id,
        ctx.speed,
    )


def _fly_over_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for FLY_OVER method."""
    if not ctx.ordered_lhas:
        raise ValueError("fly-over requires ordered LHA positions")
    return calculate_fly_over_path(ctx.ordered_lhas, ctx.config, ctx.inspection.id, ctx.speed)


def _parallel_side_sweep_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for PARALLEL_SIDE_SWEEP method."""
    if not ctx.ordered_lhas:
        raise ValueError("parallel-side-sweep requires ordered LHA positions")
    if prep.runway_center is None:
        raise ValueError("parallel-side-sweep requires a runway centerline reference point")
    return calculate_parallel_side_sweep_path(
        ctx.ordered_lhas,
        prep.runway_center,
        ctx.config,
        ctx.inspection.id,
        ctx.speed,
        elevation_provider=ctx.elevation_provider,
    )


def _hover_point_lock_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for HOVER_POINT_LOCK method."""
    if prep.target_lha_pos is None:
        raise ValueError("hover-point-lock requires a target LHA position")
    return calculate_hover_point_lock_path(
        prep.target_lha_pos,
        prep.target_agl_type or "",
        ctx.runway_heading,
        ctx.config,
        ctx.inspection.id,
        ctx.speed,
    )


def _meht_check_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for MEHT_CHECK method."""
    if prep.target_lha_pos is None:
        raise ValueError("meht-check requires a computed MEHT position")
    return calculate_meht_check_path(
        prep.target_lha_pos, ctx.center, ctx.config, ctx.inspection.id, ctx.speed
    )


def _surface_scan_handler(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """handler for SURFACE_SCAN method."""
    if prep.scan_surface is None:
        raise ValueError("surface scan requires a target surface")
    return calculate_surface_scan_path(
        prep.scan_surface,
        ctx.config,
        ctx.inspection.id,
        ctx.speed,
        sensor_fov=ctx.drone.sensor_fov if ctx.drone else None,
        elevation_provider=ctx.elevation_provider,
    )
