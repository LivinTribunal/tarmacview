"""tests for flight-plan generation, persistence, waypoint batch update, transit edits."""

from uuid import uuid4

import pytest

from app.core.exceptions import DomainError, NotFoundError
from tests.data.missions import MISSION_AIRPORT_PAYLOAD

DRONE_PROFILE_PAYLOAD = {
    "name": "FP Test Drone",
    "manufacturer": "DJI",
    "model": "Matrice 300",
    "max_speed": 23.0,
    "max_climb_rate": 6.0,
    "max_altitude": 500.0,
    "battery_capacity": 5935.0,
    "endurance_minutes": 55.0,
    "camera_resolution": "20MP",
    "camera_frame_rate": 30,
    "sensor_fov": 84.0,
    "weight": 6.3,
}


@pytest.fixture(scope="module")
def fp_airport_id(client):
    """create a test airport for flight plan tests."""
    payload = {**MISSION_AIRPORT_PAYLOAD, "icao_code": "LKFP"}
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


@pytest.fixture(scope="module")
def fp_drone_id(client):
    """create a test drone profile."""
    r = client.post("/api/v1/drone-profiles", json=DRONE_PROFILE_PAYLOAD)
    return r.json()["id"]


@pytest.fixture(scope="module")
def fp_mission_id(client, fp_airport_id, fp_drone_id):
    """create a mission for flight plan tests."""
    r = client.post(
        "/api/v1/missions",
        json={
            "name": "FP Test Mission",
            "airport_id": fp_airport_id,
            "drone_profile_id": fp_drone_id,
            "takeoff_coordinate": {
                "type": "Point",
                "coordinates": [18.11, 49.69, 260.0],
            },
            "landing_coordinate": {
                "type": "Point",
                "coordinates": [18.12, 49.69, 260.0],
            },
        },
    )
    return r.json()["id"]


def test_generate_trajectory_without_coordinates(client, fp_airport_id):
    """generate trajectory returns 400 when takeoff/landing coordinates are missing."""
    r = client.post(
        "/api/v1/missions",
        json={"name": "No Coords Mission", "airport_id": fp_airport_id},
    )
    mission_id = r.json()["id"]

    r = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r.status_code == 400
    assert "Takeoff/landing coordinates must be set" in r.json()["detail"]


def test_generate_trajectory_without_landing_coordinate(client, fp_airport_id):
    """generate trajectory returns 400 when only takeoff is set."""
    r = client.post(
        "/api/v1/missions",
        json={
            "name": "No Landing Mission",
            "airport_id": fp_airport_id,
            "takeoff_coordinate": {"type": "Point", "coordinates": [18.11, 49.69, 260.0]},
        },
    )
    mission_id = r.json()["id"]

    r = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r.status_code == 400
    assert "Takeoff/landing coordinates must be set" in r.json()["detail"]


def test_batch_update_no_flight_plan(client, fp_mission_id):
    """batch update returns 404 when no flight plan exists."""
    r = client.put(
        f"/api/v1/missions/{fp_mission_id}/flight-plan/waypoints",
        json={"updates": []},
    )
    assert r.status_code == 404


