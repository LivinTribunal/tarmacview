"""phases 2-4 for a single inspection: config resolve, method compute, validate, reroute."""

from dataclasses import replace
from uuid import UUID

from app.core.enums import CameraAction, InspectionMethod, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.models.inspection import Inspection
from app.models.mission import Mission

from ..config_resolver import (
    check_sensor_fov,
    check_speed_framerate,
    resolve_density,
    resolve_speed,
    resolve_with_defaults,
)
from ..helpers import (
    _apply_camera_actions,
    check_missing_setting_angles,
    derive_observation_angle,
    get_glide_slope_angle,
    get_lha_positions,
    get_lha_positions_from_surfaces,
    get_lha_setting_angle_by_id,
    get_lha_setting_angles,
    get_ordered_lha_positions,
    get_runway_heading,
    get_surface_centerline_midpoint,
    resolve_center_height_offset,
    resolve_scan_surface,
)
from ..methods import (
    _PAPI_GLIDE_SLOPE_METHODS,
    PREPARE_REGISTRY,
    compute_measurement_trajectory,
)
from ..pathfinding import has_line_of_sight, resolve_inspection_collisions
from ..safety_validator import validate_inspection_pass
from ..types import (
    DEFAULT_ANGLE_OFFSET,
    MIN_ARC_RADIUS,
    VERTICAL_POSITION_TOLERANCE_DEG,
    MethodContext,
    MissionData,
    Point3D,
    Violation,
    WaypointData,
)
from ._postprocess import _inject_mission_default, _papi_band_violations


