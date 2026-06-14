"""phase-5 geometry: pass boundaries, inter-pass core, bookend transits."""

import app.services.trajectory.orchestrator as _orch
from app.core.config import settings
from app.core.enums import CameraAction, WaypointType
from app.core.exceptions import TrajectoryGenerationError
from app.core.geometry import wkt_to_geojson
from app.models.value_objects import Coordinate
from app.utils.geo import bearing_between

from ..pathfinding import compute_inter_pass_transits
from ..types import InspectionPass, Point3D, WaypointData


def _parse_coordinate(wkt: str | None, label: str) -> list[float]:
    """parse and validate a 3D coordinate from a WKT geometry string."""
    try:
        parsed = wkt_to_geojson(wkt)
        if parsed is None:
            raise TrajectoryGenerationError(f"{label} coordinate geometry is empty")
        coords = parsed.get("coordinates")
    except TrajectoryGenerationError:
        raise
    except Exception as e:
        raise TrajectoryGenerationError(f"failed to parse {label} coordinate geometry") from e
    if not coords or len(coords) < 3:
        raise TrajectoryGenerationError(f"{label} coordinate must be a valid 3D point")
    try:
        Coordinate(lat=coords[1], lon=coords[0], alt=coords[2])
    except ValueError as e:
        raise TrajectoryGenerationError(f"invalid {label} coordinate: {e}")

    return coords


def _first_last_mh(
    pass_wps: list[WaypointData],
) -> tuple[WaypointData | None, WaypointData | None]:
    """first and last MEASUREMENT/HOVER waypoints in a pass."""
    mh = [
        wp for wp in pass_wps if wp.waypoint_type in (WaypointType.MEASUREMENT, WaypointType.HOVER)
    ]
    if not mh:
        return None, None
    return mh[0], mh[-1]


def _filter_to_mh(
    pass_wps: list[WaypointData],
) -> tuple[list[WaypointData], dict[int, int]]:
    """filter to MEASUREMENT/HOVER, return (filtered, full_idx -> filtered_idx map)."""
    filtered: list[WaypointData] = []
    idx_map: dict[int, int] = {}
    for orig_idx, wp in enumerate(pass_wps):
        if wp.waypoint_type in (WaypointType.MEASUREMENT, WaypointType.HOVER):
            idx_map[orig_idx] = len(filtered)
            filtered.append(wp)
    return filtered, idx_map


def _pass_boundary(
    pass_wps: list[WaypointData],
) -> tuple[WaypointData | None, WaypointData | None]:
    """boundary waypoints for inter-pass A*: first/last MEASUREMENT/HOVER of the pass.

    every scope binds its inter-pass transits between MH waypoints - the
    MEASUREMENTS_ONLY core is the canonical join geometry and NTL splices
    intra-pass TRANSITs back inside each pass instead of retargeting the join.
    a TRANSIT-only pass cannot bound a measurement core - the empty-pass drop in
    _generate_trajectory_inner removes zero-waypoint passes, so reaching this
    branch with no MEASUREMENT/HOVER means a pass was generated with only TRANSIT
    waypoints and that's a real bug, not something to paper over.
    """
    first, last = _first_last_mh(pass_wps)
    if first is None or last is None:
        raise TrajectoryGenerationError("inspection produced no measurement waypoints")
    return first, last


def _assemble_core(
    inspection_passes: list[InspectionPass],
    scope: str,
    local_geoms,
    default_speed,
    *,
    transit_agl,
    elevation_provider,
    buffer_distance_override,
    require_perpendicular_runway_crossing,
    keep_inside_airport_boundary,
) -> tuple[list[WaypointData], list[int], list[dict[int, int]], list[str]]:
    """assemble inspection passes interleaved with A* inter-pass transits.

    every scope shares one canonical core: each pass is filtered to MEASUREMENT/HOVER
    and adjacent passes are joined by `compute_inter_pass_transits` between MH
    boundaries. for NTL each rendered pass equals the original full pass, so any
    intra-pass TRANSIT (e.g. the vertical-profile descent) sits in its original
    position and the per-pass A* that placed it is preserved.

    returns (core_waypoints, pass_start_indices, measurement_index_maps, soft_warnings).
    measurement_index_maps[i] maps original-pass index -> rendered-pass index for pass i:
    MEASUREMENT/HOVER-only for MEASUREMENTS_ONLY, identity over the full pass otherwise.
    """
    # filter each pass to MH unconditionally - the canonical core
    rendered_mh: list[list[WaypointData]] = []
    mh_idx_maps: list[dict[int, int]] = []
    for ipass in inspection_passes:
        filtered, idx_map = _filter_to_mh(ipass.waypoints)
        rendered_mh.append(filtered)
        mh_idx_maps.append(idx_map)

    # boundary waypoints for inter-pass A* - always MH endpoints
    boundaries: list[tuple[Point3D, Point3D] | None] = []
    for ipass in inspection_passes:
        first, last = _pass_boundary(ipass.waypoints)
        if first is None or last is None:
            boundaries.append(None)
            continue
        boundaries.append(
            (
                Point3D(lon=first.lon, lat=first.lat, alt=first.alt),
                Point3D(lon=last.lon, lat=last.lat, alt=last.alt),
            )
        )

    # single inter-pass A* call site - the unified visibility graph for every scope
    usable = [b for b in boundaries if b is not None]
    unified_transits, transit_warnings = compute_inter_pass_transits(
        usable,
        local_geoms,
        default_speed,
        elevation_provider=elevation_provider,
        transit_agl=transit_agl,
        buffer_distance_override=buffer_distance_override,
        require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        keep_inside_airport_boundary=keep_inside_airport_boundary,
    )
    # spread back into transits aligned with passes via an explicit pairwise walk
    # over `boundaries`. consume one unified_transit per (prev, current) pair where
    # both are non-None - decoupled from any iterator state. the empty-pass drop
    # in `_generate_trajectory_inner` keeps `boundaries` free of None entries, so
    # the count assertion holds.
    transits: list[list[WaypointData] | None] = []
    ut_idx = 0
    for i in range(len(boundaries)):
        if i == 0 or boundaries[i] is None or boundaries[i - 1] is None:
            transits.append(None)
        else:
            transits.append(unified_transits[ut_idx])
            ut_idx += 1
    assert ut_idx == len(unified_transits), (
        "inter-pass transit count mismatch - empty boundaries leaked into _assemble_core"
    )

    # rendered passes per scope - MEASUREMENTS_ONLY keeps the filtered MH list,
    # NTL splices intra-pass TRANSITs back via the original full pass so each
    # rendered pass equals the original full pass byte-for-byte.
    if scope == "MEASUREMENTS_ONLY":
        rendered_passes: list[list[WaypointData]] = rendered_mh
        measurement_index_maps: list[dict[int, int]] = mh_idx_maps
    else:
        rendered_passes = [list(ipass.waypoints) for ipass in inspection_passes]
        # identity map over the full pass so phase-5 violation/obstructed remap
        # works without a scope branch
        measurement_index_maps = [
            {k: k for k in range(len(ipass.waypoints))} for ipass in inspection_passes
        ]

    core: list[WaypointData] = []
    pass_start_indices: list[int] = []
    for i, rendered in enumerate(rendered_passes):
        if i > 0 and transits[i] is not None and rendered:
            core.extend(transits[i])
        pass_start_indices.append(len(core))
        core.extend(rendered)

    return core, pass_start_indices, measurement_index_maps, transit_warnings


