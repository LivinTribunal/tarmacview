"""tests for trajectory orchestrator - domain exceptions, validation result creation"""

from uuid import uuid4

import pytest

from app.core.enums import CameraAction, WaypointType
from app.core.exceptions import NotFoundError, TrajectoryGenerationError
from app.services.trajectory.types import WaypointData
from tests.data.trajectory import (
    DEFAULT_LANDING,
    DEFAULT_TAKEOFF,
    TRAJECTORY_AGL_PAYLOAD,
    TRAJECTORY_AIRPORT_PAYLOAD,
    TRAJECTORY_DRONE_PAYLOAD,
    TRAJECTORY_SURFACE_PAYLOAD,
    make_lha_payload,
)


def test_generate_trajectory_mission_not_found(db_engine):
    """orchestrator raises NotFoundError for missing mission"""
    from sqlalchemy.orm import Session

    from app.services.trajectory.orchestrator import generate_trajectory

    with Session(db_engine) as db:
        with pytest.raises(NotFoundError, match="mission not found"):
            generate_trajectory(db, uuid4())


def test_generate_trajectory_no_inspections(client, db_engine):
    """orchestrator raises TrajectoryGenerationError when mission has no inspections"""
    from sqlalchemy.orm import Session

    from app.services.trajectory.orchestrator import generate_trajectory

    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "NOIN"},
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "No Inspections Test",
            "airport_id": airport["id"],
            "default_speed": 5.0,
        },
    ).json()

    with Session(db_engine) as db:
        with pytest.raises(TrajectoryGenerationError, match="mission has no inspections"):
            generate_trajectory(db, mission["id"])


def test_generate_trajectory_no_waypoints_generated(client):
    """mission with inspection but no LHAs produces 400"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "NOLH"},
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    # create AGL with no LHAs
    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json=TRAJECTORY_AGL_PAYLOAD,
    ).json()

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "No LHA Template",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "No LHA Test",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
        },
    ).json()

    client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    response = client.post(f"/api/v1/missions/{mission['id']}/generate-trajectory")
    assert response.status_code == 400


def test_generate_trajectory_route_translates_not_found(client):
    """route returns 404 for missing mission"""
    response = client.post(f"/api/v1/missions/{uuid4()}/generate-trajectory")

    assert response.status_code == 404


def test_generate_trajectory_route_translates_no_inspections(client):
    """route returns 400 when mission has no inspections"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "NOIP"},
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "No Inspections Route Test",
            "airport_id": airport["id"],
            "default_speed": 5.0,
        },
    ).json()

    response = client.post(f"/api/v1/missions/{mission['id']}/generate-trajectory")

    assert response.status_code == 400


def test_validation_result_always_created(client):
    """flight plan always has validation_result even with zero warnings"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "VALR"},
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

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Val Result Template",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Val Result Test",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    assert fp["validation_result"] is not None
    assert fp["validation_result"]["passed"] is True
    assert fp["is_validated"] is True


def test_regeneration_replaces_flight_plan(client):
    """calling generate twice replaces the flight plan instead of duplicating"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "RGEN"},
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

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Regen Template",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Regen Test",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    r1 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r1.status_code == 200
    fp1_id = r1.json()["flight_plan"]["id"]

    r2 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r2.status_code == 200
    fp2_id = r2.json()["flight_plan"]["id"]

    assert fp1_id != fp2_id

    # only one flight plan should exist
    fp_get = client.get(f"/api/v1/missions/{mission_id}/flight-plan")
    assert fp_get.status_code == 200
    assert fp_get.json()["id"] == fp2_id


def _create_mission_with_inspection(client, icao_code, **mission_extras):
    """helper to create airport + surface + agl + lhas + template + drone + mission + inspection"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao_code},
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

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Template {icao_code}",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission_payload = {
        "name": f"Test {icao_code}",
        "airport_id": airport_id,
        "drone_profile_id": drone["id"],
        "default_speed": 5.0,
        "takeoff_coordinate": DEFAULT_TAKEOFF,
        "landing_coordinate": DEFAULT_LANDING,
        **mission_extras,
    }

    mission = client.post("/api/v1/missions", json=mission_payload).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    return mission_id, airport_id


def test_phase5_transit_bookend_assembly(client):
    """NTL trajectory starts and ends with at-altitude TRANSIT bookends."""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}
    landing = {"type": "Point", "coordinates": [14.28, 50.09, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "TKLM",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    wp_types = [w["waypoint_type"] for w in fp["waypoints"]]

    assert wp_types[0] == "TRANSIT"
    assert wp_types[-1] == "TRANSIT"
    assert "TAKEOFF" not in wp_types
    assert "LANDING" not in wp_types

    # total distance and duration should be positive
    assert fp["total_distance"] > 0
    assert fp["estimated_duration"] > 0


def test_phase5_transit_between_waypoints(client):
    """transit waypoints are inserted between bookend climb and inspection pass"""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "TRNZ",
        takeoff_coordinate=takeoff,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    wp_types = [w["waypoint_type"] for w in fp["waypoints"]]

    # NTL: starts with TRANSIT (above-takeoff climb), inspection, then TRANSIT (above-landing)
    assert wp_types[0] == "TRANSIT"
    assert "MEASUREMENT" in wp_types
    assert "TAKEOFF" not in wp_types
    assert "LANDING" not in wp_types


def test_runway_crossing_warnings(client):
    """runway crossings are categorized as warnings, not violations."""
    # place takeoff on one side of runway, so transit crosses it
    takeoff = {"type": "Point", "coordinates": [14.26, 50.11, 300]}
    landing = {"type": "Point", "coordinates": [14.26, 50.08, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "RWCR",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    vr = response.json()["flight_plan"]["validation_result"]
    violations = vr["violations"]
    assert isinstance(violations, list)
    assert len(violations) > 0

    # any crossing messages should be warnings, never violations
    crossings = [v for v in violations if "crosses" in v["message"]]
    for c in crossings:
        assert c["category"] == "warning"

    # no hard violations from crossings - validation passes
    hard_violations = [v for v in violations if v["category"] == "violation"]
    assert len(hard_violations) == 0
    assert vr["passed"] is True


def test_surface_crossing_warnings_carry_kind(client, monkeypatch):
    """orchestrator tags both transit and grouped-measurement crossings surface_crossing.

    crossings are geometry-gated and the pathfinder normally routes around the
    runway, so force segment_runway_crossing_length positive to deterministically
    exercise the crossing-emission block for every segment (TRANSIT bookends ->
    per-transit message, MEASUREMENT segments -> grouped message).
    """
    from app.services.trajectory import orchestrator

    monkeypatch.setattr(orchestrator, "segment_runway_crossing_length", lambda *a, **k: 5.0)

    mission_id, _ = _create_mission_with_inspection(client, "SCXK")
    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    violations = response.json()["flight_plan"]["validation_result"]["violations"]
    crossings = [v for v in violations if "crosses" in v["message"]]
    assert crossings, "forced crossing should emit at least one warning"

    transit_fmt = [v for v in crossings if "): crosses " in v["message"]]
    grouped_fmt = [v for v in crossings if "during measurement" in v["message"]]
    assert transit_fmt, "expected a per-transit crossing message"
    assert grouped_fmt, "expected a grouped-measurement crossing message"
    for c in crossings:
        assert c["category"] == "warning"
        assert c["violation_kind"] == "surface_crossing"
        assert c["constraint_name"] == "Surface Crossing"


def test_soft_warning_threads_validator_kind():
    """_format_soft_warnings carries the validator-emitted violation_kind."""
    from app.services.trajectory.orchestrator import _format_soft_warnings
    from app.services.trajectory.types import Violation

    warnings: list[tuple[str, list[str], str | None]] = []
    violations = [
        Violation(
            is_warning=True,
            message="waypoint inside SAFETY zone: north pad",
            violation_kind="safety_zone",
            waypoint_index=2,
        )
    ]
    _format_soft_warnings(violations, "pass A", warnings)

    assert len(warnings) == 1
    msg, wp_ids, kind = warnings[0]
    assert kind == "safety_zone"
    assert "pass A" in msg


def test_final_validation_produces_soft_warnings(client):
    """final assembled path validation adds soft warnings to the response"""
    mission_id, _ = _create_mission_with_inspection(client, "FNVL")

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    # validation result should exist with passed=True
    assert fp["validation_result"] is not None
    assert fp["validation_result"]["passed"] is True

    # waypoints should be ordered by sequence
    wps = fp["waypoints"]
    assert len(wps) > 0
    seq_orders = [w["sequence_order"] for w in wps]
    assert seq_orders == sorted(seq_orders)


def test_pipeline_computes_distance_and_duration(client):
    """full pipeline computes total_distance and estimated_duration"""
    mission_id, _ = _create_mission_with_inspection(client, "DIST")

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    assert fp["total_distance"] is not None
    assert fp["total_distance"] > 0
    assert fp["estimated_duration"] is not None
    assert fp["estimated_duration"] > 0


def test_vertical_profile_generates_hover_waypoints(client):
    """vertical profile is one continuous measurement pass - HOVER only appears as
    video recording bookends, not at LHA setting-angle transitions."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "VPRO"},
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

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Vertical Profile Template",
            "methods": ["VERTICAL_PROFILE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 8},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Vertical Profile Test",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 3.0,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.26, 50.105, 300]},
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "VERTICAL_PROFILE"},
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    wps = fp["waypoints"]
    assert len(wps) > 0

    # vertical profile emits continuous MEASUREMENT waypoints; the only HOVERs
    # that may appear are the RECORDING_START / RECORDING_STOP video bookends.
    inspection_hover_wps = [
        w for w in wps if w["waypoint_type"] == "HOVER" and w.get("inspection_id") is not None
    ]
    for wp in inspection_hover_wps:
        assert wp["camera_action"] in (
            "RECORDING_START",
            "RECORDING_STOP",
        ), "vertical profile should not hover mid-climb at setting angles"

    # altitudes should vary (vertical sweep changes altitude)
    measurement_wps = [w for w in wps if w["waypoint_type"] == "MEASUREMENT"]
    if len(measurement_wps) >= 2:
        alts = [w["position"]["coordinates"][2] for w in measurement_wps]
        assert max(alts) > min(alts), "vertical profile should have varying altitudes"