def _process_inspection(
    inspection: Inspection,
    mission: Mission,
    mission_data: MissionData,
    drone,
    default_speed,
    local_geoms,
    resolved_directions: dict[UUID, bool],
    require_perpendicular: bool,
    keep_inside_boundary: bool,
    warnings: list[tuple[str, list[str], str | None]],
    suggestions: list[tuple[str, list[str], str | None]],
) -> tuple[str, list[WaypointData], list[Violation], list[int], float] | None:
    """phases 2-4 for a single inspection.

    resolves config + mission-default injection, runs pre-checks and method
    prep, computes the pass, validates / reroutes, applies the shared papi
    band check, camera actions, and the line-of-sight obstruction scan.

    returns (label, pass_wps, violations, obstructed_wps, buffer_distance) for
    a surviving pass, or None when the inspection is skipped (no LHA positions
    or an empty pass). raises TrajectoryGenerationError on hard failures,
    exactly as the inline loop body did.
    """
    template = inspection.template

    # phase 2 - resolve config and pre-checks
    config = resolve_with_defaults(inspection, template)

    # apply resolved direction from the pre-pass into ResolvedConfig
    config.direction_reversed = resolved_directions.get(inspection.id, False)

    # inject mission-level defaults when neither the inspection nor the template set the
    # field. capture_mode keeps its truthy + str-cast gate; buffer / measurement-speed
    # keep their is-not-None gate (None = mission has no default for the field).
    _inject_mission_default(
        config,
        inspection,
        template,
        "capture_mode",
        str(mission.default_capture_mode) if mission.default_capture_mode else None,
    )
    _inject_mission_default(
        config, inspection, template, "buffer_distance", mission.default_buffer_distance
    )
    _inject_mission_default(
        config,
        inspection,
        template,
        "measurement_speed_override",
        mission.measurement_speed_override,
    )

    # generate suggestions for fields using template defaults
    label = f"{template.name} #{inspection.sequence_order}"
    if not inspection.config or inspection.config.measurement_density is None:
        default_density = (
            template.default_config.measurement_density
            if template.default_config and template.default_config.measurement_density
            else None
        )
        if default_density:
            suggestions.append(
                (
                    f"{label}: no density override - using default ({default_density} pts)",
                    [],
                    None,
                )
            )

    lha_ids = inspection.lha_ids
    lha_positions = get_lha_positions(template, lha_ids)

    # AGL-agnostic methods (hover-point-lock) may have LHAs outside template targets
    if not lha_positions and lha_ids:
        lha_positions = get_lha_positions_from_surfaces(mission_data.surfaces, lha_ids)

    if inspection.method == InspectionMethod.SURFACE_SCAN:
        # surface scan targets a surface, not an AGL. center on its centerline.
        scan_surface = resolve_scan_surface(mission_data.surfaces, config.scan_surface_id)
        if scan_surface is None:
            raise TrajectoryGenerationError(
                f"{label}: surface scan requires a target surface - set scan_surface_id"
            )
        center = get_surface_centerline_midpoint(scan_surface)
        if center is None:
            raise TrajectoryGenerationError(
                f"{label}: surface scan target {scan_surface.identifier} has no usable centerline"
            )
    elif not lha_positions:
        if inspection.method == InspectionMethod.HOVER_POINT_LOCK:
            raise TrajectoryGenerationError(
                f"{template.name} #{inspection.sequence_order}: "
                "hover-point-lock requires a selected LHA"
            )
        warnings.append(
            (
                f"{template.name} #{inspection.sequence_order}: no LHA positions",
                [],
                None,
            )
        )
        return None
    else:
        center = Point3D.center(lha_positions)

    # raise the LHA-centroid aim altitude per the camera center-height reference.
    # center is the camera target + gimbal anchor for every PAPI glide-slope method,
    # and the terrain/altitude anchor for HR/VP - so lifting it moves the whole HR/VP
    # pass and every method's camera aim without touching the generators. APPROACH_DESCENT
    # anchors its altitude on the runway touchpoint, so for it the lift only retargets the
    # camera/gimbal at the lens and leaves the touchpoint-anchored descent path unchanged.
    if inspection.method in _PAPI_GLIDE_SLOPE_METHODS:
        center.alt += resolve_center_height_offset(config, template, lha_ids)

    glide_slope = get_glide_slope_angle(template)
    rwy_heading = get_runway_heading(template, mission_data.surfaces)
    setting_angles = get_lha_setting_angles(template, lha_ids)

    # derive observation angle from lha setting angles for papi methods
    if inspection.method == InspectionMethod.HORIZONTAL_RANGE:
        missing_units = check_missing_setting_angles(template, lha_ids)
        if missing_units:
            units_str = ", ".join(missing_units)
            warnings.append(
                (
                    f"{label}: LHA unit(s) {units_str} missing setting angle "
                    "- computed observation angle may be inaccurate",
                    [],
                    None,
                )
            )

        if setting_angles:
            offset = (
                config.angle_offset_above
                if config.angle_offset_above is not None
                else DEFAULT_ANGLE_OFFSET
            )

            # lha setting angle override - use a specific lha's angle instead of max
            override_id = config.lha_setting_angle_override_id
            if override_id is not None:
                override_angle = get_lha_setting_angle_by_id(template, override_id)
                if override_angle is not None:
                    glide_slope = override_angle + offset
                else:
                    warnings.append(
                        (
                            f"{label}: overridden LHA not found or has no setting angle "
                            "- falling back to max",
                            [],
                            None,
                        )
                    )
                    glide_slope = derive_observation_angle(setting_angles, offset)
            else:
                glide_slope = derive_observation_angle(setting_angles, offset)
        else:
            warnings.append(
                (
                    f"{label}: no setting angles available - falling back to AGL glide slope angle",
                    [],
                    None,
                )
            )

    # ordered LHA positions are used by fly-over and parallel-side-sweep
    ordered_lhas = get_ordered_lha_positions(template, lha_ids)
    if config.direction_reversed and inspection.method in (
        InspectionMethod.FLY_OVER,
        InspectionMethod.PARALLEL_SIDE_SWEEP,
    ):
        ordered_lhas = list(reversed(ordered_lhas))

    # method-specific pre-computation via registry. context carries every
    # always-present input; the resolved speed lands on it before the handler runs.
    prepare_fn = PREPARE_REGISTRY.get(inspection.method)
    if prepare_fn is None:
        raise TrajectoryGenerationError(f"unsupported inspection method: {inspection.method}")

    ctx = MethodContext(
        inspection=inspection,
        config=config,
        center=center,
        runway_heading=rwy_heading,
        glide_slope=glide_slope,
        speed=default_speed,
        default_speed=default_speed,
        setting_angles=setting_angles,
        template=template,
        surfaces=mission_data.surfaces,
        drone=drone,
        elevation_provider=mission_data.elevation_provider,
        ordered_lhas=ordered_lhas,
    )

    prep = prepare_fn(ctx)

    if prep.rwy_heading_override is not None:
        rwy_heading = prep.rwy_heading_override

    # suggest optimal density without overriding user's choice
    _, density_suggestion = resolve_density(inspection.method, setting_angles, config)
    if density_suggestion:
        suggestions.append(
            (
                f"{template.name} #{inspection.sequence_order}: {density_suggestion}",
                [],
                None,
            )
        )

    # method-specific suggestion (e.g. suboptimal surface-scan run count)
    if prep.suggestion:
        suggestions.append((f"{label}: {prep.suggestion}", [], None))

    speed, speed_warning, optimal_speed = resolve_speed(
        prep.path_distance, prep.density_for_speed, drone, prep.default_speed
    )
    if speed_warning:
        warnings.append(
            (
                f"{template.name} #{inspection.sequence_order}: {speed_warning}",
                [],
                None,
            )
        )

    if drone:
        warning = check_speed_framerate(speed, drone, optimal_speed)
        if warning:
            warnings.append((warning, [], "speed_framerate"))

        # separate check for measurement speed when it differs from transit
        if config.measurement_speed_override is not None:
            ms_warning = check_speed_framerate(
                config.measurement_speed_override, drone, optimal_speed
            )
            if ms_warning:
                warnings.append((f"measurement speed: {ms_warning}", [], "speed_framerate"))

    if drone and prep.needs_fov_check:
        fov_distance = config.horizontal_distance or MIN_ARC_RADIUS
        approach = (rwy_heading + 180) % 360
        warning = check_sensor_fov(drone, lha_positions, fov_distance, approach)
        if warning:
            warnings.append((warning, [], None))

    # phase 3 - compute waypoints. rebind the resolved speed + any heading
    # override onto the context before dispatching to the handler.
    ctx = replace(ctx, speed=speed, runway_heading=rwy_heading)
    try:
        pass_wps = compute_measurement_trajectory(ctx, prep)
    except ValueError as e:
        raise TrajectoryGenerationError(str(e))

    # for vertical profiles, add a descent waypoint back to start altitude
    # before validation so transit doesn't start from the top of the sweep
    # and the descent is included in the constraint check
    if (
        inspection.method == InspectionMethod.VERTICAL_PROFILE
        and len(pass_wps) >= 2
        and abs(pass_wps[0].lon - pass_wps[-1].lon) < VERTICAL_POSITION_TOLERANCE_DEG
        and abs(pass_wps[0].lat - pass_wps[-1].lat) < VERTICAL_POSITION_TOLERANCE_DEG
    ):
        pass_wps.append(
            WaypointData(
                lon=pass_wps[0].lon,
                lat=pass_wps[0].lat,
                alt=pass_wps[0].alt,
                heading=pass_wps[-1].heading,
                speed=speed,
                waypoint_type=WaypointType.TRANSIT,
                camera_action=CameraAction.NONE,
            )
        )

    # phase 3 - validate and reroute
    violations = validate_inspection_pass(
        pass_wps,
        drone,
        mission_data.constraints,
        local_geoms,
        elevation_provider=mission_data.elevation_provider,
        buffer_distance=config.buffer_distance,
        keep_inside_airport_boundary=keep_inside_boundary,
    )

    obstacle_violations = [
        v for v in violations if not v.is_warning and v.violation_kind == "obstacle"
    ]

    if obstacle_violations:
        pass_wps = resolve_inspection_collisions(
            pass_wps,
            local_geoms,
            center,
            buffer_distance_override=config.buffer_distance,
            require_perpendicular_runway_crossing=require_perpendicular,
            elevation_provider=mission_data.elevation_provider,
            keep_inside_airport_boundary=keep_inside_boundary,
        )

        # re-validate after rerouting
        violations = validate_inspection_pass(
            pass_wps,
            drone,
            mission_data.constraints,
            local_geoms,
            elevation_provider=mission_data.elevation_provider,
            buffer_distance=config.buffer_distance,
            keep_inside_airport_boundary=keep_inside_boundary,
        )

    hard = [v for v in violations if not v.is_warning]
    if hard:
        raise TrajectoryGenerationError(
            "hard constraint violation",
            violations=[
                {
                    "message": v.message,
                    "violation_kind": v.violation_kind,
                    "constraint_id": v.constraint_id,
                    "waypoint_index": v.waypoint_index,
                }
                for v in hard
            ],
        )

    # papi all-white-zone invariant after terrain delta - soft warning only.
    # HORIZONTAL_RANGE: checks every measurement against the all-white edge.
    # VERTICAL_PROFILE: per-bookend check against the resolved climb angles.
    violations.extend(
        _papi_band_violations(pass_wps, center, setting_angles, config, inspection.method)
    )

    # defer soft warning formatting until after phase 5 assembly,
    # when global waypoint offsets are known
    label = f"{template.name} #{inspection.sequence_order}"

    # phase 4 - post-inspection processing
    _apply_camera_actions(pass_wps)

    # check camera line-of-sight to PAPI for each measurement waypoint
    obstructed_wps: list[int] = []
    for wp_idx, wp in enumerate(pass_wps):
        if wp.waypoint_type not in (WaypointType.MEASUREMENT, WaypointType.HOVER):
            continue
        wp_pt = Point3D(lon=wp.lon, lat=wp.lat, alt=wp.alt)
        if not has_line_of_sight(wp_pt, center, local_geoms):
            obstructed_wps.append(wp_idx)

    # drop empty passes so phase-5 inter-pass transits stay aligned with
    # the surviving boundaries. schema enforces measurement_density >= 1
    # already, but a hand-crafted ORM write could still produce zero
    # waypoints; warn and skip.
    if not pass_wps:
        warnings.append((f"{label}: empty pass dropped", [], None))
        return None

    return label, pass_wps, violations, obstructed_wps, config.buffer_distance
