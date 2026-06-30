"""unit tests for trajectory helper utilities."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.trajectory.helpers import (
    _designator_sort_key,
    get_average_lens_height_agl,
    get_lha_positions,
    get_ordered_lha_positions,
    get_runway_centerline_midpoint,
    get_surface_centerline_midpoint,
    resolve_center_height_offset,
)
from app.services.trajectory.types import ResolvedConfig
from tests.data.trajectory import DESIGNATOR_MAP


class TestDesignatorSortKey:
    """tests for _designator_sort_key ordering."""

    def test_numeric_designators_sort_numerically(self):
        """numeric strings sort by integer value, not lexically."""
        keys = [_designator_sort_key(d) for d in ["10", "2", "1", "3"]]
        labels = ["10", "2", "1", "3"]
        result = [val for _, val in sorted(zip(keys, labels))]
        assert result == ["1", "2", "3", "10"]

    def test_alpha_designators_sort_lexically(self):
        """letter designators sort alphabetically."""
        keys = [_designator_sort_key(d) for d in ["D", "A", "C", "B"]]
        labels = ["D", "A", "C", "B"]
        result = [val for _, val in sorted(zip(keys, labels))]
        assert result == ["A", "B", "C", "D"]

    def test_numeric_before_alpha(self):
        """numeric designators sort before alpha ones."""
        assert _designator_sort_key("1") < _designator_sort_key("A")
        assert _designator_sort_key("99") < _designator_sort_key("A")

    def test_none_treated_as_alpha_empty(self):
        """None designator sorts with alpha group as empty string."""
        key_none = _designator_sort_key(None)
        key_a = _designator_sort_key("A")
        assert key_none < key_a

    @pytest.mark.parametrize("value", [None, ""])
    def test_none_and_empty_equivalent(self, value):
        """None and empty string produce the same sort key."""
        assert _designator_sort_key(value) == _designator_sort_key("")


class TestDesignatorMapConsistency:
    """verify test fixture mapping matches the project's PAPI letter convention."""

    # project convention (per user spec): sequence 1 (furthest from runway) = A,
    # sequence 4 (closest to runway) = D. the letter is a presentation of
    # sequence_number so the invariant 1=A..4=D holds across writes.
    PAPI_MAPPING = {1: "A", 2: "B", 3: "C", 4: "D"}

    def test_fixture_matches_papi_mapping(self):
        """test DESIGNATOR_MAP must match the project's sequence->letter convention."""
        assert DESIGNATOR_MAP == self.PAPI_MAPPING


def _lha(lon, lat, alt, designator):
    """fake LHA with a WKT POINT Z position."""
    return SimpleNamespace(
        id=uuid4(),
        position=f"POINT Z ({lon} {lat} {alt})",
        unit_designator=designator,
    )


class TestLhaPositionGetters:
    """getters now route through _parse_lha_position - prove output identity."""

    def test_get_ordered_lha_positions_parses_and_skips_missing(self):
        """valid positions parse to Point3D, designator-ordered; missing ones drop."""
        good = _lha(18.1, 49.6, 260.0, "1")
        missing = SimpleNamespace(id=uuid4(), position=None, unit_designator="2")
        template = SimpleNamespace(targets=[SimpleNamespace(lhas=[missing, good])])

        positions = get_ordered_lha_positions(template)

        assert len(positions) == 1
        assert (positions[0].lon, positions[0].lat, positions[0].alt) == (18.1, 49.6, 260.0)

    def test_get_lha_positions_filters_by_id(self):
        """lha_ids filter returns only the selected positions."""
        a = _lha(18.1, 49.6, 260.0, "1")
        b = _lha(18.2, 49.7, 261.0, "2")
        template = SimpleNamespace(targets=[SimpleNamespace(lhas=[a, b])])

        positions = get_lha_positions(template, [a.id])

        assert len(positions) == 1
        assert (positions[0].lon, positions[0].lat) == (18.1, 49.6)


