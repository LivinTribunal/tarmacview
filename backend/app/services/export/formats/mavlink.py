"""mavlink export - qgc wpl 110 plain text, or qgc .plan json with geofence."""

import json

from app.core.geometry import point_lonlatalt
from app.models.flight_plan import FlightPlan

from ..shared import _UUIDEncoder, _waypoint_sort_key

# mavlink command codes
_MAV_CMD_NAV_WAYPOINT = 16
_MAV_CMD_NAV_TAKEOFF = 22
_MAV_CMD_NAV_LAND = 21
_MAV_CMD_IMAGE_START_CAPTURE = 2000
_MAV_CMD_VIDEO_START_CAPTURE = 2500
_MAV_CMD_VIDEO_STOP_CAPTURE = 2501

# MAV_FRAME_GLOBAL_RELATIVE_ALT
_MAV_FRAME = 3

_WAYPOINT_TYPE_COMMANDS = {
    "TAKEOFF": _MAV_CMD_NAV_TAKEOFF,
    "LANDING": _MAV_CMD_NAV_LAND,
}

_CAMERA_ACTION_COMMANDS = {
    "RECORDING_START": _MAV_CMD_VIDEO_START_CAPTURE,
    "RECORDING_STOP": _MAV_CMD_VIDEO_STOP_CAPTURE,
    "PHOTO_CAPTURE": _MAV_CMD_IMAGE_START_CAPTURE,
}


def generate_mavlink(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    geozone_payload: dict | None = None,
) -> bytes:
    """serialize flight plan to mavlink format.

    default output is QGC WPL 110 plain text. when geozone_payload is set the
    output is a QGC .plan JSON document with mission + geoFence + rallyPoints,
    keeping plain-text consumers untouched.
    """
    if geozone_payload is not None:
        return _generate_mavlink_plan(flight_plan, airport_elevation, geozone_payload)
    return _generate_mavlink_wpl(flight_plan, airport_elevation)


def _generate_mavlink_wpl(flight_plan: FlightPlan, airport_elevation: float) -> bytes:
    """serialize flight plan to qgc wpl 110 mavlink waypoint format."""
    lines = ["QGC WPL 110"]
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)

    seq = 0
    for wp in waypoints:
        lon, lat, alt = point_lonlatalt(wp.position)
        # mavlink uses relative altitude (AGL)
        agl = alt - airport_elevation
        command = _WAYPOINT_TYPE_COMMANDS.get(wp.waypoint_type, _MAV_CMD_NAV_WAYPOINT)

        # first waypoint is current
        current = 1 if seq == 0 else 0

        # p1 = hold time for hover waypoints
        p1 = wp.hover_duration or 0

        line = (
            f"{seq}\t{current}\t{_MAV_FRAME}\t{command}\t"
            f"{p1}\t0\t0\t{wp.heading or 0}\t"
            f"{lat}\t{lon}\t{agl}\t1"
        )
        lines.append(line)
        seq += 1

        # camera command after navigation waypoint
        cam_cmd = _CAMERA_ACTION_COMMANDS.get(wp.camera_action)
        if cam_cmd:
            cam_line = f"{seq}\t0\t0\t{cam_cmd}\t0\t0\t0\t0\t0\t0\t0\t1"
            lines.append(cam_line)
            seq += 1

    return "\n".join(lines).encode("utf-8")


