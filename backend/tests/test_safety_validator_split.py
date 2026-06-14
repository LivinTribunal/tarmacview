"""regression net for the safety_validator.py -> safety_validator/ package split (T3).

byte-identical behavior is the contract: every prior import path still resolves,
the violation concatenation order is unchanged, and the hard-vs-soft AGL
severity split survives the move across submodules.
"""

import ast
import pathlib
from types import SimpleNamespace
from uuid import UUID

from shapely.geometry import Polygon

from app.core.enums import ConstraintType, SafetyZoneType, WaypointType
from app.services.trajectory import safety_validator
from app.services.trajectory.safety_validator import (
    _batch_check_minimum_agl,
    validate_inspection_pass,
)
from app.services.trajectory.types import (
    LocalBoundary,
    LocalGeometries,
    LocalObstacle,
    LocalZone,
    WaypointData,
)
from app.utils.local_projection import LocalProjection

# the symbols orchestrator.py / pathfinding.py import externally - the AC surface
_AC_EXTERNAL_SURFACE = {
    # orchestrator.py
    "check_battery",
    "segment_runway_crossing_length",
    "validate_inspection_pass",
    "validate_papi_angle_band",
    "validate_vertical_profile_angle_band",
    # pathfinding.py
    "check_obstacle",
    "resolve_obstacle_buffer",
    "segments_intersect_obstacle",
    "segments_intersect_zone",
}

_GEOMETRY_SYMBOLS = {
    "resolve_obstacle_buffer",
    "segments_intersect_obstacle",
    "segments_intersect_zone",
    "segment_runway_crossing_length",
    "check_obstacle",
    "_polygon_contains_lonlat_2d",
}
_CONSTRAINTS_SYMBOLS = {
    "_check_constraint",
    "_check_runway_buffer",
    "_violation",
    "check_safety_zone",
    "check_drone_constraints",
    "check_battery",
}
_PASSES_SYMBOLS = {
    "validate_inspection_pass",
    "_batch_check_obstacles",
    "_batch_check_zones",
    "_batch_check_boundary_zones",
    "_batch_check_minimum_agl",
    "validate_papi_angle_band",
    "validate_vertical_profile_angle_band",
    "_GROUND_LEVEL_WAYPOINT_TYPES",
    "_BOUNDARY_EGRESS_WAYPOINT_TYPES",
}

_PKG_DIR = pathlib.Path(safety_validator.__file__).parent
# safety_validator-external trajectory modules - importing any of these at
# package init would re-introduce a cycle (pathfinding/orchestrator import us).
_FORBIDDEN_TRAJECTORY_MODULES = {
    "orchestrator",
    "pathfinding",
    "methods",
    "heading_optimizer",
    "helpers",
    "config_resolver",
}


def test_full_surface_importable_from_package_root():
    """every external + private symbol still resolves off the package root."""
    for name in _GEOMETRY_SYMBOLS | _CONSTRAINTS_SYMBOLS | _PASSES_SYMBOLS:
        assert hasattr(safety_validator, name), name


def test_all_lists_at_least_the_ac_external_surface():
    """__all__ re-exports every symbol orchestrator.py / pathfinding.py import."""
    exported = set(safety_validator.__all__)
    assert _AC_EXTERNAL_SURFACE <= exported
    for name in _AC_EXTERNAL_SURFACE:
        assert hasattr(safety_validator, name), name


def test_symbols_live_in_their_assigned_submodule():
    """the per-file seam matches the acceptance criteria exactly."""
    for name in _GEOMETRY_SYMBOLS:
        obj = getattr(safety_validator, name)
        if callable(obj):
            assert obj.__module__.endswith("safety_validator._geometry"), name
    for name in _CONSTRAINTS_SYMBOLS:
        obj = getattr(safety_validator, name)
        assert obj.__module__.endswith("safety_validator._constraints"), name
    for name in ("validate_inspection_pass", "_batch_check_obstacles", "validate_papi_angle_band"):
        obj = getattr(safety_validator, name)
        assert obj.__module__.endswith("safety_validator._passes"), name