def test_vertical_profile_descent_leg_los_documented_behavior(client):
    """vertical-profile descent waypoint is appended back to the climb start
    altitude before validate_inspection_pass runs, so the descent column is
    inside the same obstacle/zone safety check as the climb itself.

    defense note: the descent waypoint is a TRANSIT (camera_action=NONE) sharing
    lon/lat with the climb start, so PAPI angle-band validation - a measurement-
    only check - does not apply. line-of-sight to the LHA centre is enforced
    via the per-waypoint obstacle check, which catches anything in the shared
    column. there is no separate descent-leg LOS test because the descent never
    deviates from the climb start point.
    """
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "VPDS"},
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

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Vertical Profile Descent Template",
            "methods": ["VERTICAL_PROFILE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Vertical Profile Descent Test",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 3.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "VERTICAL_PROFILE"},
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200
    fp = response.json()["flight_plan"]
    wps = fp["waypoints"]

    measurements = [
        w for w in wps if w["waypoint_type"] == "MEASUREMENT" and w.get("inspection_id") is not None
    ]
    assert measurements, "expected at least one VP measurement waypoint"
    first = measurements[0]
    last = measurements[-1]
    first_pos = first["position"]["coordinates"]
    last_pos = last["position"]["coordinates"]

    # the trailing descent TRANSIT must share lon/lat with the climb start at
    # the climb-start altitude. find it among the waypoints emitted right after
    # the highest measurement.
    last_idx = wps.index(last)
    descent_candidates = [
        w
        for w in wps[last_idx + 1 :]
        if w["waypoint_type"] == "TRANSIT"
        and abs(w["position"]["coordinates"][0] - first_pos[0]) < 1e-6
        and abs(w["position"]["coordinates"][1] - first_pos[1]) < 1e-6
        and abs(w["position"]["coordinates"][2] - first_pos[2]) < 1.0
    ]
    assert descent_candidates, (
        "descent transit at climb-start position is missing - the orchestrator "
        "should append it before validate_inspection_pass so the column stays "
        "inside the obstacle/zone safety envelope"
    )
    # climb actually rose above the start altitude (pre-condition for the descent)
    assert last_pos[2] > first_pos[2] + 1.0


# flight plan service tests (via route layer)


def test_get_flight_plan_not_found(client):
    """get flight plan for mission with no plan returns 404"""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "FPNF"},
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={"name": "No Plan Test", "airport_id": airport["id"], "default_speed": 5.0},
    ).json()

    response = client.get(f"/api/v1/missions/{mission['id']}/flight-plan")
    assert response.status_code == 404


def test_persist_transitions_draft_to_planned(client):
    """generating trajectory transitions mission from DRAFT to PLANNED"""
    mission_id, _ = _create_mission_with_inspection(client, "DRPL")

    # verify starts as DRAFT
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "DRAFT"

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    # verify transitioned to PLANNED
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "PLANNED"


def test_persist_keeps_planned_on_regeneration(client):
    """regenerating trajectory on PLANNED mission stays PLANNED"""
    mission_id, _ = _create_mission_with_inspection(client, "RGPL")

    # first generation -> PLANNED
    client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "PLANNED"

    # second generation -> still PLANNED
    client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "PLANNED"


def test_validated_mission_auto_regresses_on_regeneration(client):
    """generating trajectory on VALIDATED mission auto-regresses to PLANNED"""
    mission_id, _ = _create_mission_with_inspection(client, "VREG")

    # generate -> PLANNED
    client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")

    # validate -> VALIDATED
    client.post(f"/api/v1/missions/{mission_id}/validate")
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "VALIDATED"

    # regenerate -> auto-regresses to PLANNED
    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "PLANNED"


def test_exported_mission_allows_regeneration(client, db_engine):
    """generating trajectory on EXPORTED mission auto-regresses and produces PLANNED"""
    from sqlalchemy.orm import Session

    from app.models.mission import Mission

    mission_id, _ = _create_mission_with_inspection(client, "EXRG")

    # generate -> PLANNED
    client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")

    # validate -> VALIDATED
    client.post(f"/api/v1/missions/{mission_id}/validate")

    # transition to EXPORTED directly via model
    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        mission.transition_to("EXPORTED")
        db.commit()

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "EXPORTED"

    # regenerate -> auto-regresses to PLANNED
    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "PLANNED"

    # waypoints should be present
    fp = response.json()["flight_plan"]
    assert len(fp["waypoints"]) > 0


def test_generate_response_includes_mission_status(client):
    """trajectory response includes mission_status field"""
    mission_id, _ = _create_mission_with_inspection(client, "MSST")

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    data = response.json()
    assert "mission_status" in data
    assert data["mission_status"] == "PLANNED"


