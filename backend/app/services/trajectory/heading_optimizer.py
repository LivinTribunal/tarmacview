"""auto-heading optimizer for mission inspections.

picks direction (NATURAL or REVERSED) per inspection to minimize total transit
distance (and, as tie-breaker, total heading change) across the mission's
inspection set.

candidate set per inspection is binary: natural or reversed. the caller decides
which inspections participate by passing a set of "auto" inspection ids; pinned
inspections stay fixed at their current direction. with k auto inspections and
k <= 10, we evaluate at most 2^k = 1024 assignments in sequence order.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from app.core.constants import COST_COMPARISON_EPSILON, DEFAULT_GLIDE_SLOPE_DEG
from app.core.enums import InspectionMethod
from app.core.exceptions import DomainError
from app.models.airport import AirfieldSurface
from app.models.inspection import Inspection
from app.utils.geo import bearing_between, distance_between, linestring_length, point_at_distance

from .config_resolver import resolve_with_defaults
from .helpers import (
    determine_end_position,
    determine_start_position,
    get_lha_positions,
    get_lha_positions_from_surfaces,
    get_ordered_lha_positions,
    get_runway_heading,
    resolve_scan_surface,
)
from .methods.surface_scan import _resolve_axis, _resolve_length_interval
from .types import Point3D

# solver safety cap - brute force is fine for k <= MAX_AUTO_INSPECTIONS (2^10 = 1024)
MAX_AUTO_INSPECTIONS: int = 10

# heading-change term is a gentle tie-breaker, not a primary cost. total transit
# distance wins, and this nudges the solver toward smoother trajectories when
# distances tie.
TURN_PENALTY_WEIGHT: float = 0.5


@dataclass
class _Segment:
    """per-inspection geometry for the solver.

    direction_flips_geometry=False means this method's endpoints and scan
    heading are unchanged by direction (hover_point_lock, meht_check,
    vertical_profile). such segments are fixed - the solver treats them as
    pinned regardless of is_auto.
    """

    inspection_id: UUID
    sequence_order: int
    entry: Point3D
    exit: Point3D
    scan_heading: float
    scan_distance: float
    direction_flips_geometry: bool
    is_auto: bool
    current_reversed: bool


@dataclass
class HeadingAssignment:
    """resolved direction (NATURAL or REVERSED) for a single inspection."""

    inspection_id: UUID
    sequence_order: int
    reversed: bool
    is_auto: bool


@dataclass
class HeadingSolution:
    """solver output: per-inspection chosen direction plus metrics."""

    assignments: list[HeadingAssignment]
    total_distance_m: float
    total_turn_deg: float
    auto_inspection_count: int
    pinned_inspection_count: int


def _heading_delta(a: float, b: float) -> float:
    """absolute heading change in degrees, wrapped to [0, 180]."""
    d = abs(a - b) % 360.0
    return d if d <= 180.0 else 360.0 - d


def _segment_for_row_methods(
    inspection: Inspection,
    template,
    lha_ids,
    is_auto: bool,
    current_reversed: bool,
) -> _Segment | None:
    """fly-over / parallel-side-sweep: scan endpoints sit on first/last ordered LHAs."""
    ordered = get_ordered_lha_positions(template, lha_ids)
    if len(ordered) < 2:
        return None

    entry = ordered[0]
    exit_ = ordered[-1]
    heading = bearing_between(entry.lon, entry.lat, exit_.lon, exit_.lat)
    distance = linestring_length([p.to_tuple() for p in ordered])
    return _Segment(
        inspection_id=inspection.id,
        sequence_order=inspection.sequence_order,
        entry=entry,
        exit=exit_,
        scan_heading=heading,
        scan_distance=distance,
        direction_flips_geometry=True,
        is_auto=is_auto,
        current_reversed=current_reversed,
    )


def _segment_for_arc_methods(
    inspection: Inspection,
    template,
    config,
    surfaces: list[AirfieldSurface],
    method: InspectionMethod,
    lha_ids,
    is_auto: bool,
    current_reversed: bool,
) -> _Segment | None:
    """horizontal_range / vertical_profile: arc or line endpoints from the helper.

    for vertical_profile this still yields a valid pair of points, but direction
    does not swap them - the flag falls into direction_flips_geometry=False.
    """
    positions = get_lha_positions(template, lha_ids)
    if not positions:
        return None
    center = Point3D.center(positions)
    rwy_heading = get_runway_heading(template, surfaces)
    try:
        start = determine_start_position(
            center, config, method, rwy_heading, DEFAULT_GLIDE_SLOPE_DEG
        )
        end = determine_end_position(center, config, method, rwy_heading, DEFAULT_GLIDE_SLOPE_DEG)
    except ValueError:
        return None

    heading = bearing_between(start.lon, start.lat, end.lon, end.lat)
    distance = distance_between(start.lon, start.lat, end.lon, end.lat)

    flips = method == InspectionMethod.HORIZONTAL_RANGE
    return _Segment(
        inspection_id=inspection.id,
        sequence_order=inspection.sequence_order,
        entry=start,
        exit=end,
        scan_heading=heading,
        scan_distance=distance,
        direction_flips_geometry=flips,
        is_auto=is_auto,
        current_reversed=current_reversed,
    )


def _segment_for_point_methods(
    inspection: Inspection,
    template,
    surfaces: list[AirfieldSurface],
    lha_ids,
    is_auto: bool,
    current_reversed: bool,
) -> _Segment | None:
    """hover_point_lock / meht_check collapse to a single point.

    treat entry and exit as identical and mark geometry as non-flipping.
    """
    positions = get_lha_positions(template, lha_ids)
    if not positions and lha_ids:
        positions = get_lha_positions_from_surfaces(surfaces, lha_ids)
    if not positions:
        return None
    point = Point3D.center(positions)
    return _Segment(
        inspection_id=inspection.id,
        sequence_order=inspection.sequence_order,
        entry=point,
        exit=point,
        scan_heading=0.0,
        scan_distance=0.0,
        direction_flips_geometry=False,
        is_auto=is_auto,
        current_reversed=current_reversed,
    )


def _segment_for_surface_scan(
    inspection: Inspection,
    config,
    surfaces: list[AirfieldSurface],
    is_auto: bool,
    current_reversed: bool,
) -> _Segment | None:
    """surface-scan: snake endpoints approximated by the along-track interval ends.

    REVERSED flips the snake start, so the segment flips geometry. run-count
    detail is irrelevant to the transit-distance estimate, so the sensor FOV is
    not needed here.
    """
    surface = resolve_scan_surface(surfaces, config.scan_surface_id)
    if surface is None:
        return None
    try:
        points, axis = _resolve_axis(surface)
    except ValueError:
        return None
    origin = points[0]
    total = linestring_length([p.to_tuple() for p in points])
    start, end = _resolve_length_interval(config, total)
    entry_lon, entry_lat = point_at_distance(origin.lon, origin.lat, axis, start)
    exit_lon, exit_lat = point_at_distance(origin.lon, origin.lat, axis, end)
    return _Segment(
        inspection_id=inspection.id,
        sequence_order=inspection.sequence_order,
        entry=Point3D(lon=entry_lon, lat=entry_lat, alt=origin.alt),
        exit=Point3D(lon=exit_lon, lat=exit_lat, alt=origin.alt),
        scan_heading=axis,
        scan_distance=max(0.0, end - start),
        direction_flips_geometry=True,
        is_auto=is_auto,
        current_reversed=current_reversed,
    )


def _build_segment(
    inspection: Inspection,
    surfaces: list[AirfieldSurface],
    is_auto: bool,
    current_reversed: bool,
) -> _Segment | None:
    """derive entry/exit geometry for a single inspection.

    dispatches to the per-method-class helper. returns None when the inspection
    has no resolvable geometry (e.g. missing LHAs). those inspections are
    skipped during solving but kept in the assignment list with their current
    direction.
    """
    template = inspection.template
    config = resolve_with_defaults(inspection, template)
    lha_ids = inspection.lha_ids

    # methods where direction does not affect geometry
    non_flipping = {
        InspectionMethod.HOVER_POINT_LOCK,
        InspectionMethod.MEHT_CHECK,
        InspectionMethod.VERTICAL_PROFILE,
    }
    try:
        method = InspectionMethod(inspection.method)
    except ValueError:
        return None

    if method == InspectionMethod.SURFACE_SCAN:
        return _segment_for_surface_scan(inspection, config, surfaces, is_auto, current_reversed)

    if method in (InspectionMethod.FLY_OVER, InspectionMethod.PARALLEL_SIDE_SWEEP):
        return _segment_for_row_methods(inspection, template, lha_ids, is_auto, current_reversed)

    # vertical_profile must hit the arc branch before the non-flipping check
    if method in (InspectionMethod.HORIZONTAL_RANGE, InspectionMethod.VERTICAL_PROFILE):
        return _segment_for_arc_methods(
            inspection, template, config, surfaces, method, lha_ids, is_auto, current_reversed
        )

    if method in non_flipping:
        return _segment_for_point_methods(
            inspection, template, surfaces, lha_ids, is_auto, current_reversed
        )

    return None


def _effective_endpoints(seg: _Segment, reversed_: bool) -> tuple[Point3D, Point3D, float]:
    """return (effective_entry, effective_exit, effective_heading) given a direction choice."""
    if not seg.direction_flips_geometry or not reversed_:
        return seg.entry, seg.exit, seg.scan_heading
    flipped_heading = (seg.scan_heading + 180.0) % 360.0
    return seg.exit, seg.entry, flipped_heading


def _score_assignment(
    segments: list[_Segment],
    choices: list[bool],
) -> tuple[float, float]:
    """sum transit distances + scan distances and total heading turn for a chosen assignment.

    returns (total_distance_m, total_turn_deg).
    """
    total_dist = 0.0
    total_turn = 0.0
    prev_exit: Point3D | None = None
    prev_heading: float | None = None
    for seg, rev in zip(segments, choices):
        entry, exit_, heading = _effective_endpoints(seg, rev)
        if prev_exit is not None:
            total_dist += distance_between(prev_exit.lon, prev_exit.lat, entry.lon, entry.lat)
            if prev_heading is not None and seg.scan_distance > 0:
                approach_heading = bearing_between(
                    prev_exit.lon, prev_exit.lat, entry.lon, entry.lat
                )
                total_turn += _heading_delta(prev_heading, approach_heading)
                total_turn += _heading_delta(approach_heading, heading)
        total_dist += seg.scan_distance
        prev_exit = exit_
        prev_heading = heading

    return total_dist, total_turn


def _enumerate(
    segments: list[_Segment],
    auto_indices: list[int],
) -> tuple[list[bool], float, float]:
    """brute-force search best direction assignment over auto indices.

    pinned indices keep their current_reversed.
    """
    k = len(auto_indices)
    base = [seg.current_reversed for seg in segments]

    if k == 0:
        dist, turn = _score_assignment(segments, base)
        return base, dist, turn

    best_choices = list(base)
    best_dist, best_turn = _score_assignment(segments, best_choices)
    best_cost = best_dist + TURN_PENALTY_WEIGHT * best_turn

    for mask in range(1 << k):
        choices = list(base)
        for bit, seg_idx in enumerate(auto_indices):
            choices[seg_idx] = bool((mask >> bit) & 1)
        dist, turn = _score_assignment(segments, choices)
        cost = dist + TURN_PENALTY_WEIGHT * turn
        if cost < best_cost - COST_COMPARISON_EPSILON:
            best_cost = cost
            best_dist = dist
            best_turn = turn
            best_choices = choices

    return best_choices, best_dist, best_turn


def solve_headings(
    inspections: Iterable[Inspection],
    surfaces: list[AirfieldSurface],
    auto_ids: set[UUID],
    initial_reversed: dict[UUID, bool] | None = None,
) -> HeadingSolution:
    """pure solver: build segments, brute-force over auto inspections, return solution.

    auto_ids is the set of inspection ids whose direction the solver may choose.
    initial_reversed seeds each segment's current_reversed flag (pinned inspections
    stay at this value, auto inspections start from it but can be flipped by the solver).
    """
    initial = initial_reversed or {}
    ordered = sorted(inspections, key=lambda i: i.sequence_order)

    segments: list[_Segment] = []
    skipped: list[Inspection] = []
    for insp in ordered:
        is_auto = insp.id in auto_ids
        current_reversed = bool(initial.get(insp.id, False))
        seg = _build_segment(insp, surfaces, is_auto=is_auto, current_reversed=current_reversed)
        if seg is None:
            skipped.append(insp)
            continue
        segments.append(seg)

    # only flip-capable auto segments participate
    auto_indices = [
        i for i, seg in enumerate(segments) if seg.is_auto and seg.direction_flips_geometry
    ]
    if len(auto_indices) > MAX_AUTO_INSPECTIONS:
        raise DomainError(
            f"auto-heading solver supports up to {MAX_AUTO_INSPECTIONS} unpinned inspections "
            f"(got {len(auto_indices)})",
            status_code=422,
        )

    best_choices, best_dist, best_turn = _enumerate(segments, auto_indices)

    assignments: list[HeadingAssignment] = []
    for seg, reversed_ in zip(segments, best_choices):
        assignments.append(
            HeadingAssignment(
                inspection_id=seg.inspection_id,
                sequence_order=seg.sequence_order,
                reversed=reversed_,
                is_auto=seg.is_auto,
            )
        )
    for insp in skipped:
        assignments.append(
            HeadingAssignment(
                inspection_id=insp.id,
                sequence_order=insp.sequence_order,
                reversed=bool(initial.get(insp.id, False)),
                is_auto=insp.id in auto_ids,
            )
        )

    assignments.sort(key=lambda a: a.sequence_order)

    pinned_count = sum(1 for seg in segments if not (seg.is_auto and seg.direction_flips_geometry))

    return HeadingSolution(
        assignments=assignments,
        total_distance_m=round(best_dist, 2),
        total_turn_deg=round(best_turn, 2),
        auto_inspection_count=len(auto_indices),
        pinned_inspection_count=pinned_count,
    )
