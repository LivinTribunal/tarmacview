"""dji wpmz 1.0.6 document assembly: template.kml + waylines.wpml + keepout folder.

mission-config block + the smaller route-level emitters live in
`mission_config.py`; per-waypoint placemark emission lives in `placemark.py`.
heading/yaw, video smooth-turn planning, and actionGroup emission live in the
sibling `heading` / `video` / `actions` modules; the namespace primitives
live in the export-root `shared` module.
"""

import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from app.models.flight_plan import FlightPlan

from ..shared import (
    _KML_KEEPOUT_DESCRIPTION,
    _kml_tag,
    _sub_text,
    _waypoint_sort_key,
    _wpml_tag,
)
from .actions import _first_zoom_emission_waypoints
from .heading import _dji_heading_mode
from .mission_config import (
    _append_mission_config,
    _emitted_distance_duration,
    _max_relative_height,
    _resolve_auto_speed,
    _takeoff_ref_msl,
)
from .placemark import (
    _append_payload_param,
    _append_placemark,
    _nearest_leg_lengths,
    _zoom_factor_for,
)
from .video import _resolve_inspection_camera_settings, _video_smooth_emit_plan


def _build_dji_template_kml(
    flight_plan: FlightPlan,
    mission_name: str,
    airport_elevation: float,
    mission=None,
    drone_profile=None,
    *,
    inspection_camera: dict | None = None,
    zoom_seqs: set | None = None,
    scope: str = "FULL",
    geozone_payload: dict | None = None,
    heading_mode_override: str | None = None,
    clamps: list[dict] | None = None,
) -> bytes:
    """build wpmz/template.kml - mission config plus reference waypoint template."""
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)
    auto_speed = _resolve_auto_speed(waypoints, mission, scope)
    if inspection_camera is None:
        inspection_camera = _resolve_inspection_camera_settings(mission)
    if zoom_seqs is None:
        zoom_seqs = _first_zoom_emission_waypoints(waypoints, inspection_camera, drone_profile)
    # keep global ceiling above the highest waypoint so the drone honors
    # per-point altitude. globalHeight is on the takeoff-relative scale (same
    # frame as the per-placemark heights) so the file stays internally
    # consistent; useGlobalHeight=0 on every placemark keeps it inert.
    takeoff_msl = _takeoff_ref_msl(mission, flight_plan, airport_elevation)
    global_height = str(max(50, int(_max_relative_height(waypoints, takeoff_msl) + 5)))
    now = datetime.now(timezone.utc)
    timestamp_ms = str(int(now.timestamp() * 1000))

    kml = ET.Element(_kml_tag("kml"))
    doc = ET.SubElement(kml, _kml_tag("Document"))
    _sub_text(doc, "author", "TarmacView")
    _sub_text(doc, "createTime", timestamp_ms)
    _sub_text(doc, "updateTime", timestamp_ms)

    _append_mission_config(
        doc,
        flight_plan,
        mission,
        drone_profile,
        in_waylines=False,
        airport_elevation=airport_elevation,
    )

    folder = ET.SubElement(doc, _kml_tag("Folder"))
    _sub_text(folder, "templateType", "waypoint")
    _sub_text(folder, "templateId", "0")

    coord_sys = ET.SubElement(folder, _wpml_tag("waylineCoordinateSysParam"))
    _sub_text(coord_sys, "coordinateMode", "WGS84")
    _sub_text(coord_sys, "heightMode", "relativeToStartPoint")

    _sub_text(folder, "autoFlightSpeed", auto_speed)
    # globalHeight + caliFlightEnable are emitted by pilot 2's own 1.0.6 export
    # (docs/specs/PAPI 22.kmz lines 36-37) - the public 1.0.2 docs omit them, so
    # do NOT "spec-fix" them away (audit 2026-05-26 -> false positives).
    _sub_text(folder, "globalHeight", global_height)
    _sub_text(folder, "caliFlightEnable", "0")
    # manual: per-waypoint gimbalRotate actions drive the gimbal pitch with
    # gimbalYawRotateEnable=0 so the m4t gimbal stays in body-follow yaw mode
    # (per-placemark heading continuously aims the body at the LHA across
    # the arc). vp video passes additionally emit a betweenAdjacentPoints
    # gimbalEvenlyRotate per segment for the smooth pitch sweep across the
    # climb; hr video anchors the gimbal once on the first measurement and
    # holds it through the arc. usePointSetting was tried but locked
    # the gimbal yaw to absolute north on real hardware.
    _sub_text(folder, "gimbalPitchMode", "manual")

    global_heading = ET.SubElement(folder, _wpml_tag("globalWaypointHeadingParam"))
    _sub_text(global_heading, "waypointHeadingMode", "followWayline")
    _sub_text(global_heading, "waypointHeadingAngle", "0")
    _sub_text(global_heading, "waypointHeadingPathMode", "followBadArc")
    _sub_text(global_heading, "waypointHeadingPoiIndex", "0")

    _sub_text(folder, "globalWaypointTurnMode", "toPointAndStopWithDiscontinuityCurvature")
    # pilot 2 emits globalUseStraightLine even under a stop-mode turn
    # (docs/specs/PAPI 22.kmz line 47) - keep it; gating it on turn mode was a
    # 1.0.2-doc false positive (audit 2026-05-26).
    _sub_text(folder, "globalUseStraightLine", "1")

    smooth_plan = _video_smooth_emit_plan(waypoints, inspection_camera)
    heading_mode = _dji_heading_mode(mission, override=heading_mode_override)
    nearest_legs = _nearest_leg_lengths(waypoints)

    for wp in waypoints:
        _append_placemark(
            folder,
            wp,
            takeoff_msl,
            in_waylines=False,
            zoom_factor=_zoom_factor_for(wp, zoom_seqs, inspection_camera),
            drone_profile=drone_profile,
            video_smooth_plan=smooth_plan.get(wp.sequence_order),
            heading_mode=heading_mode,
            nearest_leg=nearest_legs.get(wp.sequence_order),
            clamps=clamps,
            mission=mission,
        )

    # payloadParam trails the Placemarks - pilot 2 puts it AFTER them
    # (docs/specs/PAPI 22.kmz lines 217-226), not before; do not reorder it
    # ahead of the loop (1.0.2-doc false positive, audit 2026-05-26).
    _append_payload_param(folder)

    if geozone_payload is not None:
        _append_dji_template_keepouts(doc, geozone_payload)

    return ET.tostring(kml, encoding="UTF-8", xml_declaration=True)


