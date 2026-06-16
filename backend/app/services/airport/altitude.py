"""shared altitude normalization + per-airport renormalize protocol.

every elevation-provider construction in this package funnels through here so
the obstacle / AGL / LHA / mission-coordinate / waypoint resample paths share
one seam. bulk-generate keeps its own provider (loop reuse) in ``lha``.
"""

import logging
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.enums import MissionStatus
from app.core.exceptions import NotFoundError
from app.core.geometry import wkt_to_geojson
from app.models.agl import AGL, LHA
from app.models.airport import AirfieldSurface, Airport, Obstacle
from app.models.mission import Mission
from app.schemas.geometry import PolygonZ
from app.services.elevation_provider import (
    create_elevation_provider,
    resolve_elevation_with_source,
)

logger = logging.getLogger(__name__)


def _position_unchanged(
    submitted: list[float] | None,
    stored: list[float] | None,
    *,
    dp: int = 7,
) -> bool:
    """true when submitted (lon, lat) matches stored at ``dp`` decimal places.

    7 dp is ~1 cm on wgs84 - tight enough that any real coordinator edit trips
    re-resolve, identity round-trips short-circuit. both inputs ``None`` is
    treated as unchanged so a payload that omits position cannot accidentally
    trigger a provider build.
    """
    if submitted is None and stored is None:
        return True
    if submitted is None or stored is None:
        return False
    if len(submitted) < 2 or len(stored) < 2:
        return False
    return round(submitted[0], dp) == round(stored[0], dp) and round(submitted[1], dp) == round(
        stored[1], dp
    )


def _stored_point_coords(point_wkt: str | None) -> list[float] | None:
    """return [lon, lat, alt] from a stored POINT Z wkt, or None on missing/parse fail."""
    if not point_wkt:
        return None
    try:
        geojson = wkt_to_geojson(point_wkt)
        coords = geojson.get("coordinates") if geojson else None
        return list(coords) if coords else None
    except Exception:
        return None


def _ring_diff(
    submitted_ring: list[list[float]] | None,
    stored_ring: list[list[float]] | None,
) -> list[int] | None:
    """return indices of vertices that moved between submitted_ring and stored_ring.

    ``None`` means the rings are not directly comparable (length mismatch or a
    missing stored ring) - the caller should fall back to a full ring resample.
    an empty list means every vertex matches at 7 dp - the caller can skip the
    provider entirely.
    """
    if not submitted_ring or not stored_ring:
        return None
    if len(submitted_ring) != len(stored_ring):
        return None
    return [
        i
        for i, (s, t) in enumerate(zip(submitted_ring, stored_ring))
        if not _position_unchanged(s, t)
    ]


def _normalize_position_altitude(
    position_coords: list[float],
    airport: Airport,
    db: Session | None = None,
    *,
    allow_api: bool = False,
) -> None:
    """set position Z to ground elevation so objects sit at ground level.

    builds a fresh elevation provider per call - that is fine for single-entity
    write paths (create/update LHA, AGL, obstacle) where one position is
    sampled at a time. the remote-lookup cache lives on the provider instance,
    so it amortizes only within a single call. bulk loops should construct one
    provider and call ``provider.get_elevation`` directly (this is what
    :func:`renormalize_airport_altitudes` does). ``allow_api`` opts the call
    into the configured remote backend when terrain is FLAT and the master
    toggle is on; default False keeps every non-LHA entity on DEM-or-flat.
    """
    if len(position_coords) < 3:
        return
    provider = create_elevation_provider(airport, allow_api=allow_api, db=db)
    try:
        ground = provider.get_elevation(position_coords[1], position_coords[0])
        position_coords[2] = ground
    finally:
        if hasattr(provider, "close"):
            provider.close()