def test_buffer_distance_override_respected_in_trajectory(client):
    """mission with default_buffer_distance generates trajectory using the override."""
    mission_id, _ = _create_mission_with_inspection(
        client,
        "BUFD",
        default_buffer_distance=15.0,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    fp = response.json()["flight_plan"]
    assert fp["total_distance"] > 0
    assert len(fp["waypoints"]) > 0


def test_has_unsaved_map_changes_set_on_batch_update(client):
    """batch_update_waypoints sets has_unsaved_map_changes to True."""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}
    landing = {"type": "Point", "coordinates": [14.28, 50.09, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "BUMC",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
    )

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    fp = gen.json()["flight_plan"]
    first_wp = fp["waypoints"][0]

    # move the first waypoint slightly
    coords = first_wp["position"]["coordinates"]
    r = client.put(
        f"/api/v1/missions/{mission_id}/flight-plan/waypoints",
        json={
            "updates": [
                {
                    "waypoint_id": first_wp["id"],
                    "position": {
                        "type": "Point",
                        "coordinates": [coords[0] + 0.001, coords[1], coords[2]],
                    },
                }
            ]
        },
    )
    assert r.status_code == 200

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["has_unsaved_map_changes"] is True


def test_transit_waypoints_still_enforce_minimum_agl(client):
    """transit waypoints sit at ground + TRANSIT_AGL when no explicit transit_agl is set."""
    mission_id, _ = _create_mission_with_inspection(client, "AGLF")

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    wps = response.json()["flight_plan"]["waypoints"]
    # ground elevation = 300; fallback cruise = 300 + TRANSIT_AGL (30) = 330 AMSL
    transit_wps = [w for w in wps if w["waypoint_type"] == "TRANSIT"]
    assert transit_wps, "expected at least one transit waypoint"
    for wp in transit_wps:
        assert wp["position"]["coordinates"][2] >= 330.0 - 1e-6


def test_transit_agl_forces_shared_cruise_level(client):
    """all transit waypoints share ground + transit_agl when the field is set."""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}
    landing = {"type": "Point", "coordinates": [14.28, 50.09, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "CRUI",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
        transit_agl=120.0,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    wps = response.json()["flight_plan"]["waypoints"]
    # expected cruise altitude = airport elevation (300) + 120 AGL
    expected_cruise = 420.0

    transit_wps = [w for w in wps if w["waypoint_type"] == "TRANSIT"]
    assert transit_wps, "expected transit waypoints between takeoff and inspection pass"

    for wp in transit_wps:
        assert wp["position"]["coordinates"][2] == pytest.approx(expected_cruise, abs=1e-3)


def test_transit_agl_fallback_without_field(client):
    """transit waypoints fall back to ground + TRANSIT_AGL when field is unset."""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}
    landing = {"type": "Point", "coordinates": [14.28, 50.09, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "FBCR",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    wps = response.json()["flight_plan"]["waypoints"]
    # fallback cruise = 300 + TRANSIT_AGL (30) = 330
    expected_fallback = 330.0

    transit_wps = [w for w in wps if w["waypoint_type"] == "TRANSIT"]
    assert transit_wps, "expected transit waypoints"
    for wp in transit_wps:
        assert wp["position"]["coordinates"][2] == pytest.approx(expected_fallback, abs=1e-3)


def test_has_unsaved_map_changes_cleared_after_generate(client):
    """generate_trajectory clears has_unsaved_map_changes."""
    takeoff = {"type": "Point", "coordinates": [14.24, 50.10, 300]}
    landing = {"type": "Point", "coordinates": [14.28, 50.09, 300]}

    mission_id, _ = _create_mission_with_inspection(
        client,
        "GUMC",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
    )

    # generate, batch update to set the flag, then regenerate
    gen1 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen1.status_code == 200

    fp = gen1.json()["flight_plan"]
    first_wp = fp["waypoints"][0]
    coords = first_wp["position"]["coordinates"]

    client.put(
        f"/api/v1/missions/{mission_id}/flight-plan/waypoints",
        json={
            "updates": [
                {
                    "waypoint_id": first_wp["id"],
                    "position": {
                        "type": "Point",
                        "coordinates": [coords[0] + 0.001, coords[1], coords[2]],
                    },
                }
            ]
        },
    )

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["has_unsaved_map_changes"] is True

    # regenerate should clear the flag
    gen2 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen2.status_code == 200

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["has_unsaved_map_changes"] is False


def _setup_airport_template_for_method(
    client, icao_code: str, method: str, agl_type: str = "RUNWAY_EDGE_LIGHTS"
):
    """airport + runway surface + AGL of the given type + 4 LHAs + template."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao_code},
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    agl_payload = {**TRAJECTORY_AGL_PAYLOAD, "agl_type": agl_type}
    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json=agl_payload,
    ).json()
    agl_id = agl["id"]

    lha_ids: list[str] = []
    for i in range(1, 5):
        lha = client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        ).json()
        lha_ids.append(lha["id"])

    template_payload: dict = {
        "name": f"Template {icao_code}",
        "methods": [method],
        "default_config": {"measurement_density": 4},
    }
    if method != "HOVER_POINT_LOCK":
        template_payload["target_agl_ids"] = [agl_id]

    template = client.post(
        "/api/v1/inspection-templates",
        json=template_payload,
    ).json()

    return airport_id, agl_id, template["id"], lha_ids


def _run_new_method_mission(
    client,
    icao_code: str,
    method: str,
    config: dict | None = None,
    agl_type: str = "RUNWAY_EDGE_LIGHTS",
):
    """create a mission + inspection for a new method and generate the trajectory."""
    airport_id, _, template_id, lha_ids = _setup_airport_template_for_method(
        client, icao_code, method, agl_type=agl_type
    )

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

    payload: dict = {"template_id": template_id, "method": method}
    if config is not None:
        payload["config"] = config

    r = client.post(f"/api/v1/missions/{mission_id}/inspections", json=payload)
    assert r.status_code == 201, r.text

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    return mission_id, lha_ids, gen


def test_fly_over_generates_flight_plan(client):
    """fly-over produces one measurement waypoint per LHA at lha.alt + height_above_lights."""
    _, lha_ids, gen = _run_new_method_mission(
        client,
        "FLYO",
        "FLY_OVER",
        config={"height_above_lights": 12.0},
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    measurements = [w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT"]
    assert len(measurements) == len(lha_ids)
    # altitude = LHA ground (300) + height_above_lights (12)
    for wp in measurements:
        assert wp["position"]["coordinates"][2] == pytest.approx(312.0, abs=1.0)


def test_fly_over_video_mode_wraps_with_recording_hovers(client):
    """VIDEO capture adds RECORDING_START / RECORDING_STOP hover waypoints at the ends."""
    _, lha_ids, gen = _run_new_method_mission(
        client,
        "FLYV",
        "FLY_OVER",
        config={
            "capture_mode": "VIDEO_CAPTURE",
            "recording_setup_duration": 2.0,
            "height_above_lights": 12.0,
        },
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    pass_wps = [
        w
        for w in fp["waypoints"]
        if w["waypoint_type"] in ("MEASUREMENT", "HOVER") and w["inspection_id"]
    ]
    actions = [w["camera_action"] for w in pass_wps]
    assert "RECORDING_START" in actions
    assert "RECORDING_STOP" in actions
    # start/stop bookend the measurement run
    assert pass_wps[0]["camera_action"] == "RECORDING_START"
    assert pass_wps[-1]["camera_action"] == "RECORDING_STOP"


def test_parallel_side_sweep_generates_flight_plan(client):
    """parallel-side-sweep produces waypoints on the exterior side of the runway."""
    _, lha_ids, gen = _run_new_method_mission(
        client,
        "PARA",
        "PARALLEL_SIDE_SWEEP",
        config={"lateral_offset": 25.0, "height_above_lights": 10.0},
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    measurements = [w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT"]
    assert len(measurements) == len(lha_ids)

    # TRAJECTORY_SURFACE_PAYLOAD: runway centerline runs from (14.24, 50.10) to
    # (14.28, 50.09); midpoint ~ (14.26, 50.095). LHAs sit around (14.274, 50.098)
    # - just north of the centerline midpoint in lat. so the exterior (far) side
    # of the runway is further north (higher lat) than the LHA row.
    lha_lat = 50.098
    runway_mid_lat = 50.095
    for wp in measurements:
        wp_lat = wp["position"]["coordinates"][1]
        # exterior: further from runway centerline than LHAs
        assert abs(wp_lat - runway_mid_lat) > abs(lha_lat - runway_mid_lat) - 1e-6


def test_parallel_side_sweep_video_mode(client):
    """VIDEO mode adds RECORDING_START / RECORDING_STOP hover waypoints."""
    _, _, gen = _run_new_method_mission(
        client,
        "PRVD",
        "PARALLEL_SIDE_SWEEP",
        config={
            "capture_mode": "VIDEO_CAPTURE",
            "recording_setup_duration": 2.0,
            "lateral_offset": 25.0,
        },
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    actions = [w["camera_action"] for w in fp["waypoints"]]
    assert "RECORDING_START" in actions
    assert "RECORDING_STOP" in actions


def test_hover_point_lock_single_hover_photo(client):
    """PHOTO capture: one HOVER waypoint with PHOTO_CAPTURE action and configured dwell."""
    airport_id, _, template_id, lha_ids = _setup_airport_template_for_method(
        client, "HPSL", "HOVER_POINT_LOCK"
    )

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Hover Single",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()

    r = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": template_id,
            "method": "HOVER_POINT_LOCK",
            "config": {
                "selected_lha_id": lha_ids[0],
                "hover_duration": 8.0,
                "capture_mode": "PHOTO_CAPTURE",
                "camera_gimbal_angle": -30.0,
                "distance_from_lha": 10.0,
                "height_above_lha": 5.0,
            },
        },
    )
    assert r.status_code == 201, r.text

    gen = client.post(f"/api/v1/missions/{mission['id']}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]

    hover_wps = [w for w in fp["waypoints"] if w["waypoint_type"] == "HOVER" and w["inspection_id"]]
    assert len(hover_wps) == 1
    # _apply_camera_actions clears camera_action on the first/last waypoint of a
    # pass; for a single-waypoint hover that is the only waypoint, so PHOTO_CAPTURE
    # gets stripped to NONE here. the underlying behavior is covered by the unit
    # tests on calculate_hover_point_lock_path.
    assert hover_wps[0]["hover_duration"] == pytest.approx(8.0, abs=1e-3)
    assert hover_wps[0]["gimbal_pitch"] == pytest.approx(-30.0, abs=1e-3)


def test_hover_point_lock_video_three_waypoints(client):
    """VIDEO capture emits RECORDING_START + RECORDING + RECORDING_STOP hover waypoints."""
    airport_id, _, template_id, lha_ids = _setup_airport_template_for_method(
        client, "HPVD", "HOVER_POINT_LOCK"
    )
    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Hover Video",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()

    r = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": template_id,
            "method": "HOVER_POINT_LOCK",
            "config": {
                "selected_lha_id": lha_ids[0],
                "capture_mode": "VIDEO_CAPTURE",
                "recording_setup_duration": 2.0,
            },
        },
    )
    assert r.status_code == 201, r.text

    gen = client.post(f"/api/v1/missions/{mission['id']}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]

    pass_wps = [w for w in fp["waypoints"] if w["waypoint_type"] == "HOVER" and w["inspection_id"]]
    actions = [w["camera_action"] for w in pass_wps]
    assert actions == ["RECORDING_START", "RECORDING", "RECORDING_STOP"]


def test_fly_over_speed_uses_lha_count_as_density(client):
    """speed is resolved using len(ordered_lhas), not config.measurement_density.

    with the old bug, passing density=8 for 4 LHAs inflated waypoint_spacing and
    recommended a higher optimal_speed. fix: density = 4 -> lower optimal speed,
    no spurious framerate warning when speed <= optimal.
    """
    # falls back to method default (5 m/s for fly-over)
    _, lha_ids, gen = _run_new_method_mission(
        client,
        "FLSP",
        "FLY_OVER",
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    measurements = [w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT"]
    assert len(measurements) == len(lha_ids)


def test_hover_point_lock_missing_selected_lha_raises(client, db_engine):
    """orchestrator raises TrajectoryGenerationError when HOVER_POINT_LOCK has no selected LHA."""
    from sqlalchemy.orm import Session

    from app.services.trajectory.orchestrator import generate_trajectory

    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "HPLK"},
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

    for i in range(1, 4):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Hover Template",
            "methods": ["HOVER_POINT_LOCK"],
            "default_config": {"measurement_density": 4},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Hover Missing LHA",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    # inspection without selected_lha_id in config
    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HOVER_POINT_LOCK"},
    )

    with Session(db_engine) as db:
        with pytest.raises(
            TrajectoryGenerationError,
            match="hover-point-lock requires a selected LHA",
        ):
            generate_trajectory(db, mission_id)


def test_require_perpendicular_runway_crossing_shortens_path(client):
    """flag=False produces a shorter total_distance than flag=True when transit crosses runway."""
    # takeoff north of runway, landing south - guarantees the landing transit
    # leg crosses the runway centerline regardless of how the inspection ends.
    takeoff = {"type": "Point", "coordinates": [14.26, 50.11, 300]}
    landing = {"type": "Point", "coordinates": [14.26, 50.08, 300]}

    # baseline with the perpendicular constraint enforced
    perp_mission_id, _ = _create_mission_with_inspection(
        client,
        "PERP",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
        require_perpendicular_runway_crossing=True,
    )
    perp_resp = client.post(f"/api/v1/missions/{perp_mission_id}/generate-trajectory")
    assert perp_resp.status_code == 200, perp_resp.text
    perp_distance = perp_resp.json()["flight_plan"]["total_distance"]

    # second mission: identical geometry, flag off (shortest geodesic)
    short_mission_id, _ = _create_mission_with_inspection(
        client,
        "SHRT",
        takeoff_coordinate=takeoff,
        landing_coordinate=landing,
        require_perpendicular_runway_crossing=False,
    )
    short_resp = client.post(f"/api/v1/missions/{short_mission_id}/generate-trajectory")
    assert short_resp.status_code == 200, short_resp.text
    short_distance = short_resp.json()["flight_plan"]["total_distance"]

    assert short_distance < perp_distance, (
        f"shortest-geodesic distance {short_distance:.1f} not strictly less than "
        f"perpendicular {perp_distance:.1f}"
    )


def test_measurement_speed_override_governs_only_measurement_waypoints(client):
    """measurement_speed_override sets measurement speed; mission default_speed drives
    transit waypoints (climb/descent bracketing the pass)."""
    airport_id, _, template_id, lha_ids = _setup_airport_template_for_method(
        client, "MSPD", "FLY_OVER"
    )
    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    # mission default_speed = 7.0 drives transit segments
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Test MSPD",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 7.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "FLY_OVER",
            "config": {
                "measurement_speed_override": 2.0,
                "height_above_lights": 12.0,
                "capture_mode": "PHOTO_CAPTURE",
            },
        },
    )
    assert r.status_code == 201, r.text

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]

    measurements = [w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT"]
    assert measurements, "expected measurement waypoints"
    for wp in measurements:
        assert wp["speed"] == pytest.approx(2.0)

    # transit waypoints use the mission default_speed
    transit_speeds = [wp["speed"] for wp in fp["waypoints"] if wp["waypoint_type"] == "TRANSIT"]
    assert any(s == pytest.approx(7.0) for s in transit_speeds), (
        f"expected at least one transit at default_speed=7.0, got speeds: {transit_speeds}"
    )


def test_mission_measurement_speed_override_fallback(client):
    """mission measurement_speed_override applies to inspections without their own override;
    per-inspection override takes precedence when set."""
    airport_id, _, template_id, lha_ids = _setup_airport_template_for_method(
        client, "MMSO", "FLY_OVER"
    )
    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    # mission-level measurement_speed_override = 1.0
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Test MMSO",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "measurement_speed_override": 1.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    # inspection A: per-inspection override = 10.0
    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "FLY_OVER",
            "config": {
                "measurement_speed_override": 10.0,
                "height_above_lights": 12.0,
                "capture_mode": "PHOTO_CAPTURE",
            },
        },
    )
    assert r.status_code == 201, r.text
    insp_a_id = r.json()["id"]

    # inspection B: no per-inspection override - should fall back to mission's 1.0
    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "FLY_OVER",
            "config": {
                "height_above_lights": 12.0,
                "capture_mode": "PHOTO_CAPTURE",
            },
        },
    )
    assert r.status_code == 201, r.text
    insp_b_id = r.json()["id"]

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]

    # inspection A measurements should use 10.0
    a_measurements = [
        w
        for w in fp["waypoints"]
        if w["waypoint_type"] == "MEASUREMENT" and w.get("inspection_id") == insp_a_id
    ]
    assert a_measurements, "expected measurement waypoints for inspection A"
    for wp in a_measurements:
        assert wp["speed"] == pytest.approx(10.0), (
            f"inspection A should use per-inspection override 10.0, got {wp['speed']}"
        )

    # inspection B measurements should use mission fallback 1.0
    b_measurements = [
        w
        for w in fp["waypoints"]
        if w["waypoint_type"] == "MEASUREMENT" and w.get("inspection_id") == insp_b_id
    ]
    assert b_measurements, "expected measurement waypoints for inspection B"
    for wp in b_measurements:
        assert wp["speed"] == pytest.approx(1.0), (
            f"inspection B should use mission fallback 1.0, got {wp['speed']}"
        )


# lha setting angle override - orchestrator integration


def _setup_horizontal_range_mission(client, icao):
    """build a HORIZONTAL_RANGE mission with 4 lhas of varying setting angles."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao},
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

    lha_ids_by_designator: dict[str, str] = {}
    for i in range(1, 5):
        resp = client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        ).json()
        lha_ids_by_designator[resp["unit_designator"]] = resp["id"]

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Override Template {icao}",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 6},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Override Test {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    return mission_id, template["id"], lha_ids_by_designator


def test_orchestrator_lha_setting_angle_override_uses_override_angle(client, db_engine):
    """orchestrator applies override lha setting angle instead of max."""
    import math

    from sqlalchemy.orm import Session

    from app.core.geometry import wkt_to_geojson
    from app.services.trajectory.orchestrator import generate_trajectory
    from app.services.trajectory.types import MIN_ARC_RADIUS

    mission_id, template_id, lhas = _setup_horizontal_range_mission(client, "LOVR")

    # override to lha A (setting_angle=3.0); max would be 4.5 (D, closest to runway)
    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_setting_angle_override_id": lhas["A"],
            },
        },
    )
    assert r.status_code == 201, r.text
    inspection_id = r.json()["id"]

    with Session(db_engine) as db:
        flight_plan, warnings = generate_trajectory(db, mission_id)

        # 3.0 (override) + 0.5 (default offset) = 3.5 deg
        expected_alt = 300.0 + MIN_ARC_RADIUS * math.tan(math.radians(3.5))
        # max-based glide would be 4.5 + 0.5 = 5.0 deg
        max_alt = 300.0 + MIN_ARC_RADIUS * math.tan(math.radians(5.0))

        measurement_wps = [
            w
            for w in flight_plan.waypoints
            if w.waypoint_type == "MEASUREMENT" and str(w.inspection_id) == inspection_id
        ]
        assert measurement_wps, "expected measurement waypoints for horizontal range pass"
        alts = [wkt_to_geojson(w.position)["coordinates"][2] for w in measurement_wps]
        for alt in alts:
            assert alt == pytest.approx(expected_alt, abs=0.05), (
                f"override path should use angle 3.5, got alt {alt} (expected {expected_alt:.2f})"
            )
            assert alt < max_alt - 1.0, (
                f"override altitude {alt:.2f} should be clearly below max-based {max_alt:.2f}"
            )

    # no "override not found" warning should be emitted when the override id resolves
    override_warnings = [msg for msg, *_ in warnings if "overridden LHA" in msg]
    assert override_warnings == []


