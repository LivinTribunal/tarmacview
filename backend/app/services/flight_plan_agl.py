"""per-waypoint agl enrichment: ground sampling, backfill, and persist-time compute.

extracted from flight_plan_service.py. these helpers own the single batched
elevation lookup that turns persisted MSL altitudes into rendering-only AGL.
imports stay below the orchestrator/schema layer (core/models/elevation_provider
only) so flight_plan_service can re-import without an import cycle.
"""

import logging

from sqlalchemy.orm import Session

from app.core.enums import WaypointType
from app.core.geometry import wkt_to_geojson
from app.models.flight_plan import FlightPlan, Waypoint
from app.services.elevation_provider import create_elevation_provider
from app.services.trajectory.types import WaypointData

logger = logging.getLogger(__name__)

# waypoint types excluded from the displayed flight envelope.
# takeoff/landing sit on the ground and would skew global min/max toward the airport
# elevation; everything else (MEASUREMENT, TRANSIT, HOVER) is in-flight. opt-out
# keeps hover-point-lock / meht-check / video bookend HOVERs in the envelope.
_GROUND_LEVEL_WAYPOINT_TYPES = {
    WaypointType.TAKEOFF.value,
    WaypointType.LANDING.value,
}


def _extract_altitude(geom: str | None) -> float:
    """extract z-coordinate (altitude MSL) from a WKT geometry column."""
    if not geom:
        return 0.0
    geojson = wkt_to_geojson(geom)
    coords = geojson.get("coordinates", [0, 0, 0]) if geojson else [0, 0, 0]
    return coords[2] if len(coords) > 2 else 0.0


def _extract_coords(geom: str | None) -> tuple[float, float, float]:
    """extract (lon, lat, alt) from a WKT geometry column."""
    if not geom:
        return (0.0, 0.0, 0.0)
    geojson = wkt_to_geojson(geom)
    coords = geojson.get("coordinates", [0, 0, 0]) if geojson else [0, 0, 0]
    return (coords[0], coords[1], coords[2] if len(coords) > 2 else 0.0)


def _compute_waypoint_agl_values(
    waypoints: list[Waypoint],
    airport,
    elevation_fallback: float,
    *,
    elevation_provider=None,
) -> tuple[list[float], dict[int, float]]:
    """sample ground for every waypoint and camera_target in one batched call.

    returns (wp_grounds, ct_grounds) where wp_grounds is parallel to waypoints
    and ct_grounds maps the waypoint index to its camera_target ground sample.
    on provider failure every entry falls back to elevation_fallback - the
    response still renders, just without per-point terrain accuracy.
    """
    if not waypoints:
        return [], {}

    wp_points: list[tuple[float, float]] = []
    ct_indices: list[int] = []
    ct_points: list[tuple[float, float]] = []
    for idx, wp in enumerate(waypoints):
        lon, lat, _ = _extract_coords(wp.position)
        wp_points.append((lat, lon))
        if wp.camera_target:
            ct_lon, ct_lat, _ = _extract_coords(wp.camera_target)
            ct_indices.append(idx)
            ct_points.append((ct_lat, ct_lon))

    wp_boundary = len(wp_points)
    all_points = wp_points + ct_points

    wp_grounds = [elevation_fallback] * len(waypoints)
    ct_grounds: dict[int, float] = {i: elevation_fallback for i in ct_indices}

    provider = elevation_provider
    owns_provider = False
    try:
        if provider is None:
            provider = create_elevation_provider(airport, allow_api=False)
            owns_provider = True
        sampled = provider.get_elevations_batch(all_points)
        sampled_wp = sampled[:wp_boundary]
        sampled_ct = sampled[wp_boundary:]
        wp_grounds = [float(v) for v in sampled_wp]
        for i, value in zip(ct_indices, sampled_ct):
            ct_grounds[i] = float(value)
    except Exception as e:
        logger.warning("elevation provider failed: %s; falling back to airport elevation", e)
    finally:
        if owns_provider and provider is not None and hasattr(provider, "close"):
            provider.close()

    return wp_grounds, ct_grounds


def _agl_from_ground(wp: Waypoint, ground: float) -> float:
    """rendering-only agl: 0 for takeoff/landing, clamped wp.alt - ground otherwise."""
    if wp.waypoint_type in _GROUND_LEVEL_WAYPOINT_TYPES:
        return 0.0
    return max(0.0, _extract_altitude(wp.position) - ground)


def _camera_target_agl_from_ground(wp: Waypoint, ground: float) -> float:
    """rendering-only camera-target agl clamped to zero."""
    return max(0.0, _extract_altitude(wp.camera_target) - ground)


