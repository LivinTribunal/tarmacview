"""shapely geometry primitives: obstacle buffer, segment intersection, polygon containment."""

from __future__ import annotations

from shapely.geometry import LineString, Point, Polygon

from app.core.geometry import wkt_to_shapely

from ..types import DEFAULT_OBSTACLE_RADIUS, LocalObstacle, Meters


def resolve_obstacle_buffer(
    obstacle: LocalObstacle,
    override: float | None,
) -> Meters:
    """resolve the effective keepout buffer for an obstacle in meters.

    single source of truth for the per-obstacle buffer fallback used by every
    Shapely-based site (safety validation, visibility graph edges, reroute
    search radius, vertex extraction, fast-path segment checks).

    priority chain (each entry wins over the next):
      1. caller override  - when ``override > 0``, that value wins.
      2. obstacle.buffer_distance  - when set and > 0, falls back to this.
      3. DEFAULT_OBSTACLE_RADIUS  - last-resort floor that keeps reroutes from
         collapsing to zero radius and never relaxes the safety envelope.

    a zero or None override means "no caller-level override", not "zero buffer".
    """
    if override is not None and override > 0:
        return override
    if obstacle.buffer_distance is not None and obstacle.buffer_distance > 0:
        return obstacle.buffer_distance
    return DEFAULT_OBSTACLE_RADIUS


def check_obstacle(
    wp_x: float,
    wp_y: float,
    wp_alt: float,
    obstacle: LocalObstacle,
    buffer_distance: Meters = 0.0,
) -> bool:
    """check if waypoint is inside an obstacle's buffered boundary below its height."""
    buf = resolve_obstacle_buffer(obstacle, buffer_distance)
    poly = obstacle.polygon.buffer(buf) if buf > 0 else obstacle.polygon
    if not poly.contains(Point(wp_x, wp_y)):
        return False
    obs_top = obstacle.base_alt + obstacle.height
    return wp_alt >= obstacle.base_alt and wp_alt <= obs_top


# Shapely-based segment intersection functions (replace PostGIS equivalents)


def segments_intersect_obstacle(
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    obstacle: LocalObstacle,
    buffer_distance: Meters = 0.0,
) -> bool:
    """check if a line segment intersects an obstacle's buffered 2D boundary."""
    buf = resolve_obstacle_buffer(obstacle, buffer_distance)
    poly = obstacle.polygon.buffer(buf) if buf > 0 else obstacle.polygon
    line = LineString([(from_x, from_y), (to_x, to_y)])
    return line.intersects(poly)


def segments_intersect_zone(
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    zone_polygon: Polygon,
) -> bool:
    """check if a line segment intersects a safety zone's 2D footprint."""
    line = LineString([(from_x, from_y), (to_x, to_y)])
    return line.intersects(zone_polygon)


def segment_runway_crossing_length(
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    surface_polygon,
) -> float:
    """length in meters of segment inside a runway's buffered area.

    uses pre-built Shapely polygon (buffered centerline). returns 0 if no crossing.
    """
    line = LineString([(from_x, from_y), (to_x, to_y)])
    if not line.intersects(surface_polygon):
        return 0.0
    intersection = line.intersection(surface_polygon)
    return intersection.length


# Shapely ports of the prior PostGIS standalone queries.


def _polygon_contains_lonlat_2d(wkt: str | None, lon: float, lat: float) -> bool | None:
    """parse WKT polygon and test 2D containment of (lon, lat) in WGS84 space.

    containment is evaluated in degree space, dropping z. returns None when the
    polygon is missing or unparseable so callers can branch.
    """
    if not wkt:
        return None
    geom = wkt_to_shapely(wkt)
    if geom is None or not isinstance(geom, Polygon):
        return None
    # force-2D by reading exterior coords ignoring z; shapely's contains is
    # already 2D so a 3D polygon with z works directly.
    return geom.contains(Point(lon, lat))