def get_elevation_at_point(
    db: Session, airport_id: UUID, lat: float, lon: float, *, allow_api: bool = False
) -> tuple[float, str]:
    """return ground elevation at (lat, lon) with the resolved source label.

    ``allow_api`` opts the lookup into the configured remote backend, used only
    by LHA-placement call sites that need per-point ground resolution against
    real terrain. default keeps every other resolver (mission-coordinate drag,
    waypoint AGL backfill) on DEM-or-flat.
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    # the column is `nullable=False` with a default of "FLAT", but defensive
    # defaults handle test mocks where the attribute may be missing or None.
    terrain_source = getattr(airport, "terrain_source", None) or "FLAT"
    provider = create_elevation_provider(airport, allow_api=allow_api, db=db)
    try:
        return resolve_elevation_with_source(provider, terrain_source, lat, lon)
    finally:
        if hasattr(provider, "close"):
            provider.close()


def renormalize_airport_altitudes(db: Session, airport_id: UUID) -> dict[str, list[UUID]]:
    """re-normalize all position.z values for obstacles, agls, lhas, mission
    takeoff/landing coords, and per-waypoint rendering agl at airport.

    returns a dict of skipped entity ids per type so callers can surface partial
    failures - per-item errors are logged and the loop continues so one bad
    geometry does not block the rest of the airport.
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    skipped: dict[str, list[UUID]] = {
        "obstacles": [],
        "agls": [],
        "lhas": [],
        "missions": [],
        "waypoints": [],
    }

    # two providers: a bare DEM/flat one for obstacles / AGLs / missions /
    # waypoints (allow_api=False) so the renormalize sweep does not fan out
    # remote-elevation calls per entity, and a separate allow_api=True provider
    # used only for the LHA loop where per-point ground resolution defines
    # downstream PAPI geometry. the LHA loop loses cache warmth from the
    # obstacle/AGL pass because they run on separate providers; LHA counts are
    # small (~12 per airport) so the cost is acceptable.
    bare_provider = create_elevation_provider(airport, allow_api=False, db=db)
    lha_provider = create_elevation_provider(airport, allow_api=True, db=db)
    try:
        obstacles = db.query(Obstacle).filter(Obstacle.airport_id == airport_id).all()

        agls = (
            db.query(AGL)
            .join(AirfieldSurface, AGL.surface_id == AirfieldSurface.id)
            .filter(AirfieldSurface.airport_id == airport_id)
            .all()
        )

        lhas = (
            db.query(LHA)
            .join(AGL, LHA.agl_id == AGL.id)
            .join(AirfieldSurface, AGL.surface_id == AirfieldSurface.id)
            .filter(AirfieldSurface.airport_id == airport_id)
            .all()
        )

        # renormalize obstacle boundary z-coordinates (outer ring only)
        for obs in obstacles:
            try:
                geojson = wkt_to_geojson(obs.boundary)
                ring = geojson.get("coordinates", [[]])[0] if geojson else []
                if not ring:
                    continue
                parts = []
                for c in ring:
                    lon, lat = c[0], c[1]
                    ground = bare_provider.get_elevation(lat, lon)
                    parts.append(f"{lon} {lat} {ground}")
                wkt_ring = ", ".join(parts)
                obs.boundary = f"POLYGON Z (({wkt_ring}))"
            except Exception as e:
                logger.warning("skipping renormalization for Obstacle %s: %s", obs.id, e)
                skipped["obstacles"].append(obs.id)
                continue

        # renormalize AGL position.z (bare provider - no remote lookup)
        for entity in agls:
            try:
                geojson = wkt_to_geojson(entity.position)
                coords = geojson.get("coordinates", []) if geojson else []
                if len(coords) < 3:
                    continue
                lon, lat = coords[0], coords[1]
                ground = bare_provider.get_elevation(lat, lon)
                entity.position = f"POINT Z ({lon} {lat} {ground})"
            except Exception as e:
                logger.warning("skipping renormalization for AGL %s: %s", entity.id, e)
                skipped["agls"].append(entity.id)
                continue

        # renormalize LHA position.z (allow_api=True - LHA placement is the one
        # call site that opts into the configured remote backend)
        for lha in lhas:
            try:
                geojson = wkt_to_geojson(lha.position)
                coords = geojson.get("coordinates", []) if geojson else []
                if len(coords) < 3:
                    continue
                lon, lat = coords[0], coords[1]
                ground = lha_provider.get_elevation(lat, lon)
                lha.position = f"POINT Z ({lon} {lat} {ground})"
            except Exception as e:
                logger.warning("skipping renormalization for LHA %s: %s", lha.id, e)
                skipped["lhas"].append(lha.id)
                continue

        # renormalize mission.takeoff_coordinate / landing_coordinate per-point.
        # both columns are in TRAJECTORY_FIELDS, so a real alt shift on a
        # non-DRAFT mission must invalidate the trajectory - otherwise the
        # persisted flight plan would silently disagree with the new geometry
        # (the plan was computed against the old alt). a no-op rewrite (alt
        # already matches the resampled ground) does not invalidate. terminal
        # missions are skipped entirely because invalidate_trajectory() refuses
        # to modify COMPLETED / CANCELLED rows. MEASURED missions are skipped the
        # same way: the footage was already scored against the planned LHA ground
        # truth, so rewriting the coords would orphan the measurement (the
        # invalidate_trajectory() MEASURED lock would raise before the regression
        # branch is ever reached). the skip is recorded in skipped["missions"] so
        # the carve-out is observable to the caller, not silent.
        missions = db.query(Mission).filter(Mission.airport_id == airport_id).all()
        for mission in missions:
            if mission.status in Mission.TERMINAL_STATUSES:
                continue
            if mission.status == MissionStatus.MEASURED:
                skipped["missions"].append(mission.id)
                continue
            try:
                changed = False
                for attr in ("takeoff_coordinate", "landing_coordinate"):
                    wkt = getattr(mission, attr, None)
                    if not wkt:
                        continue
                    geojson = wkt_to_geojson(wkt)
                    coords = geojson.get("coordinates", []) if geojson else []
                    if len(coords) < 2:
                        continue
                    lon, lat = coords[0], coords[1]
                    existing_alt = coords[2] if len(coords) >= 3 else None
                    ground = bare_provider.get_elevation(lat, lon)
                    if existing_alt == ground:
                        continue
                    setattr(mission, attr, f"POINT Z ({lon} {lat} {ground})")
                    changed = True
                if changed and mission.status in Mission.NON_DRAFT_WITH_PLAN_STATUSES:
                    # invalidate_trajectory() regresses to DRAFT, flips
                    # has_unsaved_map_changes, and resets computation status -
                    # the persisted flight plan stays as a stale reference
                    # until the operator triggers a fresh recompute.
                    mission.invalidate_trajectory()
            except Exception as e:
                logger.warning("skipping renormalization for Mission %s: %s", mission.id, e)
                skipped["missions"].append(mission.id)
                continue

        # rendering-only per-waypoint agl refresh. lazy backfill in the read path
        # would also catch this, but doing it here keeps the post-renormalize
        # read free of provider calls. does NOT call invalidate_trajectory -
        # agl is display-only and the takeoff/landing alt branch above already
        # owns the regression semantics for a real terrain shift.
        try:
            _refresh_waypoint_agl_for_airport(db, airport_id, bare_provider, skipped)
        except Exception as e:
            logger.warning(
                "renormalize_airport_altitudes waypoint refresh for %s failed: %s",
                airport_id,
                e,
            )

        db.flush()

        if any(skipped.values()):
            logger.warning(
                "renormalize_airport_altitudes for %s left partial state: %s",
                airport_id,
                {k: len(v) for k, v in skipped.items() if v},
            )

        return skipped
    finally:
        if hasattr(bare_provider, "close"):
            bare_provider.close()
        if hasattr(lha_provider, "close"):
            lha_provider.close()


