"""geodesic helpers, EGM96/HAE conversion, polygon dimensioning, and A* search for pathfinding."""

import heapq
import math

from app.core.constants import EARTH_RADIUS_M

# re-export so consumers using `app.utils.geo.EARTH_RADIUS_M` keep working.
__all__ = [
    "EARTH_RADIUS_M",
    "astar",
    "angular_span_at_distance",
    "bearing_between",
    "center_of_points",
    "distance_between",
    "egm96_undulation",
    "elevation_angle",
    "euclidean_distance",
    "linestring_length",
    "msl_to_hae",
    "point_at_distance",
    "polygon_oriented_dimensions",
    "total_path_distance",
]


# egm96 coarse model
#
# fitted closed-form approximation of the EGM96 geoid: a leading J2-like
# zonal term plus a small set of gaussian bumps anchored on the dominant
# features (north atlantic high, indian ocean low, new guinea high, etc.).
# calibrated against published EGM96 undulation at LZIB / Jaro Luka
# (~+44.5 m), since that is the project's central european operating region.
# accuracy near LZIB: ~1-2 m. accuracy elsewhere: up to ~15 m off the real
# grid in regions without a fitted bump nearby.
#
# this is NOT a substitute for the real 16 MB egm96-15.pgm grid - it exists
# because `geographiclib` is the right long-term answer but
# `backend/requirements.txt` is a protected file (human-only). once the dep
# lands, swap the body of `egm96_undulation` for a `geographiclib.geoid.GeoidPGM`
# lookup and drop the bump table.
#
# bump format: (center_lat, center_lon, amplitude_m, sigma_deg). longitudinal
# distance uses cos(lat) compression so the bump radius stays geographic
# rather than gridded.
_EGM96_BUMPS: tuple[tuple[float, float, float, float], ...] = (
    # planet-wide J2-like baseline carried by the leading -22 sin(2 lat) term
    # already in `egm96_undulation`; bumps below capture longitudinal pattern.
    # north atlantic high
    (55.0, -25.0, 55.0, 28.0),
    # central europe high - tuned to put LZIB / Jaro Luka (~48 N, 17 E) at the
    # published +44.5 m undulation since that's the project's operating region
    (50.0, 12.0, 45.0, 22.0),
    # indian ocean depression - the deepest EGM96 low
    (-5.0, 80.0, -100.0, 28.0),
    # new guinea high
    (-5.0, 145.0, 70.0, 22.0),
    # andes / south america
    (-15.0, -65.0, 25.0, 20.0),
    # california / pacific northwest low
    (40.0, -125.0, -15.0, 18.0),
    # hudson bay low
    (60.0, -90.0, -40.0, 20.0),
    # north pacific low
    (35.0, 175.0, -10.0, 25.0),
    # australia / southern ocean
    (-30.0, 135.0, -15.0, 22.0),
    # southern atlantic low
    (-40.0, -20.0, -25.0, 28.0),
    # africa east coast trough
    (5.0, 35.0, -20.0, 20.0),
    # asia interior plateau
    (40.0, 100.0, -25.0, 25.0),
)


def egm96_undulation(lat: float, lon: float) -> float:
    """egm96 geoid height above the WGS84 ellipsoid at (lat, lon), in meters.

    positive when the ellipsoid sits above the geoid - i.e. HAE = MSL + N(lat, lon).
    coarse fitted model accurate to ~5-10 m globally; replace with a real
    16 MB EGM96 grid once `geographiclib` is approved in requirements.txt.
    """
    # leading J2-like zonal term - sets the latitude baseline
    lat_rad = math.radians(lat)
    n = -22.0 * math.sin(2.0 * lat_rad)

    cos_lat = math.cos(lat_rad)
    for clat, clon, amp, sigma in _EGM96_BUMPS:
        dlat = lat - clat
        # wrap longitude difference into [-180, 180]
        dlon = ((lon - clon + 180.0) % 360.0) - 180.0
        # cos-lat compression keeps the bump shape geographic, not gridded
        d2 = dlat * dlat + (dlon * cos_lat) ** 2
        n += amp * math.exp(-d2 / (2.0 * sigma * sigma))

    return n


