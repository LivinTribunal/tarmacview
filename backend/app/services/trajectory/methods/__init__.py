"""inspection method registry - maps InspectionMethod enum to path computation."""

from dataclasses import dataclass
from typing import Callable

from app.core.enums import InspectionMethod

from ..helpers import (
    _apply_papi_glide_slope_terrain,
    _insert_video_hover_waypoints,
)
from ..types import MethodContext, MethodPrep, WaypointData
from ._dispatch import (
    _approach_descent_handler,
    _fly_over_handler,
    _horizontal_range_handler,
    _hover_point_lock_handler,
    _meht_check_handler,
    _parallel_side_sweep_handler,
    _surface_scan_handler,
    _vertical_profile_handler,
)
from ._prepare import (
    _prepare_approach_descent,
    _prepare_fly_over,
    _prepare_horizontal_range,
    _prepare_hover_point_lock,
    _prepare_meht_check,
    _prepare_parallel_side_sweep,
    _prepare_surface_scan,
    _prepare_vertical_profile,
)
from .approach_descent import resolve_descent_angle


@dataclass(frozen=True)
class MethodSpec:
    """one inspection method's registration: prepare fn, handler, papi flag.

    adding a method is a single entry here plus its prepare + handler - the
    registries and the papi-glide-slope set are all derived from this list.
    is_papi_glide_slope marks the methods whose per-waypoint glide-slope is
    rebuilt over terrain (angle-preserving) instead of preserving commanded AGL.
    """

    method: InspectionMethod
    prepare: Callable[[MethodContext], MethodPrep]
    handler: Callable[[MethodContext, MethodPrep], list[WaypointData]]
    is_papi_glide_slope: bool = False


METHOD_SPECS: list[MethodSpec] = [
    MethodSpec(
        InspectionMethod.HORIZONTAL_RANGE,
        _prepare_horizontal_range,
        _horizontal_range_handler,
        is_papi_glide_slope=True,
    ),
    MethodSpec(
        InspectionMethod.VERTICAL_PROFILE,
        _prepare_vertical_profile,
        _vertical_profile_handler,
        is_papi_glide_slope=True,
    ),
    MethodSpec(
        InspectionMethod.APPROACH_DESCENT,
        _prepare_approach_descent,
        _approach_descent_handler,
        is_papi_glide_slope=True,
    ),
    MethodSpec(InspectionMethod.FLY_OVER, _prepare_fly_over, _fly_over_handler),
    MethodSpec(
        InspectionMethod.PARALLEL_SIDE_SWEEP,
        _prepare_parallel_side_sweep,
        _parallel_side_sweep_handler,
    ),
    MethodSpec(
        InspectionMethod.HOVER_POINT_LOCK, _prepare_hover_point_lock, _hover_point_lock_handler
    ),
    MethodSpec(InspectionMethod.MEHT_CHECK, _prepare_meht_check, _meht_check_handler),
    MethodSpec(InspectionMethod.SURFACE_SCAN, _prepare_surface_scan, _surface_scan_handler),
]

# registries derived from the single spec list - no hand-synced dicts.
PREPARE_REGISTRY: dict[InspectionMethod, Callable] = {
    spec.method: spec.prepare for spec in METHOD_SPECS
}
METHOD_REGISTRY: dict[InspectionMethod, Callable] = {
    spec.method: spec.handler for spec in METHOD_SPECS
}
# PAPI methods - per-waypoint glide-slope recompute (angle-preserving over terrain)
_PAPI_GLIDE_SLOPE_METHODS = frozenset(
    spec.method for spec in METHOD_SPECS if spec.is_papi_glide_slope
)


def compute_measurement_trajectory(ctx: MethodContext, prep: MethodPrep) -> list[WaypointData]:
    """dispatch to the path computation matching the inspection method."""
    method = ctx.inspection.method
    handler = METHOD_REGISTRY.get(method)
    if handler is None:
        raise ValueError(f"unsupported inspection method: {method}")

    waypoints = handler(ctx, prep)

    # terrain correction before video wrapper
    # PAPI methods preserve the elevation angle from the LHA (all-white-zone edge);
    # other methods preserve commanded AGL.
    if method in _PAPI_GLIDE_SLOPE_METHODS:
        terrain_anchor = ctx.center
        if method == InspectionMethod.HORIZONTAL_RANGE:
            # arc altitude uses the orchestrator-resolved glide_slope (typically
            # max(setting_angles) + angle_offset), so feed it back to the recompute.
            fixed_angle = ctx.glide_slope
        elif method == InspectionMethod.APPROACH_DESCENT:
            # the descent glide slope is anchored on the meht point over the
            # threshold, not the LHA.
            fixed_angle = resolve_descent_angle(ctx.config, ctx.glide_slope)
            terrain_anchor = prep.meht_point if prep.meht_point is not None else ctx.center
        else:
            # vertical profile waypoints encode their own commanded angle in the
            # pre-shift altitude; recover per-waypoint instead of using a constant.
            fixed_angle = None
        _apply_papi_glide_slope_terrain(
            waypoints,
            terrain_anchor,
            fixed_angle,
            ctx.elevation_provider,
            altitude_offset=ctx.config.altitude_offset,
        )

    # video mode - wrap with recording start/stop hover waypoints
    if ctx.config.capture_mode == "VIDEO_CAPTURE":
        waypoints = _insert_video_hover_waypoints(waypoints, ctx.config)

    return waypoints
