"""orchestrates an export request - status gate, geozone gate, dispatch loop."""

import re
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.enums import MissionStatus
from app.core.exceptions import DomainError, NotFoundError
from app.models.airport import Airport
from app.models.flight_plan import FlightPlan
from app.models.inspection import Inspection, InspectionTemplate
from app.models.mission import DroneProfile, Mission
from app.schemas.export import GEOZONE_CAPABLE_FORMATS

from .dji import _DJI_HEADING_MODES
from .formats import EXPORT_REGISTRY
from .geozone import build_geozone_payload

# content types for export formats
_EXPORT_CONTENT_TYPES = {
    "KML": ("application/vnd.google-earth.kml+xml", "kml"),
    "KMZ": ("application/vnd.google-earth.kmz", "kmz"),
    "JSON": ("application/json", "json"),
    "MAVLINK": ("text/plain", "waypoints"),
    "UGCS": ("application/json", "ugcs.json"),
    "WPML": ("application/xml", "wpml"),
    "CSV": ("text/csv", "csv"),
    "GPX": ("application/gpx+xml", "gpx"),
    "LITCHI": ("text/csv", "litchi.csv"),
    "DRONEDEPLOY": ("application/json", "dronedeploy.json"),
}


def _resolve_export_content_type(fmt: str, *, with_geozones: bool) -> tuple[str, str]:
    """pick the (content_type, extension) for an export, branching on flag.

    MAVLINK normally emits QGC WPL 110 plain text. when geozones are bundled,
    the format switches to a QGC `.plan` JSON document, so the extension and
    content type follow it.
    """
    if fmt == "MAVLINK" and with_geozones:
        return ("application/json", "plan")
    return _EXPORT_CONTENT_TYPES[fmt]


def _sanitize_filename(name: str) -> str:
    """produce a base filename safe for content-disposition AND dji flight hub 2.

    fh2 rejects flight route names containing < > : " / | ? * . _ — so we
    strip those (plus backslash and control chars), collapse whitespace, and
    fall back to "mission" when everything gets stripped away.
    """
    sanitized = name.encode("ascii", errors="ignore").decode("ascii")

    # control chars (RFC 7230 prohibits 0-31 and 127)
    sanitized = re.sub(r"[\x00-\x1f\x7f]", "", sanitized)
    # fh2-banned chars + backslash - replace with space so adjacent words do not merge
    sanitized = re.sub(r'[<>:"/|?*._\\]', " ", sanitized)
    # collapse repeated whitespace into a single space
    sanitized = re.sub(r"\s+", " ", sanitized)

    return sanitized.strip() or "mission"


