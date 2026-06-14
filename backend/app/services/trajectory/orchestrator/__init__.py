"""trajectory generation orchestrator: multi-phase config/methods/pathfinding/validation.

re-export shim for the orchestrator/ package split. every prior
`from app.services.trajectory.orchestrator import X` resolves byte-identically.
the `pathfinding` / `safety_validator` re-exports below are eager so
`monkeypatch.setattr(orchestrator, "compute_transit_path", ...)` and
`monkeypatch.setattr(orchestrator, "segment_runway_crossing_length", ...)`
seams still reach the call sites in `_assembly` / `_postprocess`, which
resolve those names off this package object.
"""

# rebind targets - re-exported eagerly so monkeypatch on the package
# object propagates to the submodule call sites that resolve via `_orch.X`.
from ..pathfinding import compute_transit_path
from ..safety_validator import segment_runway_crossing_length
from ._assembly import (
    _assemble_core,
    _build_landing_transit_bookend,
    _build_takeoff_transit_bookend,
    _compute_final_buffer,
    _filter_to_mh,
    _first_last_mh,
    _parse_coordinate,
    _pass_boundary,
)
from ._inspection_pass import _process_inspection
from ._pipeline import (
    _generate_trajectory_inner,
    _load_mission_data,
    _resolve_inspection_directions,
    _waypoint_orm_to_data,
    generate_trajectory,
    revalidate_existing_plan,
)
from ._postprocess import (
    _collect_surface_crossing_warnings,
    _compute_totals,
    _format_soft_warnings,
    _inject_mission_default,
    _papi_band_violations,
    _segment_duration_with_accel,
)

__all__ = [
    "_assemble_core",
    "_build_landing_transit_bookend",
    "_build_takeoff_transit_bookend",
    "_collect_surface_crossing_warnings",
    "_compute_final_buffer",
    "_compute_totals",
    "_filter_to_mh",
    "_first_last_mh",
    "_format_soft_warnings",
    "_generate_trajectory_inner",
    "_inject_mission_default",
    "_load_mission_data",
    "_papi_band_violations",
    "_parse_coordinate",
    "_pass_boundary",
    "_process_inspection",
    "_resolve_inspection_directions",
    "_segment_duration_with_accel",
    "_waypoint_orm_to_data",
    "compute_transit_path",
    "generate_trajectory",
    "revalidate_existing_plan",
    "segment_runway_crossing_length",
]
