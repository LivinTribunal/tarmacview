"""openaip-derived runway + obstacle geometry construction (inverse of surface recompute)."""

from typing import Any

from app.schemas.geometry import LineStringZ, PointZ, PolygonZ
from app.utils.geo import point_at_distance


def _compute_runway_geometry(
    threshold_lat: float,
    threshold_lon: float,
    heading_deg: float,
    length_m: float,
    width_m: float,
    elevation_m: float,
) -> dict[str, Any]:
    """generate centerline, boundary, and end position from runway dimensions.

    returns a dict with LineStringZ geometry, PolygonZ boundary, and PointZ end_position.
    this is the inverse of AirfieldSurface.recalculate_dimensions().
    """
    end_lon, end_lat = point_at_distance(threshold_lon, threshold_lat, heading_deg, length_m)

    geometry = LineStringZ(
        type="LineString",
        coordinates=[
            [threshold_lon, threshold_lat, elevation_m],
            [end_lon, end_lat, elevation_m],
        ],
    )

    # boundary: rectangle offsetting both endpoints by width/2 perpendicular
    half_w = width_m / 2.0
    left_bearing = (heading_deg - 90.0) % 360.0
    right_bearing = (heading_deg + 90.0) % 360.0

    t_left_lon, t_left_lat = point_at_distance(threshold_lon, threshold_lat, left_bearing, half_w)
    t_right_lon, t_right_lat = point_at_distance(
        threshold_lon, threshold_lat, right_bearing, half_w
    )
    e_left_lon, e_left_lat = point_at_distance(end_lon, end_lat, left_bearing, half_w)
    e_right_lon, e_right_lat = point_at_distance(end_lon, end_lat, right_bearing, half_w)

    # polygon ring: threshold-left -> end-left -> end-right -> threshold-right -> close
    boundary = PolygonZ(
        type="Polygon",
        coordinates=[
            [
                [t_left_lon, t_left_lat, elevation_m],
                [e_left_lon, e_left_lat, elevation_m],
                [e_right_lon, e_right_lat, elevation_m],
                [t_right_lon, t_right_lat, elevation_m],
                [t_left_lon, t_left_lat, elevation_m],
            ]
        ],
    )

    end_position = PointZ(type="Point", coordinates=[end_lon, end_lat, elevation_m])

    return {
        "geometry": geometry,
        "boundary": boundary,
        "end_position": end_position,
    }


def _generate_obstacle_boundary(
    lat: float, lon: float, elevation: float, radius_m: float = 3.0, vertices: int = 16
) -> PolygonZ:
    """generate a small circular polygon around an obstacle point."""
    coords = []
    for i in range(vertices):
        bearing = (360.0 * i) / vertices
        p_lon, p_lat = point_at_distance(lon, lat, bearing, radius_m)
        coords.append([p_lon, p_lat, elevation])
    # close ring
    coords.append(coords[0])

    return PolygonZ(type="Polygon", coordinates=[coords])