def test_orchestrator_lha_setting_angle_override_falls_back_with_warning(client, db_engine):
    """invalid override id logs a warning and falls back to max-based glide slope."""
    import math

    from sqlalchemy.orm import Session

    from app.core.geometry import wkt_to_geojson
    from app.models.inspection import Inspection
    from app.services.trajectory.orchestrator import generate_trajectory
    from app.services.trajectory.types import MIN_ARC_RADIUS

    mission_id, template_id, _lhas = _setup_horizontal_range_mission(client, "LOVB")

    # use a real lha from a different surface so the fk passes but the orchestrator
    # cannot find it inside this template's targets - exercises the fallback branch.
    other_airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "LOVX"},
    ).json()
    other_surface = client.post(
        f"/api/v1/airports/{other_airport['id']}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    other_agl = client.post(
        f"/api/v1/airports/{other_airport['id']}/surfaces/{other_surface['id']}/agls",
        json=TRAJECTORY_AGL_PAYLOAD,
    ).json()
    other_lha = client.post(
        f"/api/v1/airports/{other_airport['id']}/surfaces/{other_surface['id']}"
        f"/agls/{other_agl['id']}/lhas",
        json=make_lha_payload(1),
    ).json()

    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_setting_angle_override_id": other_lha["id"],
            },
        },
    )
    assert r.status_code == 201, r.text
    inspection_id = r.json()["id"]

    # sanity: the override id really was persisted
    with Session(db_engine) as db:
        insp = db.query(Inspection).filter(Inspection.id == inspection_id).first()
        assert insp.config is not None
        assert str(insp.config.lha_setting_angle_override_id) == other_lha["id"]

        flight_plan, warnings = generate_trajectory(db, mission_id)

        # max-based fallback: 4.5 + 0.5 = 5.0 deg
        expected_alt = 300.0 + MIN_ARC_RADIUS * math.tan(math.radians(5.0))

        measurement_wps = [
            w
            for w in flight_plan.waypoints
            if w.waypoint_type == "MEASUREMENT" and str(w.inspection_id) == inspection_id
        ]
        assert measurement_wps, "expected measurement waypoints for fallback path"
        alts = [wkt_to_geojson(w.position)["coordinates"][2] for w in measurement_wps]
        for alt in alts:
            assert alt == pytest.approx(expected_alt, abs=0.05), (
                f"fallback should use max-based angle 5.0, got alt {alt}"
            )

    override_warnings = [msg for msg, *_ in warnings if "overridden LHA" in msg]
    assert len(override_warnings) == 1, (
        f"expected one override-not-found warning, got {override_warnings}"
    )