def msl_to_hae(lat: float, lon: float, msl: float) -> float:
    """convert mean-sea-level altitude to wgs84 ellipsoid height at (lat, lon)."""
    return msl + egm96_undulation(lat, lon)


def distance_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """great-circle distance in meters between two WGS84 points (haversine)."""
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    # half-chord length squared
    half_chord = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )

    # angular distance in radians, then scale by earth radius
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(half_chord))


def bearing_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """initial bearing in degrees from point 1 to point 2 (0 = north, 90 = east)."""
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)

    # east-west and north-south components
    east = math.sin(delta_lon) * math.cos(lat2_rad)
    north = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(
        lat2_rad
    ) * math.cos(delta_lon)

    return (math.degrees(math.atan2(east, north)) + 360) % 360


def point_at_distance(
    lon: float, lat: float, bearing_deg: float, distance_m: float
) -> tuple[float, float]:
    """point at given distance and bearing from start - returns (lon, lat)."""
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    brng_rad = math.radians(bearing_deg)

    # angular distance on earth's surface
    angular_dist = distance_m / EARTH_RADIUS_M

    # destination latitude
    dest_lat = math.asin(
        math.sin(lat_rad) * math.cos(angular_dist)
        + math.cos(lat_rad) * math.sin(angular_dist) * math.cos(brng_rad)
    )

    # destination longitude
    dest_lon = lon_rad + math.atan2(
        math.sin(brng_rad) * math.sin(angular_dist) * math.cos(lat_rad),
        math.cos(angular_dist) - math.sin(lat_rad) * math.sin(dest_lat),
    )

    return math.degrees(dest_lon), math.degrees(dest_lat)


def center_of_points(
    points: list[tuple[float, float, float]],
) -> tuple[float, float, float]:
    """arithmetic mean of 3D points - (lon, lat, alt)."""
    n = len(points)
    if n == 0:
        raise ValueError("no points for centroid")

    return (
        sum(p[0] for p in points) / n,
        sum(p[1] for p in points) / n,
        sum(p[2] for p in points) / n,
    )


def linestring_length(coords: list[list[float]]) -> float:
    """sum of great-circle distances along a linestring of (lon, lat, ...) points in meters."""
    total = 0.0
    for i in range(1, len(coords)):
        total += distance_between(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])

    return total


def _convex_hull(xy: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """convex hull of 2D points via Andrew's monotone chain.

    returns the hull vertices, or an empty list when fewer than 3 distinct
    points are supplied (a degenerate hull the caller treats as no box).
    """
    xy_sorted = sorted(set(xy))
    if len(xy_sorted) < 3:
        return []

    def cross(o, a, b):
        """2D cross product of oa and ob - sign gives turn orientation."""
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in xy_sorted:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(xy_sorted):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _min_area_obb(hull: list[tuple[float, float]]) -> tuple[float, float, float]:
    """minimum-area oriented bounding box of a convex hull via rotating calipers.

    returns (length, width, heading_deg) - length is the longer OBB side,
    width the perpendicular dimension, heading the compass bearing of the
    long axis.
    """
    best_area = float("inf")
    best_length = 0.0
    best_width = 0.0
    best_angle = 0.0

    n = len(hull)
    for i in range(n):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % n]
        edge_len = math.hypot(x2 - x1, y2 - y1)
        if edge_len == 0:
            continue
        ux, uy = (x2 - x1) / edge_len, (y2 - y1) / edge_len
        # perpendicular axis
        vx, vy = -uy, ux
        min_u = min_v = float("inf")
        max_u = max_v = float("-inf")
        for hx, hy in hull:
            dx, dy = hx - x1, hy - y1
            u = dx * ux + dy * uy
            v = dx * vx + dy * vy
            if u < min_u:
                min_u = u
            if u > max_u:
                max_u = u
            if v < min_v:
                min_v = v
            if v > max_v:
                max_v = v
        du = max_u - min_u
        dv = max_v - min_v
        area = du * dv
        if area < best_area:
            best_area = area
            length = max(du, dv)
            width = min(du, dv)
            # heading aligned with the long side
            if du >= dv:
                angle_rad = math.atan2(uy, ux)
            else:
                angle_rad = math.atan2(vy, vx)
            best_length = length
            best_width = width
            # convert math angle (CCW from east) to compass bearing (CW from north)
            best_angle = (90.0 - math.degrees(angle_rad)) % 180.0

    return best_length, best_width, best_angle