def _refresh_waypoint_agl_for_airport(
    db: Session,
    airport_id: UUID,
    provider,
    skipped: dict[str, list[UUID]],
) -> None:
    """refresh agl + camera_target_agl on every waypoint of the airport.

    one batched provider call per flight plan covers every waypoint position
    plus every camera_target. delegates the per-waypoint write to flight_plan_service
    so the ground-level waypoint set (takeoff/landing force agl=0) stays in one
    place. errors on a single flight plan are isolated - the loop continues so
    one bad geometry does not block the rest of the airport.
    """
    from app.models.flight_plan import FlightPlan
    from app.services.flight_plan_service import _refresh_persisted_agl

    flight_plans = (
        db.query(FlightPlan)
        .join(Mission, FlightPlan.mission_id == Mission.id)
        .options(joinedload(FlightPlan.waypoints), joinedload(FlightPlan.airport))
        .filter(Mission.airport_id == airport_id)
        .all()
    )
    for fp in flight_plans:
        try:
            _refresh_persisted_agl(list(fp.waypoints), fp.airport, elevation_provider=provider)
        except Exception as e:
            logger.warning("skipping waypoint agl refresh for FlightPlan %s: %s", fp.id, e)
            for wp in fp.waypoints:
                skipped["waypoints"].append(wp.id)
            continue