def test_batch_update_mission_not_found(client):
    """batch update returns 404 for non-existent mission."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = client.put(
        f"/api/v1/missions/{fake_id}/flight-plan/waypoints",
        json={"updates": []},
    )
    assert r.status_code == 404


def test_batch_update_invalid_waypoint(client, fp_mission_id):
    """batch update returns 404 for non-existent waypoint id."""
    # generate trajectory first so we have a flight plan
    gen_r = client.post(f"/api/v1/missions/{fp_mission_id}/generate-trajectory")
    if gen_r.status_code != 200:
        pytest.skip("trajectory generation not available without inspections")

    fake_wp_id = "00000000-0000-0000-0000-000000000001"
    r = client.put(
        f"/api/v1/missions/{fp_mission_id}/flight-plan/waypoints",
        json={
            "updates": [
                {
                    "waypoint_id": fake_wp_id,
                    "position": {
                        "type": "Point",
                        "coordinates": [18.11, 49.69, 265.0],
                    },
                }
            ]
        },
    )
    assert r.status_code == 404


# persist_flight_plan integration tests


def test_persist_creates_all_category_types(db_session, fp_airport_id):
    """persist_flight_plan stores warnings, violations, and suggestions with correct categories."""
    from app.models.flight_plan import ValidationViolation
    from app.models.mission import Mission
    from app.services.flight_plan_service import persist_flight_plan

    mission = Mission(
        id=uuid4(),
        name="persist category test",
        airport_id=fp_airport_id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = persist_flight_plan(
        db_session,
        mission,
        all_waypoints=[],
        warnings=[("speed too high", [], "speed")],
        total_distance=100.0,
        estimated_duration=60.0,
        violations=[("altitude exceeded", [], "altitude")],
        suggestions=[("no density override", [], None)],
    )

    violations = (
        db_session.query(ValidationViolation)
        .filter(ValidationViolation.validation_result_id == fp.validation_result.id)
        .all()
    )

    cats = {v.category for v in violations}
    assert cats == {"warning", "violation", "suggestion"}

    warning = next(v for v in violations if v.category == "warning")
    assert warning.message == "speed too high"
    assert warning.violation_kind == "speed"

    violation = next(v for v in violations if v.category == "violation")
    assert violation.message == "altitude exceeded"
    assert violation.violation_kind == "altitude"

    suggestion = next(v for v in violations if v.category == "suggestion")
    assert suggestion.message == "no density override"
    # kind=None persisted; schema classifies from message on read
    assert suggestion.violation_kind is None

    assert fp.validation_result.passed is False

    db_session.rollback()


def test_persist_passed_true_without_violations(db_session, fp_airport_id):
    """persist_flight_plan sets passed=True when no violations are provided."""
    from app.models.mission import Mission
    from app.services.flight_plan_service import persist_flight_plan

    mission = Mission(
        id=uuid4(),
        name="persist no violations test",
        airport_id=fp_airport_id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = persist_flight_plan(
        db_session,
        mission,
        all_waypoints=[],
        warnings=[("minor warning", [], None)],
        total_distance=50.0,
        estimated_duration=30.0,
    )

    assert fp.validation_result.passed is True

    db_session.rollback()


def test_violation_response_null_waypoint_ids(db_session, fp_airport_id):
    """validation violation with NULL waypoint_ids serializes without error."""
    from app.models.flight_plan import ValidationViolation
    from app.models.mission import Mission
    from app.schemas.flight_plan import ValidationViolationResponse
    from app.services.flight_plan_service import persist_flight_plan

    mission = Mission(
        id=uuid4(),
        name="null waypoint_ids test",
        airport_id=fp_airport_id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = persist_flight_plan(
        db_session,
        mission,
        all_waypoints=[],
        warnings=[("speed too high", [], "speed")],
        total_distance=100.0,
        estimated_duration=60.0,
    )

    # simulate a pre-migration row with NULL waypoint_ids
    violation = (
        db_session.query(ValidationViolation)
        .filter(ValidationViolation.validation_result_id == fp.validation_result.id)
        .first()
    )
    violation.waypoint_ids = None
    db_session.flush()

    # this would raise ValidationError before the fix
    resp = ValidationViolationResponse.model_validate(violation)
    assert resp.waypoint_ids == []

    db_session.rollback()


def test_persist_writes_surface_crossing_kind_both_formats(db_session, fp_airport_id):
    """persist stores violation_kind from the tuple for both crossing message shapes."""
    from app.models.flight_plan import ValidationViolation
    from app.models.mission import Mission
    from app.schemas.flight_plan import ValidationViolationResponse
    from app.services.flight_plan_service import persist_flight_plan

    mission = Mission(
        id=uuid4(),
        name="surface crossing persist test",
        airport_id=fp_airport_id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    transit_msg = "wp 24-25 (WaypointType.TRANSIT): crosses RUNWAY 1 (1m)"
    grouped_msg = "inspection 2 crosses TAXIWAY A during measurement (3 segments)"
    fp = persist_flight_plan(
        db_session,
        mission,
        all_waypoints=[],
        warnings=[
            (transit_msg, [], "surface_crossing"),
            (grouped_msg, [], "surface_crossing"),
        ],
        total_distance=100.0,
        estimated_duration=60.0,
    )

    rows = (
        db_session.query(ValidationViolation)
        .filter(ValidationViolation.validation_result_id == fp.validation_result.id)
        .all()
    )
    assert {r.message for r in rows} == {transit_msg, grouped_msg}
    for r in rows:
        assert r.violation_kind == "surface_crossing"
        resp = ValidationViolationResponse.model_validate(r)
        assert resp.violation_kind == "surface_crossing"
        assert resp.constraint_name == "Surface Crossing"

    db_session.rollback()


def test_legacy_null_kind_classified_from_message(db_session, fp_airport_id):
    """a row persisted with kind=None still classifies via the schema fallback."""
    from app.models.flight_plan import ValidationViolation
    from app.models.mission import Mission
    from app.schemas.flight_plan import ValidationViolationResponse
    from app.services.flight_plan_service import persist_flight_plan

    mission = Mission(
        id=uuid4(),
        name="legacy kind test",
        airport_id=fp_airport_id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = persist_flight_plan(
        db_session,
        mission,
        all_waypoints=[],
        warnings=[("wp 3-4 (TRANSIT): crosses RUNWAY 09L (5m)", [], None)],
        total_distance=10.0,
        estimated_duration=5.0,
    )

    row = (
        db_session.query(ValidationViolation)
        .filter(ValidationViolation.validation_result_id == fp.validation_result.id)
        .first()
    )
    assert row.violation_kind is None
    resp = ValidationViolationResponse.model_validate(row)
    assert resp.violation_kind == "surface_crossing"

    db_session.rollback()


# batch_update_waypoints service tests


def _create_mission_with_waypoints(db_session, airport_id, status="DRAFT", waypoint_types=None):
    """helper to create a mission with a flight plan and waypoints."""
    from app.models.flight_plan import FlightPlan, ValidationResult, Waypoint
    from app.models.mission import Mission
    from app.services.geometry_converter import geojson_to_wkt

    mission = Mission(
        id=uuid4(),
        name="batch test mission",
        airport_id=airport_id,
        status=status,
        takeoff_coordinate=geojson_to_wkt({"type": "Point", "coordinates": [18.11, 49.69, 260.0]}),
        landing_coordinate=geojson_to_wkt({"type": "Point", "coordinates": [18.12, 49.69, 260.0]}),
    )
    db_session.add(mission)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport_id)
    fp.compile(100.0, 60.0)
    db_session.add(fp)
    db_session.flush()

    val_result = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(val_result)
    db_session.flush()

    if waypoint_types is None:
        waypoint_types = ["TAKEOFF", "TRANSIT", "MEASUREMENT", "TRANSIT", "LANDING"]

    waypoints = []
    for i, wtype in enumerate(waypoint_types, start=1):
        wp = Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=i,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.11 + i * 0.001, 49.69, 260.0 + i]}
            ),
            waypoint_type=wtype,
        )
        db_session.add(wp)
        waypoints.append(wp)

    db_session.flush()
    return mission, fp, waypoints


def test_batch_update_moves_waypoint(db_session, fp_airport_id):
    """batch_update_waypoints updates waypoint position."""

    from app.models.flight_plan import Waypoint
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, waypoints = _create_mission_with_waypoints(db_session, fp_airport_id)
    transit_wp = waypoints[1]

    new_pos = PointZ(type="Point", coordinates=[18.115, 49.695, 270.0])
    updates = [WaypointPositionUpdate(waypoint_id=transit_wp.id, position=new_pos)]

    batch_update_waypoints(db_session, mission.id, updates)

    wkt = db_session.query(Waypoint.position).filter(Waypoint.id == transit_wp.id).scalar()
    assert "18.115" in wkt
    assert "49.695" in wkt

    db_session.rollback()


def test_batch_update_waypoint_ownership(db_session, fp_airport_id):
    """batch_update_waypoints rejects waypoints from another flight plan."""
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission1, fp1, wps1 = _create_mission_with_waypoints(db_session, fp_airport_id)
    mission2, fp2, wps2 = _create_mission_with_waypoints(db_session, fp_airport_id)

    # try to update mission1 using a waypoint from mission2
    updates = [
        WaypointPositionUpdate(
            waypoint_id=wps2[0].id,
            position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        )
    ]

    with pytest.raises(NotFoundError, match="waypoint.*not found"):
        batch_update_waypoints(db_session, mission1.id, updates)

    db_session.rollback()


def test_batch_update_status_gate(db_session, fp_airport_id):
    """batch_update_waypoints rejects updates when mission is in EXPORTED status."""
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id, status="EXPORTED")

    updates = [
        WaypointPositionUpdate(
            waypoint_id=wps[1].id,
            position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        )
    ]

    with pytest.raises(DomainError, match="cannot modify waypoints"):
        batch_update_waypoints(db_session, mission.id, updates)

    db_session.rollback()


def test_batch_update_takeoff_syncs_mission_coordinate(db_session, fp_airport_id):
    """moving a takeoff waypoint updates mission.takeoff_coordinate."""
    from app.models.mission import Mission
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)
    takeoff_wp = wps[0]

    new_pos = PointZ(type="Point", coordinates=[18.15, 49.70, 265.0])
    updates = [WaypointPositionUpdate(waypoint_id=takeoff_wp.id, position=new_pos)]
    batch_update_waypoints(db_session, mission.id, updates)

    wkt = db_session.query(Mission.takeoff_coordinate).filter(Mission.id == mission.id).scalar()
    assert "18.15" in wkt
    assert "49.7" in wkt

    db_session.rollback()


def test_batch_update_landing_syncs_mission_coordinate(db_session, fp_airport_id):
    """moving a landing waypoint updates mission.landing_coordinate."""
    from app.models.mission import Mission
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)
    landing_wp = wps[4]

    new_pos = PointZ(type="Point", coordinates=[18.13, 49.71, 262.0])
    updates = [WaypointPositionUpdate(waypoint_id=landing_wp.id, position=new_pos)]
    batch_update_waypoints(db_session, mission.id, updates)

    wkt = db_session.query(Mission.landing_coordinate).filter(Mission.id == mission.id).scalar()
    assert "18.13" in wkt
    assert "49.71" in wkt

    db_session.rollback()


def test_batch_update_takeoff_passes_through_user_supplied_alt(db_session, fp_airport_id):
    """batch_update_waypoints is server pass-through for takeoff alt.

    The server does not resample ground at the rerouted (lon, lat). Callers
    that want ground-sampled altitudes resolve them upfront via the
    `GET /airports/{id}/elevation` endpoint (this is what `computePlacementUpdates`
    does for PLACE_TAKEOFF / PLACE_LANDING clicks). The DRAG-existing
    handler is expected to do the same when ground-correctness matters."""
    from app.core.geometry import wkt_to_geojson
    from app.models.mission import Mission
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)
    takeoff_wp = wps[0]

    # caller-supplied alt of 555 is preserved verbatim on both rows.
    new_pos = PointZ(type="Point", coordinates=[18.151, 49.701, 555.0])
    updates = [WaypointPositionUpdate(waypoint_id=takeoff_wp.id, position=new_pos)]
    batch_update_waypoints(db_session, mission.id, updates)

    mission_wkt = (
        db_session.query(Mission.takeoff_coordinate).filter(Mission.id == mission.id).scalar()
    )
    mission_coords = wkt_to_geojson(mission_wkt)["coordinates"]
    assert abs(mission_coords[0] - 18.151) < 1e-6
    assert abs(mission_coords[1] - 49.701) < 1e-6
    assert abs(mission_coords[2] - 555.0) < 0.01

    wp_coords = wkt_to_geojson(takeoff_wp.position)["coordinates"]
    assert abs(wp_coords[2] - 555.0) < 0.01

    db_session.rollback()


def test_batch_update_regresses_validated_to_planned(db_session, fp_airport_id):
    """batch_update_waypoints regresses VALIDATED mission to PLANNED."""
    from app.core.enums import MissionStatus
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id, status="VALIDATED")

    updates = [
        WaypointPositionUpdate(
            waypoint_id=wps[1].id,
            position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        )
    ]
    batch_update_waypoints(db_session, mission.id, updates)

    assert mission.status == MissionStatus.PLANNED

    db_session.rollback()


def test_batch_update_too_large(db_session, fp_airport_id):
    """batch_update_waypoints rejects batches over 200 entries."""
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)

    updates = [
        WaypointPositionUpdate(
            waypoint_id=wps[0].id,
            position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        )
    ] * 201

    with pytest.raises(DomainError, match="batch too large"):
        batch_update_waypoints(db_session, mission.id, updates)

    db_session.rollback()


# insert_transit_waypoint service tests


def test_insert_transit_waypoint_sequence(db_session, fp_airport_id):
    """insert_transit_waypoint inserts at correct position and resequences."""
    from app.models.flight_plan import Waypoint
    from app.schemas.flight_plan import TransitWaypointInsertRequest
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import insert_transit_waypoint

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)

    request = TransitWaypointInsertRequest(
        position=PointZ(type="Point", coordinates=[18.116, 49.692, 268.0]),
        after_sequence=2,
    )
    insert_transit_waypoint(db_session, mission.id, request)

    ordered = (
        db_session.query(Waypoint)
        .filter(Waypoint.flight_plan_id == fp.id)
        .order_by(Waypoint.sequence_order)
        .all()
    )

    assert len(ordered) == 6
    assert ordered[2].sequence_order == 3
    assert ordered[2].waypoint_type == "TRANSIT"
    # original waypoints after insertion point shifted by 1
    assert ordered[3].sequence_order == 4

    db_session.rollback()


def test_insert_transit_status_gate(db_session, fp_airport_id):
    """insert_transit_waypoint rejects when mission is COMPLETED."""
    from app.schemas.flight_plan import TransitWaypointInsertRequest
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import insert_transit_waypoint

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id, status="COMPLETED")

    request = TransitWaypointInsertRequest(
        position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        after_sequence=1,
    )

    with pytest.raises(DomainError, match="cannot modify waypoints"):
        insert_transit_waypoint(db_session, mission.id, request)

    db_session.rollback()


def test_insert_transit_regresses_validated(db_session, fp_airport_id):
    """insert_transit_waypoint regresses VALIDATED to PLANNED."""
    from app.core.enums import MissionStatus
    from app.schemas.flight_plan import TransitWaypointInsertRequest
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import insert_transit_waypoint

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id, status="VALIDATED")

    request = TransitWaypointInsertRequest(
        position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        after_sequence=1,
    )
    insert_transit_waypoint(db_session, mission.id, request)

    assert mission.status == MissionStatus.PLANNED

    db_session.rollback()


def test_insert_transit_no_flight_plan(db_session, fp_airport_id):
    """insert_transit_waypoint returns 404 when no flight plan exists."""
    from app.models.mission import Mission
    from app.schemas.flight_plan import TransitWaypointInsertRequest
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import insert_transit_waypoint

    mission = Mission(id=uuid4(), name="no fp mission", airport_id=fp_airport_id, status="DRAFT")
    db_session.add(mission)
    db_session.flush()

    request = TransitWaypointInsertRequest(
        position=PointZ(type="Point", coordinates=[18.0, 49.0, 260.0]),
        after_sequence=1,
    )

    with pytest.raises(NotFoundError, match="flight plan not found"):
        insert_transit_waypoint(db_session, mission.id, request)

    db_session.rollback()


# delete_transit_waypoint service tests


def test_delete_transit_waypoint_resequences(db_session, fp_airport_id):
    """delete_transit_waypoint removes waypoint and resequences."""
    from app.models.flight_plan import Waypoint
    from app.services.flight_plan_service import delete_transit_waypoint

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)
    transit_wp = wps[1]  # TRANSIT at sequence 2

    delete_transit_waypoint(db_session, mission.id, transit_wp.id)

    ordered = (
        db_session.query(Waypoint)
        .filter(Waypoint.flight_plan_id == fp.id)
        .order_by(Waypoint.sequence_order)
        .all()
    )

    assert len(ordered) == 4
    sequences = [w.sequence_order for w in ordered]
    assert sequences == [1, 2, 3, 4]

    db_session.rollback()


def test_delete_non_transit_waypoint_rejected(db_session, fp_airport_id):
    """delete_transit_waypoint rejects non-transit waypoints."""
    from app.services.flight_plan_service import delete_transit_waypoint

    mission, fp, wps = _create_mission_with_waypoints(db_session, fp_airport_id)
    takeoff_wp = wps[0]  # TAKEOFF

    with pytest.raises(DomainError, match="only transit waypoints"):
        delete_transit_waypoint(db_session, mission.id, takeoff_wp.id)

    db_session.rollback()


# revalidate endpoint integration tests


def _setup_full_trajectory_mission(client, icao: str) -> str:
    """build airport, surface, agl, lhas, template, drone, mission with one inspection."""
    from tests.data.trajectory import (
        DEFAULT_LANDING,
        DEFAULT_TAKEOFF,
        TRAJECTORY_AGL_PAYLOAD,
        TRAJECTORY_AIRPORT_PAYLOAD,
        TRAJECTORY_DRONE_PAYLOAD,
        TRAJECTORY_SURFACE_PAYLOAD,
        make_lha_payload,
    )

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

    for i in range(1, 4):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Reval Template {icao}",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": 3},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Reval Mission {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "transit_agl": 10.0,
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


def test_revalidate_409_when_no_flight_plan(client, fp_airport_id):
    """revalidate returns 409 when mission has no flight plan."""
    r = client.post(
        "/api/v1/missions",
        json={"name": "No FP Reval", "airport_id": fp_airport_id},
    )
    mission_id = r.json()["id"]

    resp = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert resp.status_code == 409
    assert "flight plan" in resp.json()["detail"].lower()


def test_revalidate_404_when_mission_not_found(client):
    """revalidate returns 404 for non-existent mission."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    resp = client.post(f"/api/v1/missions/{fake_id}/revalidate")
    assert resp.status_code == 404


