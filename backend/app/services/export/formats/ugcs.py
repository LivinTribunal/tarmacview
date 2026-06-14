"""ugcs route json export."""

import json
import math
from datetime import datetime, timezone

from app.models.flight_plan import FlightPlan

from ..shared import _iter_waypoints_agl, _UUIDEncoder

# ugcs data model version - matches the version ugcs expects for route import.
# update these values if your ugcs installation uses a different schema version.
_UGCS_VERSION = {
    "major": 5,
    "minor": 16,
    "patch": 1,
    "build": "9205",
    "component": "DATABASE",
}

# ugcs import only accepts "Waypoint" for all segments - Takeoff/Landing
# are internal types assigned by ugcs route planner, not valid for import.


def _deg_to_rad(degrees: float) -> float:
    """convert degrees to radians for ugcs coordinate format."""
    return degrees * math.pi / 180.0


def _build_ugcs_actions(wp) -> list[dict]:
    """build ugcs action list from waypoint fields."""
    actions = []

    if wp.heading is not None:
        actions.append(
            {
                "type": "Heading",
                "heading": _deg_to_rad(wp.heading),
                "relativeToNextWaypoint": False,
                "relativeToNorth": True,
            }
        )

    if wp.gimbal_pitch is not None:
        actions.append(
            {
                "type": "CameraControl",
                "tilt": _deg_to_rad(wp.gimbal_pitch),
                "roll": 0.0,
                "yaw": 0.0,
                "zoomLevel": None,
            }
        )

    if wp.camera_action == "PHOTO_CAPTURE":
        actions.append({"type": "CameraTrigger", "state": "SINGLE_SHOT"})
    elif wp.camera_action == "RECORDING_START":
        actions.append({"type": "CameraTrigger", "state": "START_RECORDING"})
    elif wp.camera_action == "RECORDING_STOP":
        actions.append({"type": "CameraTrigger", "state": "STOP_RECORDING"})

    if wp.hover_duration and wp.hover_duration > 0:
        actions.append(
            {
                "type": "Wait",
                "interval": wp.hover_duration,
                "waitForOperator": False,
                "waitForInstant": False,
            }
        )

    return actions


def generate_ugcs(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    geozone_payload: dict | None = None,
) -> bytes:
    """serialize flight plan to ugcs-compatible json route format."""
    rows = list(_iter_waypoints_agl(flight_plan, airport_elevation))

    segments = []
    for wp, lon, lat, alt, agl in rows:
        speed = wp.speed or 0.0

        # ugcs turn type - hover waypoints stop, others fly through
        turn_type = "STOP_AND_TURN" if wp.waypoint_type == "HOVER" else "STRAIGHT"

        segment = {
            "type": "Waypoint",
            "actions": _build_ugcs_actions(wp),
            "point": {
                "latitude": _deg_to_rad(lat),
                "longitude": _deg_to_rad(lon),
                "altitude": agl,
                "altitudeType": "AGL",
            },
            "parameters": {
                "avoidObstacles": False,
                "avoidTerrain": False,
                "speed": speed,
                "wpTurnType": turn_type,
                "altitudeType": "AGL",
                "cornerRadius": None,
            },
        }
        segments.append(segment)

    if flight_plan.generated_at:
        creation_time = int(flight_plan.generated_at.timestamp() * 1000)
    else:
        creation_time = int(datetime.now(timezone.utc).timestamp() * 1000)

    initial_speed = rows[0][0].speed if rows else 5.0

    check_custom_nfz = geozone_payload is not None
    data = {
        "version": _UGCS_VERSION,
        "payloadProfiles": [],
        "vehicleProfiles": [],
        "route": {
            "name": mission_name or "Untitled Route",
            "creationTime": creation_time,
            "scheduledTime": None,
            "startDelay": None,
            "vehicleProfile": None,
            "trajectoryType": None,
            "safeAltitude": 50.0,
            "maxAltitude": 1500.0,
            "initialSpeed": initial_speed or 5.0,
            "maxSpeed": None,
            "failsafes": {
                "rcLost": "GO_HOME",
                "gpsLost": None,
                "lowBattery": None,
                "datalinkLost": None,
            },
            "checkAerodromeNfz": False,
            "checkCustomNfz": check_custom_nfz,
            "segments": segments,
            "takeoffHeight": None,
            "cornerRadius": 20.0,
        },
    }

    if geozone_payload is not None:
        # the ugcs route schema only carries a `checkCustomNfz` toggle - it does
        # not embed nfz polygons inline. emit a sibling `customNfzList` block so
        # operators can import the polygons through ugcs's separate nfz import
        # path; the route entry flips checkCustomNfz=true so flights honor them.
        data["customNfzList"] = _build_ugcs_custom_nfz_list(geozone_payload)

    # ugcs uses java jackson serializer - match its formatting
    return json.dumps(data, indent=2, separators=(",", " : "), cls=_UUIDEncoder).encode("utf-8")


def _build_ugcs_custom_nfz_list(geozone_payload: dict) -> list[dict]:
    """convert geozone payload entries into ugcs custom-nfz polygon dicts."""
    items: list[dict] = []
    for zone in geozone_payload.get("safety_zones", []):
        items.append(_ugcs_nfz_entry(zone["name"], zone["type"], zone["geometry"]))
    for obstacle in geozone_payload.get("obstacles", []):
        items.append(_ugcs_nfz_entry(obstacle["name"], "OBSTACLE", obstacle["geometry"]))
    for buffer in geozone_payload.get("runway_buffers", []):
        label = f"{buffer['surface_type']} {buffer['identifier']}".strip()
        items.append(_ugcs_nfz_entry(label, "RUNWAY_BUFFER", buffer["geometry"]))
    return items


def _ugcs_nfz_entry(name: str, kind: str, geometry: dict) -> dict:
    """shape an individual ugcs custom-nfz entry from a polygon geometry."""
    rings = geometry.get("coordinates", [])
    points: list[dict] = []
    if rings:
        for c in rings[0]:
            points.append(
                {
                    "latitude": _deg_to_rad(c[1]),
                    "longitude": _deg_to_rad(c[0]),
                }
            )
    return {
        "name": name,
        "type": kind,
        "polygon": {"points": points},
    }