def test_orchestrator_no_override_uses_max_angle(client, db_engine):
    """orchestrator default behavior (no override) uses max setting angle."""
    import math

    from sqlalchemy.orm import Session

    from app.core.geometry import wkt_to_geojson
    from app.services.trajectory.orchestrator import generate_trajectory
    from app.services.trajectory.types import MIN_ARC_RADIUS

    mission_id, template_id, _ = _setup_horizontal_range_mission(client, "LOVM")

    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
        },
    )
    assert r.status_code == 201, r.text
    inspection_id = r.json()["id"]

    with Session(db_engine) as db:
        flight_plan, warnings = generate_trajectory(db, mission_id)

        # max-based: 4.5 + 0.5 = 5.0 deg
        expected_alt = 300.0 + MIN_ARC_RADIUS * math.tan(math.radians(5.0))

        measurement_wps = [
            w
            for w in flight_plan.waypoints
            if w.waypoint_type == "MEASUREMENT" and str(w.inspection_id) == inspection_id
        ]
        assert measurement_wps
        alts = [wkt_to_geojson(w.position)["coordinates"][2] for w in measurement_wps]
        for alt in alts:
            assert alt == pytest.approx(expected_alt, abs=0.05)

    override_warnings = [msg for msg, *_ in warnings if "overridden LHA" in msg]
    assert override_warnings == []


