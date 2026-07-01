"""end-to-end: PAPI camera center-height reference lifts the LHA-centroid aim altitude.

GROUND keeps today's behavior; LENS raises every PAPI measurement by the average
selected lens_height_agl_m; CUSTOM raises by an operator height. LENS with no lens
heights degrades to GROUND. Non-glide-slope PAPI methods (MEHT_CHECK) are untouched.
"""

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

# unique lens height on every LHA so the average is a known, uniform value.
LENS_AGL_M = 4.0


def _lha_payload_with_lens(i: int) -> dict:
    """make_lha_payload plus a surveyed lens height (PAPI optics)."""
    payload = make_lha_payload(i)
    payload["lens_height_agl_m"] = LENS_AGL_M
    payload["lens_height_msl_m"] = 300.0 + LENS_AGL_M
    return payload


def _build_papi_mission(client, icao: str, method: str, config: dict | None, *, lens: bool):
    """build a full PAPI mission for one inspection and return its mission_id."""
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
    agl_id = agl["id"]

    build_lha = _lha_payload_with_lens if lens else make_lha_payload
    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=build_lha(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"{method} Template {icao}",
            "methods": [method],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 5},
        },
    ).json()

    drone = client.post(
        "/api/v1/drone-profiles", json={**TRAJECTORY_DRONE_PAYLOAD, "name": f"Drone {icao}"}
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Center Height {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 3.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    body = {"template_id": template["id"], "method": method}
    if config is not None:
        body["config"] = config
    client.post(f"/api/v1/missions/{mission_id}/inspections", json=body)
    return mission_id


def _papi_band_warnings(validation_result: dict | None) -> list[str]:
    """papi_angle_band soft-warning messages from a validation_result payload."""
    if not validation_result:
        return []
    return sorted(
        v["message"]
        for v in validation_result["violations"]
        if v.get("violation_kind") == "papi_angle_band"
    )


def _measurement_alts(client, icao: str, method: str, config: dict | None, *, lens: bool):
    """build a full PAPI mission for one inspection and return its measurement altitudes."""
    mission_id = _build_papi_mission(client, icao, method, config, lens=lens)

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200, response.text

    wps = response.json()["flight_plan"]["waypoints"]
    alts = [
        w["position"]["coordinates"][2]
        for w in wps
        if w["waypoint_type"] == "MEASUREMENT" and w.get("inspection_id") is not None
    ]
    assert alts, "expected measurement waypoints"
    return sorted(alts)


def _assert_uniform_lift(ground: list[float], lifted: list[float], delta: float):
    """every lifted measurement altitude is its ground counterpart plus delta."""
    assert len(ground) == len(lifted)
    for g, ll in zip(ground, lifted):
        assert ll == pytest.approx(g + delta, abs=1e-6)


def test_horizontal_range_lens_lifts_by_average_lens_height(client):
    """LENS raises every HR measurement by the average selected lens_height_agl_m."""
    ground = _measurement_alts(client, "ZCHA", "HORIZONTAL_RANGE", None, lens=True)
    lifted = _measurement_alts(
        client,
        "ZCHB",
        "HORIZONTAL_RANGE",
        {"papi_center_height_reference": "LENS"},
        lens=True,
    )
    _assert_uniform_lift(ground, lifted, LENS_AGL_M)


def test_horizontal_range_custom_lifts_by_operator_height(client):
    """CUSTOM raises every HR measurement by the operator-entered height."""
    ground = _measurement_alts(client, "ZCHC", "HORIZONTAL_RANGE", None, lens=True)
    lifted = _measurement_alts(
        client,
        "ZCHD",
        "HORIZONTAL_RANGE",
        {"papi_center_height_reference": "CUSTOM", "papi_center_height_custom_m": 6.0},
        lens=True,
    )
    _assert_uniform_lift(ground, lifted, 6.0)


def test_vertical_profile_lens_lifts_uniformly(client):
    """LENS lifts the whole VP climb by the average lens height (band preserved)."""
    ground = _measurement_alts(client, "ZCHE", "VERTICAL_PROFILE", None, lens=True)
    lifted = _measurement_alts(
        client,
        "ZCHF",
        "VERTICAL_PROFILE",
        {"papi_center_height_reference": "LENS"},
        lens=True,
    )
    _assert_uniform_lift(ground, lifted, LENS_AGL_M)


def test_lens_with_no_lens_heights_matches_ground(client):
    """LENS with no configured lens heights degrades to Ground (no lift)."""
    ground = _measurement_alts(client, "ZCHG", "HORIZONTAL_RANGE", None, lens=False)
    lens = _measurement_alts(
        client,
        "ZCHH",
        "HORIZONTAL_RANGE",
        {"papi_center_height_reference": "LENS"},
        lens=False,
    )
    _assert_uniform_lift(ground, lens, 0.0)


def test_ground_default_matches_explicit_ground(client):
    """omitting the reference (default GROUND) equals an explicit GROUND."""
    default = _measurement_alts(client, "ZCHI", "HORIZONTAL_RANGE", None, lens=True)
    explicit = _measurement_alts(
        client,
        "ZCHJ",
        "HORIZONTAL_RANGE",
        {"papi_center_height_reference": "GROUND"},
        lens=True,
    )
    _assert_uniform_lift(default, explicit, 0.0)


def test_revalidate_lens_matches_generate_band_verdict(client):
    """revalidate applies the same center-height lift as generate.

    a LENS vertical-profile climb preserves its elevation angles, so generate
    emits no all-white-band warnings; revalidate must agree. before the fix
    revalidate measured the persisted (raised) waypoints from a ground-level
    centroid, drifting every bookend angle past tolerance and firing spurious
    `papi_angle_band` warnings the generate path never produced.
    """
    mission_id = _build_papi_mission(
        client,
        "ZCHK",
        "VERTICAL_PROFILE",
        {"papi_center_height_reference": "LENS"},
        lens=True,
    )

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    gen_band = _papi_band_warnings(gen.json()["flight_plan"]["validation_result"])

    reval = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert reval.status_code == 200, reval.text
    reval_band = _papi_band_warnings(reval.json()["validation_result"])

    # the shared-dispatch contract: revalidate's band verdict equals generate's.
    assert reval_band == gen_band


def test_only_glide_slope_methods_honor_the_center_height_reference():
    """the lift is gated on the canonical _PAPI_GLIDE_SLOPE_METHODS set (HR/VP/AD).

    _inspection_pass reuses the derived set instead of a parallel hard-coded tuple,
    so a future glide-slope method picks up the center-height lift for free; meht-check,
    hover-point-lock, fly-over, surface-scan, parallel-side-sweep stay excluded.
    """
    from app.core.enums import InspectionMethod
    from app.services.trajectory.methods import _PAPI_GLIDE_SLOPE_METHODS

    assert _PAPI_GLIDE_SLOPE_METHODS == {
        InspectionMethod.HORIZONTAL_RANGE,
        InspectionMethod.VERTICAL_PROFILE,
        InspectionMethod.APPROACH_DESCENT,
    }
    for excluded in (
        InspectionMethod.MEHT_CHECK,
        InspectionMethod.HOVER_POINT_LOCK,
        InspectionMethod.FLY_OVER,
        InspectionMethod.SURFACE_SCAN,
        InspectionMethod.PARALLEL_SIDE_SWEEP,
    ):
        assert excluded not in _PAPI_GLIDE_SLOPE_METHODS
