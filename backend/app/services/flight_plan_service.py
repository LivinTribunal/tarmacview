"""flight plan persistence, waypoint write paths, revalidation, and enriched-response assembly."""

import logging
from collections import defaultdict
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import InspectionMethod, WaypointType
from app.core.exceptions import DomainError, NotFoundError
from app.models.flight_plan import (
    FlightPlan,
    ValidationResult,
    ValidationViolation,
    Waypoint,
)
from app.models.mission import Mission
from app.schemas.flight_plan import (
    FlightPlanResponse,
    InspectionFlightStats,
    TransitWaypointInsertRequest,
    WaypointPositionUpdate,
)

# per-waypoint agl enrichment lives in flight_plan_agl; re-imported here so the
# public flight_plan_service surface (airport_service lazily imports
# _refresh_persisted_agl from here) stays unchanged after the extraction
from app.services.flight_plan_agl import (
    _GROUND_LEVEL_WAYPOINT_TYPES,
    _backfill_waypoint_agl,
    _compute_waypoint_data_agl,
    _extract_altitude,
    _extract_coords,
    _refresh_persisted_agl,
)
from app.services.geometry_converter import geojson_to_wkt
from app.services.trajectory.types import WaypointData
from app.utils.geo import bearing_between, distance_between

logger = logging.getLogger(__name__)

# methods where first-to-last traversal bearing is meaningful.
_BEARING_METHODS = {
    InspectionMethod.HORIZONTAL_RANGE,
    InspectionMethod.FLY_OVER,
    InspectionMethod.PARALLEL_SIDE_SWEEP,
}


def _to_point_wkt(lon: float, lat: float, alt: float) -> str:
    """convert lon/lat/alt to a WKT point string."""
    return geojson_to_wkt({"type": "Point", "coordinates": [lon, lat, alt]})


def _waypoint_to_model(
    wp,
    flight_plan_id,
    sequence_order: int,
    *,
    agl: float | None = None,
    camera_target_agl: float | None = None,
) -> Waypoint:
    """convert WaypointData to ORM model."""
    target_wkt = None
    if wp.camera_target:
        ct = wp.camera_target
        target_wkt = _to_point_wkt(ct.lon, ct.lat, ct.alt)

    return Waypoint(
        flight_plan_id=flight_plan_id,
        inspection_id=wp.inspection_id,
        sequence_order=sequence_order,
        position=_to_point_wkt(wp.lon, wp.lat, wp.alt),
        heading=wp.heading,
        speed=wp.speed,
        hover_duration=wp.hover_duration,
        camera_action=wp.camera_action,
        waypoint_type=wp.waypoint_type,
        camera_target=target_wkt,
        gimbal_pitch=wp.gimbal_pitch,
        agl=agl,
        camera_target_agl=camera_target_agl,
    )


