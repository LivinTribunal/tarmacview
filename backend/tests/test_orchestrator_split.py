"""regression net for the orchestrator.py -> orchestrator/ package split (T3).

byte-identical behavior is the contract: every prior import path still resolves,
the per-file seam matches the acceptance criteria, the `pathfinding` and
`safety_validator` re-exports keep the long-standing monkeypatch seams alive,
and the lazy `revalidate_existing_plan` import from `flight_plan_service` is
still resolvable across the package boundary.
"""

import ast
import pathlib

from app.services.trajectory import orchestrator

# external surface: every name an importer (production or test) reaches for
_AC_EXTERNAL_SURFACE = {
    # production importers (api routes + services + sibling trajectory init)
    "generate_trajectory",
    "revalidate_existing_plan",
    # test_trajectory_orchestrator + sibling suites - patched on the package
    "compute_transit_path",
    "segment_runway_crossing_length",
    "_format_soft_warnings",
    "_pass_boundary",
    "_inject_mission_default",
    "_compute_totals",
    "_collect_surface_crossing_warnings",
    "_papi_band_violations",
    "_resolve_inspection_directions",
    "_compute_final_buffer",
    "_segment_duration_with_accel",
    # additional helpers that survived as part of the public-ish shape
    "_assemble_core",
    "_process_inspection",
    "_generate_trajectory_inner",
    "_waypoint_orm_to_data",
}

_ASSEMBLY_CALLABLES = {
    "_assemble_core",
    "_build_landing_transit_bookend",
    "_build_takeoff_transit_bookend",
    "_compute_final_buffer",
    "_filter_to_mh",
    "_first_last_mh",
    "_parse_coordinate",
    "_pass_boundary",
}
_POSTPROCESS_CALLABLES = {
    "_collect_surface_crossing_warnings",
    "_compute_totals",
    "_format_soft_warnings",
    "_inject_mission_default",
    "_papi_band_violations",
    "_segment_duration_with_accel",
}
_PIPELINE_CALLABLES = {
    "_generate_trajectory_inner",
    "_load_mission_data",
    "_resolve_inspection_directions",
    "_waypoint_orm_to_data",
    "generate_trajectory",
    "revalidate_existing_plan",
}
_INSPECTION_PASS_CALLABLES = {"_process_inspection"}

_PKG_DIR = pathlib.Path(orchestrator.__file__).parent


def test_external_surface_resolves():
    """every prior `from orchestrator import X` for the AC-listed X still resolves."""
    for name in _AC_EXTERNAL_SURFACE:
        assert hasattr(orchestrator, name), name


def test_all_explicit_and_complete():
    """package `__all__` is non-empty and covers both entrypoints + every patched helper."""
    assert orchestrator.__all__, "package __all__ must be non-empty"
    exported = set(orchestrator.__all__)
    assert _AC_EXTERNAL_SURFACE <= exported


def test_per_file_seam_via_module_attribute():
    """the per-file seam matches the acceptance criteria exactly."""
    for name in _ASSEMBLY_CALLABLES:
        obj = getattr(orchestrator, name)
        assert obj.__module__.endswith("orchestrator._assembly"), name
    for name in _POSTPROCESS_CALLABLES:
        obj = getattr(orchestrator, name)
        assert obj.__module__.endswith("orchestrator._postprocess"), name
    for name in _PIPELINE_CALLABLES:
        obj = getattr(orchestrator, name)
        assert obj.__module__.endswith("orchestrator._pipeline"), name
    for name in _INSPECTION_PASS_CALLABLES:
        obj = getattr(orchestrator, name)
        assert obj.__module__.endswith("orchestrator._inspection_pass"), name


def test_per_file_seam_via_ast():
    """ast-parse each submodule; the function partition matches the AC."""
    expected_per_file = {
        "_assembly.py": _ASSEMBLY_CALLABLES,
        "_postprocess.py": _POSTPROCESS_CALLABLES,
        "_pipeline.py": _PIPELINE_CALLABLES,
        "_inspection_pass.py": _INSPECTION_PASS_CALLABLES,
    }
    for filename, expected in expected_per_file.items():
        path = _PKG_DIR / filename
        tree = ast.parse(path.read_text())
        defined = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        missing = expected - defined
        assert not missing, f"{filename} missing functions: {missing}"


def test_no_safety_validator_or_pathfinding_in_init():
    """package init re-exports from siblings but never triggers the cycle."""
    init_path = _PKG_DIR / "__init__.py"
    tree = ast.parse(init_path.read_text())
    # the only ImportFrom nodes for safety_validator / pathfinding in __init__
    # are the eager rebind-target re-exports, which import single symbols.
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or not node.module:
            continue
        if node.module in ("..pathfinding", "..safety_validator"):
            allowed = {"compute_transit_path", "segment_runway_crossing_length"}
            assert all(alias.name in allowed for alias in node.names), (
                "__init__ may only eagerly re-export the rebind targets from siblings"
            )


