"""geozone payload assembly + WKT helpers shared by every geozone-capable format."""

from app.core.enums import SafetyZoneType
from app.core.geometry import wkt_to_geojson
from app.models.airport import Airport


def _geometry_to_geojson_polygon(geom: str | None) -> dict | None:
    """convert a WKT polygon column into a geojson Polygon dict."""
    if not geom:
        return None
    return wkt_to_geojson(geom)


def _ring_xy(ring: list) -> list[tuple[float, float]]:
    """drop z to produce a list of (lon, lat) pairs for kml/mavlink polygons."""
    return [(c[0], c[1]) for c in ring]


def build_geozone_payload(
    airport: Airport,
    *,
    include_runway_buffers: bool,
) -> dict:
    """assemble the export-ready geozone payload from airport state.

    filters: AIRPORT_BOUNDARY safety zones are excluded (boundary defines where
    the airport is, not a keep-out); inactive safety zones are excluded.
    runway_buffers is populated only when the caller asked for them.
    """
    safety_zones: list[dict] = []
    for zone in airport.safety_zones or []:
        if not zone.is_active:
            continue
        if zone.type == SafetyZoneType.AIRPORT_BOUNDARY.value:
            continue
        polygon = _geometry_to_geojson_polygon(zone.geometry)
        if polygon is None:
            continue
        safety_zones.append(
            {
                "id": str(zone.id),
                "name": zone.name,
                "type": zone.type,
                "altitude_floor": zone.altitude_floor,
                "altitude_ceiling": zone.altitude_ceiling,
                "geometry": polygon,
            }
        )

    obstacles: list[dict] = []
    for obstacle in airport.obstacles or []:
        polygon = _geometry_to_geojson_polygon(obstacle.boundary)
        if polygon is None:
            continue
        obstacles.append(
            {
                "id": str(obstacle.id),
                "name": obstacle.name,
                "type": obstacle.type,
                "height": obstacle.height,
                "buffer_distance": obstacle.buffer_distance,
                "geometry": polygon,
            }
        )

    runway_buffers: list[dict] = []
    if include_runway_buffers:
        for surface in airport.surfaces or []:
            polygon = _geometry_to_geojson_polygon(surface.boundary)
            if polygon is None:
                continue
            runway_buffers.append(
                {
                    "id": str(surface.id),
                    "identifier": surface.identifier,
                    "surface_type": surface.surface_type,
                    "buffer_distance": surface.buffer_distance,
                    "geometry": polygon,
                }
            )

    return {
        "safety_zones": safety_zones,
        "obstacles": obstacles,
        "runway_buffers": runway_buffers,
    }
