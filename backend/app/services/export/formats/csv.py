"""csv export - flat tabular waypoint dump."""

import csv
import io

from app.models.flight_plan import FlightPlan

from ..shared import _iter_waypoints_agl


def generate_csv_export(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
) -> bytes:
    """serialize flight plan to csv format."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "sequence",
            "latitude",
            "longitude",
            "altitude_msl",
            "altitude_agl",
            "speed",
            "heading",
            "camera_action",
            "waypoint_type",
        ]
    )

    for wp, lon, lat, alt, agl in _iter_waypoints_agl(flight_plan, airport_elevation):
        writer.writerow(
            [
                wp.sequence_order,
                f"{lat:.8f}",
                f"{lon:.8f}",
                f"{alt:.2f}",
                f"{agl:.2f}",
                wp.speed or 0,
                wp.heading or 0,
                wp.camera_action or "NONE",
                wp.waypoint_type,
            ]
        )

    return buf.getvalue().encode("utf-8")