def build_enriched_response(db: Session, flight_plan: FlightPlan) -> FlightPlanResponse:
    """build flight plan response with computed flight statistics.

    altitude min/max (msl + agl) cover every in-flight waypoint; takeoff/landing
    are excluded because they sit on the ground and would drag min_altitude_agl
    toward zero. with no in-flight waypoints the four altitude fields stay None.
    per-waypoint agl is read straight off the persisted columns; legacy null
    columns are lazily backfilled via _backfill_waypoint_agl.
    """
    waypoints = flight_plan.waypoints
    elevation = flight_plan.airport.elevation if flight_plan.airport else 0.0

    if waypoints:
        _backfill_waypoint_agl(db, flight_plan, elevation)

    response = FlightPlanResponse.model_validate(flight_plan)

    if not waypoints:
        return response

    # global altitude stats - exclude only ground-level waypoints
    in_flight = [wp for wp in waypoints if wp.waypoint_type not in _GROUND_LEVEL_WAYPOINT_TYPES]
    if in_flight:
        altitudes_msl = [_extract_altitude(wp.position) for wp in in_flight]
        response.min_altitude_msl = min(altitudes_msl)
        response.max_altitude_msl = max(altitudes_msl)
        response.min_altitude_agl = response.min_altitude_msl - elevation
        response.max_altitude_agl = response.max_altitude_msl - elevation

    # transit speed from mission (fall back to 5.0 m/s default)
    mission = flight_plan.mission
    default_speed = 5.0
    if mission and mission.default_speed is not None:
        default_speed = mission.default_speed
    response.transit_speed = default_speed

    # average speed = total distance / total duration
    if response.total_distance and response.estimated_duration and response.estimated_duration > 0:
        response.average_speed = round(response.total_distance / response.estimated_duration, 2)

    # per-inspection stats
    by_inspection: dict[UUID, list[Waypoint]] = defaultdict(list)
    for wp in waypoints:
        if wp.inspection_id:
            by_inspection[wp.inspection_id].append(wp)

    # inspection id -> method, for deriving the displayed traversal bearing
    method_by_inspection: dict[UUID, str] = {}
    if mission:
        for insp in mission.inspections:
            method_by_inspection[insp.id] = insp.method

    inspection_stats = []
    for insp_id, insp_wps in by_inspection.items():
        insp_alts = [_extract_altitude(wp.position) for wp in insp_wps]
        insp_min_msl = min(insp_alts)
        insp_max_msl = max(insp_alts)

        # segment duration: sum of travel time + hover durations
        seg_duration = 0.0
        coords_list = [_extract_coords(wp.position) for wp in insp_wps]
        for i in range(1, len(coords_list)):
            dist = distance_between(
                coords_list[i - 1][0],
                coords_list[i - 1][1],
                coords_list[i][0],
                coords_list[i][1],
            )
            speed = insp_wps[i].speed or insp_wps[i - 1].speed or default_speed
            seg_duration += dist / speed if speed > 0 else 0.0

        for wp in insp_wps:
            if wp.hover_duration:
                seg_duration += wp.hover_duration

        # traversal bearing between the first and last measurement waypoints.
        # only meaningful for arc/linear methods with >= 2 measurement waypoints.
        direction_bearing: int | None = None
        if method_by_inspection.get(insp_id) in _BEARING_METHODS:
            meas_coords = [
                _extract_coords(wp.position)
                for wp in insp_wps
                if wp.waypoint_type == WaypointType.MEASUREMENT.value
            ]
            if len(meas_coords) >= 2:
                first_lon, first_lat, _ = meas_coords[0]
                last_lon, last_lat, _ = meas_coords[-1]
                direction_bearing = (
                    round(bearing_between(first_lon, first_lat, last_lon, last_lat)) % 360
                )

        inspection_stats.append(
            InspectionFlightStats(
                inspection_id=insp_id,
                min_altitude_agl=insp_min_msl - elevation,
                max_altitude_agl=insp_max_msl - elevation,
                min_altitude_msl=insp_min_msl,
                max_altitude_msl=insp_max_msl,
                waypoint_count=len(insp_wps),
                segment_duration=round(seg_duration, 2),
                direction_bearing=direction_bearing,
            )
        )

    response.inspection_stats = inspection_stats
    return response


def _write_violations(
    db: Session,
    val_result_id: UUID,
    category: str,
    entries: list[tuple[str, list[str], str | None]],
    *,
    resolve=lambda wp_ids: wp_ids,
) -> None:
    """insert ValidationViolation rows for one category, deduped by message.

    a fresh seen-set per call keeps dedup per-category (warning/violation/
    suggestion). resolve maps the raw waypoint ids - persist_flight_plan passes
    the index->uuid resolver, _persist_validation_result passes identity.
    """
    seen: set[str] = set()
    for msg, wp_ids, kind in entries:
        if msg in seen:
            continue
        seen.add(msg)
        db.add(
            ValidationViolation(
                validation_result_id=val_result_id,
                category=category,
                message=msg,
                waypoint_ids=resolve(wp_ids),
                violation_kind=kind,
            )
        )


def persist_flight_plan(
    db: Session,
    mission: Mission,
    all_waypoints: list[WaypointData],
    warnings: list[tuple[str, list[str], str | None]],
    total_distance: float,
    estimated_duration: float,
    violations: list[tuple[str, list[str], str | None]] | None = None,
    suggestions: list[tuple[str, list[str], str | None]] | None = None,
    *,
    elevation_provider=None,
    airport=None,
) -> FlightPlan:
    """persist flight plan with waypoints and validation result.

    each warning/violation/suggestion is a (message, waypoint_ids, kind) tuple;
    kind is the structured violation_kind persisted onto the row (null when the
    schema must classify from the message). the three lists land under
    category='warning'/'violation'/'suggestion'; violations do not abort here.

    elevation_provider, when supplied, is the trajectory pipeline's already-open
    provider reused for the one-shot batched agl lookup so the persist phase does
    not double-open. airport is the elevation fallback.
    """
    flight_plan = FlightPlan(
        mission_id=mission.id,
        airport_id=mission.airport_id,
    )
    flight_plan.compile(total_distance, estimated_duration)
    db.add(flight_plan)
    db.flush()

    if airport is None:
        airport = mission.airport
    agls, ct_agls = _compute_waypoint_data_agl(
        all_waypoints, airport, elevation_provider=elevation_provider
    )

    for i, wp in enumerate(all_waypoints, start=1):
        db.add(
            _waypoint_to_model(
                wp,
                flight_plan.id,
                i,
                agl=agls[i - 1],
                camera_target_agl=ct_agls[i - 1],
            )
        )

    # flush waypoints so they get UUIDs
    db.flush()

    # build index -> uuid mapping for resolving waypoint indices
    persisted_wps = (
        db.query(Waypoint)
        .filter(Waypoint.flight_plan_id == flight_plan.id)
        .order_by(Waypoint.sequence_order)
        .all()
    )
    idx_to_uuid = {i: str(w.id) for i, w in enumerate(persisted_wps)}

    def _resolve_ids(wp_ids: list[str]) -> list[str]:
        """resolve index-based ids to actual UUIDs when possible."""
        resolved = []
        for wid in wp_ids:
            if wid.startswith("idx:"):
                try:
                    idx = int(wid[4:])
                except ValueError:
                    continue
                if idx in idx_to_uuid:
                    resolved.append(idx_to_uuid[idx])
            else:
                resolved.append(wid)
        return resolved

    # validation result - passed=False when non-aborting violations exist
    has_violations = bool(violations)
    val_result = ValidationResult(
        flight_plan_id=flight_plan.id,
        passed=not has_violations,
    )
    db.add(val_result)
    db.flush()

    _write_violations(db, val_result.id, "warning", warnings, resolve=_resolve_ids)
    _write_violations(db, val_result.id, "violation", violations or [], resolve=_resolve_ids)
    _write_violations(db, val_result.id, "suggestion", suggestions or [], resolve=_resolve_ids)

    # caller (orchestrator) handles commit after setting is_validated and status
    db.flush()

    return flight_plan


