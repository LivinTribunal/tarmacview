"""gpx 1.1 export - generic gps exchange document."""

import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from app.models.flight_plan import FlightPlan

from ..shared import _iter_waypoints_agl


def generate_gpx(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
) -> bytes:
    """serialize flight plan to gpx 1.1 format."""
    rows = list(_iter_waypoints_agl(flight_plan, airport_elevation))

    gpx = ET.Element(
        "gpx",
        {
            "version": "1.1",
            "creator": "TarmacView",
            "xmlns": "http://www.topografix.com/GPX/1/1",
        },
    )

    metadata = ET.SubElement(gpx, "metadata")
    ET.SubElement(metadata, "name").text = mission_name or "Flight Plan"
    ET.SubElement(metadata, "time").text = datetime.now(timezone.utc).isoformat()

    # waypoint elements
    for wp, lon, lat, alt, _agl in rows:
        wpt = ET.SubElement(gpx, "wpt", {"lat": f"{lat:.8f}", "lon": f"{lon:.8f}"})
        ET.SubElement(wpt, "ele").text = f"{alt:.2f}"
        ET.SubElement(wpt, "name").text = f"WP{wp.sequence_order}"
        ET.SubElement(wpt, "desc").text = f"{wp.waypoint_type} {wp.camera_action or 'NONE'}"

    # track element
    trk = ET.SubElement(gpx, "trk")
    ET.SubElement(trk, "name").text = mission_name or "Flight Plan"
    trkseg = ET.SubElement(trk, "trkseg")

    for _wp, lon, lat, alt, _agl in rows:
        trkpt = ET.SubElement(trkseg, "trkpt", {"lat": f"{lat:.8f}", "lon": f"{lon:.8f}"})
        ET.SubElement(trkpt, "ele").text = f"{alt:.2f}"

    return ET.tostring(gpx, encoding="utf-8", xml_declaration=True)
