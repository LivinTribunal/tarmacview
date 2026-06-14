"""resolver tests for the lha-selection helper modes (ALL/RANGE/FROM_THRESHOLD/CUSTOM).

mirrors `frontend/src/utils/resolveLhaSelection.test.ts` - adding a case here
should be added there too so the parity contract holds.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.exceptions import DomainError
from app.services.lha_selection import (
    _along_track_distance_m,
    resolve_rule,
    resolve_rules_to_lha_ids,
)


def _wkt_pointz(lon: float, lat: float, alt: float = 0.0) -> str:
    """build a POINT Z WKT string."""
    return f"POINT Z ({lon} {lat} {alt})"


def _make_lha(seq: int, lon: float = 14.27, lat: float = 50.10):
    """build a minimal lha namespace usable by the resolver."""
    return SimpleNamespace(
        id=uuid4(),
        sequence_number=seq,
        position=_wkt_pointz(lon, lat),
    )


def _make_agl(lhas, surface=None):
    """build a minimal agl namespace with .lhas and .surface."""
    return SimpleNamespace(id=uuid4(), lhas=lhas, surface=surface)


def _make_runway_surface(t_lon=14.24, t_lat=50.10, e_lon=14.27, e_lat=50.10):
    """build an airfield-surface stub with threshold + end positions."""
    return SimpleNamespace(
        threshold_position=_wkt_pointz(t_lon, t_lat),
        end_position=_wkt_pointz(e_lon, e_lat),
    )


def test_resolve_all_returns_full_set():
    lhas = [_make_lha(1), _make_lha(2), _make_lha(3)]
    agl = _make_agl(lhas)
    out = resolve_rule({"mode": "ALL"}, agl, None)
    assert out == {lha.id for lha in lhas}


def test_resolve_custom_returns_empty_set():
    """custom mode does not pick ids by itself - the canonical list lives on lha_ids."""
    lhas = [_make_lha(1), _make_lha(2)]
    agl = _make_agl(lhas)
    assert resolve_rule({"mode": "CUSTOM"}, agl, None) == set()


def test_resolve_range_inclusive():
    lhas = [_make_lha(i) for i in range(1, 6)]
    agl = _make_agl(lhas)
    rule = {"mode": "RANGE", "params": {"from": 2, "to": 4}}
    expected = {lha.id for lha in lhas if 2 <= lha.sequence_number <= 4}
    assert resolve_rule(rule, agl, None) == expected


def test_resolve_range_empty_from_treats_as_one():
    lhas = [_make_lha(i) for i in range(1, 5)]
    agl = _make_agl(lhas)
    rule = {"mode": "RANGE", "params": {"from": None, "to": 3}}
    expected = {lha.id for lha in lhas if lha.sequence_number <= 3}
    assert resolve_rule(rule, agl, None) == expected


def test_resolve_range_empty_to_treats_as_max():
    lhas = [_make_lha(i) for i in range(1, 5)]
    agl = _make_agl(lhas)
    rule = {"mode": "RANGE", "params": {"from": 2, "to": None}}
    expected = {lha.id for lha in lhas if lha.sequence_number >= 2}
    assert resolve_rule(rule, agl, None) == expected


def test_resolve_range_from_greater_than_to_raises():
    lhas = [_make_lha(i) for i in range(1, 4)]
    agl = _make_agl(lhas)
    with pytest.raises(DomainError):
        resolve_rule({"mode": "RANGE", "params": {"from": 5, "to": 2}}, agl, None)


def test_resolve_range_negative_value_raises():
    lhas = [_make_lha(i) for i in range(1, 4)]
    agl = _make_agl(lhas)
    with pytest.raises(DomainError):
        resolve_rule({"mode": "RANGE", "params": {"from": -1, "to": 2}}, agl, None)


def test_resolve_from_threshold_start_picks_close_lhas():
    """on a 1-degree-lon runway (~71km), 100m band picks just the lhas near the start."""
    # threshold at lon=14.24, end at lon=14.27 (~3km eastward); place lhas
    # along the runway. 100m from threshold = ~0.0009 degrees.
    surface = _make_runway_surface(t_lon=14.240, e_lon=14.270)
    lhas = [
        _make_lha(1, lon=14.2401),  # ~7m past threshold
        _make_lha(2, lon=14.2405),  # ~36m past threshold
        _make_lha(3, lon=14.2412),  # ~86m past threshold
        _make_lha(4, lon=14.2420),  # ~143m past threshold (outside 100m band)
        _make_lha(5, lon=14.2500),  # well past
    ]
    agl = _make_agl(lhas, surface=surface)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "START", "distance_m": 100}}
    out = resolve_rule(rule, agl, surface)
    in_band = {lha.id for lha in lhas[:3]}
    assert out == in_band


def test_resolve_from_threshold_end_mirrors_from_end():
    """END anchor inverts the projection: lhas near end_position fall in."""
    surface = _make_runway_surface(t_lon=14.240, e_lon=14.270)
    lhas = [
        _make_lha(1, lon=14.2401),  # near start
        _make_lha(2, lon=14.2693),  # ~50m before end
        _make_lha(3, lon=14.2698),  # ~14m before end
    ]
    agl = _make_agl(lhas, surface=surface)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "END", "distance_m": 100}}
    out = resolve_rule(rule, agl, surface)
    assert lhas[1].id in out and lhas[2].id in out
    assert lhas[0].id not in out


def test_resolve_from_threshold_missing_surface_raises():
    lhas = [_make_lha(1)]
    agl = _make_agl(lhas, surface=None)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "START", "distance_m": 50}}
    with pytest.raises(DomainError):
        resolve_rule(rule, agl, None)


def test_resolve_from_threshold_surface_without_endpoints_raises():
    surface = SimpleNamespace(threshold_position=None, end_position=None)
    lhas = [_make_lha(1)]
    agl = _make_agl(lhas, surface=surface)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "START", "distance_m": 50}}
    with pytest.raises(DomainError):
        resolve_rule(rule, agl, surface)


def test_resolve_from_threshold_negative_distance_raises():
    surface = _make_runway_surface()
    lhas = [_make_lha(1)]
    agl = _make_agl(lhas, surface=surface)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "START", "distance_m": -1}}
    with pytest.raises(DomainError):
        resolve_rule(rule, agl, surface)


def test_resolve_from_threshold_unknown_anchor_raises():
    surface = _make_runway_surface()
    lhas = [_make_lha(1)]
    agl = _make_agl(lhas, surface=surface)
    rule = {"mode": "FROM_THRESHOLD", "params": {"threshold": "MIDDLE", "distance_m": 10}}
    with pytest.raises(DomainError):
        resolve_rule(rule, agl, surface)


def test_resolve_unknown_mode_raises():
    agl = _make_agl([_make_lha(1)])
    with pytest.raises(DomainError):
        resolve_rule({"mode": "WHATEVER"}, agl, None)


def test_along_track_distance_anchored_at_start_is_signed():
    # straight east-west runway, ~3000m long
    threshold = (14.240, 50.100)
    end = (14.270, 50.100)
    # point past the start, in the runway direction
    pt = (14.245, 50.100)
    d = _along_track_distance_m(pt, threshold, end, "START")
    assert d > 0
    # point on the wrong side of the start (west of threshold)
    pt2 = (14.230, 50.100)
    d2 = _along_track_distance_m(pt2, threshold, end, "START")
    assert d2 < 0


def test_resolve_rules_to_lha_ids_unions_per_agl():
    lhas_a = [_make_lha(i) for i in range(1, 5)]
    agl_a = _make_agl(lhas_a)
    lhas_b = [_make_lha(i) for i in range(1, 4)]
    agl_b = _make_agl(lhas_b)
    rules = {
        str(agl_a.id): {"mode": "RANGE", "params": {"from": 2, "to": 3}},
        str(agl_b.id): {"mode": "ALL"},
    }
    out = resolve_rules_to_lha_ids(rules, {agl_a.id: agl_a, agl_b.id: agl_b})
    expected = {lhas_a[1].id, lhas_a[2].id, lhas_b[0].id, lhas_b[1].id, lhas_b[2].id}
    assert set(out) == expected


def test_resolve_rules_custom_keeps_caller_supplied_ids_per_agl():
    """CUSTOM-mode AGLs union their slice of the caller's lha_ids list."""
    lhas_a = [_make_lha(i) for i in range(1, 4)]
    agl_a = _make_agl(lhas_a)
    rules = {str(agl_a.id): {"mode": "CUSTOM"}}
    out = resolve_rules_to_lha_ids(rules, {agl_a.id: agl_a}, custom_lha_ids=[lhas_a[0].id])
    assert out == [lhas_a[0].id]


def test_resolve_rules_custom_drops_ids_not_belonging_to_agl():
    lhas_a = [_make_lha(i) for i in range(1, 3)]
    agl_a = _make_agl(lhas_a)
    rogue_id = uuid4()
    rules = {str(agl_a.id): {"mode": "CUSTOM"}}
    out = resolve_rules_to_lha_ids(rules, {agl_a.id: agl_a}, custom_lha_ids=[rogue_id])
    assert out == []