def _append_dji_template_keepouts(doc, geozone_payload: dict) -> None:
    """append a kml Folder of advisory keep-out polygons to the dji template.

    Pilot 2 / FH2 render these placemarks but do NOT enforce them at flight
    time - the description text makes that clear so the operator does not
    mistake the file for a fence upload.
    """
    safety_zones = geozone_payload.get("safety_zones") or []
    obstacles = geozone_payload.get("obstacles") or []
    runway_buffers = geozone_payload.get("runway_buffers") or []
    if not safety_zones and not obstacles and not runway_buffers:
        return

    keepout = ET.SubElement(doc, _kml_tag("Folder"))
    name_el = ET.SubElement(keepout, _kml_tag("name"))
    name_el.text = "Keep-out zones"
    desc_el = ET.SubElement(keepout, _kml_tag("description"))
    desc_el.text = _KML_KEEPOUT_DESCRIPTION

    def _emit(label: str, geom: dict) -> None:
        """emit one labelled keep-out polygon placemark into the folder."""
        rings = geom.get("coordinates", [])
        if not rings:
            return
        placemark = ET.SubElement(keepout, _kml_tag("Placemark"))
        ET.SubElement(placemark, _kml_tag("name")).text = label
        ET.SubElement(placemark, _kml_tag("description")).text = _KML_KEEPOUT_DESCRIPTION
        polygon = ET.SubElement(placemark, _kml_tag("Polygon"))
        outer = ET.SubElement(polygon, _kml_tag("outerBoundaryIs"))
        ring = ET.SubElement(outer, _kml_tag("LinearRing"))
        coords = ET.SubElement(ring, _kml_tag("coordinates"))
        coords.text = " ".join(f"{c[0]:.8f},{c[1]:.8f}" for c in rings[0])

    for zone in safety_zones:
        _emit(f"Safety Zone - {zone['name']}", zone["geometry"])
    for obstacle in obstacles:
        _emit(f"Obstacle - {obstacle['name']}", obstacle["geometry"])
    for buffer in runway_buffers:
        _emit(f"Runway buffer - {buffer['identifier']}", buffer["geometry"])


