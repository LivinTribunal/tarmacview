"""engine-layer determinism: identical inputs produce bit-exact waypoint sequences.

covers same-process repeats and PYTHONHASHSEED variance across the two primary
PAPI methods and a multi-inspection mission (the orchestrator phase that runs
direction resolution, inter-pass transits, heading optimization, and A*).
"""

import os
import subprocess
import sys
from pathlib import Path
from uuid import UUID

import pytest

from tests.data.trajectory import (
    DEFAULT_LANDING,
    DEFAULT_TAKEOFF,
    TRAJECTORY_AGL_PAYLOAD,
    TRAJECTORY_AIRPORT_PAYLOAD,
    TRAJECTORY_DRONE_PAYLOAD,
    TRAJECTORY_SURFACE_PAYLOAD,
    make_lha_payload,
)

_BACKEND_DIR = Path(__file__).resolve().parents[1]

# stand-alone worker: connects to the shared test db (url + mission ids via
# env), regenerates each mission, prints one sha256 over every waypoint row.
# floats go through repr so the digest is bit-exact (python's float repr is the
# shortest round-tripping string, so equal repr iff equal bits). never commits,
# so the db stays pristine for the next seed.
_WORKER_SCRIPT = """
import hashlib
import os
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.trajectory.orchestrator import generate_trajectory

engine = create_engine(os.environ["TV_DET_DB_URL"])
parts = []
for mid in os.environ["TV_DET_MISSION_IDS"].split(","):
    with Session(engine) as db:
        fp, _ = generate_trajectory(db, UUID(mid))
        rows = [
            (
                wp.sequence_order,
                wp.position,
                repr(wp.heading),
                repr(wp.speed),
                repr(wp.gimbal_pitch),
                wp.waypoint_type,
                wp.camera_action,
                repr(wp.hover_duration),
                wp.camera_target,
                str(wp.inspection_id) if wp.inspection_id is not None else None,
            )
            for wp in sorted(fp.waypoints, key=lambda w: w.sequence_order)
        ]
        parts.append(repr(rows))
print("DETERMINISM_DIGEST:" + hashlib.sha256("|".join(parts).encode()).hexdigest())
"""


def _canonical_rows(fp):
    """canonical, bit-exact waypoint tuples for the engine-controlled fields.

    floats go through repr so equality is bit-exact, not tolerance-based: a
    python float repr is the shortest string that round-trips to the same bits.
    """
    return [
        (
            wp.sequence_order,
            wp.position,
            repr(wp.heading),
            repr(wp.speed),
            repr(wp.gimbal_pitch),
            wp.waypoint_type,
            wp.camera_action,
            repr(wp.hover_duration),
            wp.camera_target,
            str(wp.inspection_id) if wp.inspection_id is not None else None,
        )
        for wp in sorted(fp.waypoints, key=lambda w: w.sequence_order)
    ]


def _build_single_inspection_mission(client, icao, method, density, speed):
    """create an airport + single-inspection mission for the given method."""
    airport = client.post(
        "/api/v1/airports", json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao}
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json=TRAJECTORY_AGL_PAYLOAD,
    ).json()

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Det Tpl {icao}",
            "methods": [method],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": density},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Det Mission {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": speed,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": method},
    )
    return mission_id


def _build_multi_inspection_mission(client, icao):
    """create an airport + 2-inspection mission so phase-5 inter-pass A* runs."""
    airport = client.post(
        "/api/v1/airports", json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao}
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json=TRAJECTORY_AGL_PAYLOAD,
    ).json()

    for i in range(1, 4):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        )

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Det Multi {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "transit_agl": 10.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    for letter in ("A", "B"):
        template = client.post(
            "/api/v1/inspection-templates",
            json={
                "name": f"Det Multi Tpl {letter} {icao}",
                "methods": ["HORIZONTAL_RANGE"],
                "target_agl_ids": [agl["id"]],
                "default_config": {"measurement_density": 3},
            },
        ).json()
        client.post(
            f"/api/v1/missions/{mission_id}/inspections",
            json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
        )
    return mission_id


@pytest.fixture(scope="module")
def determinism_missions(client):
    """build the three scenario missions once and return their ids."""
    return {
        "horizontal_range": _build_single_inspection_mission(
            client, "ZDHR", "HORIZONTAL_RANGE", 6, 5.0
        ),
        "vertical_profile": _build_single_inspection_mission(
            client, "ZDVP", "VERTICAL_PROFILE", 8, 3.0
        ),
        "multi_inspection": _build_multi_inspection_mission(client, "ZDMI"),
    }


def _engine_rows(db_engine, mission_id):
    """regenerate the mission on a fresh session and return canonical rows."""
    from sqlalchemy.orm import Session

    from app.services.trajectory.orchestrator import generate_trajectory

    with Session(db_engine) as db:
        fp, _ = generate_trajectory(db, UUID(mission_id))
        rows = _canonical_rows(fp)
        # no commit: the session context rolls back so inputs stay identical
        # across runs and the hashseed subprocess sees a clean db.
    return rows


@pytest.mark.parametrize("scenario", ["horizontal_range", "vertical_profile", "multi_inspection"])
def test_same_process_repeat(determinism_missions, db_engine, scenario):
    """five same-process engine runs on identical inputs are bit-exact."""
    mission_id = determinism_missions[scenario]
    runs = [_engine_rows(db_engine, mission_id) for _ in range(5)]

    assert runs[0], f"{scenario}: engine produced no waypoints"
    for i, run in enumerate(runs[1:], start=2):
        assert run == runs[0], f"{scenario}: run {i} diverged from run 1"


def test_hashseed_variance(determinism_missions, db_engine):
    """PYTHONHASHSEED 0, 1, and random produce an identical engine digest."""
    db_url = db_engine.url.render_as_string(hide_password=False)
    mission_ids = ",".join(determinism_missions.values())

    digests = {}
    for seed in ("0", "1", "random"):
        proc = subprocess.run(
            [sys.executable, "-c", _WORKER_SCRIPT],
            cwd=str(_BACKEND_DIR),
            env={
                **os.environ,
                "PYTHONHASHSEED": seed,
                "ELEVATION_API_FALLBACK_ENABLED": "false",
                "TV_DET_DB_URL": db_url,
                "TV_DET_MISSION_IDS": mission_ids,
            },
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert proc.returncode == 0, (
            f"seed {seed} worker failed:\nSTDOUT\n{proc.stdout}\nSTDERR\n{proc.stderr}"
        )
        line = next(
            (ln for ln in proc.stdout.splitlines() if ln.startswith("DETERMINISM_DIGEST:")),
            None,
        )
        assert line, f"seed {seed} emitted no digest:\nSTDOUT\n{proc.stdout}\nSTDERR\n{proc.stderr}"
        digests[seed] = line.split(":", 1)[1]

    assert len(set(digests.values())) == 1, f"hashseed broke determinism: {digests}"