def _generate_mavlink_plan(
    flight_plan: FlightPlan,
    airport_elevation: float,
    geozone_payload: dict,
) -> bytes:
    """build a qgc .plan json doc with mission + geoFence + rallyPoints."""
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)

    items: list[dict] = []
    do_jump_id = 0
    for wp in waypoints:
        lon, lat, alt = point_lonlatalt(wp.position)
        agl = alt - airport_elevation
        command = _WAYPOINT_TYPE_COMMANDS.get(wp.waypoint_type, _MAV_CMD_NAV_WAYPOINT)
        params = [
            wp.hover_duration or 0,
            0,
            0,
            wp.heading or 0,
            lat,
            lon,
            agl,
        ]
        do_jump_id += 1
        items.append(
            {
                "AMSLAltAboveTerrain": None,
                "Altitude": agl,
                "AltitudeMode": 1,
                "autoContinue": True,
                "command": command,
                "doJumpId": do_jump_id,
                "frame": _MAV_FRAME,
                "params": params,
                "type": "SimpleItem",
            }
        )

        # camera trigger after the nav item, mirrors the WPL path so geozone
        # exports actually capture data instead of just flying the route.
        cam_cmd = _CAMERA_ACTION_COMMANDS.get(wp.camera_action)
        if cam_cmd:
            do_jump_id += 1
            items.append(
                {
                    "AMSLAltAboveTerrain": None,
                    "Altitude": 0,
                    "AltitudeMode": 1,
                    "autoContinue": True,
                    "command": cam_cmd,
                    "doJumpId": do_jump_id,
                    # MAV_FRAME_MISSION - non-positional, no lat/lon/alt
                    "frame": 2,
                    "params": [0, 0, 0, 0, 0, 0, 0],
                    "type": "SimpleItem",
                }
            )

    plan_home = _mavlink_planned_home_position(waypoints, airport_elevation)
    polygons = _mavlink_geofence_polygons(geozone_payload)

    plan = {
        "fileType": "Plan",
        "geoFence": {
            "circles": [],
            "polygons": polygons,
            "version": 2,
        },
        "groundStation": "QGroundControl",
        "mission": {
            "cruiseSpeed": 5,
            "firmwareType": 12,
            "globalPlanAltitudeMode": 1,
            "hoverSpeed": 5,
            "items": items,
            "plannedHomePosition": plan_home,
            "vehicleType": 2,
            "version": 2,
        },
        "rallyPoints": {
            "points": [],
            "version": 2,
        },
        "version": 1,
    }

    return json.dumps(plan, indent=4, cls=_UUIDEncoder).encode("utf-8")


def _mavlink_planned_home_position(waypoints, airport_elevation: float) -> list[float]:
    """choose [lat, lon, alt] for the qgc plannedHomePosition."""
    if not waypoints:
        return [0.0, 0.0, 0.0]
    lon, lat, _ = point_lonlatalt(waypoints[0].position)
    return [lat, lon, airport_elevation]


def _mavlink_geofence_polygons(geozone_payload: dict) -> list[dict]:
    """convert the geozone payload into qgc geoFence.polygons entries.

    safety zones + obstacles emit `inclusion: false` (keep-out). runway buffers
    emit `inclusion: true` (the drone must stay inside the buffered envelope).
    """
    polygons: list[dict] = []
    for zone in geozone_payload.get("safety_zones", []):
        rings = zone["geometry"].get("coordinates", [])
        if not rings:
            continue
        polygons.append(_mavlink_polygon_entry(rings[0], inclusion=False))
    for obstacle in geozone_payload.get("obstacles", []):
        rings = obstacle["geometry"].get("coordinates", [])
        if not rings:
            continue
        polygons.append(_mavlink_polygon_entry(rings[0], inclusion=False))
    for buffer in geozone_payload.get("runway_buffers", []):
        rings = buffer["geometry"].get("coordinates", [])
        if not rings:
            continue
        polygons.append(_mavlink_polygon_entry(rings[0], inclusion=True))
    return polygons


def _mavlink_polygon_entry(ring: list, *, inclusion: bool) -> dict:
    """shape a single geoFence polygon entry (qgc .plan v2 schema)."""
    # qgc polygons use [lat, lon] pairs and must NOT repeat the closing vertex
    coords = [[c[1], c[0]] for c in ring]
    if len(coords) >= 2 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return {
        "inclusion": inclusion,
        "polygon": coords,
        "version": 1,
    }