def _persist_validation_result(
    db: Session,
    flight_plan: FlightPlan,
    warnings: list[tuple[str, list[str], str | None]],
    violations: list[tuple[str, list[str], str | None]],
    suggestions: list[tuple[str, list[str], str | None]],
) -> None:
    """write a fresh ValidationResult subtree, replacing any existing row.

    each warning/violation/suggestion is a (message, waypoint_uuids, kind) tuple.
    relies on cascade="all, delete-orphan" to clear violations when the parent
    is deleted, and flushes between delete and insert to avoid FK dangling.
    """
    if flight_plan.validation_result is not None:
        db.delete(flight_plan.validation_result)
        db.flush()

    has_violations = bool(violations)
    val_result = ValidationResult(
        flight_plan_id=flight_plan.id,
        passed=not has_violations,
    )
    db.add(val_result)
    db.flush()

    _write_violations(db, val_result.id, "warning", warnings)
    _write_violations(db, val_result.id, "violation", violations)
    _write_violations(db, val_result.id, "suggestion", suggestions)

    db.flush()


def revalidate_flight_plan(db: Session, mission_id: UUID) -> FlightPlanResponse:
    """re-run safety validations against the persisted flight plan.

    waypoints are not regenerated - their UUIDs and positions stay byte-identical;
    only the ValidationResult row is replaced. raises 409 when the mission has no
    flight plan. commits inside the service (deliberate flush-only exception - the
    route attaches no audit row and this reloads + returns in one call).
    """
    # imported lazily to dodge the orchestrator -> flight_plan_service edge in
    # the import graph (orchestrator already imports persist_flight_plan from here).
    from app.services.trajectory.orchestrator import revalidate_existing_plan

    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    fp = (
        db.query(FlightPlan)
        .options(joinedload(FlightPlan.waypoints))
        .filter(FlightPlan.mission_id == mission_id)
        .first()
    )
    if fp is None:
        raise DomainError("mission has no flight plan", status_code=409)

    warnings, violations, suggestions = revalidate_existing_plan(db, mission_id)
    _persist_validation_result(db, fp, warnings, violations, suggestions)

    fp.is_validated = not violations
    db.commit()

    return get_flight_plan(db, mission_id)


def get_flight_plan(db: Session, mission_id: UUID) -> FlightPlanResponse:
    """get flight plan for mission with waypoints, validation, and flight statistics."""
    fp = (
        db.query(FlightPlan)
        .options(
            joinedload(FlightPlan.waypoints),
            joinedload(FlightPlan.validation_result).joinedload(ValidationResult.violations),
            joinedload(FlightPlan.mission),
            joinedload(FlightPlan.airport),
        )
        .filter(FlightPlan.mission_id == mission_id)
        .first()
    )
    if not fp:
        raise NotFoundError("flight plan not found")

    return build_enriched_response(db, fp)