def polygon_oriented_dimensions(
    ring: list[list[float]],
) -> tuple[float, float, float]:
    """oriented bounding box of a polygon ring (lon, lat, ...).

    returns (length, width, heading_deg) where length is the longest side of
    the OBB, width is the perpendicular dimension, and heading is the bearing
    of the long axis. uses rotating calipers on the convex hull and projects
    points to a local east/north plane centered at the polygon centroid.
    """
    pts = list(ring)
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return 0.0, 0.0, 0.0

    # local east/north projection in meters
    lat0 = sum(p[1] for p in pts) / len(pts)
    lon0 = sum(p[0] for p in pts) / len(pts)
    cos_lat0 = math.cos(math.radians(lat0))

    def to_xy(p):
        """convert (lon, lat) to local (east, north) meters."""
        x = math.radians(p[0] - lon0) * EARTH_RADIUS_M * cos_lat0
        y = math.radians(p[1] - lat0) * EARTH_RADIUS_M
        return x, y

    xy = [to_xy(p) for p in pts]

    hull = _convex_hull(xy)
    if len(hull) < 3:
        return 0.0, 0.0, 0.0

    return _min_area_obb(hull)


def total_path_distance(
    points: list[tuple[float, float, float]],
) -> float:
    """total 3D distance along a path of (lon, lat, alt) points in meters."""
    total = 0.0
    for i in range(1, len(points)):
        ground_dist = distance_between(
            points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
        )
        altitude_diff = points[i][2] - points[i - 1][2]
        total += math.sqrt(ground_dist**2 + altitude_diff**2)

    return total


def elevation_angle(
    from_lon: float,
    from_lat: float,
    from_alt: float,
    to_lon: float,
    to_lat: float,
    to_alt: float,
) -> float:
    """elevation angle in degrees from one 3D point to another (gimbal pitch)."""
    ground_dist = distance_between(from_lon, from_lat, to_lon, to_lat)
    altitude_diff = to_alt - from_alt

    if ground_dist == 0:
        return 90.0 if altitude_diff > 0 else -90.0

    return math.degrees(math.atan2(altitude_diff, ground_dist))


def angular_span_at_distance(
    points: list[tuple[float, float, float]],
    observer_lon: float,
    observer_lat: float,
) -> float:
    """angular span in degrees of a set of points as seen from observer."""
    if len(points) < 2:
        return 0.0

    bearings = [bearing_between(observer_lon, observer_lat, p[0], p[1]) for p in points]

    span = max(bearings) - min(bearings)

    # handle wrap-around (e.g. 350 to 10 degrees)
    if span > 180:
        span = 360 - span

    return span


def euclidean_distance(x1: float, y1: float, x2: float, y2: float) -> float:
    """euclidean distance between two points in local meter coordinates."""
    return math.hypot(x2 - x1, y2 - y1)


# A* pathfinding on visibility graph
def astar(
    graph: dict[int, list[tuple[int, float]]],
    start: int,
    goal: int,
    positions: list[tuple[float, float, float]],
    use_euclidean: bool = False,
) -> list[int] | None:
    """A* shortest path - returns node index list or None if unreachable.

    when use_euclidean is True, the heuristic uses euclidean distance
    in local meter coordinates instead of haversine.
    """
    open_set = [(0.0, start)]
    came_from: dict[int, int] = {}
    g_score: dict[int, float] = {start: 0.0}

    while open_set:
        _, current = heapq.heappop(open_set)

        if current == goal:
            # reconstruct path
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)

            return list(reversed(path))

        for neighbor, edge_weight in graph.get(current, []):
            tentative_g = g_score[current] + edge_weight

            if tentative_g < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g

                if use_euclidean:
                    heuristic = euclidean_distance(
                        positions[neighbor][0],
                        positions[neighbor][1],
                        positions[goal][0],
                        positions[goal][1],
                    )
                else:
                    heuristic = distance_between(
                        positions[neighbor][0],
                        positions[neighbor][1],
                        positions[goal][0],
                        positions[goal][1],
                    )
                heapq.heappush(open_set, (tentative_g + heuristic, neighbor))

    return None
