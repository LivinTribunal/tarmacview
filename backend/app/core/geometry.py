"""WKT geometry helpers - the single seam between stored strings and Shapely.

geometry columns store raw WKT strings (POINT Z (lon lat alt),
LINESTRING Z (...), POLYGON Z ((...))). every consumer that needs to operate
on the geometry parses through Shapely here.
"""

from __future__ import annotations

from shapely import from_wkt
from shapely.geometry.base import BaseGeometry


def wkt_to_shapely(wkt: str | None) -> BaseGeometry | None:
    """parse a WKT string to a Shapely geometry, returning None on empty input."""
    if wkt is None or wkt == "":
        return None
    return from_wkt(wkt)


def wkt_to_geojson(wkt: str | None) -> dict | None:
    """parse a WKT string to a GeoJSON dict (Point/LineString/Polygon, all 3D)."""
    geom = wkt_to_shapely(wkt)
    if geom is None:
        return None

    if geom.geom_type == "Point":
        return {"type": "Point", "coordinates": _coords_3d(list(geom.coords)[0])}

    if geom.geom_type == "LineString":
        return {"type": "LineString", "coordinates": [_coords_3d(c) for c in geom.coords]}

    if geom.geom_type == "Polygon":
        rings = [[_coords_3d(c) for c in geom.exterior.coords]]
        for interior in geom.interiors:
            rings.append([_coords_3d(c) for c in interior.coords])
        return {"type": "Polygon", "coordinates": rings}

    raise ValueError(f"unsupported geometry type: {geom.geom_type}")


def _coords_3d(c) -> list[float]:
    """normalize a coordinate tuple to [x, y, z] with z defaulting to 0."""
    if len(c) >= 3:
        return [float(c[0]), float(c[1]), float(c[2])]
    return [float(c[0]), float(c[1]), 0.0]


def point_lonlatalt(wkt: str | None) -> tuple[float, float, float]:
    """parse a Point WKT string to (lon, lat, alt); strict on empty/None/non-Point."""
    if not wkt:
        raise ValueError("missing point geometry")
    geom = wkt_to_shapely(wkt)
    if geom is None or geom.geom_type != "Point":
        raise ValueError(f"expected Point geometry, got {geom.geom_type if geom else None}")
    c = geom.coords[0]  # POINT EMPTY -> IndexError (a missing point is a data bug)
    return (float(c[0]), float(c[1]), float(c[2]) if len(c) > 2 else 0.0)


def polygon_xy(wkt: str | None) -> list[tuple[float, float]]:
    """parse a Polygon WKT string to a list of (lon, lat) exterior-ring pairs.

    returns [] on empty/None input; raises ValueError on non-Polygon geometry.
    """
    if not wkt:
        return []
    geom = wkt_to_shapely(wkt)
    if geom is None:
        return []
    if geom.geom_type != "Polygon":
        raise ValueError(f"expected Polygon geometry, got {geom.geom_type}")
    return [(float(c[0]), float(c[1])) for c in geom.exterior.coords]


def linestring_xy(wkt: str | None) -> list[tuple[float, float]]:
    """parse a LineString WKT string to a list of (lon, lat) pairs.

    returns [] on empty/None input; raises ValueError on non-LineString geometry.
    """
    if not wkt:
        return []
    geom = wkt_to_shapely(wkt)
    if geom is None:
        return []
    if geom.geom_type != "LineString":
        raise ValueError(f"expected LineString geometry, got {geom.geom_type}")
    return [(float(c[0]), float(c[1])) for c in geom.coords]