def batch_update_waypoints(
    db: Session, mission_id: UUID, updates: list[WaypointPositionUpdate]
) -> FlightPlanResponse:
    """batch update waypoint positions and camera targets."""
    if len(updates) > 200:
        raise DomainError("batch too large", status_code=400)

    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    if mission.status not in Mission.PRE_EXPORT_EDITABLE_STATUSES:
        raise DomainError("cannot modify waypoints in current status", status_code=409)

    fp = db.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
    if not fp:
        raise NotFoundError("flight plan not found")

    # load all target waypoints in one query
    waypoint_ids = [upd.waypoint_id for upd in updates]
    waypoints = (
        db.query(Waypoint)
        .filter(Waypoint.id.in_(waypoint_ids), Waypoint.flight_plan_id == fp.id)
        .all()
    )
    wp_map = {wp.id: wp for wp in waypoints}

    moved_waypoints: list[Waypoint] = []
    for upd in updates:
        wp = wp_map.get(upd.waypoint_id)
        if not wp:
            raise NotFoundError(f"waypoint {upd.waypoint_id} not found")

        coords = upd.position.coordinates
        wp.position = geojson_to_wkt({"type": "Point", "coordinates": coords})

        if upd.camera_target is not None:
            ct_coords = upd.camera_target.coordinates
            wp.camera_target = geojson_to_wkt({"type": "Point", "coordinates": ct_coords})

        # mirror takeoff/landing moves into the mission coordinate so later KMZ
        # exports pick them up. server is pass-through: the caller's coordinates
        # land on both rows verbatim (callers ground-sample alt upfront).
        if wp.waypoint_type == WaypointType.TAKEOFF:
            mission.takeoff_coordinate = geojson_to_wkt({"type": "Point", "coordinates": coords})
        elif wp.waypoint_type == WaypointType.LANDING:
            mission.landing_coordinate = geojson_to_wkt({"type": "Point", "coordinates": coords})

        moved_waypoints.append(wp)

    if moved_waypoints:
        _refresh_persisted_agl(moved_waypoints, fp.airport)

    mission.regress_to_planned()
    mission.has_unsaved_map_changes = True
    db.flush()

    return get_flight_plan(db, mission_id)


def insert_transit_waypoint(
    db: Session, mission_id: UUID, request: TransitWaypointInsertRequest
) -> FlightPlanResponse:
    """insert a new transit waypoint after the given sequence position."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    if mission.status not in Mission.PRE_EXPORT_EDITABLE_STATUSES:
        raise DomainError("cannot modify waypoints in current status", status_code=409)

    fp = db.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
    if not fp:
        raise NotFoundError("flight plan not found")

    # validate after_sequence is within range
    max_seq = (
        db.query(func.max(Waypoint.sequence_order))
        .filter(Waypoint.flight_plan_id == fp.id)
        .scalar()
    ) or 0
    if request.after_sequence < 0 or request.after_sequence > max_seq:
        raise DomainError(
            f"after_sequence must be between 0 and {max_seq}",
            status_code=400,
        )

    # shift all waypoints after the insertion point
    subsequent = (
        db.query(Waypoint)
        .filter(
            Waypoint.flight_plan_id == fp.id,
            Waypoint.sequence_order > request.after_sequence,
        )
        .all()
    )
    for wp in subsequent:
        wp.sequence_order += 1

    coords = request.position.coordinates
    new_wp = Waypoint(
        flight_plan_id=fp.id,
        sequence_order=request.after_sequence + 1,
        position=geojson_to_wkt({"type": "Point", "coordinates": coords}),
        waypoint_type=WaypointType.TRANSIT,
    )
    db.add(new_wp)

    _refresh_persisted_agl([new_wp], fp.airport)

    mission.regress_to_planned()
    mission.has_unsaved_map_changes = True
    db.flush()

    return get_flight_plan(db, mission_id)


def delete_transit_waypoint(db: Session, mission_id: UUID, waypoint_id: UUID) -> FlightPlanResponse:
    """delete a transit waypoint and resequence remaining waypoints."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    if mission.status not in Mission.PRE_EXPORT_EDITABLE_STATUSES:
        raise DomainError("cannot modify waypoints in current status", status_code=409)

    fp = db.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
    if not fp:
        raise NotFoundError("flight plan not found")

    wp = (
        db.query(Waypoint)
        .filter(Waypoint.id == waypoint_id, Waypoint.flight_plan_id == fp.id)
        .first()
    )
    if not wp:
        raise NotFoundError("waypoint not found")

    if wp.waypoint_type != WaypointType.TRANSIT:
        raise DomainError("only transit waypoints can be deleted", status_code=400)

    deleted_seq = wp.sequence_order
    db.delete(wp)

    # resequence subsequent waypoints
    subsequent = (
        db.query(Waypoint)
        .filter(
            Waypoint.flight_plan_id == fp.id,
            Waypoint.sequence_order > deleted_seq,
        )
        .all()
    )
    for w in subsequent:
        w.sequence_order -= 1

    mission.regress_to_planned()

    mission.has_unsaved_map_changes = True
    db.flush()

    return get_flight_plan(db, mission_id)