def export_mission(
    db: Session,
    mission_id: UUID,
    formats: list[str],
    *,
    include_geozones: bool = False,
    include_runway_buffers: bool = False,
    dji_heading_mode_override: str | None = None,
    acknowledge_altitude_clamps: bool = False,
) -> tuple[dict[str, tuple[bytes, str]], str, list[dict]]:
    """transition mission to EXPORTED and generate requested export files.

    returns (files_dict, sanitized_mission_name, altitude_clamps) where
    files_dict maps filename -> (content_bytes, content_type) and
    altitude_clamps is the (possibly empty) list of below-takeoff placemarks
    the operator acknowledged for this export.

    when `include_geozones` is true the airport's safety zones, obstacles, and
    (if `include_runway_buffers`) runway/taxiway buffers are bundled into the
    format-native representation. the flag is gated by format capability and
    by the linked drone profile's `supports_geozone_upload` bit.

    `dji_heading_mode_override` (optional) replaces `mission.dji_heading_mode`
    for this export. when supplied and different from the persisted value,
    the column is updated as a side effect so the operator's choice sticks
    for the next export. only consumed by the KMZ / WPML generators; ignored
    for every other format.

    when KMZ/WPML placemark altitudes would be clamped to the takeoff
    reference and `acknowledge_altitude_clamps` is false, the call raises
    `DomainError(status_code=409, extra={"altitude_clamps": [...]})` so the
    route can surface the list to the operator before any file leaves the
    server. nothing in this branch is committed - status transition and any
    heading-mode write-back roll back with the route's uncommitted session.
    """
    if include_runway_buffers and not include_geozones:
        raise DomainError(
            "include_runway_buffers requires include_geozones=true",
            status_code=400,
        )

    if (
        dji_heading_mode_override is not None
        and dji_heading_mode_override not in _DJI_HEADING_MODES
    ):
        raise DomainError(
            f"invalid dji_heading_mode_override '{dji_heading_mode_override}', "
            f"must be one of {set(_DJI_HEADING_MODES)}",
            status_code=422,
        )

    # eager-load inspections + configs whenever an export format carries
    # per-inspection camera settings (json, kmz, wpml).
    mission_query = db.query(Mission).filter(Mission.id == mission_id)
    if any(f in formats for f in ("JSON", "KMZ", "WPML")):
        mission_query = mission_query.options(
            joinedload(Mission.inspections).joinedload(Inspection.config),
            joinedload(Mission.inspections)
            .joinedload(Inspection.template)
            .joinedload(InspectionTemplate.default_config),
        )
    mission = mission_query.first()
    if not mission:
        raise NotFoundError("mission not found")

    # reject statuses that have not reached validation; MEASURED is allowed
    # (post-validation - plan + artifacts persist, re-export/re-dispatch is legal)
    if mission.status not in Mission.EXPORT_ELIGIBLE_STATUSES:
        raise DomainError(
            "mission must be VALIDATED, EXPORTED, or MEASURED to export, "
            f"current: {mission.status}",
            status_code=409,
        )

    # verify flight plan and airport exist before committing status transition
    flight_plan = (
        db.query(FlightPlan)
        .options(joinedload(FlightPlan.waypoints))
        .filter(FlightPlan.mission_id == mission_id)
        .first()
    )
    if not flight_plan:
        raise NotFoundError("no flight plan found for this mission")

    airport_query = db.query(Airport).filter(Airport.id == flight_plan.airport_id)
    if include_geozones:
        airport_query = airport_query.options(
            joinedload(Airport.obstacles),
            joinedload(Airport.safety_zones),
            joinedload(Airport.surfaces),
        )
    airport = airport_query.first()
    if not airport or airport.elevation is None:
        raise DomainError(
            "airport elevation is required for export - AGL altitudes cannot be calculated",
            status_code=422,
        )
    airport_elevation = airport.elevation

    unsupported = [fmt for fmt in formats if fmt not in EXPORT_REGISTRY]
    if unsupported:
        raise DomainError(
            f"unsupported export format(s): {', '.join(unsupported)}", status_code=422
        )

    # load the drone profile for dji enum lookup - cheap, single-row query, only
    # needed for KMZ/WPML but simpler than branching inside the loop.
    drone_profile = None
    if mission.drone_profile_id is not None:
        drone_profile = (
            db.query(DroneProfile).filter(DroneProfile.id == mission.drone_profile_id).first()
        )

    # dji kmz/wpml carry the configured drone's wpml enum; unmapped drones
    # (mavic 2 pro / non-dji / none) fall back to the m4t enum inside
    # `_dji_enums_for` so the file still renders in fh2 / pilot 2. the
    # frontend reads `DroneProfileResponse.supports_dji_wpml` and shows a
    # confirm modal pre-export so the operator knows what the file is
    # tagged as.

    geozone_payload: dict | None = None
    if include_geozones:
        incapable_formats = [fmt for fmt in formats if fmt not in GEOZONE_CAPABLE_FORMATS]
        if incapable_formats:
            raise DomainError(
                f"include_geozones is not supported for format(s): {', '.join(incapable_formats)}",
                status_code=400,
            )
        if drone_profile is None or not drone_profile.supports_geozone_upload:
            raise DomainError(
                "selected drone does not support geozone upload",
                status_code=400,
            )
        geozone_payload = build_geozone_payload(
            airport, include_runway_buffers=include_runway_buffers
        )

    scope = mission.flight_plan_scope or "FULL"
    scope_suffix = {
        "FULL": " no tl",
        "MEASUREMENTS_ONLY": " measurements only",
    }.get(scope, "")
    safe_name = _sanitize_filename(mission.name + scope_suffix)

    # generate every file before transitioning status / writing heading-mode.
    # the clamp gate may raise below; if it does the route never commits, so
    # nothing the orchestrator did persists. dji generators (KMZ/WPML) append
    # one record per below-takeoff placemark into `altitude_clamps`.
    altitude_clamps: list[dict] = []
    files: dict[str, tuple[bytes, str]] = {}
    for fmt in formats:
        generator = EXPORT_REGISTRY[fmt]
        content_type, ext = _resolve_export_content_type(
            fmt, with_geozones=include_geozones and fmt in GEOZONE_CAPABLE_FORMATS
        )
        filename = f"{safe_name}.{ext}"
        fmt_payload = geozone_payload if fmt in GEOZONE_CAPABLE_FORMATS else None
        if fmt == "KMZ":
            content = generator(
                flight_plan,
                mission.name,
                airport_elevation,
                mission=mission,
                drone_profile=drone_profile,
                scope=scope,
                geozone_payload=fmt_payload,
                heading_mode_override=dji_heading_mode_override,
                clamps=altitude_clamps,
            )
        elif fmt == "WPML":
            content = generator(
                flight_plan,
                mission.name,
                airport_elevation,
                mission=mission,
                drone_profile=drone_profile,
                scope=scope,
                heading_mode_override=dji_heading_mode_override,
                clamps=altitude_clamps,
            )
        elif fmt == "JSON":
            content = generator(
                flight_plan,
                mission.name,
                airport_elevation,
                mission=mission,
                geozone_payload=fmt_payload,
            )
        elif fmt in ("KML", "MAVLINK", "UGCS"):
            content = generator(
                flight_plan,
                mission.name,
                airport_elevation,
                geozone_payload=fmt_payload,
            )
        elif fmt == "LITCHI":
            content = generator(
                flight_plan,
                mission.name,
                airport_elevation,
                mission=mission,
            )
        else:
            content = generator(flight_plan, mission.name, airport_elevation)
        files[filename] = (content, content_type)

    if altitude_clamps and not acknowledge_altitude_clamps:
        raise DomainError(
            "altitude clamps require operator acknowledgment",
            status_code=409,
            extra={"altitude_clamps": altitude_clamps},
        )

    if mission.status == MissionStatus.VALIDATED.value:
        try:
            mission.transition_to(MissionStatus.EXPORTED.value)
            db.flush()
            db.refresh(mission)
        except ValueError as e:
            raise DomainError("invalid status transition", status_code=409) from e

    # persist the operator's last-used heading mode so the next export
    # pre-fills the picker. dji_heading_mode is NOT in TRAJECTORY_FIELDS so
    # this write does not regress mission status to DRAFT. recorded in the
    # EXPORT audit row's details by the route, no separate UPDATE row.
    if (
        dji_heading_mode_override is not None
        and mission.dji_heading_mode != dji_heading_mode_override
    ):
        mission.dji_heading_mode = dji_heading_mode_override
        db.flush()

    return files, safe_name, altitude_clamps