def test_no_external_trajectory_import_at_package_init():
    """no submodule imports a safety_validator-external trajectory module."""
    for py in _PKG_DIR.glob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                head = node.module.split(".")[0]
                assert head not in _FORBIDDEN_TRAJECTORY_MODULES, (py.name, node.module)
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert "safety_validator" not in alias.name or alias.name.endswith(
                        "safety_validator"
                    ), (py.name, alias.name)
                    parts = alias.name.split(".")
                    assert not (
                        "trajectory" in parts
                        and any(m in parts for m in _FORBIDDEN_TRAJECTORY_MODULES)
                    ), (py.name, alias.name)


def _local_box(half: float = 100.0) -> Polygon:
    """square polygon in local meter coords centered on the projection origin."""
    return Polygon([(-half, -half), (half, -half), (half, half), (-half, half)])


class _FlatGround:
    """stub elevation provider returning a constant ground height."""

    def __init__(self, ground: float):
        """remember the ground level."""
        self.ground = ground

    def get_elevations_batch(self, points):
        """return the same ground elevation for every requested point."""
        return [self.ground] * len(points)


def test_violation_concatenation_order_is_byte_identical():
    """a mixed pass yields the exact pre-split violation_kind sequence.

    order: per-waypoint drone then constraint, then obstacles, then zones with
    boundary-egress first, then minimum-AGL.
    """
    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
    # waypoint sits at the projection origin (0, 0) in local coords
    wp = WaypointData(lon=14.0, lat=50.0, alt=100.0, waypoint_type=WaypointType.TRANSIT)

    obstacle = LocalObstacle(
        polygon=_local_box(),
        name="mast",
        height=200.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    hard_zone = LocalZone(
        polygon=_local_box(),
        zone_type=SafetyZoneType.PROHIBITED.value,
        name="no-fly",
        altitude_floor=None,
        altitude_ceiling=None,
    )
    # boundary far from the origin so the waypoint is outside it
    boundary = LocalBoundary(
        polygon=Polygon([(5000, 5000), (5100, 5000), (5100, 5100), (5000, 5100)]),
        name="perimeter",
    )
    local_geoms = LocalGeometries(
        proj=proj,
        obstacles=[obstacle],
        zones=[hard_zone],
        boundary_zones=[boundary],
        surfaces=[],
    )

    drone = SimpleNamespace(max_altitude=50.0, max_speed=None, endurance_minutes=None)
    constraint = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        constraint_type=ConstraintType.ALTITUDE,
        is_hard_constraint=True,
        min_altitude=None,
        max_altitude=50.0,
        max_horizontal_speed=None,
        lateral_buffer=None,
        boundary=None,
    )

    violations = validate_inspection_pass(
        [wp],
        drone,
        [constraint],
        local_geoms,
        elevation_provider=_FlatGround(98.0),
        keep_inside_airport_boundary=True,
    )

    kinds = [v.violation_kind for v in violations]
    assert kinds == ["drone", "constraint", "obstacle", "geofence", "safety_zone", "altitude"]


def test_agl_severity_split_survives_the_move():
    """transit below MIN_TRANSIT_ALTITUDE_AGL_M is hard; measurement/hover stay soft."""
    provider = _FlatGround(300.0)

    transit = WaypointData(lon=14.0, lat=50.0, alt=302.0, waypoint_type=WaypointType.TRANSIT)
    (transit_v,) = _batch_check_minimum_agl([transit], provider)
    assert transit_v.is_warning is False
    assert transit_v.violation_kind == "altitude"

    for wp_type in (WaypointType.MEASUREMENT, WaypointType.HOVER):
        wp = WaypointData(lon=14.0, lat=50.0, alt=302.0, waypoint_type=wp_type)
        (soft_v,) = _batch_check_minimum_agl([wp], provider)
        assert soft_v.is_warning is True
        assert soft_v.violation_kind == "altitude"