def test_revalidate_preserves_waypoint_uuids_and_positions(client):
    """revalidate keeps waypoint UUIDs and lon/lat byte-identical."""
    mission_id = _setup_full_trajectory_mission(client, "ZFRA")
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    before = client.get(f"/api/v1/missions/{mission_id}/flight-plan").json()
    before_pairs = [(wp["id"], tuple(wp["position"]["coordinates"])) for wp in before["waypoints"]]

    resp = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert resp.status_code == 200
    after = resp.json()
    after_pairs = [(wp["id"], tuple(wp["position"]["coordinates"])) for wp in after["waypoints"]]

    assert before_pairs == after_pairs


def test_revalidate_replaces_old_validation_row(client, db_session):
    """calling revalidate twice keeps a single ValidationResult row."""
    from app.models.flight_plan import FlightPlan, ValidationResult

    mission_id = _setup_full_trajectory_mission(client, "ZFRB")
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    r1 = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert r1.status_code == 200
    r2 = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert r2.status_code == 200

    fp = db_session.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
    count = (
        db_session.query(ValidationResult).filter(ValidationResult.flight_plan_id == fp.id).count()
    )
    assert count == 1


def test_revalidate_clears_hard_violation_after_obstacle_removed(client):
    """obstacle added post-gen -> delete -> revalidate clean + waypoints intact."""
    mission_id = _setup_full_trajectory_mission(client, "ZFRE")
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    airport_id = mission["airport_id"]

    before = client.get(f"/api/v1/missions/{mission_id}/flight-plan").json()
    snapshot = [(wp["id"], tuple(wp["position"]["coordinates"])) for wp in before["waypoints"]]

    # tall, wide obstacle covering the HORIZONTAL_RANGE arc (~350 m NE of the LHA centroid)
    # so it overlaps measurement waypoints generated by the existing trajectory.
    obs = client.post(
        f"/api/v1/airports/{airport_id}/obstacles",
        json={
            "name": "Reval Blocker",
            "type": "BUILDING",
            "height": 1000.0,
            "buffer_distance": 50.0,
            "boundary": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [14.276, 50.098, 300],
                        [14.281, 50.098, 300],
                        [14.281, 50.101, 300],
                        [14.276, 50.101, 300],
                        [14.276, 50.098, 300],
                    ]
                ],
            },
        },
    )
    assert obs.status_code in (200, 201), obs.json()
    obstacle_id = obs.json()["id"]

    blocked = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert blocked.status_code == 200
    blocked_violations = blocked.json()["validation_result"]["violations"]
    hard_blocked = [v for v in blocked_violations if v["category"] == "violation"]
    assert hard_blocked, "expected at least one hard violation while obstacle present"

    delete_resp = client.delete(f"/api/v1/airports/{airport_id}/obstacles/{obstacle_id}")
    assert delete_resp.status_code == 200

    cleared = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert cleared.status_code == 200
    body = cleared.json()
    cleared_hard = [
        v for v in body["validation_result"]["violations"] if v["category"] == "violation"
    ]
    assert cleared_hard == []

    after_snapshot = [(wp["id"], tuple(wp["position"]["coordinates"])) for wp in body["waypoints"]]
    assert after_snapshot == snapshot


