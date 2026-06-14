"""kml export - generic google-earth waypoint document."""

import simplekml

from app.models.flight_plan import FlightPlan

from ..geozone import _ring_xy
from ..shared import _KML_KEEPOUT_DESCRIPTION, _iter_waypoints_agl


def generate_kml(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    geozone_payload: dict | None = None,
) -> bytes:
    """serialize flight plan waypoints to kml format."""
    kml = simplekml.Kml()
    kml.document.name = f"Flight Plan - {mission_name}" if mission_name else "Flight Plan"

    folder = kml.newfolder(name="Waypoints")

    coords_list = []
    for wp, lon, lat, alt, agl in _iter_waypoints_agl(flight_plan, airport_elevation):
        coords_list.append((lon, lat, agl))

        pnt = folder.newpoint(
            name=f"WP{wp.sequence_order}",
            coords=[(lon, lat, agl)],
        )
        pnt.description = (
            f"Type: {wp.waypoint_type}\n"
            f"Camera: {wp.camera_action or 'NONE'}\n"
            f"Speed: {wp.speed or 0} m/s\n"
            f"Heading: {wp.heading or 0}°\n"
            f"Altitude MSL: {alt:.1f}m\n"
            f"Altitude AGL: {agl:.1f}m"
        )
        pnt.altitudemode = simplekml.AltitudeMode.relativetoground

    # connecting line
    if len(coords_list) > 1:
        line = kml.newlinestring(name="Flight Path")
        line.coords = coords_list
        line.altitudemode = simplekml.AltitudeMode.relativetoground
        line.style.linestyle.color = simplekml.Color.green
        line.style.linestyle.width = 2

    if geozone_payload is not None:
        _append_kml_keepouts(kml, geozone_payload)

    return kml.kml().encode("utf-8")


def _append_kml_keepouts(kml, geozone_payload: dict) -> None:
    """add a 'Keep-out zones' folder to a simplekml document."""
    safety_zones = geozone_payload.get("safety_zones") or []
    obstacles = geozone_payload.get("obstacles") or []
    runway_buffers = geozone_payload.get("runway_buffers") or []

    if not safety_zones and not obstacles and not runway_buffers:
        return

    folder = kml.newfolder(name="Keep-out zones")

    for zone in safety_zones:
        rings = zone["geometry"].get("coordinates", [])
        if not rings:
            continue
        placemark = folder.newpolygon(
            name=f"Safety Zone - {zone['name']}",
            outerboundaryis=_ring_xy(rings[0]),
        )
        placemark.description = _KML_KEEPOUT_DESCRIPTION
        placemark.style.polystyle.color = simplekml.Color.changealphaint(96, simplekml.Color.red)
        placemark.style.linestyle.color = simplekml.Color.red
        placemark.style.linestyle.width = 2

    for obstacle in obstacles:
        rings = obstacle["geometry"].get("coordinates", [])
        if not rings:
            continue
        placemark = folder.newpolygon(
            name=f"Obstacle - {obstacle['name']}",
            outerboundaryis=_ring_xy(rings[0]),
        )
        placemark.description = _KML_KEEPOUT_DESCRIPTION
        placemark.style.polystyle.color = simplekml.Color.changealphaint(96, simplekml.Color.orange)
        placemark.style.linestyle.color = simplekml.Color.orange
        placemark.style.linestyle.width = 2

    for buffer in runway_buffers:
        rings = buffer["geometry"].get("coordinates", [])
        if not rings:
            continue
        placemark = folder.newpolygon(
            name=f"Runway buffer - {buffer['identifier']}",
            outerboundaryis=_ring_xy(rings[0]),
        )
        placemark.description = _KML_KEEPOUT_DESCRIPTION
        placemark.style.polystyle.color = simplekml.Color.changealphaint(64, simplekml.Color.yellow)
        placemark.style.linestyle.color = simplekml.Color.yellow
        placemark.style.linestyle.width = 1
