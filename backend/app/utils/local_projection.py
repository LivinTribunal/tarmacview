"""equirectangular projection + WGS84-to-Shapely conversion utilities."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

from shapely.geometry import LineString, Point, Polygon

from app.core.constants import EARTH_RADIUS_M
from app.core.geometry import wkt_to_geojson

if TYPE_CHECKING:
    from app.models.airport import AirfieldSurface, Obstacle, SafetyZone

logger = logging.getLogger(__name__)

# fallback runway width in meters when a surface row carries no width
DEFAULT_RUNWAY_WIDTH_M: float = 45.0

# re-exported so consumers using `app.utils.local_projection.EARTH_RADIUS_M` keep working.
__all__ = [
    "EARTH_RADIUS_M",
    "LocalBoundary",
    "LocalGeometries",
    "LocalObstacle",
    "LocalProjection",
    "LocalSurface",
    "LocalZone",
    "build_local_geometries",
    "obstacle_base_altitude_from_wkt",
    "wkt_to_local_linestring",
    "wkt_to_local_polygon",
]


class LocalProjection:
    """equirectangular projection centered on airport reference point."""

    def __init__(self, ref_lon: float, ref_lat: float):
        """initialize projection centered on (ref_lon, ref_lat)."""
        self.ref_lon = ref_lon
        self.ref_lat = ref_lat
        self._cos_ref_lat = math.cos(math.radians(ref_lat))

    def to_local(self, lon: float, lat: float) -> tuple[float, float]:
        """convert WGS84 (lon, lat) to local meter coordinates (x, y)."""
        x = math.radians(lon - self.ref_lon) * EARTH_RADIUS_M * self._cos_ref_lat
        y = math.radians(lat - self.ref_lat) * EARTH_RADIUS_M
        return x, y

    def to_wgs84(self, x: float, y: float) -> tuple[float, float]:
        """convert local meter coordinates (x, y) back to WGS84 (lon, lat)."""
        lon = self.ref_lon + math.degrees(x / (EARTH_RADIUS_M * self._cos_ref_lat))
        lat = self.ref_lat + math.degrees(y / EARTH_RADIUS_M)
        return lon, lat

    def point_to_local(self, lon: float, lat: float) -> Point:
        """convert WGS84 to Shapely Point in local coordinates."""
        x, y = self.to_local(lon, lat)
        return Point(x, y)

    def line_to_local(self, lon1: float, lat1: float, lon2: float, lat2: float) -> LineString:
        """convert WGS84 segment to Shapely LineString in local coordinates."""
        return LineString([self.to_local(lon1, lat1), self.to_local(lon2, lat2)])


# local-coordinate geometry containers for Shapely-based pathfinding


@dataclass
class LocalObstacle:
    """obstacle polygon in local meter coordinates."""

    polygon: Polygon
    name: str
    height: float
    base_alt: float
    buffer_distance: float


@dataclass
class LocalZone:
    """safety zone polygon in local meter coordinates."""

    polygon: Polygon
    zone_type: str
    name: str
    altitude_floor: float | None
    altitude_ceiling: float | None


@dataclass
class LocalBoundary:
    """airport boundary polygon in local meter coordinates."""

    polygon: Polygon
    name: str


@dataclass
class LocalSurface:
    """runway/taxiway buffered centerline in local meter coordinates.

    polygon is the centerline buffered by half_width + buffer_distance so every
    downstream consumer (visibility-graph crossing penalty, perpendicular-crossing
    node spacing, future surface checks) sees the same no-go region. buffer_distance
    is retained so callers that need the width/2 + buffer offset (e.g. perpendicular
    candidate-node placement) don't have to back it out of the polygon.
    """

    polygon: Polygon
    centerline: LineString
    identifier: str
    surface_type: str
    width: float
    length: float
    heading: float | None
    buffer_distance: float = 0.0


@dataclass
class LocalGeometries:
    """all spatial geometry in local meter coordinates for pathfinding."""

    proj: LocalProjection
    obstacles: list[LocalObstacle]
    zones: list[LocalZone]
    boundary_zones: list[LocalBoundary]
    surfaces: list[LocalSurface]


def wkt_to_local_polygon(proj: LocalProjection, wkt: str | None) -> Polygon | None:
    """convert WKT polygon string to Shapely Polygon in local coordinates."""
    if not wkt:
        return None
    try:
        geojson = wkt_to_geojson(wkt)
    except (ValueError, KeyError, TypeError, IndexError):
        return None

    if not geojson or geojson.get("type") != "Polygon":
        return None

    coords = geojson.get("coordinates")
    if not coords or not coords[0]:
        return None

    exterior = [proj.to_local(c[0], c[1]) for c in coords[0]]

    holes = []
    for ring in coords[1:]:
        holes.append([proj.to_local(c[0], c[1]) for c in ring])

    try:
        poly = Polygon(exterior, holes)
        if poly.is_empty or not poly.is_valid:
            return None
        return poly
    except Exception as exc:
        logger.warning("failed to build local polygon: %s", exc)
        return None


def wkt_to_local_linestring(proj: LocalProjection, wkt: str | None) -> LineString | None:
    """convert WKT linestring string to Shapely LineString in local coordinates."""
    if not wkt:
        return None
    try:
        geojson = wkt_to_geojson(wkt)
    except (ValueError, KeyError, TypeError, IndexError):
        return None

    if not geojson or geojson.get("type") != "LineString":
        return None

    coords = geojson.get("coordinates")
    if not coords or len(coords) < 2:
        return None

    local_coords = [proj.to_local(c[0], c[1]) for c in coords]
    try:
        ls = LineString(local_coords)
        if ls.is_empty:
            return None
        return ls
    except Exception as exc:
        logger.warning("failed to build local linestring: %s", exc)
        return None


def obstacle_base_altitude_from_wkt(wkt: str | None) -> float:
    """extract base altitude as the highest boundary corner z-coordinate.

    safety validator builds the obstacle band as ``[base_alt, base_alt + height]``.
    on a slope, using ``min(z)`` under-reports the high-side roof and a drone can
    pass below the real top while clearing the modeled band. ``max(z)`` is the
    conservative choice: the whole footprint is treated as resting on its
    highest corner, so ``base_alt + height`` always covers the true roof. flat
    boundaries (all corners equal) are unaffected.
    """
    try:
        geojson = wkt_to_geojson(wkt)
        if not geojson:
            return 0.0
        coords = geojson.get("coordinates", [[]])[0]
        if coords:
            alts = [c[2] for c in coords if len(c) > 2]
            return max(alts) if alts else 0.0
    except Exception:
        pass
    return 0.0


def _build_local_obstacles(proj: LocalProjection, obstacles: list[Obstacle]) -> list[LocalObstacle]:
    """map ORM obstacles to LocalObstacle, skipping rows with unparseable geometry."""
    local_obstacles = []
    for obs in obstacles:
        if not obs.boundary:
            continue
        poly = wkt_to_local_polygon(proj, obs.boundary)
        if poly is None:
            logger.error("obstacle %s skipped - geometry could not be parsed", obs.name)
            continue
        base_alt = obstacle_base_altitude_from_wkt(obs.boundary)
        local_obstacles.append(
            LocalObstacle(
                polygon=poly,
                name=obs.name or "",
                height=obs.height or 0.0,
                base_alt=base_alt,
                buffer_distance=obs.buffer_distance or 0.0,
            )
        )
    return local_obstacles


def _build_local_zones(
    proj: LocalProjection, zones: list[SafetyZone]
) -> tuple[list[LocalZone], list[LocalBoundary]]:
    """split ORM safety zones into LocalZone and LocalBoundary (AIRPORT_BOUNDARY) lists."""
    from app.core.enums import SafetyZoneType

    local_zones = []
    local_boundaries = []
    for zone in zones:
        if not zone.geometry:
            continue
        poly = wkt_to_local_polygon(proj, zone.geometry)
        if poly is None:
            logger.error("safety zone %s skipped - geometry could not be parsed", zone.name)
            continue

        if zone.type == SafetyZoneType.AIRPORT_BOUNDARY.value:
            local_boundaries.append(
                LocalBoundary(
                    polygon=poly,
                    name=zone.name or "",
                )
            )
        else:
            local_zones.append(
                LocalZone(
                    polygon=poly,
                    zone_type=zone.type,
                    name=zone.name or "",
                    altitude_floor=zone.altitude_floor,
                    altitude_ceiling=zone.altitude_ceiling,
                )
            )
    return local_zones, local_boundaries


def _dedupe_paired_surfaces(surfaces: list[AirfieldSurface]) -> list:
    """fold paired runway rows into one - falls back to the raw list when ids are absent.

    each physical runway is two AirfieldSurface rows (one per designator end,
    e.g. 04 and 22) with a geometrically identical buffered polygon. processing
    both sides double-counts the crossing-length penalty in
    `_build_visibility_graph` and emits duplicate crossing-pair nodes in
    `_runway_crossing_node_pairs`, so keep only the first row of each pair.
    surfaces without an id (test fixtures) pass through unchanged.
    """
    seen_surface_ids: set = set()
    deduped_surfaces: list = []
    for s in surfaces:
        sid = getattr(s, "id", None)
        if sid is not None and sid in seen_surface_ids:
            continue
        if sid is not None:
            seen_surface_ids.add(sid)
            partner_id = getattr(s, "paired_surface_id", None)
            if partner_id:
                seen_surface_ids.add(partner_id)
        deduped_surfaces.append(s)
    return deduped_surfaces


def _build_local_surfaces(
    proj: LocalProjection, deduped_surfaces: list, surfaces_by_id: dict
) -> list[LocalSurface]:
    """map deduped surfaces to LocalSurface, bundling paired designators (e.g. "04/22")."""
    local_surfaces = []
    for surface in deduped_surfaces:
        if not surface.geometry:
            continue
        ls = wkt_to_local_linestring(proj, surface.geometry)
        if ls is None:
            logger.error("surface %s skipped - geometry could not be parsed", surface.name)
            continue
        half_width = (surface.width or DEFAULT_RUNWAY_WIDTH_M) / 2.0
        buffer_distance = surface.buffer_distance or 0.0
        runway_poly = ls.buffer(half_width + buffer_distance, cap_style="flat")

        own = surface.identifier or ""
        partner_id = getattr(surface, "paired_surface_id", None)
        partner = surfaces_by_id.get(partner_id) if partner_id else None
        partner_ident = getattr(partner, "identifier", None) if partner else None
        if partner_ident and partner_ident != own:
            display_identifier = "/".join(sorted([own, partner_ident]))
        else:
            display_identifier = own

        local_surfaces.append(
            LocalSurface(
                polygon=runway_poly,
                centerline=ls,
                identifier=display_identifier,
                surface_type=surface.surface_type or "",
                width=surface.width or DEFAULT_RUNWAY_WIDTH_M,
                length=surface.length or ls.length,
                heading=surface.heading,
                buffer_distance=buffer_distance,
            )
        )
    return local_surfaces


def build_local_geometries(
    proj: LocalProjection,
    obstacles: list[Obstacle],
    zones: list[SafetyZone],
    surfaces: list[AirfieldSurface],
) -> LocalGeometries:
    """build LocalGeometries from ORM objects and a projection."""
    local_obstacles = _build_local_obstacles(proj, obstacles)
    local_zones, local_boundaries = _build_local_zones(proj, zones)

    surfaces_by_id = {s.id: s for s in surfaces if getattr(s, "id", None) is not None}
    deduped_surfaces = _dedupe_paired_surfaces(surfaces)
    local_surfaces = _build_local_surfaces(proj, deduped_surfaces, surfaces_by_id)

    return LocalGeometries(
        proj=proj,
        obstacles=local_obstacles,
        zones=local_zones,
        boundary_zones=local_boundaries,
        surfaces=local_surfaces,
    )