def test_monkeypatch_seam_compute_transit_path_holds(monkeypatch):
    """patching `orchestrator.compute_transit_path` reaches the `_assembly` callers.

    the bookend builders live in `_assembly.py` and resolve the name via
    `_orch.compute_transit_path` so a monkeypatch on the package object propagates.
    """
    calls: list[str] = []

    def _spy(*args, **kwargs):
        """record that the patched symbol was reached."""
        calls.append("hit")
        return []

    monkeypatch.setattr(orchestrator, "compute_transit_path", _spy)
    # direct-call the bookend builder so we exercise the indirection without
    # spinning up a full mission. a minimal stub mission carries only what
    # `_parse_coordinate` reads.

    class _Mission:
        """minimal stub: only the takeoff_coordinate WKT is read."""

        takeoff_coordinate = "POINT Z (14.0 50.0 100.0)"
        landing_coordinate = "POINT Z (14.0 50.0 100.0)"

    from app.services.trajectory.types import Point3D

    first_pt = Point3D(lon=14.001, lat=50.001, alt=120.0)
    orchestrator._build_takeoff_transit_bookend(
        _Mission(),
        first_pt,
        5.0,
        20.0,
        elevation_provider=None,
        local_geoms=None,
        buffer_distance_override=None,
        require_perpendicular_runway_crossing=True,
        keep_inside_airport_boundary=False,
    )
    assert calls == ["hit"]


def test_monkeypatch_seam_segment_runway_crossing_length_holds(monkeypatch):
    """patching `orchestrator.segment_runway_crossing_length` reaches `_postprocess`.

    `_collect_surface_crossing_warnings` resolves the name off the package object
    so the long-standing patch site in test_trajectory_orchestrator stays alive.
    """
    calls: list[str] = []

    def _spy(*args, **kwargs):
        """record that the patched symbol was reached and return zero (no crossing)."""
        calls.append("hit")
        return 0.0

    monkeypatch.setattr(orchestrator, "segment_runway_crossing_length", _spy)

    from types import SimpleNamespace

    from shapely.geometry import LineString, Polygon

    from app.core.enums import WaypointType
    from app.services.trajectory.types import LocalSurface, WaypointData
    from app.utils.local_projection import LocalProjection

    wps = [
        WaypointData(lon=14.0, lat=50.0, alt=100.0, waypoint_type=WaypointType.TRANSIT),
        WaypointData(lon=14.001, lat=50.001, alt=100.0, waypoint_type=WaypointType.TRANSIT),
    ]
    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
    surfaces = [
        LocalSurface(
            polygon=Polygon([(0, 0), (100, 0), (100, 100), (0, 100)]),
            centerline=LineString([(0, 50), (100, 50)]),
            identifier="RW1",
            surface_type="runway",
            width=40.0,
            length=100.0,
            heading=90.0,
        )
    ]
    geoms = SimpleNamespace(surfaces=surfaces)
    warnings: list = []
    orchestrator._collect_surface_crossing_warnings(wps, proj, geoms, {}, warnings)
    assert calls, "segment_runway_crossing_length was not reached via the package seam"


def test_monkeypatch_seam_process_inspection_holds(monkeypatch):
    """patching `orchestrator._process_inspection` reaches the `_pipeline` driver loop.

    `_generate_trajectory_inner` resolves the symbol via `_orch._process_inspection`
    so a monkeypatch on the package object propagates after the _inspection_pass
    extraction (mirrors the long-standing `compute_transit_path` indirection).
    """
    from types import SimpleNamespace

    import pytest

    from app.core.enums import MissionStatus
    from app.core.exceptions import TrajectoryGenerationError
    from app.services.trajectory.orchestrator import _pipeline
    from app.services.trajectory.types import MissionData

    calls: list[str] = []

    def _spy(*args, **kwargs):
        """record that the patched symbol was reached; return None to skip the pass."""
        calls.append("hit")
        return None

    monkeypatch.setattr(orchestrator, "_process_inspection", _spy)
    # the driver loop also calls `_resolve_inspection_directions`; stub it so we
    # don't need a real heading-optimizer pre-pass.
    monkeypatch.setattr(_pipeline, "_resolve_inspection_directions", lambda *a, **k: {})

    inspection = SimpleNamespace(sequence_order=1)
    mission = SimpleNamespace(
        flight_plan_scope="MEASUREMENTS_ONLY",
        takeoff_coordinate=None,
        landing_coordinate=None,
        flight_plan=None,
        status=MissionStatus.DRAFT,
        transit_agl=20.0,
        require_perpendicular_runway_crossing=True,
        keep_inside_airport_boundary=False,
        inspections=[inspection],
    )
    airport = SimpleNamespace(location="POINT Z (14.0 50.0 100.0)")
    mission_data = MissionData(
        mission=mission,
        airport=airport,
        drone=None,
        obstacles=[],
        safety_zones=[],
        surfaces=[],
        constraints=[],
        default_speed=5.0,
        elevation_provider=None,
    )

    # the spy returns None for every inspection, so the loop completes with
    # empty `inspection_passes` and the function raises - the seam reach is
    # the only thing we care about here.
    with pytest.raises(TrajectoryGenerationError):
        _pipeline._generate_trajectory_inner(db=None, mission_data=mission_data)

    assert calls == ["hit"], "spy was not reached via the package seam"


def test_lazy_flight_plan_service_import_resolves():
    """regression for the lazy `revalidate_existing_plan` import in flight_plan_service."""
    from app.services.trajectory.orchestrator import revalidate_existing_plan

    assert callable(revalidate_existing_plan)
