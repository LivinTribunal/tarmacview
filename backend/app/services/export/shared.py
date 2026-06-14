"""shared encoder, sort, xml-primitive, and waypoint helpers for every export generator."""

import json
import xml.etree.ElementTree as ET
from datetime import datetime
from uuid import UUID

from app.core.geometry import point_lonlatalt

# dji wpmz 1.0.6 - flight hub 2 / pilot 2 schema used by real dji exports.
# the namespace primitives + registration live here (not in dji.py) so every
# dji_* submodule imports downward only and the package has no import cycle.
_KML_NS = "http://www.opengis.net/kml/2.2"
_WPML_NS = "http://www.dji.com/wpmz/1.0.6"
_KML = f"{{{_KML_NS}}}"
_WPML = f"{{{_WPML_NS}}}"

ET.register_namespace("", _KML_NS)
ET.register_namespace("wpml", _WPML_NS)

# advisory note attached to every keep-out placemark - DJI Pilot 2 renders
# these polygons but does NOT enforce them, so the operator must understand
# the file is informational, not a fence upload.
_KML_KEEPOUT_DESCRIPTION = (
    "Advisory only - not enforced by DJI Pilot 2. Configure server-side "
    "geofencing (FlySafe / FlightHub 2 Custom Flight Area) for enforcement."
)


def _waypoint_sort_key(wp):
    """sort waypoints by sequence order."""
    return wp.sequence_order


def _kml_tag(name: str) -> str:
    """qualify an element name with the kml namespace."""
    return f"{_KML}{name}"


def _wpml_tag(name: str) -> str:
    """qualify an element name with the dji wpml namespace."""
    return f"{_WPML}{name}"


def _sub_text(parent, tag: str, text: str):
    """create a child element in the wpml namespace with text content."""
    el = ET.SubElement(parent, _wpml_tag(tag))
    el.text = text
    return el


def _iter_waypoints_agl(flight_plan, airport_elevation: float):
    """yield (wp, lon, lat, alt, agl) per waypoint in sequence order.

    centralizes the sort + point_lonlatalt + `alt - airport_elevation` triplet
    repeated across the byte-identical format generators. agl is the airport-
    relative height; consumers that only need lon/lat/alt ignore the last slot.
    """
    for wp in sorted(flight_plan.waypoints, key=_waypoint_sort_key):
        lon, lat, alt = point_lonlatalt(wp.position)
        yield wp, lon, lat, alt, alt - airport_elevation


class _UUIDEncoder(json.JSONEncoder):
    """json encoder that handles UUIDs and datetimes."""

    def default(self, o):
        """serialize non-standard types."""
        if isinstance(o, UUID):
            return str(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)
