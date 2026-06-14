"""export-format registry - maps format code to generator callable."""

from typing import Callable

from .csv import generate_csv_export
from .dronedeploy import generate_dronedeploy
from .gpx import generate_gpx
from .json import generate_json
from .kml import generate_kml
from .kmz import generate_kmz
from .litchi import generate_litchi_csv
from .mavlink import generate_mavlink
from .ugcs import generate_ugcs
from .wpml import generate_wpml

EXPORT_REGISTRY: dict[str, Callable] = {
    "KML": generate_kml,
    "KMZ": generate_kmz,
    "JSON": generate_json,
    "MAVLINK": generate_mavlink,
    "UGCS": generate_ugcs,
    "WPML": generate_wpml,
    "CSV": generate_csv_export,
    "GPX": generate_gpx,
    "LITCHI": generate_litchi_csv,
    "DRONEDEPLOY": generate_dronedeploy,
}

__all__ = [
    "EXPORT_REGISTRY",
    "generate_kml",
    "generate_kmz",
    "generate_json",
    "generate_mavlink",
    "generate_ugcs",
    "generate_wpml",
    "generate_csv_export",
    "generate_gpx",
    "generate_litchi_csv",
    "generate_dronedeploy",
]