def _build_dji_waylines_wpml(
    flight_plan: FlightPlan,
    mission_name: str,
    airport_elevation: float,
    mission=None,
    drone_profile=None,
    *,
    inspection_camera: dict | None = None,
    zoom_seqs: set | None = None,
    scope: str = "FULL",
    heading_mode_override: str | None = None,
    clamps: list[dict] | None = None,
) -> bytes:
    """build wpmz/waylines.wpml - executable wayline consumed by the aircraft."""
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)
    auto_speed = _resolve_auto_speed(waypoints, mission, scope)
    if inspection_camera is None:
        inspection_camera = _resolve_inspection_camera_settings(mission)
    if zoom_seqs is None:
        zoom_seqs = _first_zoom_emission_waypoints(waypoints, inspection_camera, drone_profile)

    kml = ET.Element(_kml_tag("kml"))
    doc = ET.SubElement(kml, _kml_tag("Document"))

    _append_mission_config(
        doc,
        flight_plan,
        mission,
        drone_profile,
        in_waylines=True,
        airport_elevation=airport_elevation,
    )

    folder = ET.SubElement(doc, _kml_tag("Folder"))
    _sub_text(folder, "templateId", "0")

    # mirror the template.kml block - pilot rc rejects waylines whose folder
    # does not declare how per-placemark coordinates and heights should be
    # interpreted. without it the controller renders placemark labels but
    # refuses to draw the connecting polyline or populate the mission summary.
    coord_sys = ET.SubElement(folder, _wpml_tag("waylineCoordinateSysParam"))
    _sub_text(coord_sys, "coordinateMode", "WGS84")
    _sub_text(coord_sys, "heightMode", "relativeToStartPoint")

    # relativeToStartPoint: executeHeight is the height above the ground
    # takeoff point (wp_MSL - takeoff_ground_MSL). this is geoid-free and
    # cancels any datum error in the subtraction. it replaces the absolute
    # WGS84/HAE scheme whose template fields resolved ~45 m underground and
    # flew the drone into the ground at mission start. the template folder's
    # `wpml:waylineCoordinateSysParam/heightMode` uses the same relative
    # value so whichever field Pilot 2's regeneration consumes is correct.
    _sub_text(folder, "executeHeightMode", "relativeToStartPoint")
    _sub_text(folder, "waylineId", "0")

    # distance/duration computed from the emitted slice, not from the row.
    # flight_plan.total_distance / estimated_duration are FULL-trajectory
    # values; reusing them here would overstate MO slices and may cause pilot
    # rc to refuse to populate the summary panel when the wayline metadata
    # disagrees with the placemark count.
    emitted_dist, emitted_dur = _emitted_distance_duration(waypoints, auto_speed, scope=scope)
    _sub_text(folder, "distance", f"{emitted_dist:g}")
    _sub_text(folder, "duration", f"{emitted_dur:g}")
    _sub_text(folder, "autoFlightSpeed", auto_speed)
    _sub_text(folder, "realTimeFollowSurfaceByFov", "0")

    smooth_plan = _video_smooth_emit_plan(waypoints, inspection_camera)
    heading_mode = _dji_heading_mode(mission, override=heading_mode_override)
    nearest_legs = _nearest_leg_lengths(waypoints)
    takeoff_msl = _takeoff_ref_msl(mission, flight_plan, airport_elevation)

    for wp in waypoints:
        _append_placemark(
            folder,
            wp,
            takeoff_msl,
            in_waylines=True,
            zoom_factor=_zoom_factor_for(wp, zoom_seqs, inspection_camera),
            drone_profile=drone_profile,
            video_smooth_plan=smooth_plan.get(wp.sequence_order),
            heading_mode=heading_mode,
            nearest_leg=nearest_legs.get(wp.sequence_order),
            clamps=clamps,
            mission=mission,
        )

    return ET.tostring(kml, encoding="UTF-8", xml_declaration=True)