def test_revalidate_runs_battery_check(client):
    """revalidate produces a battery suggestion when drone endurance is unknown."""
    from tests.data.trajectory import (
        DEFAULT_LANDING,
        DEFAULT_TAKEOFF,
        TRAJECTORY_AGL_PAYLOAD,
        TRAJECTORY_AIRPORT_PAYLOAD,
        TRAJECTORY_SURFACE_PAYLOAD,
        make_lha_payload,
    )

    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "ZFRC"},
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

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "Reval Template ZRV3",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": 3},
        },
    ).json()

    # drone with no endurance metadata - should trigger soft battery suggestion
    drone = client.post(
        "/api/v1/drone-profiles",
        json={
            "name": "No Endurance",
            "max_speed": 23.0,
            "max_altitude": 500.0,
            "camera_frame_rate": 30,
            "sensor_fov": 84.0,
        },
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Reval Mission ZRV3",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "transit_agl": 10.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]
    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    resp = client.post(f"/api/v1/missions/{mission_id}/revalidate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["validation_result"] is not None
    messages = [v["message"] for v in body["validation_result"]["violations"]]
    assert any("endurance unknown" in m for m in messages)


def test_revalidate_requires_auth(client, db_engine):
    """revalidate honors auth like generate-trajectory."""
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from app.api.dependencies import get_current_user
    from app.core.database import get_db
    from app.main import app

    mission_id = _setup_full_trajectory_mission(client, "ZFRD")
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200

    # remove auth override to exercise the unauthenticated path
    saved_overrides = dict(app.dependency_overrides)
    TestSession = sessionmaker(bind=db_engine)

    def _override_db():
        """test db override that yields a fresh session."""
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    try:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides[get_db] = _override_db
        unauth_client = TestClient(app)
        resp = unauth_client.post(f"/api/v1/missions/{mission_id}/revalidate")
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved_overrides)
