"""parity tests between backend enums and frontend literal unions.

these guard against silent drift, e.g. F-8 in the 2026-04-22 audit where
ConstraintType went from "ALTITUDE | SPEED | ..." on the backend to
"NO_FLY | ALTITUDE_LIMIT | ..." on the frontend without any compile error.
"""

import re
from pathlib import Path

from app.core.enums import (
    ConstraintType,
    MissionStatus,
    PapiCenterHeightReference,
    WaypointType,
)

FRONTEND_ENUMS = (
    Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "types" / "enums.ts"
)


def _parse_union(source: str, type_name: str) -> set[str]:
    """extract members of `export type {type_name} = "A" | "B" | ...;`."""
    pattern = re.compile(
        rf"export type {type_name}\s*=\s*([^;]+);",
        re.MULTILINE,
    )
    match = pattern.search(source)
    if match is None:
        raise AssertionError(f"could not find type {type_name} in {FRONTEND_ENUMS}")

    body = match.group(1)
    members = re.findall(r'"([^"]+)"', body)
    if not members:
        raise AssertionError(f"no members extracted for type {type_name}")
    return set(members)


def test_frontend_enums_file_exists():
    """frontend enums file must exist for parity checks to run."""
    assert FRONTEND_ENUMS.exists(), f"frontend enums file missing: {FRONTEND_ENUMS}"


def test_constraint_type_parity():
    """backend ConstraintType matches frontend union exactly."""
    source = FRONTEND_ENUMS.read_text()
    frontend = _parse_union(source, "ConstraintType")
    backend = {m.value for m in ConstraintType}
    assert backend == frontend, f"drift: backend={backend} frontend={frontend}"


def test_mission_status_parity():
    """backend MissionStatus matches frontend union exactly."""
    source = FRONTEND_ENUMS.read_text()
    frontend = _parse_union(source, "MissionStatus")
    backend = {m.value for m in MissionStatus}
    assert backend == frontend, f"drift: backend={backend} frontend={frontend}"


def test_waypoint_type_parity():
    """backend WaypointType matches frontend union exactly."""
    source = FRONTEND_ENUMS.read_text()
    frontend = _parse_union(source, "WaypointType")
    backend = {m.value for m in WaypointType}
    assert backend == frontend, f"drift: backend={backend} frontend={frontend}"


def test_papi_center_height_reference_parity():
    """backend PapiCenterHeightReference matches frontend union exactly."""
    source = FRONTEND_ENUMS.read_text()
    frontend = _parse_union(source, "PapiCenterHeightReference")
    backend = {m.value for m in PapiCenterHeightReference}
    assert backend == frontend, f"drift: backend={backend} frontend={frontend}"
