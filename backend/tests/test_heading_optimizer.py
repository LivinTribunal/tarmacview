"""unit tests for the auto-heading optimizer.

tests use lightweight test doubles for Inspection / Template / AGL / LHA so
the solver can be exercised without standing up a full postgis mission.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest

from app.core.enums import InspectionMethod
from app.services.trajectory import heading_optimizer
from app.services.trajectory.heading_optimizer import (
    MAX_AUTO_INSPECTIONS,
    _build_segment,
    _effective_endpoints,
    _heading_delta,
    _score_assignment,
    _Segment,
    solve_headings,
)
from app.services.trajectory.types import Point3D


@dataclass
class _FakeLHA:
    """minimal lha stand-in exposing only the fields the optimizer reads."""

    id: UUID
    position_coords: tuple[float, float, float]
    unit_designator: str | None = None
    setting_angle: float | None = None

    @property
    def position(self):
        """return a WKT POINT Z string matching what wkt_to_geojson expects."""
        return _make_wkt_point(self.position_coords)


@dataclass
class _FakeAGL:
    """minimal agl with an ordered list of lhas."""

    id: UUID
    surface_id: UUID
    lhas: list[_FakeLHA]
    agl_type: str = "PAPI"
    glide_slope_angle: float | None = None
    distance_from_threshold: float | None = None


@dataclass
class _FakeTemplate:
    """minimal template with targets and a name."""

    name: str = "T"
    default_config: object | None = None
    targets: list[_FakeAGL] = field(default_factory=list)


@dataclass
class _FakeConfig:
    """minimal InspectionConfiguration-like object.

    mirrors fields the optimizer touches via resolve_with_defaults/overlay_config.
    """

    direction: str | None = None
    resolved_direction: str | None = None
    altitude_offset: float | None = None
    lha_ids: list | None = None
    selected_lha_id: UUID | None = None
    measurement_density: int = 8
    capture_mode: str = "PHOTO_CAPTURE"
    # null-valued fields that ResolvedConfig allows
    angle_offset_above: float | None = None
    angle_offset_below: float | None = None
    measurement_speed_override: float | None = None
    custom_tolerances: dict | None = None
    hover_duration: float | None = None
    horizontal_distance: float | None = None
    sweep_angle: float | None = None
    angle_source: str | None = None
    angle_start: float | None = None
    angle_end: float | None = None
    recording_setup_duration: float | None = None
    buffer_distance: float | None = None
    height_above_lights: float | None = None
    lateral_offset: float | None = None
    distance_from_lha: float | None = None
    height_above_lha: float | None = None
    camera_gimbal_angle: float | None = None
    lha_setting_angle_override_id: UUID | None = None
    hover_bearing: float | None = None
    hover_bearing_reference: str | None = None
    descent_start_distance: float | None = None
    descent_glide_slope_override: float | None = None
    scan_surface_id: UUID | None = None
    scan_length_mode: str | None = None
    scan_length_from: float | None = None
    scan_length_to: float | None = None
    scan_width: float | None = None
    scan_width_side: str | None = None
    scan_height: float | None = None
    scan_run_count: int | None = None
    scan_run_orientation: str | None = None
    scan_sidelap_percent: float | None = None
    white_balance: str | None = None
    iso: int | None = None
    shutter_speed: str | None = None
    focus_mode: str | None = None
    optical_zoom: float | None = None

    def resolve_with_defaults(self, template_config):
        """mirror InspectionConfiguration.resolve_with_defaults for test doubles."""
        from app.models.inspection import InspectionConfiguration

        merged = {}
        for key in InspectionConfiguration._MERGE_FIELDS:
            template_val = getattr(template_config, key, None) if template_config else None
            override_val = getattr(self, key, None)
            merged[key] = override_val if override_val is not None else template_val
        return merged


@dataclass
class _FakeInspection:
    """minimal Inspection-like object that the optimizer reads."""

    id: UUID
    template: _FakeTemplate
    method: str
    sequence_order: int
    config: _FakeConfig | None

    @property
    def lha_ids(self):
        """mirror the ORM lha_ids property."""
        if self.config and self.config.lha_ids:
            return list(self.config.lha_ids)
        if self.config and self.config.selected_lha_id:
            return [self.config.selected_lha_id]
        return None


def _make_wkt_point(coords: tuple[float, float, float]) -> str:
    """build a POINT Z WKT string for the given (lon, lat, alt) tuple."""
    lon, lat, alt = coords
    return f"POINT Z ({lon} {lat} {alt})"


def _row(start_lon: float, start_lat: float, n: int, spacing_m: float = 10.0) -> list[_FakeLHA]:
    """build n LHAs spaced eastward from a start point."""
    from app.utils.geo import point_at_distance

    lhas = []
    for i in range(n):
        if i == 0:
            lon, lat = start_lon, start_lat
        else:
            lon, lat = point_at_distance(start_lon, start_lat, 90.0, spacing_m * i)
        lhas.append(_FakeLHA(id=uuid4(), position_coords=(lon, lat, 380.0)))
    return lhas


def _inspection_with_method(
    seq: int,
    lhas: list[_FakeLHA],
    method: InspectionMethod,
    direction: str | None = None,
) -> _FakeInspection:
    """construct an inspection of the given method over the supplied LHAs."""
    surface_id = uuid4()
    agl = _FakeAGL(id=uuid4(), surface_id=surface_id, lhas=lhas, agl_type="CENTERLINE")
    template = _FakeTemplate(targets=[agl])
    cfg = _FakeConfig(
        direction=direction,
        lha_ids=[lha.id for lha in lhas],
    )
    return _FakeInspection(
        id=uuid4(),
        template=template,
        method=method.value,
        sequence_order=seq,
        config=cfg,
    )


def _fly_over(
    seq: int,
    lhas: list[_FakeLHA],
    direction: str | None = None,
) -> _FakeInspection:
    """construct a fly-over inspection over the given LHA row."""
    return _inspection_with_method(seq, lhas, InspectionMethod.FLY_OVER, direction)


# solver math


class TestHeadingDelta:
    """absolute heading change wraps correctly into [0, 180]."""

    def test_zero(self):
        """same heading yields zero delta."""
        assert _heading_delta(42.0, 42.0) == pytest.approx(0.0)

    def test_small(self):
        """45 vs 90 = 45."""
        assert _heading_delta(45.0, 90.0) == pytest.approx(45.0)

    def test_wraps(self):
        """10 vs 350 wraps to 20, not 340."""
        assert _heading_delta(10.0, 350.0) == pytest.approx(20.0)

    def test_opposite(self):
        """opposite headings are 180 apart."""
        assert _heading_delta(0.0, 180.0) == pytest.approx(180.0)


class TestEffectiveEndpoints:
    """reversing a flip-capable segment swaps entry/exit and rotates heading 180."""

    def test_non_flipping_segment_never_flips(self):
        """hover-like segments ignore the reversed flag."""
        a = Point3D(lon=0.0, lat=0.0, alt=0.0)
        b = Point3D(lon=1.0, lat=0.0, alt=0.0)
        seg = _Segment(
            inspection_id=uuid4(),
            sequence_order=1,
            entry=a,
            exit=b,
            scan_heading=90.0,
            scan_distance=0.0,
            direction_flips_geometry=False,
            is_auto=True,
            current_reversed=False,
        )
        entry, exit_, heading = _effective_endpoints(seg, reversed_=True)
        assert (entry, exit_, heading) == (a, b, 90.0)

    def test_flipping_segment_swaps(self):
        """flip-capable segments swap entry/exit and rotate heading by 180."""
        a = Point3D(lon=0.0, lat=0.0, alt=0.0)
        b = Point3D(lon=1.0, lat=0.0, alt=0.0)
        seg = _Segment(
            inspection_id=uuid4(),
            sequence_order=1,
            entry=a,
            exit=b,
            scan_heading=90.0,
            scan_distance=10.0,
            direction_flips_geometry=True,
            is_auto=True,
            current_reversed=False,
        )
        entry, exit_, heading = _effective_endpoints(seg, reversed_=True)
        assert entry == b
        assert exit_ == a
        assert heading == pytest.approx(270.0)


class TestScoreAssignment:
    """scoring accumulates transit + scan distances across ordered segments."""

    def test_two_segments_transit_plus_scans(self):
        """sum = transit(exit0 -> entry1) + scan0 + scan1."""
        from app.utils.geo import distance_between

        p0 = Point3D(lon=0.0, lat=0.0, alt=0.0)
        p1 = Point3D(lon=0.001, lat=0.0, alt=0.0)
        p2 = Point3D(lon=0.01, lat=0.0, alt=0.0)
        p3 = Point3D(lon=0.011, lat=0.0, alt=0.0)
        seg0 = _Segment(
            inspection_id=uuid4(),
            sequence_order=1,
            entry=p0,
            exit=p1,
            scan_heading=90.0,
            scan_distance=distance_between(p0.lon, p0.lat, p1.lon, p1.lat),
            direction_flips_geometry=True,
            is_auto=True,
            current_reversed=False,
        )
        seg1 = _Segment(
            inspection_id=uuid4(),
            sequence_order=2,
            entry=p2,
            exit=p3,
            scan_heading=90.0,
            scan_distance=distance_between(p2.lon, p2.lat, p3.lon, p3.lat),
            direction_flips_geometry=True,
            is_auto=True,
            current_reversed=False,
        )
        dist, turn = _score_assignment([seg0, seg1], [False, False])
        expected_transit = distance_between(p1.lon, p1.lat, p2.lon, p2.lat)
        expected_total = expected_transit + seg0.scan_distance + seg1.scan_distance
        assert dist == pytest.approx(expected_total)
        assert turn == pytest.approx(0.0, abs=1e-3)


# end-to-end solver tests over the public surface


class TestSolveHeadings:
    """solver picks direction that minimizes total transit."""

    def test_two_offset_rows_reverse_beats_natural(self):
        """two parallel rows: reversed second row shortens the transit."""
        from app.utils.geo import point_at_distance

        row_a = _row(0.0, 0.0, 4, spacing_m=10.0)
        a_exit_lon, a_exit_lat, _ = row_a[-1].position_coords
        start_lon, start_lat = point_at_distance(a_exit_lon, a_exit_lat, 90.0, 30.0)
        row_b = _row(start_lon, start_lat, 4, spacing_m=10.0)
        row_b = list(reversed(row_b))

        # row A pinned natural, row B is auto
        insp_a = _fly_over(1, row_a, direction="NATURAL")
        insp_b = _fly_over(2, row_b, direction=None)

        sol = solve_headings(
            [insp_a, insp_b],
            surfaces=[],
            auto_ids={insp_b.id},
        )
        assert sol.auto_inspection_count == 1
        assignments = {a.sequence_order: a for a in sol.assignments}
        assert assignments[2].reversed is True

    def test_deterministic_same_input_same_output(self):
        """solver output is deterministic for a fixed input."""
        row_a = _row(0.0, 0.0, 4)
        insp_a = _fly_over(1, row_a, direction=None)
        first = solve_headings([insp_a], surfaces=[], auto_ids={insp_a.id})
        second = solve_headings([insp_a], surfaces=[], auto_ids={insp_a.id})
        assert first.assignments[0].reversed == second.assignments[0].reversed
        assert first.total_distance_m == pytest.approx(second.total_distance_m)

    def test_auto_inspection_starting_reversed_flips_back_when_natural_is_shorter(self):
        """auto inspection starting with reversed=True flips back when natural wins."""
        from app.utils.geo import point_at_distance

        row_a = _row(0.0, 0.0, 4, spacing_m=10.0)
        a_exit_lon, a_exit_lat, _ = row_a[-1].position_coords
        start_lon, start_lat = point_at_distance(a_exit_lon, a_exit_lat, 90.0, 60.0)
        row_b = _row(start_lon, start_lat, 4, spacing_m=10.0)

        insp_a = _fly_over(1, row_a, direction="NATURAL")
        insp_b = _fly_over(2, row_b, direction=None)

        sol = solve_headings(
            [insp_a, insp_b],
            surfaces=[],
            auto_ids={insp_b.id},
            initial_reversed={insp_b.id: True},
        )
        assignments = {a.sequence_order: a for a in sol.assignments}
        assert assignments[2].reversed is False
        assert assignments[2].is_auto is True

    def test_pinned_inspection_keeps_current_reversed(self):
        """pinned (not in auto_ids) inspections stay at their initial value."""
        row = _row(0.0, 0.0, 3)
        insp = _fly_over(1, row, direction="REVERSED")
        sol = solve_headings(
            [insp],
            surfaces=[],
            auto_ids=set(),
            initial_reversed={insp.id: True},
        )
        assignments = {a.sequence_order: a for a in sol.assignments}
        assert assignments[1].reversed is True
        assert assignments[1].is_auto is False

    def test_no_auto_inspections_returns_zero_auto_count(self):
        """solver runs with zero auto inspections (still returns metrics)."""
        row = _row(0.0, 0.0, 3)
        insp = _fly_over(1, row, direction="NATURAL")
        sol = solve_headings([insp], surfaces=[], auto_ids=set())
        assert sol.auto_inspection_count == 0
        assert sol.pinned_inspection_count == 1

    def test_over_cap_raises(self):
        """brute-force cap is enforced via DomainError (422)."""
        from app.core.exceptions import DomainError

        inspections = []
        auto_ids: set[UUID] = set()
        for i in range(MAX_AUTO_INSPECTIONS + 1):
            row = _row(float(i) * 0.01, 0.0, 3)
            insp = _fly_over(i + 1, row, direction=None)
            inspections.append(insp)
            auto_ids.add(insp.id)

        with pytest.raises(DomainError):
            solve_headings(inspections, surfaces=[], auto_ids=auto_ids)


class TestHeadingOptimizerModuleSurface:
    """MAX_AUTO_INSPECTIONS and public symbols stay stable."""

    def test_cap_is_ten(self):
        """brute-force cap matches documented 2^10."""
        assert heading_optimizer.MAX_AUTO_INSPECTIONS == 10

    def test_solve_headings_exported(self):
        """solve_headings is the public surface used by the orchestrator pre-pass."""
        assert hasattr(heading_optimizer, "solve_headings")


class TestBuildSegmentDispatch:
    """_build_segment routes each method class to the right helper, behavior-neutral."""

    def test_row_method_flips_and_uses_endpoint_lhas(self):
        """fly-over / parallel-side-sweep produce a flip-capable row segment."""
        row = _row(0.0, 0.0, 4, spacing_m=10.0)
        for method in (InspectionMethod.FLY_OVER, InspectionMethod.PARALLEL_SIDE_SWEEP):
            insp = _inspection_with_method(1, row, method)
            seg = _build_segment(insp, surfaces=[], is_auto=True, current_reversed=False)
            assert seg is not None
            assert seg.direction_flips_geometry is True
            assert seg.scan_distance > 0
            assert (seg.entry.lon, seg.entry.lat) == pytest.approx(row[0].position_coords[:2])
            assert (seg.exit.lon, seg.exit.lat) == pytest.approx(row[-1].position_coords[:2])

    def test_horizontal_range_is_flip_capable_arc(self):
        """horizontal_range routes to the arc helper and flips with direction."""
        row = _row(0.0, 0.0, 3, spacing_m=10.0)
        insp = _inspection_with_method(1, row, InspectionMethod.HORIZONTAL_RANGE)
        seg = _build_segment(insp, surfaces=[], is_auto=True, current_reversed=False)
        assert seg is not None
        assert seg.direction_flips_geometry is True
        assert seg.scan_distance > 0
        assert (seg.entry.lon, seg.entry.lat) != (seg.exit.lon, seg.exit.lat)

    def test_vertical_profile_hits_arc_branch_not_point(self):
        """vertical_profile must reach the arc branch first - non-flipping, not collapsed."""
        row = _row(0.0, 0.0, 3, spacing_m=10.0)
        insp = _inspection_with_method(1, row, InspectionMethod.VERTICAL_PROFILE)
        seg = _build_segment(insp, surfaces=[], is_auto=True, current_reversed=False)
        assert seg is not None
        # arc branch sets flips=False for VP; the point branch would also set
        # False but would collapse entry==exit with zero scan - assert the
        # altitude band survives so we know it took the arc path.
        assert seg.direction_flips_geometry is False
        assert seg.entry.alt != seg.exit.alt

    def test_point_methods_collapse_to_single_point(self):
        """hover-point-lock / meht-check collapse entry==exit, non-flipping, zero scan."""
        row = _row(0.0, 0.0, 3, spacing_m=10.0)
        for method in (InspectionMethod.HOVER_POINT_LOCK, InspectionMethod.MEHT_CHECK):
            insp = _inspection_with_method(1, row, method)
            seg = _build_segment(insp, surfaces=[], is_auto=True, current_reversed=False)
            assert seg is not None
            assert seg.entry == seg.exit
            assert seg.scan_distance == 0.0
            assert seg.scan_heading == 0.0
            assert seg.direction_flips_geometry is False

    def test_surface_scan_flips_with_interval_endpoints(self):
        """surface-scan produces a flip-capable segment from the along-track interval."""
        from app.utils.geo import point_at_distance

        surface_id = uuid4()
        end_lon, _ = point_at_distance(18.0, 49.0, 90.0, 1000.0)

        @dataclass
        class _Surf:
            id: UUID
            heading: float | None
            width: float | None
            length: float | None
            geometry: str

        surface = _Surf(
            id=surface_id,
            heading=90.0,
            width=45.0,
            length=1000.0,
            geometry=f"LINESTRING Z (18.0 49.0 290, {end_lon} 49.0 290)",
        )
        template = _FakeTemplate(targets=[])
        cfg = _FakeConfig(scan_surface_id=surface_id)
        insp = _FakeInspection(
            id=uuid4(),
            template=template,
            method=InspectionMethod.SURFACE_SCAN.value,
            sequence_order=1,
            config=cfg,
        )
        seg = _build_segment(insp, surfaces=[surface], is_auto=True, current_reversed=False)
        assert seg is not None
        assert seg.direction_flips_geometry is True
        assert seg.scan_distance > 0
        assert (seg.entry.lon, seg.entry.lat) != (seg.exit.lon, seg.exit.lat)

    def test_surface_scan_without_surface_is_skipped(self):
        """a surface-scan with no resolvable surface yields no segment."""
        template = _FakeTemplate(targets=[])
        cfg = _FakeConfig(scan_surface_id=None)
        insp = _FakeInspection(
            id=uuid4(),
            template=template,
            method=InspectionMethod.SURFACE_SCAN.value,
            sequence_order=1,
            config=cfg,
        )
        assert _build_segment(insp, surfaces=[], is_auto=True, current_reversed=False) is None

    def test_unknown_method_returns_none(self):
        """an unrecognized method string yields no segment (skipped, not crashed)."""
        row = _row(0.0, 0.0, 3)
        insp = _inspection_with_method(1, row, InspectionMethod.FLY_OVER)
        insp.method = "NOT_A_REAL_METHOD"
        assert _build_segment(insp, surfaces=[], is_auto=False, current_reversed=False) is None

    def test_solve_headings_runs_per_method_class(self):
        """solver produces deterministic output for arc and point method classes."""
        row = _row(0.0, 0.0, 3, spacing_m=10.0)
        for method in (
            InspectionMethod.HORIZONTAL_RANGE,
            InspectionMethod.VERTICAL_PROFILE,
            InspectionMethod.HOVER_POINT_LOCK,
            InspectionMethod.MEHT_CHECK,
        ):
            insp = _inspection_with_method(1, row, method)
            first = solve_headings([insp], surfaces=[], auto_ids={insp.id})
            second = solve_headings([insp], surfaces=[], auto_ids={insp.id})
            assert len(first.assignments) == 1
            assert first.assignments[0].reversed == second.assignments[0].reversed
            assert first.total_distance_m == pytest.approx(second.total_distance_m)