def test_get_runway_centerline_midpoint_matches_surface_midpoint():
    """runway-centerline midpoint now delegates to get_surface_centerline_midpoint."""
    surface = SimpleNamespace(
        id=uuid4(),
        geometry="LINESTRING Z (18.0 49.5 100, 18.1 49.6 110, 18.2 49.7 120)",
    )
    template = SimpleNamespace(targets=[SimpleNamespace(surface_id=surface.id)])

    mid = get_runway_centerline_midpoint(template, [surface])
    surface_mid = get_surface_centerline_midpoint(surface)

    # first/last vertex average, ignoring intermediate vertices
    assert (mid.lon, mid.lat, mid.alt) == (surface_mid.lon, surface_mid.lat, surface_mid.alt)
    assert mid.lon == pytest.approx(18.1)
    assert mid.lat == pytest.approx(49.6)
    assert mid.alt == pytest.approx(110.0)


def _lha_lens(lens_agl, designator="A"):
    """fake LHA carrying a lens_height_agl_m (None for non-PAPI / unconfigured)."""
    return SimpleNamespace(id=uuid4(), lens_height_agl_m=lens_agl, unit_designator=designator)


class TestGetAverageLensHeightAgl:
    """averaging of selected PAPI LHA lens heights."""

    def test_averages_configured_heights(self):
        """mean of every non-null lens_height_agl_m across template LHAs."""
        template = SimpleNamespace(targets=[SimpleNamespace(lhas=[_lha_lens(1.0), _lha_lens(3.0)])])
        assert get_average_lens_height_agl(template) == pytest.approx(2.0)

    def test_skips_none_heights(self):
        """null lens heights are ignored, average uses only set ones."""
        template = SimpleNamespace(
            targets=[SimpleNamespace(lhas=[_lha_lens(2.0), _lha_lens(None), _lha_lens(4.0)])]
        )
        assert get_average_lens_height_agl(template) == pytest.approx(3.0)

    def test_none_when_no_heights_set(self):
        """returns None when no LHA carries a lens height."""
        template = SimpleNamespace(
            targets=[SimpleNamespace(lhas=[_lha_lens(None), _lha_lens(None)])]
        )
        assert get_average_lens_height_agl(template) is None

    def test_none_when_no_lhas(self):
        """returns None when there are no target LHAs at all."""
        template = SimpleNamespace(targets=[])
        assert get_average_lens_height_agl(template) is None

    def test_respects_lha_ids_filter(self):
        """only the selected lha_ids contribute to the average."""
        a = _lha_lens(2.0)
        b = _lha_lens(8.0)
        template = SimpleNamespace(targets=[SimpleNamespace(lhas=[a, b])])
        assert get_average_lens_height_agl(template, [a.id]) == pytest.approx(2.0)


class TestResolveCenterHeightOffset:
    """center-height reference -> meters to raise the LHA-centroid aim altitude."""

    def _template(self, *heights):
        """template with one AGL whose LHAs carry the given lens heights."""
        return SimpleNamespace(targets=[SimpleNamespace(lhas=[_lha_lens(h) for h in heights])])

    def test_ground_is_zero(self):
        """GROUND (and the default) keeps the centroid at ground level."""
        cfg = ResolvedConfig(papi_center_height_reference="GROUND")
        assert resolve_center_height_offset(cfg, self._template(5.0), None) == 0.0
        # default ResolvedConfig also reads as GROUND
        assert resolve_center_height_offset(ResolvedConfig(), self._template(5.0), None) == 0.0

    def test_lens_uses_average(self):
        """LENS lifts by the average selected lens_height_agl_m."""
        cfg = ResolvedConfig(papi_center_height_reference="LENS")
        assert resolve_center_height_offset(cfg, self._template(1.0, 3.0), None) == pytest.approx(
            2.0
        )

    def test_lens_with_no_heights_falls_back_to_ground(self):
        """LENS with no configured lens heights degrades to 0 (Ground behavior)."""
        cfg = ResolvedConfig(papi_center_height_reference="LENS")
        assert resolve_center_height_offset(cfg, self._template(None, None), None) == 0.0

    def test_custom_uses_operator_height(self):
        """CUSTOM lifts by the operator-entered height."""
        cfg = ResolvedConfig(papi_center_height_reference="CUSTOM", papi_center_height_custom_m=7.5)
        assert resolve_center_height_offset(cfg, self._template(2.0), None) == pytest.approx(7.5)

    def test_custom_with_no_height_is_zero(self):
        """CUSTOM with an unset height degrades to 0."""
        cfg = ResolvedConfig(papi_center_height_reference="CUSTOM")
        assert resolve_center_height_offset(cfg, self._template(2.0), None) == 0.0