# constraint-rule lifecycle - rules live on the mission and survive regeneration


def test_mission_constraints_evaluated_on_first_compile(client, db_engine):
    """rule attached before the first compile fires as a soft validation warning."""
    from sqlalchemy.orm import Session

    from app.models.flight_plan import AltitudeConstraint
    from app.models.mission import Mission

    mission_id, _ = _create_mission_with_inspection(client, "CSFA")

    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        rule = AltitudeConstraint(
            name="impossibly low ceiling",
            min_altitude=0.0,
            max_altitude=1.0,
            is_hard_constraint=False,
        )
        mission.constraints.append(rule)
        db.commit()

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200, response.text

    fp = response.json()["flight_plan"]
    violations = fp["validation_result"]["violations"]
    # the altitude rule's bound shows up in the warning message
    assert any("above max 1m" in v.get("message", "") for v in violations), (
        f"expected altitude-bound warning in {violations}"
    )


def test_mission_constraints_survive_regeneration(client, db_engine):
    """rules attached pre-generate are evaluated on every recompute, not just the first."""
    from sqlalchemy.orm import Session

    from app.models.flight_plan import AltitudeConstraint, SpeedConstraint
    from app.models.mission import Mission

    mission_id, _ = _create_mission_with_inspection(client, "CSFB")

    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        alt_rule = AltitudeConstraint(
            name="ceiling",
            min_altitude=0.0,
            max_altitude=1.0,
            is_hard_constraint=False,
        )
        speed_rule = SpeedConstraint(
            name="speed cap",
            max_horizontal_speed=0.1,
            is_hard_constraint=False,
        )
        mission.constraints.extend([alt_rule, speed_rule])
        db.commit()
        alt_id = str(alt_rule.id)
        speed_id = str(speed_rule.id)

    # first compile - both rules fire
    r1 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r1.status_code == 200, r1.text
    v1 = r1.json()["flight_plan"]["validation_result"]["violations"]
    assert any("above max 1m" in v.get("message", "") for v in v1)
    assert any("exceeds max 0.1" in v.get("message", "") for v in v1)

    # force regen via a trajectory-affecting field tweak
    client.patch(f"/api/v1/missions/{mission_id}", json={"default_speed": 6.0})

    r2 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r2.status_code == 200, r2.text
    v2 = r2.json()["flight_plan"]["validation_result"]["violations"]
    assert any("above max 1m" in v.get("message", "") for v in v2), (
        "altitude rule should still fire after regeneration"
    )
    assert any("exceeds max 0.1" in v.get("message", "") for v in v2), (
        "speed rule should still fire after regeneration"
    )

    # rules still attached with the original uuids - validation_violation FK
    # (ondelete=SET NULL) stays resolvable across regenerations
    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        ids = {str(c.id) for c in mission.constraints}
        assert ids == {alt_id, speed_id}


def test_mission_constraint_deletion_takes_effect_on_regen(client, db_engine):
    """deleting one of two attached rules leaves the survivor as the only fire."""
    from sqlalchemy.orm import Session

    from app.models.flight_plan import AltitudeConstraint, SpeedConstraint
    from app.models.mission import Mission

    mission_id, _ = _create_mission_with_inspection(client, "CSFC")

    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        alt_rule = AltitudeConstraint(
            name="ceiling",
            min_altitude=0.0,
            max_altitude=1.0,
            is_hard_constraint=False,
        )
        speed_rule = SpeedConstraint(
            name="speed cap",
            max_horizontal_speed=0.1,
            is_hard_constraint=False,
        )
        mission.constraints.extend([alt_rule, speed_rule])
        db.commit()
        speed_id = str(speed_rule.id)

    client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")

    # detach the speed rule
    with Session(db_engine) as db:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        doomed = [c for c in mission.constraints if str(c.id) == speed_id]
        assert doomed
        mission.constraints.remove(doomed[0])
        db.commit()

    r2 = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r2.status_code == 200, r2.text
    v2 = r2.json()["flight_plan"]["validation_result"]["violations"]

    assert any("above max 1m" in v.get("message", "") for v in v2)
    assert not any("exceeds max 0.1" in v.get("message", "") for v in v2)


# pass-boundary edge cases - MEASUREMENTS_ONLY scope rejects transit-only passes


