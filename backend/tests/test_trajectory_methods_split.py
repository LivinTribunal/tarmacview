"""regression net for the methods/__init__.py registry + (ctx, prep) dispatch."""

import pytest

from app.core.enums import InspectionMethod
from app.services.trajectory import methods
from app.services.trajectory.methods import (
    METHOD_REGISTRY,
    METHOD_SPECS,
    PREPARE_REGISTRY,
    MethodSpec,
    compute_measurement_trajectory,
)
from app.services.trajectory.types import MethodPrep, ResolvedConfig
from tests.method_dispatch import make_context

_PREPARE_NAMES = [
    "_prepare_horizontal_range",
    "_prepare_vertical_profile",
    "_prepare_approach_descent",
    "_prepare_fly_over",
    "_prepare_parallel_side_sweep",
    "_prepare_hover_point_lock",
    "_prepare_meht_check",
    "_prepare_surface_scan",
]
_HANDLER_NAMES = [
    "_horizontal_range_handler",
    "_vertical_profile_handler",
    "_approach_descent_handler",
    "_fly_over_handler",
    "_parallel_side_sweep_handler",
    "_hover_point_lock_handler",
    "_meht_check_handler",
    "_surface_scan_handler",
]


def test_split_functions_reexported_by_name():
    """every _prepare_*/_*_handler stays importable from the package root."""
    for name in _PREPARE_NAMES + _HANDLER_NAMES:
        assert hasattr(methods, name), name

    # direct import path historically used by test_trajectory_meht_check
    from app.services.trajectory.methods import _prepare_meht_check

    assert callable(_prepare_meht_check)


def test_method_specs_cover_every_method():
    """one MethodSpec per InspectionMethod - the single registration site."""
    assert all(isinstance(spec, MethodSpec) for spec in METHOD_SPECS)
    assert {spec.method for spec in METHOD_SPECS} == set(InspectionMethod)
    assert len(METHOD_SPECS) == len(set(InspectionMethod))


def test_registries_derive_from_specs():
    """PREPARE_REGISTRY / METHOD_REGISTRY are derived straight from the spec list."""
    assert PREPARE_REGISTRY == {spec.method: spec.prepare for spec in METHOD_SPECS}
    assert METHOD_REGISTRY == {spec.method: spec.handler for spec in METHOD_SPECS}


def test_prepare_registry_keys_and_module_origin():
    """PREPARE_REGISTRY covers every method; values live in the _prepare module."""
    assert set(PREPARE_REGISTRY) == set(InspectionMethod)
    for fn in PREPARE_REGISTRY.values():
        assert callable(fn)
        assert fn.__module__ == "app.services.trajectory.methods._prepare"


def test_method_registry_keys_and_module_origin():
    """METHOD_REGISTRY covers every method; values live in the _dispatch module."""
    assert set(METHOD_REGISTRY) == set(InspectionMethod)
    for fn in METHOD_REGISTRY.values():
        assert callable(fn)
        assert fn.__module__ == "app.services.trajectory.methods._dispatch"


def test_papi_glide_slope_methods_derived_from_specs():
    """the papi-glide-slope set is exactly the flagged specs."""
    assert methods._PAPI_GLIDE_SLOPE_METHODS == {
        InspectionMethod.HORIZONTAL_RANGE,
        InspectionMethod.VERTICAL_PROFILE,
        InspectionMethod.APPROACH_DESCENT,
    }
    assert methods._PAPI_GLIDE_SLOPE_METHODS == frozenset(
        spec.method for spec in METHOD_SPECS if spec.is_papi_glide_slope
    )


def test_compute_measurement_trajectory_dispatches_with_ctx_prep(monkeypatch):
    """the dispatcher routes to the METHOD_REGISTRY handler, passing (ctx, prep)."""
    captured: dict = {}

    def fake_handler(ctx, prep):
        captured["ctx"] = ctx
        captured["prep"] = prep
        return []

    insp = type("I", (), {"method": InspectionMethod.FLY_OVER, "id": "x"})()
    config = ResolvedConfig(capture_mode="PHOTO_CAPTURE")
    ctx = make_context(insp, config, runway_heading=60.0, glide_slope=3.0, speed=5.0)
    prep = MethodPrep()

    monkeypatch.setitem(METHOD_REGISTRY, InspectionMethod.FLY_OVER, fake_handler)
    out = compute_measurement_trajectory(ctx, prep)

    assert out == []
    assert captured["ctx"] is ctx
    assert captured["prep"] is prep
    assert captured["ctx"].inspection is insp
    assert captured["ctx"].runway_heading == 60.0
    assert captured["ctx"].speed == 5.0


def test_compute_measurement_trajectory_unsupported_method():
    """unknown method raises ValueError from the dispatcher."""
    insp = type("I", (), {"method": "NOT_A_METHOD", "id": "x"})()
    config = ResolvedConfig(capture_mode="PHOTO_CAPTURE")
    ctx = make_context(insp, config)

    with pytest.raises(ValueError, match="unsupported inspection method"):
        compute_measurement_trajectory(ctx, MethodPrep())


def test_linestring_length_matches_hand_rolled_polyline_loop():
    """geo.linestring_length equals the old per-segment distance_between loop.

    pins the path-distance parity for the fly-over / parallel-side-sweep /
    surface-scan polyline replacements (#862).
    """
    from app.services.trajectory.types import Point3D
    from app.utils.geo import distance_between, linestring_length, point_at_distance

    base = Point3D(lon=14.26, lat=50.1, alt=380.0)
    pts = [base]
    for i in range(1, 6):
        lon, lat = point_at_distance(base.lon, base.lat, 75.0, 23.5 * i)
        pts.append(Point3D(lon=lon, lat=lat, alt=380.0 + i))

    hand_rolled = 0.0
    for k in range(1, len(pts)):
        hand_rolled += distance_between(pts[k - 1].lon, pts[k - 1].lat, pts[k].lon, pts[k].lat)

    assert linestring_length([p.to_tuple() for p in pts]) == hand_rolled
    # single point and empty inputs degenerate to zero, like the old loop
    assert linestring_length([pts[0].to_tuple()]) == 0.0
    assert linestring_length([]) == 0.0
