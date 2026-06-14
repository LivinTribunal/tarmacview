"""structured json export."""

import json
from datetime import datetime, timezone

from app.core.geometry import point_lonlatalt
from app.models.flight_plan import FlightPlan
from app.models.mission import Mission

from ..shared import _UUIDEncoder, _waypoint_sort_key


def generate_json(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    mission: Mission | None = None,
    geozone_payload: dict | None = None,
) -> bytes:
    """serialize flight plan to structured json."""
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)

    wp_list = []
    for wp in waypoints:
        lon, lat, alt = point_lonlatalt(wp.position)
        agl = alt - airport_elevation

        camera_target = None
        if wp.camera_target:
            ct_lon, ct_lat, ct_alt = point_lonlatalt(wp.camera_target)
            camera_target = {
                "latitude": ct_lat,
                "longitude": ct_lon,
                "altitude_msl": ct_alt,
                "altitude_agl": ct_alt - airport_elevation,
            }

        wp_list.append(
            {
                "sequence_order": wp.sequence_order,
                "latitude": lat,
                "longitude": lon,
                "altitude_msl": alt,
                "altitude_agl": agl,
                "speed": wp.speed,
                "heading": wp.heading,
                "camera_action": wp.camera_action,
                "waypoint_type": wp.waypoint_type,
                "camera_target": camera_target,
                "inspection_id": wp.inspection_id,
            }
        )

    data = {
        "mission_name": mission_name,
        "mission_id": flight_plan.mission_id,
        "airport_elevation": airport_elevation,
        "generated_at": flight_plan.generated_at or datetime.now(timezone.utc),
        "total_distance": flight_plan.total_distance,
        "estimated_duration": flight_plan.estimated_duration,
        "waypoints": wp_list,
    }

    # per-inspection camera settings when mission is available
    if mission and hasattr(mission, "inspections") and mission.inspections:
        _cam_keys = (
            "white_balance",
            "iso",
            "shutter_speed",
            "focus_mode",
            "optical_zoom",
        )
        inspections_out = []
        for insp in sorted(mission.inspections, key=lambda i: i.sequence_order):
            resolved = {}
            if insp.config:
                template_cfg = insp.template.default_config if insp.template else None
                resolved = insp.config.resolve_with_defaults(template_cfg)
            cam = {k: resolved.get(k) for k in _cam_keys}
            if any(v is not None for v in cam.values()):
                inspections_out.append(
                    {
                        "id": insp.id,
                        "method": insp.method,
                        "sequence_order": insp.sequence_order,
                        "camera_settings": cam,
                    }
                )
        if inspections_out:
            data["inspections"] = inspections_out

    if geozone_payload is not None:
        data["geozones"] = geozone_payload

    return json.dumps(data, indent=2, cls=_UUIDEncoder).encode("utf-8")