def _backfill_waypoint_agl(
    db: Session,
    flight_plan: FlightPlan,
    elevation: float,
) -> None:
    """one-shot lazy backfill for legacy plans persisted before the agl columns.

    runs only when at least one waypoint row has null agl/camera_target_agl.
    commits inside this read path so subsequent reads do not re-fire the
    provider - deliberate exception to flush-only, mirrors revalidate_flight_plan.
    """
    waypoints = flight_plan.waypoints
    if not waypoints:
        return

    needs_wp = [i for i, wp in enumerate(waypoints) if wp.agl is None]
    needs_ct = [
        i for i, wp in enumerate(waypoints) if wp.camera_target and wp.camera_target_agl is None
    ]
    if not needs_wp and not needs_ct:
        return

    wp_grounds, ct_grounds = _compute_waypoint_agl_values(waypoints, flight_plan.airport, elevation)

    for i in needs_wp:
        waypoints[i].agl = _agl_from_ground(waypoints[i], wp_grounds[i])
    for i in needs_ct:
        ground = ct_grounds.get(i, elevation)
        waypoints[i].camera_target_agl = _camera_target_agl_from_ground(waypoints[i], ground)

    db.flush()
    db.commit()


def _compute_waypoint_data_agl(
    all_waypoints: list[WaypointData],
    airport,
    *,
    elevation_provider=None,
) -> tuple[list[float], list[float | None]]:
    """sample ground for every WaypointData + camera_target in one batched call.

    returns (agls, camera_target_agls) - parallel to all_waypoints. takeoff and
    landing waypoints force agl=0; missing camera_target rows yield None. used
    by persist_flight_plan and the waypoint-update refresh paths so the persist
    site can hand precomputed values into _waypoint_to_model.
    """
    if not all_waypoints:
        return [], []

    elevation_fallback = airport.elevation if airport is not None else 0.0

    wp_points: list[tuple[float, float]] = [(wp.lat, wp.lon) for wp in all_waypoints]
    ct_indices: list[int] = []
    ct_points: list[tuple[float, float]] = []
    for idx, wp in enumerate(all_waypoints):
        if wp.camera_target:
            ct_indices.append(idx)
            ct_points.append((wp.camera_target.lat, wp.camera_target.lon))

    wp_boundary = len(wp_points)
    all_points = wp_points + ct_points

    wp_grounds = [elevation_fallback] * len(all_waypoints)
    ct_grounds: dict[int, float] = {i: elevation_fallback for i in ct_indices}

    provider = elevation_provider
    owns_provider = False
    try:
        if provider is None:
            provider = create_elevation_provider(airport, allow_api=False)
            owns_provider = True
        sampled = provider.get_elevations_batch(all_points)
        wp_grounds = [float(v) for v in sampled[:wp_boundary]]
        for i, value in zip(ct_indices, sampled[wp_boundary:]):
            ct_grounds[i] = float(value)
    except Exception as e:
        logger.warning(
            "elevation provider failed during agl persist: %s; using airport elevation", e
        )
    finally:
        if owns_provider and provider is not None and hasattr(provider, "close"):
            provider.close()

    agls: list[float] = []
    ct_agls: list[float | None] = []
    for idx, wp in enumerate(all_waypoints):
        wtype = wp.waypoint_type
        wtype_value = wtype.value if hasattr(wtype, "value") else wtype
        if wtype_value in _GROUND_LEVEL_WAYPOINT_TYPES:
            agls.append(0.0)
        else:
            agls.append(max(0.0, wp.alt - wp_grounds[idx]))

        if wp.camera_target:
            ct_alt = wp.camera_target.alt
            ct_agls.append(max(0.0, ct_alt - ct_grounds.get(idx, elevation_fallback)))
        else:
            ct_agls.append(None)

    return agls, ct_agls


def _refresh_persisted_agl(
    waypoints: list[Waypoint],
    airport,
    *,
    elevation_provider=None,
) -> None:
    """recompute agl + camera_target_agl on only the moved/new rows.

    one batched provider call covers every waypoint plus every camera_target so
    the per-row write does not multiply elevation lookups. takeoff/landing force
    agl=0 regardless of sampled ground. elevation_provider is reused when the
    caller already has one alive (renormalize loop) so we don't double-open.
    """
    if not waypoints:
        return
    elevation_fallback = airport.elevation if airport is not None else 0.0
    wp_grounds, ct_grounds = _compute_waypoint_agl_values(
        waypoints, airport, elevation_fallback, elevation_provider=elevation_provider
    )
    for i, wp in enumerate(waypoints):
        wp.agl = _agl_from_ground(wp, wp_grounds[i])
        if wp.camera_target:
            ground = ct_grounds.get(i, elevation_fallback)
            wp.camera_target_agl = _camera_target_agl_from_ground(wp, ground)
        else:
            wp.camera_target_agl = None