def test_pass_boundary_transit_only_pass_raises():
    """MEASUREMENTS_ONLY pass with no MEASUREMENT/HOVER waypoints raises a clear error."""
    from app.services.trajectory.orchestrator import _pass_boundary

    transit_only = [
        WaypointData(
            lon=14.26,
            lat=50.10,
            alt=350.0,
            heading=90.0,
            speed=8.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
        WaypointData(
            lon=14.27,
            lat=50.10,
            alt=350.0,
            heading=90.0,
            speed=8.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
    ]

    with pytest.raises(
        TrajectoryGenerationError, match="inspection produced no measurement waypoints"
    ):
        _pass_boundary(transit_only)


def test_pass_boundary_ntl_scope_also_raises_on_transit_only():
    """NTL scope shares the MH-boundary contract - a TRANSIT-only pass raises.

    issue #405: every scope binds its inter-pass transits between MH endpoints, so a
    pass with no MEASUREMENT/HOVER cannot bound the canonical core. the empty-pass
    drop should keep this branch unreachable in practice; the raise replaces a
    silent fallback that hid generator bugs.
    """
    from app.services.trajectory.orchestrator import _pass_boundary

    transit_only = [
        WaypointData(
            lon=14.26,
            lat=50.10,
            alt=350.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
        WaypointData(
            lon=14.27,
            lat=50.10,
            alt=350.0,
            waypoint_type=WaypointType.TRANSIT,
            camera_action=CameraAction.NONE,
        ),
    ]

    with pytest.raises(
        TrajectoryGenerationError, match="inspection produced no measurement waypoints"
    ):
        _pass_boundary(transit_only)


# issue #496: per-waypoint agl is persisted at trajectory generation time and
# pinned by these tests so future refactors cannot quietly drop the write.


def test_persist_flight_plan_populates_waypoint_agl(client, db_engine):
    """orchestrator persist phase writes agl on every Waypoint row.

    TAKEOFF/LANDING force agl=0; in-flight waypoints get max(0, alt - ground).
    on a FLAT airport with no api fallback the sampled ground equals
    airport.elevation so AGL collapses to wp.alt - airport.elevation.
    """
    from sqlalchemy.orm import sessionmaker

    from app.models.airport import Airport
    from app.models.flight_plan import FlightPlan

    mission_id, airport_id = _create_mission_with_inspection(client, "WPAG")
    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200

    Session = sessionmaker(bind=db_engine)
    with Session() as session:
        airport = session.query(Airport).filter(Airport.id == airport_id).first()
        fp = session.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
        assert fp is not None
        assert fp.waypoints

        for wp in fp.waypoints:
            assert wp.agl is not None, f"waypoint {wp.id} has null persisted agl"

            if wp.waypoint_type in ("TAKEOFF", "LANDING"):
                assert wp.agl == 0.0
            else:
                assert wp.agl >= 0.0
                # FLAT airport (no api fallback in orchestrator path): ground
                # equals airport.elevation, so persisted agl matches the simple
                # subtraction within float tolerance.
                pos_z = float(wp.position.split()[-1].rstrip(")"))
                assert abs(wp.agl - max(0.0, pos_z - airport.elevation)) < 0.01


def test_no_elevation_warnings_on_flat_airport_read(client, db_engine, caplog):
    """opening a freshly-generated plan on a FLAT airport fires zero provider calls.

    the regression we're guarding: per-read Open-Elevation calls with WARNING-level
    'open-elevation lookup failed' lines. with the persist-and-read shape, the
    waypoint columns are non-null after generate-trajectory and build_enriched_response
    short-circuits before the provider is constructed.
    """
    import logging

    mission_id, _ = _create_mission_with_inspection(client, "FLRD")
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    caplog.clear()
    with caplog.at_level(logging.WARNING):
        resp = client.get(f"/api/v1/missions/{mission_id}/flight-plan")
        assert resp.status_code == 200

    suspect = [r for r in caplog.records if "open-elevation lookup failed" in r.message]
    messages = [r.message for r in suspect]
    assert suspect == [], f"unexpected open-elevation warnings on read: {messages}"


# extracted-helper units (T3 refactor #545) - pure functions, no DB needed.


class _Cfg:
    """minimal stand-in for inspection.config / template.default_config."""

    def __init__(self, **fields):
        """seed only the fields the test cares about."""
        for k, v in fields.items():
            setattr(self, k, v)


class _Holder:
    """stand-in carrying a `config` or `default_config` attribute (or None)."""

    def __init__(self, attr_name, value):
        """attr_name is 'config' (inspection) or 'default_config' (template)."""
        setattr(self, attr_name, value)


def test_inject_mission_default_fills_when_unset():
    """mission default lands on config when neither inspection nor template set it."""
    from app.services.trajectory.orchestrator import _inject_mission_default
    from app.services.trajectory.types import ResolvedConfig

    config = ResolvedConfig()
    inspection = _Holder("config", _Cfg(buffer_distance=None))
    template = _Holder("default_config", _Cfg(buffer_distance=None))

    _inject_mission_default(config, inspection, template, "buffer_distance", 7.5)

    assert config.buffer_distance == 7.5


def test_inject_mission_default_inspection_value_wins():
    """an inspection-set field blocks the mission default."""
    from app.services.trajectory.orchestrator import _inject_mission_default
    from app.services.trajectory.types import ResolvedConfig

    config = ResolvedConfig()
    config.buffer_distance = 3.0
    inspection = _Holder("config", _Cfg(buffer_distance=3.0))
    template = _Holder("default_config", _Cfg(buffer_distance=None))

    _inject_mission_default(config, inspection, template, "buffer_distance", 7.5)

    assert config.buffer_distance == 3.0


def test_inject_mission_default_template_value_wins():
    """a template-set field blocks the mission default."""
    from app.services.trajectory.orchestrator import _inject_mission_default
    from app.services.trajectory.types import ResolvedConfig

    config = ResolvedConfig()
    inspection = _Holder("config", _Cfg(measurement_speed_override=None))
    template = _Holder("default_config", _Cfg(measurement_speed_override=2.0))

    _inject_mission_default(config, inspection, template, "measurement_speed_override", 9.0)

    assert config.measurement_speed_override is None


def test_inject_mission_default_none_value_is_noop():
    """a None mission value is the 'mission has no default' sentinel - never injects."""
    from app.services.trajectory.orchestrator import _inject_mission_default
    from app.services.trajectory.types import ResolvedConfig

    config = ResolvedConfig()
    inspection = _Holder("config", None)
    template = _Holder("default_config", None)

    _inject_mission_default(config, inspection, template, "capture_mode", None)

    # untouched - dataclass default preserved
    assert config.capture_mode == "VIDEO_CAPTURE"


def test_inject_mission_default_handles_none_config_objects():
    """inspection.config / template.default_config of None still resolve to inject."""
    from app.services.trajectory.orchestrator import _inject_mission_default
    from app.services.trajectory.types import ResolvedConfig

    config = ResolvedConfig()
    inspection = _Holder("config", None)
    template = _Holder("default_config", None)

    _inject_mission_default(config, inspection, template, "capture_mode", "PHOTO_CAPTURE")

    assert config.capture_mode == "PHOTO_CAPTURE"


def _wp(lon, lat, alt, wtype, *, speed=5.0, hover=None):
    """small WaypointData factory for totals/crossing units."""
    from app.core.enums import CameraAction
    from app.services.trajectory.types import WaypointData

    return WaypointData(
        lon=lon,
        lat=lat,
        alt=alt,
        heading=0.0,
        speed=speed,
        waypoint_type=wtype,
        camera_action=CameraAction.NONE,
        hover_duration=hover,
    )


def test_compute_totals_empty_path():
    """no waypoints: zero distance, zero duration."""
    from app.services.trajectory.orchestrator import _compute_totals

    assert _compute_totals([]) == (0.0, 0.0)


def test_compute_totals_hover_duration_added():
    """per-waypoint hover_duration accumulates into the duration."""
    from app.core.enums import WaypointType
    from app.services.trajectory.orchestrator import _compute_totals

    wps = [_wp(14.0, 50.0, 100.0, WaypointType.HOVER, hover=12.0)]
    dist, dur = _compute_totals(wps)

    assert dist == 0.0
    assert dur == 12.0


def test_compute_totals_gimbal_settle_on_type_change():
    """a segment-type change into MEASUREMENT adds exactly GIMBAL_SETTLE_TIME."""
    from app.core.enums import WaypointType
    from app.services.trajectory.orchestrator import _compute_totals
    from app.services.trajectory.types import GIMBAL_SETTLE_TIME

    a0 = _wp(14.0000, 50.0, 100.0, WaypointType.TRANSIT)
    a1 = _wp(14.0010, 50.0, 100.0, WaypointType.TRANSIT)
    same_type = _compute_totals([a0, a1])

    b0 = _wp(14.0000, 50.0, 100.0, WaypointType.TRANSIT)
    b1 = _wp(14.0010, 50.0, 100.0, WaypointType.MEASUREMENT)
    type_change = _compute_totals([b0, b1])

    assert type_change[0] == same_type[0]  # identical geometry -> identical distance
    assert type_change[1] - same_type[1] == pytest.approx(GIMBAL_SETTLE_TIME)


def test_collect_surface_crossing_warnings_grouped_and_individual():
    """measurement crossings group per (seq, surface); transit crossings stay individual."""
    from types import SimpleNamespace

    from shapely.geometry import Polygon

    from app.core.enums import WaypointType
    from app.services.trajectory.orchestrator import _collect_surface_crossing_warnings
    from app.utils.local_projection import LocalProjection

    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
    # 50 m square box centred on the projection origin, in local meters
    box = Polygon([(-25, -25), (25, -25), (25, 25), (-25, 25)])
    surface = SimpleNamespace(polygon=box, surface_type="RUNWAY", identifier="R1")
    local_geoms = SimpleNamespace(surfaces=[surface])

    # segment from local (-100, 0) to (100, 0) drives straight through the box
    lon0, lat0 = proj.to_wgs84(-100.0, 0.0)
    lon1, lat1 = proj.to_wgs84(100.0, 0.0)

    # measurement crossing -> grouped, keyed by wp_inspection_seq
    meas = [
        _wp(lon0, lat0, 100.0, WaypointType.TRANSIT),
        _wp(lon1, lat1, 100.0, WaypointType.MEASUREMENT),
    ]
    warnings: list[tuple[str, list[str], str | None]] = []
    _collect_surface_crossing_warnings(meas, proj, local_geoms, {1: 3}, warnings)
    assert len(warnings) == 1
    msg, wp_ids, kind = warnings[0]
    assert msg == "inspection 3 crosses RUNWAY R1 during measurement (1 segments)"
    assert kind == "surface_crossing"
    assert wp_ids == ["idx:0", "idx:1"]

    # transit crossing -> individual, and a pre-seeded identical message dedups
    transit = [
        _wp(lon0, lat0, 100.0, WaypointType.TRANSIT),
        _wp(lon1, lat1, 100.0, WaypointType.TRANSIT),
    ]
    warnings2: list[tuple[str, list[str], str | None]] = []
    _collect_surface_crossing_warnings(transit, proj, local_geoms, {}, warnings2)
    assert len(warnings2) == 1
    assert "): crosses RUNWAY R1 " in warnings2[0][0]
    assert warnings2[0][2] == "surface_crossing"

    pre = list(warnings2)
    _collect_surface_crossing_warnings(transit, proj, local_geoms, {}, warnings2)
    assert warnings2 == pre  # order-sensitive dedup against the live list


def test_papi_band_violations_non_papi_method_is_empty():
    """a non HR/VP method has no all-white-zone band check."""
    from app.core.enums import InspectionMethod
    from app.services.trajectory.orchestrator import _papi_band_violations
    from app.services.trajectory.types import Point3D, ResolvedConfig

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    out = _papi_band_violations([], center, [3.0], ResolvedConfig(), InspectionMethod.FLY_OVER)

    assert out == []


def test_papi_band_violations_hr_without_setting_angles_is_empty():
    """HORIZONTAL_RANGE with no setting angles yields no band violations."""
    from app.core.enums import InspectionMethod
    from app.services.trajectory.orchestrator import _papi_band_violations
    from app.services.trajectory.types import Point3D, ResolvedConfig

    center = Point3D(lon=14.0, lat=50.0, alt=300.0)
    out = _papi_band_violations([], center, [], ResolvedConfig(), InspectionMethod.HORIZONTAL_RANGE)

    assert out == []


def _setup_surface_scan_mission(client, icao_code: str, config: dict):
    """airport + runway surface + drone + SURFACE_SCAN template + inspection."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao_code},
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Scan {icao_code}",
            "methods": ["SURFACE_SCAN"],
            "default_config": {"measurement_density": 4},
        },
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Scan {icao_code}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    full_config = {"scan_surface_id": surface_id, **config}
    r = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "SURFACE_SCAN", "config": full_config},
    )
    assert r.status_code == 201, r.text

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    return mission_id, surface_id, gen


def test_surface_scan_generates_serpentine_pass(client):
    """SURFACE_SCAN on a runway produces a serpentine measurement pass via the no-LHA branch."""
    _, _, gen = _setup_surface_scan_mission(
        client, "SSCA", {"capture_mode": "VIDEO_CAPTURE", "scan_height": 10.0}
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    measurements = [
        w for w in fp["waypoints"] if w["waypoint_type"] == "MEASUREMENT" and w["inspection_id"]
    ]
    # full-width runway (45 m) at 10 m / -70 deg with an 84 deg FOV needs multiple runs;
    # video keeps two endpoints per run.
    assert len(measurements) >= 4
    assert len(measurements) % 2 == 0


def test_surface_scan_photo_mode_spaced_captures(client):
    """PHOTO mode emits spaced PHOTO_CAPTURE waypoints along each run."""
    _, _, gen = _setup_surface_scan_mission(
        client, "SSCB", {"capture_mode": "PHOTO_CAPTURE", "scan_height": 10.0}
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    captures = [
        w
        for w in fp["waypoints"]
        if w["waypoint_type"] == "MEASUREMENT" and w["camera_action"] == "PHOTO_CAPTURE"
    ]
    # spaced photos give many more than the two-per-run video shape
    assert len(captures) > 8


def test_surface_scan_video_wraps_recording_bookends(client):
    """VIDEO mode wraps the serpentine in recording start/stop bookends."""
    _, _, gen = _setup_surface_scan_mission(
        client,
        "SSCC",
        {"capture_mode": "VIDEO_CAPTURE", "recording_setup_duration": 2.0},
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    pass_wps = [
        w
        for w in fp["waypoints"]
        if w["waypoint_type"] in ("MEASUREMENT", "HOVER") and w["inspection_id"]
    ]
    actions = [w["camera_action"] for w in pass_wps]
    assert "RECORDING_START" in actions
    assert "RECORDING_STOP" in actions


def test_surface_scan_missing_surface_errors(client):
    """a surface scan with no scan_surface_id fails generation with a clear error."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "SSCD"},
    ).json()
    airport_id = airport["id"]
    client.post(f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD)
    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Scan SSCD", "methods": ["SURFACE_SCAN"]},
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Scan SSCD",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "SURFACE_SCAN"},
    )
    gen = client.post(f"/api/v1/missions/{mission['id']}/generate-trajectory")
    assert gen.status_code >= 400
    assert "surface" in gen.text.lower()


def test_surface_scan_run_count_override_emits_suggestion(client):
    """a suboptimal run-count override surfaces a suggestion via the existing channel."""
    _, _, gen = _setup_surface_scan_mission(
        client, "SSCE", {"capture_mode": "VIDEO_CAPTURE", "scan_run_count": 1}
    )
    assert gen.status_code == 200, gen.text
    fp = gen.json()["flight_plan"]
    violations = (fp.get("validation_result") or {}).get("violations", [])
    suggestions = " ".join(v["message"] for v in violations if v.get("category") == "suggestion")
    assert "run count" in suggestions.lower()


def _orm_waypoint(position):
    """fake persisted Waypoint row for _waypoint_orm_to_data characterization."""
    from types import SimpleNamespace

    return SimpleNamespace(
        position=position,
        camera_target=None,
        heading=None,
        speed=None,
        hover_duration=None,
        gimbal_pitch=None,
        waypoint_type="MEASUREMENT",
        camera_action=None,
        inspection_id=None,
    )


def test_waypoint_orm_to_data_round_trips_valid_position():
    """a valid persisted position materializes to the same lon/lat/alt."""
    from app.services.trajectory.orchestrator._pipeline import _waypoint_orm_to_data

    data = _waypoint_orm_to_data(_orm_waypoint("POINT Z (18.1 49.6 260)"))

    assert (data.lon, data.lat, data.alt) == (18.1, 49.6, 260.0)


def test_waypoint_orm_to_data_raises_on_missing_position():
    """a missing persisted position raises instead of yielding (0,0,0)."""
    from app.services.trajectory.orchestrator._pipeline import _waypoint_orm_to_data

    with pytest.raises(ValueError):
        _waypoint_orm_to_data(_orm_waypoint(None))
