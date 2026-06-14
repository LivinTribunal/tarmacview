"""dronedeploy json export."""

import json

from app.models.flight_plan import FlightPlan

from ..shared import _iter_waypoints_agl, _UUIDEncoder


def generate_dronedeploy(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
) -> bytes:
    """serialize flight plan to dronedeploy json format."""
    dd_action_map = {
        "PHOTO_CAPTURE": {"type": "photo"},
        "RECORDING_START": {"type": "videoStart"},
        "RECORDING_STOP": {"type": "videoStop"},
    }

    wp_list = []
    for wp, lon, lat, alt, agl in _iter_waypoints_agl(flight_plan, airport_elevation):
        actions = []
        dd_action = dd_action_map.get(wp.camera_action)
        if dd_action:
            actions.append(dd_action)

        wp_list.append(
            {
                "lat": lat,
                "lng": lon,
                "alt": agl,
                "speed": wp.speed or 0,
                "heading": wp.heading or 0,
                "actions": actions,
            }
        )

    data = {
        "version": 1,
        "name": mission_name or "Flight Plan",
        "waypoints": wp_list,
    }

    return json.dumps(data, indent=2, cls=_UUIDEncoder).encode("utf-8")
