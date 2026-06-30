"""five-phase trajectory pipeline: load, resolve, compute, validate, assemble."""

from uuid import UUID

from sqlalchemy.orm import Session, joinedload

import app.services.trajectory.orchestrator as _orch
from app.core.enums import CameraAction, InspectionMethod, MissionStatus, WaypointType
from app.core.exceptions import DomainError, NotFoundError, TrajectoryGenerationError
from app.core.geometry import point_lonlatalt, wkt_to_geojson
from app.models.agl import AGL
from app.models.airport import AirfieldSurface, Airport, Obstacle, SafetyZone
from app.models.flight_plan import FlightPlan
from app.models.inspection import Inspection, InspectionTemplate
from app.models.mission import Mission
from app.services.elevation_provider import create_elevation_provider
from app.services.flight_plan_service import persist_flight_plan
from app.utils.local_projection import LocalProjection, build_local_geometries

from .. import heading_optimizer
from ..config_resolver import resolve_with_defaults
from ..helpers import (
    get_lha_positions,
    get_lha_positions_from_surfaces,
    get_lha_setting_angles,
)
from ..safety_validator import (
    check_battery,
    validate_inspection_pass,
)
from ..types import (
    DEFAULT_RESERVE_MARGIN,
    DEFAULT_SPEED,
    TRANSIT_AGL,
    InspectionPass,
    MissionData,
    Point3D,
    Violation,
    WaypointData,
)
from ._assembly import (
    _assemble_core,
    _build_landing_transit_bookend,
    _build_takeoff_transit_bookend,
    _compute_final_buffer,
    _parse_coordinate,
    _pass_boundary,
)
from ._postprocess import (
    _collect_surface_crossing_warnings,
    _compute_totals,
    _format_soft_warnings,
    _papi_band_violations,
)


def _resolve_inspection_directions(
    inspections: list[Inspection],
    mission: Mission,
    surfaces: list[AirfieldSurface],
) -> dict[UUID, bool]:
    """resolve each inspection's direction (NATURAL or REVERSED) for trajectory compile.

    priority:
        1. inspection.config.direction (NATURAL/REVERSED) wins.
        2. mission.direction (NATURAL/REVERSED) when inspection inherits.
        3. otherwise the solver picks for the AUTO subset.

    writes the chosen value into each inspection's resolved_direction column
    (overwritten on every compile). returns a mapping of inspection.id -> reversed bool
    so the caller can pass it through to ResolvedConfig.direction_reversed.
    """
    mission_dir = mission.direction or "AUTO"
    auto_ids: set[UUID] = set()
    pinned: dict[UUID, bool] = {}

    for insp in inspections:
        insp_dir = getattr(insp.config, "direction", None) if insp.config else None
        if insp_dir in ("NATURAL", "REVERSED"):
            pinned[insp.id] = insp_dir == "REVERSED"
            continue
        if mission_dir in ("NATURAL", "REVERSED"):
            pinned[insp.id] = mission_dir == "REVERSED"
            continue
        auto_ids.add(insp.id)

    initial_reversed: dict[UUID, bool] = dict(pinned)
    for insp in inspections:
        if insp.id in initial_reversed:
            continue
        prev = getattr(insp.config, "resolved_direction", None) if insp.config else None
        initial_reversed[insp.id] = prev == "REVERSED"

    solution = heading_optimizer.solve_headings(
        inspections,
        surfaces,
        auto_ids=auto_ids,
        initial_reversed=initial_reversed,
    )

    resolved: dict[UUID, bool] = {}
    for assignment in solution.assignments:
        resolved[assignment.inspection_id] = assignment.reversed

    # persist resolved_direction; never explicitly cleared, harmlessly overwritten
    insp_by_id = {insp.id: insp for insp in inspections}
    for insp_id, reversed_ in resolved.items():
        insp = insp_by_id.get(insp_id)
        if insp is None or insp.config is None:
            continue
        insp.config.resolved_direction = "REVERSED" if reversed_ else "NATURAL"

    return resolved


