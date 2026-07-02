"""orchestrator end-to-end tests for RUNWAY_HORIZONTAL_RANGE (REL touchpoint arc)."""

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

# touchpoint on the runway centerline, at airport ground level
_TOUCHPOINT = {
    "touchpoint_latitude": 50.095,
    "touchpoint_longitude": 14.26,
    "touchpoint_altitude": 300.0,
}


def _setup_rel_runway_hr(client, icao_code: str, *, with_touchpoint: bool, config: dict):
    """airport + runway (optionally with touchpoint) + REL AGL + LHAs + runway-HR mission."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao_code},
    ).json()
    airport_id = airport["id"]

    surface_payload = {**TRAJECTORY_SURFACE_PAYLOAD}
    if with_touchpoint:
        surface_payload = {**surface_payload, **_TOUCHPOINT}
    surface = client.post(f"/api/v1/airports/{airport_id}/surfaces", json=surface_payload).json()
    surface_id = surface["id"]

    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json={**TRAJECTORY_AGL_PAYLOAD, "agl_type": "RUNWAY_EDGE_LIGHTS"},
    ).json()
    agl_id = agl["id"]

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    tpl_resp = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Template {icao_code}",
            "methods": ["RUNWAY_HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 4},
        },
    )
    assert tpl_resp.status_code == 201, tpl_resp.text
    template = tpl_resp.json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Test {icao_code}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "RUNWAY_HORIZONTAL_RANGE", "config": config},
    )
    assert r.status_code == 201, r.text
    return mission_id


def test_runway_hr_generates_constant_altitude_arc(client):
    """REL arc flies at a single altitude anchored on the surveyed touchpoint."""
    mission_id = _setup_rel_runway_hr(
        client,
        "RHRA",
        with_touchpoint=True,
        config={"horizontal_distance": 120, "sweep_angle": 12, "height_above_lights": 20},
    )
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text

    fp = gen.json()["flight_plan"]
    measurements = [w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT"]
    assert measurements
    # constant altitude = touchpoint.alt (300) + height (20)
    alts = [w["position"]["coordinates"][2] for w in measurements]
    assert max(alts) - min(alts) < 0.5
    assert alts[0] == pytest.approx(320.0, abs=1.0)


def test_runway_hr_missing_touchpoint_errors_with_runway_identifier(client):
    """a runway with no surveyed touchpoint fails generation naming the runway."""
    mission_id = _setup_rel_runway_hr(
        client,
        "RHRB",
        with_touchpoint=False,
        config={"horizontal_distance": 120, "height_above_lights": 20},
    )
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 400, gen.text
    detail = gen.json()["detail"]
    message = detail["error"] if isinstance(detail, dict) else detail
    assert "touchpoint" in message
    assert "06/24" in message


def test_runway_hr_revalidate_emits_no_papi_band_warning(client):
    """generate + revalidate produce no papi_angle_band warnings (REL is not a PAPI method)."""
    mission_id = _setup_rel_runway_hr(
        client,
        "RHRC",
        with_touchpoint=True,
        config={"horizontal_distance": 120, "sweep_angle": 12, "height_above_lights": 20},
    )
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text

    reval = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert reval.status_code == 200, reval.text
    fp = reval.json()
    violations = fp.get("validation_result", {}).get("violations", []) or []
    assert all(v.get("violation_kind") != "papi_angle_band" for v in violations)