def _build_takeoff_transit_bookend(
    mission,
    first_pt: Point3D,
    default_speed,
    transit_agl,
    *,
    elevation_provider,
    local_geoms,
    buffer_distance_override,
    require_perpendicular_runway_crossing,
    keep_inside_airport_boundary,
) -> tuple[list[WaypointData], list[float], float]:
    """transit prefix: above-takeoff at transit_agl + A* to first pass start."""
    tc = _parse_coordinate(mission.takeoff_coordinate, "takeoff")
    takeoff_alt = tc[2]
    if elevation_provider:
        takeoff_alt = elevation_provider.get_elevation(tc[1], tc[0])

    above_takeoff = WaypointData(
        lon=tc[0],
        lat=tc[1],
        alt=takeoff_alt + transit_agl,
        heading=bearing_between(tc[0], tc[1], first_pt.lon, first_pt.lat),
        speed=default_speed,
        waypoint_type=WaypointType.TRANSIT,
        camera_action=CameraAction.NONE,
    )
    from_pt = Point3D(lon=tc[0], lat=tc[1], alt=takeoff_alt + transit_agl)
    # compute_transit_path resolved off the package object so the
    # `monkeypatch.setattr(orchestrator, "compute_transit_path", ...)` seam
    # still reaches this bookend call after the package split.
    transit = _orch.compute_transit_path(
        from_pt,
        first_pt,
        local_geoms,
        default_speed,
        elevation_provider=elevation_provider,
        transit_agl=transit_agl,
        buffer_distance_override=buffer_distance_override,
        require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        keep_inside_airport_boundary=keep_inside_airport_boundary,
    )
    return [above_takeoff, *transit], tc, takeoff_alt


def _build_landing_transit_bookend(
    mission,
    last_pt: Point3D,
    default_speed,
    transit_agl,
    *,
    elevation_provider,
    local_geoms,
    buffer_distance_override,
    require_perpendicular_runway_crossing,
    keep_inside_airport_boundary,
) -> tuple[list[WaypointData], list[float], float]:
    """transit suffix: A* from last pass end to above-landing at transit_agl."""
    lc = _parse_coordinate(mission.landing_coordinate, "landing")
    landing_alt = lc[2]
    if elevation_provider:
        landing_alt = elevation_provider.get_elevation(lc[1], lc[0])

    to_pt = Point3D(lon=lc[0], lat=lc[1], alt=landing_alt + transit_agl)
    # compute_transit_path resolved off the package object - mirrors the takeoff
    # bookend above so the monkeypatch seam reaches both bookend builders.
    transit = _orch.compute_transit_path(
        last_pt,
        to_pt,
        local_geoms,
        default_speed,
        elevation_provider=elevation_provider,
        transit_agl=transit_agl,
        buffer_distance_override=buffer_distance_override,
        require_perpendicular_runway_crossing=require_perpendicular_runway_crossing,
        keep_inside_airport_boundary=keep_inside_airport_boundary,
    )
    return list(transit), lc, landing_alt


def _compute_final_buffer(buffers_used: list[float]) -> float:
    """largest per-pass obstacle buffer used during validation.

    the final-assembled trajectory shares this envelope with every inter-pass
    transit and the bookend transits so the constraint can only tighten, never
    relax, what each pass already cleared. falls back to settings.vertex_buffer_m
    when no per-pass buffer was tracked (e.g., every inspection skipped early).
    """
    return max(buffers_used, default=settings.vertex_buffer_m)
