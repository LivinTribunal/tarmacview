"""dji kmz archive (template.kml + waylines.wpml) export."""

import io
import zipfile

from app.models.flight_plan import FlightPlan

from ..dji import (
    _build_dji_template_kml,
    _build_dji_waylines_wpml,
    _first_zoom_emission_waypoints,
    _resolve_inspection_camera_settings,
)
from ..shared import _waypoint_sort_key


def generate_kmz(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    mission=None,
    drone_profile=None,
    scope: str = "FULL",
    geozone_payload: dict | None = None,
    heading_mode_override: str | None = None,
    clamps: list[dict] | None = None,
) -> bytes:
    """serialize flight plan to a dji wpmz archive consumable by flight hub 2.

    when `clamps` is supplied, any below-takeoff placemark altitude is
    appended once (on the waylines pass) so the orchestrator can refuse the
    file until the operator acknowledges the modification.
    """
    # resolve once - both builders consume the same camera + zoom-emission state
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)
    inspection_camera = _resolve_inspection_camera_settings(mission)
    zoom_seqs = _first_zoom_emission_waypoints(waypoints, inspection_camera, drone_profile)

    template_kml = _build_dji_template_kml(
        flight_plan,
        mission_name,
        airport_elevation,
        mission,
        drone_profile,
        inspection_camera=inspection_camera,
        zoom_seqs=zoom_seqs,
        scope=scope,
        geozone_payload=geozone_payload,
        heading_mode_override=heading_mode_override,
        clamps=clamps,
    )
    waylines_wpml = _build_dji_waylines_wpml(
        flight_plan,
        mission_name,
        airport_elevation,
        mission,
        drone_profile,
        inspection_camera=inspection_camera,
        zoom_seqs=zoom_seqs,
        scope=scope,
        heading_mode_override=heading_mode_override,
        clamps=clamps,
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("wpmz/template.kml", template_kml)
        zf.writestr("wpmz/waylines.wpml", waylines_wpml)

    return buf.getvalue()