def _normalize_boundary_altitude(
    boundary: PolygonZ | None,
    airport: Airport,
    *,
    indices: Iterable[int] | None = None,
) -> None:
    """set boundary ring z-coordinates to ground elevation.

    ``indices`` filters which ring vertices are resampled. ``None`` (the default)
    preserves the prior whole-ring behavior used by the create path. an empty
    iterable short-circuits before the provider is built so a no-move update
    pays zero open-elevation cost.
    """
    if not boundary or not boundary.coordinates:
        return
    ring = boundary.coordinates[0]
    if not ring:
        return
    if indices is None:
        targets: list[int] = list(range(len(ring)))
    else:
        targets = [i for i in indices if 0 <= i < len(ring)]
        if not targets:
            return
    provider = create_elevation_provider(airport)
    try:
        for j in targets:
            coord = ring[j]
            if len(coord) >= 3:
                ground = provider.get_elevation(coord[1], coord[0])
                ring[j] = list(coord[:2]) + [ground]
    finally:
        if hasattr(provider, "close"):
            provider.close()


def _renormalize_boundary_with_stored(
    boundary: PolygonZ | None,
    stored_wkt: str | None,
    airport: Airport,
) -> None:
    """resample boundary z only on moved vertices; preserve stored z elsewhere.

    falls back to a full ring renormalize when the stored wkt is unparseable or
    the vertex count changed - the rings cannot be aligned in that case. when
    every vertex matches at 7 dp, copies stored z onto the submitted ring and
    returns without building a provider.
    """
    if not boundary or not boundary.coordinates:
        return
    submitted_ring = boundary.coordinates[0]
    if not submitted_ring:
        return

    stored_ring: list[list[float]] | None = None
    if stored_wkt:
        try:
            geojson = wkt_to_geojson(stored_wkt)
            rings = geojson.get("coordinates", []) if geojson else []
            if rings:
                stored_ring = rings[0]
        except Exception:
            stored_ring = None

    moved = _ring_diff(submitted_ring, stored_ring)
    if moved is None or stored_ring is None:
        _normalize_boundary_altitude(boundary, airport)
        return

    moved_set = set(moved)
    for i, coord in enumerate(submitted_ring):
        if i in moved_set:
            continue
        if i >= len(stored_ring):
            continue
        stored_coord = stored_ring[i]
        if len(coord) >= 3 and len(stored_coord) >= 3:
            submitted_ring[i] = list(coord[:2]) + [stored_coord[2]]

    if not moved:
        return
    _normalize_boundary_altitude(boundary, airport, indices=moved)
