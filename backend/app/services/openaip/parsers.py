"""openaip response parsers: type mappers, extractors, runway/airspace/obstacle parsers."""

from typing import cast

from app.schemas.geometry import PointZ, PolygonZ
from app.schemas.infrastructure import ObstacleTypeStr, SafetyZoneTypeStr
from app.schemas.openaip import (
    ObstacleSuggestion,
    RunwaySuggestion,
    SafetyZoneSuggestion,
)
from app.utils.geo import bearing_between, distance_between, point_at_distance

from .conversions import _convert_altitude_limit, _convert_length
from .geometry import _compute_runway_geometry, _generate_obstacle_boundary

# openaip airspace class codes - map to our SafetyZoneType enum
# source: openaip docs; the api exposes integer "type" codes.
# we map the common ones we care about; unmapped airspaces are skipped.
_AIRSPACE_TYPE_MAP: dict[int, str] = {
    4: "CTR",
    1: "RESTRICTED",
    2: "PROHIBITED",
    3: "RESTRICTED",  # danger area - treat as restricted for safety
    21: "TEMPORARY_NO_FLY",  # TRA/TSA
    22: "TEMPORARY_NO_FLY",  # TRA/TSA
}

# openaip obstacle type codes - map to our ObstacleType enum.
# unmapped values fall back to OTHER.
_OBSTACLE_TYPE_MAP: dict[int, str] = {
    2: "BUILDING",
    14: "TOWER",
    8: "ANTENNA",  # tower / mast / antenna family collapses to ANTENNA
    15: "ANTENNA",
    17: "VEGETATION",
}


# type mappers
def _map_airspace_type(openaip_type: int | None) -> str | None:
    """map openaip airspace type code to SafetyZone type, or None if unmapped."""
    if openaip_type is None:
        return None

    return _AIRSPACE_TYPE_MAP.get(int(openaip_type))


def _map_obstacle_type(openaip_type: int | None) -> str:
    """map openaip obstacle type code to ObstacleType, default OTHER."""
    if openaip_type is None:
        return "OTHER"

    return _OBSTACLE_TYPE_MAP.get(int(openaip_type), "OTHER")


# response field extractors
def _extract_point(geom: dict | None) -> tuple[float, float] | None:
    """extract (lon, lat) from a geojson Point geometry."""
    if not geom or geom.get("type") != "Point":
        return None

    coords = geom.get("coordinates") or []
    if len(coords) < 2:
        return None

    return float(coords[0]), float(coords[1])


def _extract_elevation(elev: dict | float | int | None) -> float | None:
    """extract an elevation value in meters from an openaip elevation field."""
    if elev is None:
        return None
    if isinstance(elev, (int, float)):
        return float(elev)
    if isinstance(elev, dict):
        return _convert_length(elev.get("value"), elev.get("unit"))

    return None


# runway parsers
def _parse_runway_from_dual_thresholds(
    designator: str,
    run_a: dict,
    run_b: dict,
    width_m: float,
    fallback_elevation: float,
) -> RunwaySuggestion | None:
    """build a runway suggestion from two runway direction (run) entries with threshold coords."""
    pt_a = _extract_point(run_a.get("thresholdLocation"))
    pt_b = _extract_point(run_b.get("thresholdLocation"))
    if pt_a is None or pt_b is None:
        return None

    lon_a, lat_a = pt_a
    lon_b, lat_b = pt_b

    heading = bearing_between(lon_a, lat_a, lon_b, lat_b)
    length = distance_between(lon_a, lat_a, lon_b, lat_b)

    if length < 1.0:
        return None

    geoms = _compute_runway_geometry(
        threshold_lat=lat_a,
        threshold_lon=lon_a,
        heading_deg=heading,
        length_m=length,
        width_m=width_m,
        elevation_m=fallback_elevation,
    )

    return RunwaySuggestion(
        identifier=str(designator),
        heading=heading,
        length=length,
        width=width_m,
        threshold_position=PointZ(
            type="Point",
            coordinates=[lon_a, lat_a, fallback_elevation],
        ),
        end_position=PointZ(
            type="Point",
            coordinates=[lon_b, lat_b, fallback_elevation],
        ),
        geometry=geoms["geometry"],
        boundary=geoms["boundary"],
    )


def _parse_runs(
    rw: dict,
    fallback_elevation: float,
    airport_center: tuple[float, float] | None = None,
) -> list[RunwaySuggestion]:
    """parse openaip runway with a `runs` array - one physical strip, two directions.

    when both runs have threshold locations, builds geometry directly from the two
    thresholds for maximum accuracy. falls back to single-run parsing otherwise.
    """
    runs = rw.get("runs") or []
    if len(runs) < 2:
        return []

    dimensions = rw.get("dimension") or {}
    width = _convert_length(
        (dimensions.get("width") or {}).get("value"),
        (dimensions.get("width") or {}).get("unit"),
    )
    if width is None:
        # try getting width from individual runs
        for run in runs:
            run_dim = run.get("dimension") or {}
            width = _convert_length(
                (run_dim.get("width") or {}).get("value"),
                (run_dim.get("width") or {}).get("unit"),
            )
            if width is not None:
                break
    if width is None:
        width = 45.0

    run_a, run_b = runs[0], runs[1]
    pt_a = _extract_point(run_a.get("thresholdLocation"))
    pt_b = _extract_point(run_b.get("thresholdLocation"))

    results: list[RunwaySuggestion] = []

    if pt_a is not None and pt_b is not None:
        # dual thresholds - build both directions from the exact positions
        des_a = run_a.get("designator") or run_a.get("name") or ""
        des_b = run_b.get("designator") or run_b.get("name") or ""
        designator = f"{des_a}/{des_b}" if des_a and des_b else (des_a or des_b)

        suggestion = _parse_runway_from_dual_thresholds(
            designator, run_a, run_b, width, fallback_elevation
        )
        if suggestion is not None:
            results.append(suggestion)
    else:
        # fall back to single-run parsing for each run that has enough data
        for run in runs:
            parsed = _parse_single_run(
                run, fallback_elevation, airport_center=airport_center, width_override=width
            )
            if parsed is not None:
                results.append(parsed)

    return results


