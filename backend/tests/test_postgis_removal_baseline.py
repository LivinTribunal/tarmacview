"""regression test for the post-PostGIS LKPR flight-plan baseline.

regenerates a flight plan against the seeded LKPR fixture and diffs it against
``tests/data/postgis_removal_baseline.json``. the baseline JSON should be
captured once from a known-good main and committed; this test then guards
against drift in the WKT-string + Shapely pathway.

if the JSON fixture is missing the test self-skips with a note - the on-call
agent is responsible for re-capturing it after a deliberate baseline change
(see issue #424). to refresh: run with ``UPDATE_BASELINE=1`` to dump the
freshly-generated waypoints to the fixture path instead of asserting.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from tests.data.airports import AIRPORT_PAYLOAD
from tests.data.trajectory import (
    DEFAULT_LANDING,
    DEFAULT_TAKEOFF,
    TRAJECTORY_DRONE_PAYLOAD,
    TRAJECTORY_SURFACE_PAYLOAD,
    make_lha_payload,
)

BASELINE_PATH = Path(__file__).parent / "data" / "postgis_removal_baseline.json"


def _round_coord(coord, ndigits: int = 6):
    """round a coordinate triple to ndigits to dodge fp jitter on x86 vs arm."""
    return [round(float(c), ndigits) for c in coord]


def _waypoint_summary(wp: dict) -> dict:
    """build a position-and-type summary from an api waypoint dict."""
    coords = (wp.get("position") or {}).get("coordinates") or [0, 0, 0]
    return {
        "sequence_order": wp["sequence_order"],
        "waypoint_type": wp["waypoint_type"],
        "camera_action": wp["camera_action"],
        "position": _round_coord(coords),
    }


def _build_lkpr_mission(client) -> str:
    """seed the deterministic LKPR-baseline mission and return its id.

    same shape every run: LKPR airport, one runway from
    TRAJECTORY_SURFACE_PAYLOAD, one PAPI AGL with four LHAs (A-D),
    a HORIZONTAL_RANGE template, the trajectory drone profile, and a
    mission with fixed takeoff/landing coordinates.
    """
    airport = client.post("/api/v1/airports", json=AIRPORT_PAYLOAD).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json={
            "agl_type": "PAPI",
            "name": "PAPI RWY 24",
            "position": {"type": "Point", "coordinates": [14.274, 50.097, 380]},
            "side": "LEFT",
            "glide_slope_angle": 3.0,
        },
    ).json()
    agl_id = agl["id"]

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "LKPR baseline template",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "LKPR baseline mission",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    return mission_id


@pytest.mark.skipif(
    not BASELINE_PATH.exists() and os.environ.get("UPDATE_BASELINE") != "1",
    reason=(
        "baseline JSON not committed yet - capture from a stable mainline run "
        "with UPDATE_BASELINE=1 and commit to "
        "backend/tests/data/postgis_removal_baseline.json"
    ),
)
def test_lkpr_baseline_byte_for_byte(client):
    """re-generate the LKPR plan and compare to the committed baseline.

    when UPDATE_BASELINE=1 the test runs unconditionally and dumps the
    freshly-generated summaries to the fixture path instead of asserting -
    the on-call agent runs that against a known-good mainline to refresh
    the baseline before squash, then re-runs without the env var to verify.
    """
    mission_id = _build_lkpr_mission(client)
    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200, response.text
    waypoints = response.json()["flight_plan"]["waypoints"]
    summaries = [_waypoint_summary(w) for w in waypoints]
    assert len(summaries) > 0, "trajectory pipeline returned zero waypoints"

    if os.environ.get("UPDATE_BASELINE") == "1":
        BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
        BASELINE_PATH.write_text(json.dumps({"waypoints": summaries}, indent=2))
        pytest.skip(f"UPDATE_BASELINE=1 - wrote {len(summaries)} waypoints to {BASELINE_PATH}")

    captured = json.loads(BASELINE_PATH.read_text())
    assert summaries == captured["waypoints"], (
        "LKPR trajectory drift - WKT/Shapely pathway no longer reproduces baseline"
    )