def _load_mission_data(db: Session, mission_id: UUID) -> MissionData:
    """load all entities needed for trajectory generation in a single query phase."""
    mission = (
        db.query(Mission)
        .options(
            joinedload(Mission.drone_profile),
            joinedload(Mission.inspections)
            .joinedload(Inspection.template)
            .joinedload(InspectionTemplate.default_config),
            joinedload(Mission.inspections).joinedload(Inspection.config),
            joinedload(Mission.inspections)
            .joinedload(Inspection.template)
            .joinedload(InspectionTemplate.targets)
            .joinedload(AGL.lhas),
            joinedload(Mission.flight_plan),
            joinedload(Mission.constraints),
        )
        .filter(Mission.id == mission_id)
        .first()
    )
    if not mission:
        raise NotFoundError("mission not found")
    if not mission.inspections:
        raise TrajectoryGenerationError("mission has no inspections")

    airport = db.query(Airport).filter(Airport.id == mission.airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    obstacles = db.query(Obstacle).filter(Obstacle.airport_id == airport.id).all()
    safety_zones = (
        db.query(SafetyZone)
        .filter(SafetyZone.airport_id == airport.id, SafetyZone.is_active == True)  # noqa: E712
        .all()
    )
    # eager-load surface -> agls -> lhas so hover-point-lock's AGL-agnostic
    # lookup (find_lha_in_surfaces) doesn't trigger N+1 lazy loads on the
    # trajectory critical path.
    surfaces = (
        db.query(AirfieldSurface)
        .options(joinedload(AirfieldSurface.agls).joinedload(AGL.lhas))
        .filter(AirfieldSurface.airport_id == airport.id)
        .all()
    )

    # constraints are mission-owned - they survive flight-plan regeneration so
    # operator-attached rules apply to every recompute without reattachment.
    constraints = list(mission.constraints)

    provider = create_elevation_provider(airport)

    return MissionData(
        mission=mission,
        airport=airport,
        drone=mission.drone_profile,
        obstacles=obstacles,
        safety_zones=safety_zones,
        surfaces=surfaces,
        constraints=constraints,
        default_speed=mission.default_speed or DEFAULT_SPEED,
        elevation_provider=provider,
    )


def generate_trajectory(
    db: Session, mission_id: UUID
) -> tuple[FlightPlan, list[tuple[str, list[str], str | None]]]:
    """five-phase trajectory generation pipeline.

    phase 1: load all data
    phase 2: config resolution and pre-checks per inspection
    phase 3: compute waypoints, validate, and reroute
    phase 4: post-inspection processing
    phase 5: final assembly with A* transit
    """

    # phase 1 - load all data
    mission_data = _load_mission_data(db, mission_id)
    provider = mission_data.elevation_provider

    try:
        return _generate_trajectory_inner(db, mission_data)
    finally:
        if hasattr(provider, "close"):
            provider.close()


def _generate_trajectory_inner(
    db: Session, mission_data: MissionData
) -> tuple[FlightPlan, list[tuple[str, list[str], str | None]]]:
    """run phases 2-5 of trajectory generation; outer function handles resource cleanup."""
    mission = mission_data.mission
    drone = mission_data.drone
    default_speed = mission_data.default_speed

    scope = mission.flight_plan_scope or "FULL"

    # pre-check: takeoff/landing coordinates required unless scope is MEASUREMENTS_ONLY
    if scope != "MEASUREMENTS_ONLY":
        if not mission.takeoff_coordinate:
            raise TrajectoryGenerationError(
                "takeoff coordinates must be set before generating a trajectory"
            )
        if not mission.landing_coordinate:
            raise TrajectoryGenerationError(
                "landing coordinates must be set before generating a trajectory"
            )

    # delete existing flight plan before invalidation - db concern stays in service.
    # must happen before invalidate_trajectory() per its contract.
    existing_fp = mission.flight_plan
    if existing_fp:
        db.delete(existing_fp)
        db.flush()

    # auto-regress VALIDATED/EXPORTED so regeneration works without manual step
    if mission.status in Mission.POST_PLAN_STATUSES:
        mission.invalidate_trajectory()

    # only DRAFT or PLANNED can generate - terminal states are blocked
    if mission.status not in Mission.PRE_PLAN_STATUSES:
        raise TrajectoryGenerationError(
            f"cannot generate trajectory for mission in {mission.status} status"
        )

    warnings: list[tuple[str, list[str], str | None]] = []
    suggestions: list[tuple[str, list[str], str | None]] = []
    papi_obstruction_violations: list[tuple[str, list[str], str | None]] = []

    inspection_passes: list[InspectionPass] = []
    # deferred per-pass data for formatting after phase 5 assembly
    deferred_pass_data: list[tuple[str, list, list[int]]] = []
    # per-pass buffers actually used by validate_inspection_pass; the max defines
    # the final-assembled envelope so the constraint can only tighten, never relax.
    buffers_used: list[float] = []

    # resolve configurable transit altitude above ground level
    transit_agl = (
        mission_data.mission.transit_agl
        if mission_data.mission.transit_agl is not None
        else TRANSIT_AGL
    )
    if mission_data.mission.transit_agl is None:
        suggestions.append(
            (
                f"no transit AGL set - using default ({TRANSIT_AGL:.1f} m); "
                "consider raising transit_agl to reduce soft AGL warnings",
                [],
                None,
            )
        )

    # operator opt-in: allow shortest-geodesic crossing instead of perpendicular,
    # reducing the runway closure window. defaults True for legacy behavior.
    require_perpendicular = mission_data.mission.require_perpendicular_runway_crossing

    # operator opt-in: when true, transits are biased to stay inside the airport
    # boundary polygon. matches the geozone export, which the drone firmware
    # enforces as a hard geofence in flight. defaults true.
    keep_inside_boundary = bool(mission_data.mission.keep_inside_airport_boundary)

    # set up local projection centered on airport for Shapely-based pathfinding
    airport_coords = _parse_coordinate(mission_data.airport.location, "airport")
    proj = LocalProjection(ref_lon=airport_coords[0], ref_lat=airport_coords[1])
    local_geoms = build_local_geometries(
        proj, mission_data.obstacles, mission_data.safety_zones, mission_data.surfaces
    )

    sorted_inspections = sorted(mission.inspections, key=lambda i: i.sequence_order)

    # pre-pass: resolve direction per inspection (NATURAL/REVERSED). priority:
    # inspection.direction > mission.direction > solver. solver runs only over
    # the AUTO subset and writes back into inspection.resolved_direction.
    resolved_directions = _resolve_inspection_directions(
        sorted_inspections, mission, mission_data.surfaces
    )

    for inspection in sorted_inspections:
        # resolved off the package object so the `monkeypatch.setattr(orchestrator,
        # "_process_inspection", ...)` seam still reaches this driver loop after
        # the _inspection_pass extraction.
        result = _orch._process_inspection(
            inspection,
            mission,
            mission_data,
            drone,
            default_speed,
            local_geoms,
            resolved_directions,
            require_perpendicular,
            keep_inside_boundary,
            warnings,
            suggestions,
        )
        if result is None:
            continue
        label, pass_wps, violations, obstructed_wps, buffer_distance = result
        deferred_pass_data.append((label, violations, obstructed_wps))
        inspection_passes.append(InspectionPass(waypoints=pass_wps, inspection_id=inspection.id))
        buffers_used.append(buffer_distance)

    if not inspection_passes:
        raise TrajectoryGenerationError("no waypoints generated")

    # final-assembled envelope: the largest buffer any per-pass validation used.
    # shared by inter-pass A* transits, NTL bookend transits, and the final
    # validate_inspection_pass call below so the envelope can only tighten.
    final_buffer = _compute_final_buffer(buffers_used)

    # phase 5 - layered final assembly
    # core: passes interleaved with inter-pass A* transits (MEASUREMENTS_ONLY output)
    # transit bookends (NTL): above-takeoff TRANSIT + A* to first pass;
    #   A* from last pass to above-landing TRANSIT
    provider = mission_data.elevation_provider

    core, pass_start_indices, measurement_index_maps, transit_warnings = _assemble_core(
        inspection_passes,
        scope,
        local_geoms,
        default_speed,
        transit_agl=transit_agl,
        elevation_provider=provider,
        buffer_distance_override=final_buffer,
        require_perpendicular_runway_crossing=require_perpendicular,
        keep_inside_airport_boundary=keep_inside_boundary,
    )
    for w in transit_warnings:
        warnings.append((w, [], None))

    if scope == "MEASUREMENTS_ONLY":
        if not core:
            raise TrajectoryGenerationError("no measurement waypoints generated")
        all_waypoints: list[WaypointData] = list(core)
    else:
        if not inspection_passes[0].waypoints:
            raise TrajectoryGenerationError("first inspection produced no waypoints")

        first_first, _ = _pass_boundary(inspection_passes[0].waypoints)
        _, last_last = _pass_boundary(inspection_passes[-1].waypoints)
        first_pt = Point3D(lon=first_first.lon, lat=first_first.lat, alt=first_first.alt)
        last_pt = Point3D(lon=last_last.lon, lat=last_last.lat, alt=last_last.alt)

        bookend_takeoff, _tc, _takeoff_alt = _build_takeoff_transit_bookend(
            mission,
            first_pt,
            default_speed,
            transit_agl,
            elevation_provider=provider,
            local_geoms=local_geoms,
            buffer_distance_override=final_buffer,
            require_perpendicular_runway_crossing=require_perpendicular,
            keep_inside_airport_boundary=keep_inside_boundary,
        )
        bookend_landing, _lc, _landing_alt = _build_landing_transit_bookend(
            mission,
            last_pt,
            default_speed,
            transit_agl,
            elevation_provider=provider,
            local_geoms=local_geoms,
            buffer_distance_override=final_buffer,
            require_perpendicular_runway_crossing=require_perpendicular,
            keep_inside_airport_boundary=keep_inside_boundary,
        )

        prefix: list[WaypointData] = list(bookend_takeoff)
        suffix: list[WaypointData] = list(bookend_landing)

        pass_start_indices = [i + len(prefix) for i in pass_start_indices]
        all_waypoints = [*prefix, *core, *suffix]

    # build waypoint index -> inspection sequence mapping; format per-pass deferred warnings.
    # measurement_index_maps[i] maps original-pass index -> rendered-pass index for every
    # scope (MH-only for MEASUREMENTS_ONLY, identity over the full pass otherwise), so
    # the violation/obstructed remap below is a single code path.
    wp_inspection_seq: dict[int, int] = {}
    for i, (pass_start, ipass) in enumerate(zip(pass_start_indices, inspection_passes)):
        idx_map = measurement_index_maps[i]
        pass_wp_count = len(idx_map)
        for k in range(pass_start, pass_start + pass_wp_count):
            if k < len(all_waypoints):
                wp_inspection_seq[k] = i + 1

        if i >= len(deferred_pass_data):
            continue
        d_label, d_violations, d_obstructed = deferred_pass_data[i]

        # remap violations + obstructed indices from original-pass to rendered-pass coords;
        # an out-of-map index belongs to a waypoint the rendered pass dropped (only
        # possible when MEASUREMENTS_ONLY filters out an intra-pass TRANSIT)
        remapped: list[Violation] = []
        for v in d_violations:
            if v.waypoint_index is not None and v.waypoint_index not in idx_map:
                continue
            if v.waypoint_index is not None:
                v = Violation(
                    is_warning=v.is_warning,
                    message=v.message,
                    violation_kind=v.violation_kind,
                    constraint_id=v.constraint_id,
                    waypoint_index=idx_map[v.waypoint_index],
                )
            remapped.append(v)
        _format_soft_warnings(remapped, d_label, warnings, wp_offset=pass_start)
        d_obstructed = [idx_map[wi] for wi in d_obstructed if wi in idx_map]

        if d_obstructed:
            display_wps = [wi + 1 for wi in d_obstructed]
            if len(display_wps) <= 3:
                wp_str = ", ".join(str(w) for w in display_wps)
            else:
                wp_str = f"{min(display_wps)}-{max(display_wps)}"
            wp_ids = [f"idx:{wi + pass_start}" for wi in d_obstructed]
            papi_obstruction_violations.append(
                (
                    f"{d_label} (wp {wp_str}): camera view to PAPI obstructed",
                    wp_ids,
                    "camera_obstruction",
                )
            )

    # check for runway/taxiway crossings and add grouped warnings
    _collect_surface_crossing_warnings(
        all_waypoints, proj, local_geoms, wp_inspection_seq, warnings
    )

    # final validation of assembled path - reuses the same envelope as transits
    final_violations = validate_inspection_pass(
        all_waypoints,
        drone,
        mission_data.constraints,
        local_geoms,
        elevation_provider=provider,
        buffer_distance=final_buffer,
        keep_inside_airport_boundary=keep_inside_boundary,
    )
    final_hard = [v for v in final_violations if not v.is_warning]
    if final_hard:
        raise TrajectoryGenerationError(
            f"final validation failed (buffer={final_buffer:.1f} m)",
            violations=[
                {
                    "message": v.message,
                    "violation_kind": v.violation_kind,
                    "constraint_id": v.constraint_id,
                    "waypoint_index": v.waypoint_index,
                }
                for v in final_hard
            ],
        )

    _format_soft_warnings(final_violations, "final validation", warnings)

    total_dist, total_dur = _compute_totals(all_waypoints)

    # battery check after all phases including transit durations
    if drone:
        bw = check_battery(total_dur, drone, DEFAULT_RESERVE_MARGIN)
        if bw:
            warnings.append((bw.message, [], bw.violation_kind))

    flight_plan = persist_flight_plan(
        db,
        mission,
        all_waypoints,
        warnings,
        total_dist,
        total_dur,
        violations=papi_obstruction_violations,
        suggestions=suggestions,
        elevation_provider=provider,
        airport=mission_data.airport,
    )

    # no hard violations at this point - mark flight plan as validated
    flight_plan.is_validated = True

    # transition to PLANNED only if still in DRAFT (skip if already PLANNED from regression)
    if mission.status == MissionStatus.DRAFT:
        mission.transition_to(MissionStatus.PLANNED)

    mission.has_unsaved_map_changes = False
    db.flush()

    return flight_plan, warnings


def _waypoint_orm_to_data(wp) -> WaypointData:
    """materialize a persisted Waypoint row into WaypointData for revalidation."""
    lon, lat, alt = point_lonlatalt(wp.position)

    camera_target = None
    if wp.camera_target is not None:
        try:
            ct_geo = wkt_to_geojson(wp.camera_target)
            ct_coords = (ct_geo.get("coordinates") if ct_geo else None) or []
        except (KeyError, ValueError, TypeError):
            ct_coords = []
        if ct_coords and len(ct_coords) >= 3:
            camera_target = Point3D(lon=ct_coords[0], lat=ct_coords[1], alt=ct_coords[2])

    return WaypointData(
        lon=lon,
        lat=lat,
        alt=alt,
        heading=wp.heading if wp.heading is not None else 0.0,
        speed=wp.speed if wp.speed is not None else DEFAULT_SPEED,
        waypoint_type=WaypointType(wp.waypoint_type),
        camera_action=CameraAction(wp.camera_action) if wp.camera_action else CameraAction.NONE,
        camera_target=camera_target,
        inspection_id=wp.inspection_id,
        hover_duration=wp.hover_duration,
        gimbal_pitch=wp.gimbal_pitch,
    )


def revalidate_existing_plan(
    db: Session, mission_id: UUID
) -> tuple[
    list[tuple[str, list[str], str | None]],
    list[tuple[str, list[str], str | None]],
    list[tuple[str, list[str], str | None]],
]:
    """re-run the safety pipeline against an already-persisted flight plan.

    does not recompute waypoints. reads current obstacle / safety zone / surface
    state plus persisted Waypoint rows and runs the same final-assembled pipeline
    used by generate_trajectory: validate_inspection_pass (drone, obstacle, zone,
    transit-AGL hard / measurement-soft), validate_papi_angle_band per PAPI
    inspection, and check_battery on the persisted total duration.

    returns (warnings, violations, suggestions) as (message, waypoint_uuids, kind)
    tuples so the service layer can persist them via persist_flight_plan's writer.
    """
    mission_data = _load_mission_data(db, mission_id)
    provider = mission_data.elevation_provider

    try:
        mission = mission_data.mission
        fp = mission.flight_plan
        if fp is None or not fp.waypoints:
            raise DomainError("mission has no flight plan", status_code=409)

        all_waypoints = [_waypoint_orm_to_data(wp) for wp in fp.waypoints]
        wp_uuids = [str(wp.id) for wp in fp.waypoints]

        airport_coords = _parse_coordinate(mission_data.airport.location, "airport")
        proj = LocalProjection(ref_lon=airport_coords[0], ref_lat=airport_coords[1])
        local_geoms = build_local_geometries(
            proj, mission_data.obstacles, mission_data.safety_zones, mission_data.surfaces
        )

        # final-assembled buffer mirrors generate_trajectory's contract: max of any
        # per-pass override or the env-controlled vertex_buffer_m floor.
        per_pass_buffers = [
            insp.config.buffer_distance
            for insp in mission.inspections
            if insp.config and insp.config.buffer_distance is not None
        ]
        final_buffer = _compute_final_buffer(per_pass_buffers)

        warnings: list[tuple[str, list[str], str | None]] = []
        violations_out: list[tuple[str, list[str], str | None]] = []
        suggestions: list[tuple[str, list[str], str | None]] = []

        final_violations = validate_inspection_pass(
            all_waypoints,
            mission_data.drone,
            mission_data.constraints,
            local_geoms,
            elevation_provider=provider,
            buffer_distance=final_buffer,
            keep_inside_airport_boundary=bool(mission.keep_inside_airport_boundary),
        )

        final_hard = [v for v in final_violations if not v.is_warning]
        for v in final_hard:
            wp_ids = (
                [wp_uuids[v.waypoint_index]]
                if v.waypoint_index is not None and 0 <= v.waypoint_index < len(wp_uuids)
                else []
            )
            violations_out.append((v.message, wp_ids, v.violation_kind))

        _format_soft_warnings(final_violations, "final validation", warnings)

        # papi all-white-zone soft check, scoped per-inspection
        for inspection in sorted(mission.inspections, key=lambda i: i.sequence_order):
            if inspection.method not in (
                InspectionMethod.HORIZONTAL_RANGE,
                InspectionMethod.VERTICAL_PROFILE,
            ):
                continue

            template = inspection.template
            if template is None:
                continue

            lha_ids = inspection.lha_ids
            lha_positions = get_lha_positions(template, lha_ids)
            if not lha_positions and lha_ids:
                lha_positions = get_lha_positions_from_surfaces(mission_data.surfaces, lha_ids)
            if not lha_positions:
                continue

            setting_angles = get_lha_setting_angles(template, lha_ids)

            insp_idx_pairs = [
                (i, all_waypoints[i])
                for i in range(len(all_waypoints))
                if fp.waypoints[i].inspection_id == inspection.id
            ]
            if not insp_idx_pairs:
                continue

            insp_wps = [wp for _, wp in insp_idx_pairs]
            insp_indices = [i for i, _ in insp_idx_pairs]
            center = Point3D.center(lha_positions)

            # shared dispatch with generate - HR without setting angles yields no
            # band violations (was an early `continue`; the empty remap below is a
            # no-op, so the persisted output is unchanged).
            config = resolve_with_defaults(inspection, template)
            papi_violations = _papi_band_violations(
                insp_wps, center, setting_angles, config, inspection.method
            )

            label = f"{template.name} #{inspection.sequence_order}"
            remapped: list[Violation] = []
            for v in papi_violations:
                if v.waypoint_index is None or v.waypoint_index >= len(insp_indices):
                    continue
                global_idx = insp_indices[v.waypoint_index]
                remapped.append(
                    Violation(
                        is_warning=v.is_warning,
                        message=v.message,
                        violation_kind=v.violation_kind,
                        constraint_id=v.constraint_id,
                        waypoint_index=global_idx,
                    )
                )
            _format_soft_warnings(remapped, label, warnings)

        # battery check uses the persisted total duration so we don't recompute.
        if fp.estimated_duration is not None:
            bw = check_battery(fp.estimated_duration, mission_data.drone, DEFAULT_RESERVE_MARGIN)
            if bw:
                warnings.append((bw.message, [], bw.violation_kind))

        # convert idx: refs in soft-warning waypoint id slots to actual UUIDs.
        def _resolve(
            items: list[tuple[str, list[str], str | None]],
        ) -> list[tuple[str, list[str], str | None]]:
            """convert idx: pseudo-ids in the (msg, ids, kind) tuple list to waypoint uuids."""
            resolved: list[tuple[str, list[str], str | None]] = []
            for msg, ids, kind in items:
                out: list[str] = []
                for wid in ids:
                    if wid.startswith("idx:"):
                        try:
                            i = int(wid[4:])
                        except ValueError:
                            continue
                        if 0 <= i < len(wp_uuids):
                            out.append(wp_uuids[i])
                    else:
                        out.append(wid)
                resolved.append((msg, out, kind))
            return resolved

        return _resolve(warnings), _resolve(violations_out), _resolve(suggestions)
    finally:
        if hasattr(provider, "close"):
            provider.close()