def _parse_single_run(
    run: dict,
    fallback_elevation: float,
    airport_center: tuple[float, float] | None = None,
    width_override: float | None = None,
) -> RunwaySuggestion | None:
    """parse a single runway run/direction entry."""
    designator = run.get("designator") or run.get("name")
    dimensions = run.get("dimension") or {}
    length = _convert_length(
        (dimensions.get("length") or {}).get("value"),
        (dimensions.get("length") or {}).get("unit"),
    )
    width = width_override
    if width is None:
        width = _convert_length(
            (dimensions.get("width") or {}).get("value"),
            (dimensions.get("width") or {}).get("unit"),
        )

    heading_field = run.get("trueHeading")
    if heading_field is None:
        heading_field = run.get("heading")

    if not designator or length is None or width is None or heading_field is None:
        return None

    heading = float(heading_field)
    threshold = _extract_point(run.get("thresholdLocation") or run.get("location"))
    if threshold is None:
        if airport_center is None:
            return None
        center_lon, center_lat = airport_center
        back_bearing = (heading + 180.0) % 360.0
        threshold = point_at_distance(center_lon, center_lat, back_bearing, float(length) / 2.0)

    threshold_lon, threshold_lat = threshold

    geoms = _compute_runway_geometry(
        threshold_lat=threshold_lat,
        threshold_lon=threshold_lon,
        heading_deg=heading,
        length_m=float(length),
        width_m=float(width),
        elevation_m=fallback_elevation,
    )

    return RunwaySuggestion(
        identifier=str(designator),
        heading=heading,
        length=float(length),
        width=float(width),
        threshold_position=PointZ(
            type="Point",
            coordinates=[threshold_lon, threshold_lat, fallback_elevation],
        ),
        end_position=geoms["end_position"],
        geometry=geoms["geometry"],
        boundary=geoms["boundary"],
    )


def _parse_runway(
    rw: dict,
    fallback_elevation: float,
    airport_center: tuple[float, float] | None = None,
) -> list[RunwaySuggestion]:
    """parse an openaip runway object into suggestions.

    openaip runways may contain a `runs` array with per-direction data including
    threshold locations. when both thresholds are available, geometry is built
    directly from them for maximum accuracy. otherwise falls back to projection.
    returns a list (possibly empty) of suggestions.
    """
    runs_results = _parse_runs(rw, fallback_elevation, airport_center=airport_center)
    if runs_results:
        return runs_results

    # legacy single-runway format
    result = _parse_single_run(rw, fallback_elevation, airport_center=airport_center)
    if result is not None:
        return [result]

    return []


# polygon + zone/obstacle parsers
def _parse_polygon_geometry(geom: dict | None, default_z: float = 0.0) -> PolygonZ | None:
    """parse an openaip polygon geometry (2d or 3d) into a PolygonZ with Z coordinates."""
    if not geom or geom.get("type") != "Polygon":
        return None

    rings = geom.get("coordinates") or []
    if not rings:
        return None

    out_rings: list[list[list[float]]] = []
    for ring in rings:
        # geojson/wkt linear rings need >=4 positions (3 unique + closing repeat)
        if len(ring) < 4:
            return None

        new_ring: list[list[float]] = []
        for c in ring:
            if len(c) < 2:
                return None
            lon = float(c[0])
            lat = float(c[1])
            z = float(c[2]) if len(c) >= 3 else default_z
            new_ring.append([lon, lat, z])

        # ensure ring is closed
        if new_ring[0] != new_ring[-1]:
            new_ring.append(list(new_ring[0]))

        out_rings.append(new_ring)

    return PolygonZ(type="Polygon", coordinates=out_rings)


def _parse_airspace(item: dict) -> SafetyZoneSuggestion | None:
    """parse an openaip airspace into a SafetyZoneSuggestion, or None if unmapped."""
    mapped = _map_airspace_type(item.get("type"))
    if mapped is None:
        return None

    polygon = _parse_polygon_geometry(item.get("geometry"))
    if polygon is None:
        return None

    name = item.get("name") or "Airspace"
    floor = _convert_altitude_limit(item.get("lowerLimit"))
    ceiling = _convert_altitude_limit(item.get("upperLimit"))

    return SafetyZoneSuggestion(
        name=str(name),
        type=cast(SafetyZoneTypeStr, mapped),
        geometry=polygon,
        altitude_floor=floor,
        altitude_ceiling=ceiling,
    )


def _parse_obstacle(item: dict, fallback_elevation: float) -> ObstacleSuggestion | None:
    """parse an openaip obstacle into a suggestion, or None if incomplete."""
    point = _extract_point(item.get("geometry"))
    if point is None:
        return None

    lon, lat = point
    elevation = _extract_elevation(item.get("elevation")) or fallback_elevation
    height_field = item.get("height") or {}
    height = _convert_length(height_field.get("value"), height_field.get("unit"))
    if height is None:
        height = 0.0

    mapped = _map_obstacle_type(item.get("type"))
    name = item.get("name") or f"Obstacle ({mapped.lower()})"

    return ObstacleSuggestion(
        name=str(name),
        type=cast(ObstacleTypeStr, mapped),
        height=float(height),
        boundary=_generate_obstacle_boundary(lat, lon, elevation),
    )
