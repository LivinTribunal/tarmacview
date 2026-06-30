"""tests for mission CRUD, duplication, inspections, transit AGL, trajectory-affecting updates."""

from uuid import uuid4

import pytest

from tests.data.missions import (
    INVALID_AIRPORT_ID,
    MISSION_AIRPORT_PAYLOAD,
    MISSION_TEMPLATE_PAYLOAD,
    MISSION_UPDATE_PAYLOAD,
)


@pytest.fixture(scope="module")
def airport_id(client):
    """create a test airport for mission tests"""
    r = client.post("/api/v1/airports", json=MISSION_AIRPORT_PAYLOAD)

    return r.json()["id"]


# Tests
def test_create_mission(client, airport_id):
    """test create mission"""
    response = client.post(
        "/api/v1/missions", json={"name": "Test Mission", "airport_id": airport_id}
    )
    assert response.status_code == 201
    data = response.json()

    assert data["name"] == "Test Mission"
    assert data["status"] == "DRAFT"
    assert data["airport_id"] == airport_id


def test_create_mission_invalid_airport(client):
    """test create mission with invalid airport id"""
    response = client.post(
        "/api/v1/missions",
        json={"name": "Bad Mission", "airport_id": INVALID_AIRPORT_ID},
    )
    assert response.status_code == 400


def test_list_missions(client):
    """test list missions"""
    response = client.get("/api/v1/missions")
    assert response.status_code == 200
    body = response.json()

    assert body["meta"]["total"] >= 1


def test_list_missions_with_status_filter(client):
    """test list missions filtered by status"""
    response = client.get("/api/v1/missions?status=DRAFT")
    assert response.status_code == 200
    body = response.json()

    assert all(m["status"] == "DRAFT" for m in body["data"])


def test_list_missions_with_airport_filter(client, airport_id):
    """test list missions filtered by airport"""
    response = client.get(f"/api/v1/missions?airport_id={airport_id}")
    assert response.status_code == 200
    body = response.json()

    assert body["meta"]["total"] >= 1
    assert all(m["airport_id"] == airport_id for m in body["data"])


def test_get_mission_detail(client):
    """test get mission with inspections"""
    missions = client.get("/api/v1/missions").json()["data"]
    mission_id = missions[0]["id"]

    response = client.get(f"/api/v1/missions/{mission_id}")
    assert response.status_code == 200
    data = response.json()

    assert "inspections" in data


def test_update_mission(client):
    """test update mission"""
    missions = client.get("/api/v1/missions").json()["data"]
    mission_id = missions[0]["id"]

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json=MISSION_UPDATE_PAYLOAD,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Mission"


def test_duplicate_mission(client):
    """test duplicate mission clones inspections"""
    missions = client.get("/api/v1/missions").json()["data"]
    mission_id = missions[0]["id"]

    original = client.get(f"/api/v1/missions/{mission_id}").json()

    response = client.post(f"/api/v1/missions/{mission_id}/duplicate")
    assert response.status_code == 201
    data = response.json()

    assert data["status"] == "DRAFT"
    assert "(copy)" in data["name"]

    duplicate_detail = client.get(f"/api/v1/missions/{data['id']}").json()
    assert len(duplicate_detail["inspections"]) == len(original["inspections"])


def test_duplicate_mission_preserves_lha_ids(client, airport_id):
    """duplicate mission preserves lha_ids from inspection configs."""
    from uuid import uuid4

    # create mission with inspection that has lha_ids in config
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "LHA Dup Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={"name": "LHA Dup Mission", "airport_id": airport_id},
    ).json()

    lha_id_1 = str(uuid4())
    lha_id_2 = str(uuid4())

    client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": template["id"],
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_ids": [lha_id_1, lha_id_2]},
        },
    )

    # duplicate
    dup = client.post(f"/api/v1/missions/{mission['id']}/duplicate")
    assert dup.status_code == 201

    dup_detail = client.get(f"/api/v1/missions/{dup.json()['id']}").json()
    assert len(dup_detail["inspections"]) == 1

    dup_config = dup_detail["inspections"][0].get("config")
    assert dup_config is not None
    assert dup_config["lha_ids"] == [lha_id_1, lha_id_2]


def test_delete_mission(client, airport_id):
    """test delete mission"""
    response = client.post("/api/v1/missions", json={"name": "To Delete", "airport_id": airport_id})
    mission_id = response.json()["id"]

    response = client.delete(f"/api/v1/missions/{mission_id}")
    assert response.status_code == 200

    response = client.get(f"/api/v1/missions/{mission_id}")
    assert response.status_code == 404


def test_add_inspection(client):
    """test add inspection to mission"""
    template = client.post(
        "/api/v1/inspection-templates",
        json=MISSION_TEMPLATE_PAYLOAD,
    ).json()

    missions = client.get("/api/v1/missions").json()["data"]
    mission_id = missions[0]["id"]

    response = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )
    assert response.status_code == 201
    assert response.json()["method"] == "HORIZONTAL_RANGE"


def test_list_missions_includes_inspection_count_and_duration(client):
    """test list response includes inspection_count and estimated_duration."""
    response = client.get("/api/v1/missions")
    assert response.status_code == 200
    body = response.json()

    for m in body["data"]:
        assert "inspection_count" in m
        assert "estimated_duration" in m
        assert isinstance(m["inspection_count"], int)


def test_delete_inspection(client):
    """test delete inspection from mission"""
    missions = client.get("/api/v1/missions").json()["data"]
    mission_id = missions[0]["id"]

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert len(detail["inspections"]) > 0, "precondition: mission must have inspections"
    insp_id = detail["inspections"][0]["id"]

    response = client.delete(f"/api/v1/missions/{mission_id}/inspections/{insp_id}")
    assert response.status_code == 200


def test_create_mission_accepts_valid_transit_agl(client, airport_id):
    """mission create persists transit_agl when above the 5m AGL floor."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Cruise Mission",
            "airport_id": airport_id,
            "transit_agl": 80.0,
        },
    )
    assert response.status_code == 201
    assert response.json()["transit_agl"] == 80.0


def test_create_mission_rejects_transit_agl_below_minimum(client, airport_id):
    """mission create with transit_agl < MIN_AGL returns 422."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Too Low",
            "airport_id": airport_id,
            "transit_agl": 3.0,
        },
    )
    assert response.status_code == 422


def test_create_mission_rejects_non_positive_transit_agl(client, airport_id):
    """mission create with transit_agl <= 0 returns 422 via schema Field(gt=0)."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Zero Cruise",
            "airport_id": airport_id,
            "transit_agl": 0,
        },
    )
    assert response.status_code == 422


def test_create_mission_rejects_transit_agl_above_drone_max(client, airport_id):
    """mission create with transit_agl above drone.max_altitude returns 422."""
    drone = client.post(
        "/api/v1/drone-profiles",
        json={
            "name": "Low Ceiling Drone",
            "max_speed": 20.0,
            "max_altitude": 100.0,
            "endurance_minutes": 40.0,
            "camera_frame_rate": 30,
            "sensor_fov": 84.0,
        },
    ).json()

    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Above Ceiling",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "transit_agl": 200.0,
        },
    )
    assert response.status_code == 422


def test_update_mission_transit_agl_invalidates_trajectory(client, airport_id, db_session):
    """updating transit_agl on a PLANNED mission regresses it to DRAFT."""
    from app.core.enums import MissionStatus
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Invalidate Cruise Test",
            "airport_id": airport_id,
            "transit_agl": 60.0,
        },
    ).json()
    mission_id = mission["id"]

    # flip status directly so we don't need a full inspection fixture
    db_mission = db_session.query(Mission).filter(Mission.id == mission_id).first()
    db_mission.status = MissionStatus.PLANNED
    db_session.commit()

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json={"transit_agl": 90.0},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DRAFT"
    assert response.json()["transit_agl"] == 90.0


def test_update_mission_rejects_invalid_transit_agl(client, airport_id):
    """updating transit_agl below MIN_AGL returns 422."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Update Reject", "airport_id": airport_id},
    ).json()

    response = client.put(
        f"/api/v1/missions/{mission['id']}",
        json={"transit_agl": 3.0},
    )
    assert response.status_code == 422


def test_duplicate_mission_preserves_transit_agl(client, airport_id):
    """duplicate carries transit_agl over to the new draft."""
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Dup Cruise",
            "airport_id": airport_id,
            "transit_agl": 75.0,
        },
    ).json()

    dup = client.post(f"/api/v1/missions/{mission['id']}/duplicate")
    assert dup.status_code == 201
    assert dup.json()["transit_agl"] == 75.0


# require_perpendicular_runway_crossing


def test_create_mission_defaults_require_perpendicular_true(client, airport_id):
    """new missions default to perpendicular crossing for backward compatibility."""
    response = client.post(
        "/api/v1/missions",
        json={"name": "Default Perp", "airport_id": airport_id},
    )
    assert response.status_code == 201
    assert response.json()["require_perpendicular_runway_crossing"] is True


def test_create_mission_persists_require_perpendicular_false(client, airport_id):
    """operator opt-in to shortest-geodesic crossing persists on create."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Shortest Geodesic",
            "airport_id": airport_id,
            "require_perpendicular_runway_crossing": False,
        },
    )
    assert response.status_code == 201
    assert response.json()["require_perpendicular_runway_crossing"] is False


def test_update_require_perpendicular_invalidates_trajectory(client, airport_id, db_session):
    """toggling the flag on a PLANNED mission regresses it to DRAFT."""
    from app.core.enums import MissionStatus
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={"name": "Invalidate Perp", "airport_id": airport_id},
    ).json()
    mission_id = mission["id"]

    # flip status directly so we don't need a full inspection fixture
    db_mission = db_session.query(Mission).filter(Mission.id == mission_id).first()
    db_mission.status = MissionStatus.PLANNED
    db_session.commit()

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json={"require_perpendicular_runway_crossing": False},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DRAFT"
    assert response.json()["require_perpendicular_runway_crossing"] is False


# dji_heading_mode rollback toggle


def test_create_mission_defaults_dji_heading_mode_to_smooth_transition(client, airport_id):
    """new missions get dji_heading_mode='smoothTransition' from the column server default.

    smoothTransition is the documented all-models mode that interpolates
    body yaw between per-WP angles - chosen as the default because it
    works on every supported airframe without runtime POI math.
    """
    response = client.post(
        "/api/v1/missions",
        json={"name": "Heading Default", "airport_id": airport_id},
    )
    assert response.status_code == 201
    assert response.json()["dji_heading_mode"] == "smoothTransition"


def test_update_mission_dji_heading_mode_does_not_regress_status(client, airport_id, db_session):
    """flipping dji_heading_mode is an export-only change, never a trajectory change.

    the field is deliberately absent from TRAJECTORY_FIELDS so operators can
    flip between smoothTransition / towardPOI / followWayline without
    recomputing the trajectory.
    """
    from app.core.enums import MissionStatus
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={"name": "Heading Toggle", "airport_id": airport_id},
    ).json()
    mission_id = mission["id"]
    assert mission["dji_heading_mode"] == "smoothTransition"

    # flip status directly so we don't need a full inspection fixture
    db_mission = db_session.query(Mission).filter(Mission.id == mission_id).first()
    db_mission.status = MissionStatus.VALIDATED
    db_session.commit()

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json={"dji_heading_mode": "followWayline"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dji_heading_mode"] == "followWayline"
    # status preserved - flipping the export shape is not a trajectory change
    assert body["status"] == "VALIDATED"
    assert body["has_unsaved_map_changes"] is False


def test_update_mission_rejects_invalid_dji_heading_mode(client, airport_id):
    """unknown dji_heading_mode values are rejected at the schema boundary."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Heading Invalid", "airport_id": airport_id},
    ).json()

    response = client.put(
        f"/api/v1/missions/{mission['id']}",
        json={"dji_heading_mode": "noseDown"},
    )
    assert response.status_code == 422


def test_duplicate_mission_carries_dji_heading_mode(client, airport_id, db_session):
    """duplicate clones the dji_heading_mode override onto the new draft."""
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={"name": "Heading Dup", "airport_id": airport_id},
    ).json()

    # set the column directly - PUT path is exercised separately
    db_mission = db_session.query(Mission).filter(Mission.id == mission["id"]).first()
    db_mission.dji_heading_mode = "followWayline"
    db_session.commit()

    dup = client.post(f"/api/v1/missions/{mission['id']}/duplicate")
    assert dup.status_code == 201
    assert dup.json()["dji_heading_mode"] == "followWayline"


# per-export dji_heading_mode_override + persistence write-back


@pytest.fixture
def _exportable_mission(client, airport_id, db_engine):
    """build a VALIDATED mission with a flight plan + validation_result so /export passes.

    follows the same direct-INSERT pattern test_audit_coverage uses for
    flight-plan audit setup. each invocation builds a fresh mission so the
    write-back side effect is observed in isolation.
    """
    from uuid import uuid4

    from sqlalchemy import text

    from app.core.enums import MissionStatus

    # kmz/wpml export needs a drone with a dji wpml enum
    drone = client.post(
        "/api/v1/drone-profiles",
        json={
            "name": "Export Matrice 4T",
            "manufacturer": "DJI",
            "model": "Matrice 4T",
            "max_speed": 20.0,
            "max_altitude": 500.0,
            "endurance_minutes": 40.0,
            "camera_frame_rate": 30,
            "sensor_fov": 84.0,
        },
    ).json()

    mission_resp = client.post(
        "/api/v1/missions",
        json={
            "name": "Heading Export",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.10, 380.0]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.27, 50.10, 380.0]},
        },
    )
    mission_id = mission_resp.json()["id"]

    fp_id = uuid4()
    val_id = uuid4()

    with db_engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO flight_plan (id, mission_id, airport_id, total_distance, "
                "estimated_duration, is_validated) "
                "VALUES (:id, :mid, :aid, 100.0, 60.0, true)"
            ),
            {"id": str(fp_id), "mid": mission_id, "aid": airport_id},
        )
        conn.execute(
            text(
                "INSERT INTO validation_result (id, flight_plan_id, passed) "
                "VALUES (:id, :fp_id, true)"
            ),
            {"id": str(val_id), "fp_id": str(fp_id)},
        )
        types = ["TAKEOFF", "TRANSIT", "MEASUREMENT", "LANDING"]
        for i, wt in enumerate(types, start=1):
            conn.execute(
                text(
                    "INSERT INTO waypoint (id, flight_plan_id, sequence_order, position, "
                    "waypoint_type) VALUES (:id, :fp_id, :seq, :wkt, :wt)"
                ),
                {
                    "id": str(uuid4()),
                    "fp_id": str(fp_id),
                    "seq": i,
                    "wkt": f"POINT Z (14.{260 + i} 50.10 380.{i})",
                    "wt": wt,
                },
            )
        conn.commit()

    # flip status to VALIDATED so /export is allowed
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE mission SET status=:s WHERE id=:id"),
            {"s": MissionStatus.VALIDATED.value, "id": mission_id},
        )
        conn.commit()

    return {"mission_id": mission_id, "flight_plan_id": str(fp_id)}


def test_export_request_override_wins_and_persists(client, _exportable_mission, db_session):
    """dji_heading_mode_override on /export wins for the export AND writes back.

    contract:
    - mission column starts at smoothTransition (server default)
    - operator passes override='followWayline' on /export
    - the export uses followWayline (no schema-level proof in this test - byte
      shape is exercised by test_export_service; this test pins the route +
      service plumbing + persistence side effect)
    - mission.dji_heading_mode is now 'followWayline' so the next export
      pre-fills the picker with the operator's last choice
    - mission status is EXPORTED after the call (export gate succeeded)
    - mission.has_unsaved_map_changes stayed False (write-back must not
      regress to DRAFT - dji_heading_mode is not in TRAJECTORY_FIELDS)
    """
    from app.models.mission import Mission

    mission_id = _exportable_mission["mission_id"]
    pre = client.get(f"/api/v1/missions/{mission_id}").json()
    assert pre["dji_heading_mode"] == "smoothTransition"

    response = client.post(
        f"/api/v1/missions/{mission_id}/export",
        json={"formats": ["KMZ"], "dji_heading_mode_override": "followWayline"},
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    persisted = db_session.query(Mission).filter(Mission.id == mission_id).first()
    assert persisted.dji_heading_mode == "followWayline"
    assert persisted.status == "EXPORTED"
    assert persisted.has_unsaved_map_changes is False


def test_export_request_no_override_preserves_persisted_value(
    client, _exportable_mission, db_session
):
    """when no override is sent, the persisted column is unchanged."""
    from app.models.mission import Mission

    mission_id = _exportable_mission["mission_id"]

    response = client.post(
        f"/api/v1/missions/{mission_id}/export",
        json={"formats": ["KMZ"]},
    )
    assert response.status_code == 200

    db_session.expire_all()
    persisted = db_session.query(Mission).filter(Mission.id == mission_id).first()
    # unchanged from the server default
    assert persisted.dji_heading_mode == "smoothTransition"


def test_export_request_invalid_override_returns_422(client, _exportable_mission):
    """unknown dji_heading_mode_override is rejected at the schema boundary."""
    mission_id = _exportable_mission["mission_id"]

    response = client.post(
        f"/api/v1/missions/{mission_id}/export",
        json={"formats": ["KMZ"], "dji_heading_mode_override": "noseDown"},
    )
    assert response.status_code == 422


# keep_inside_airport_boundary


def test_create_mission_defaults_keep_inside_airport_boundary_true(client, airport_id):
    """new missions default to keep_inside_airport_boundary=true - geozone-aligned default."""
    response = client.post(
        "/api/v1/missions",
        json={"name": "Default Keep Inside", "airport_id": airport_id},
    )
    assert response.status_code == 201
    assert response.json()["keep_inside_airport_boundary"] is True


def test_create_mission_persists_keep_inside_airport_boundary_false(client, airport_id):
    """operator opt-out persists on create - byte-identical no-preference shape."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Ignore Boundary",
            "airport_id": airport_id,
            "keep_inside_airport_boundary": False,
        },
    )
    assert response.status_code == 201
    assert response.json()["keep_inside_airport_boundary"] is False


def test_update_keep_inside_airport_boundary_invalidates_trajectory(client, airport_id, db_session):
    """toggling keep_inside_airport_boundary on a PLANNED mission regresses it to DRAFT."""
    from app.core.enums import MissionStatus
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={"name": "Invalidate Keep Inside", "airport_id": airport_id},
    ).json()
    mission_id = mission["id"]

    db_mission = db_session.query(Mission).filter(Mission.id == mission_id).first()
    db_mission.status = MissionStatus.PLANNED
    db_session.commit()

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json={"keep_inside_airport_boundary": False},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DRAFT"
    assert response.json()["keep_inside_airport_boundary"] is False


def test_create_mission_rejects_invalid_keep_inside_airport_boundary(client, airport_id):
    """non-boolean value is rejected at the schema boundary."""
    response = client.post(
        "/api/v1/missions",
        json={
            "name": "Bad Keep Inside",
            "airport_id": airport_id,
            "keep_inside_airport_boundary": "ALWAYS_INSIDE",
        },
    )
    assert response.status_code == 422


# route-level terminal-state lifecycle guards
#
# the model layer raises ValueError on terminal-state mutation and the services
# convert that to DomainError(409); these tests pin the 409 at the HTTP boundary
# so a service refactor that stops delegating to the model methods gets caught.


@pytest.fixture(scope="module")
def lifecycle_template_id(client):
    """create a dedicated template for the lifecycle-guard inspection tests."""
    r = client.post(
        "/api/v1/inspection-templates",
        json={**MISSION_TEMPLATE_PAYLOAD, "name": "Lifecycle Guard Template"},
    )

    return r.json()["id"]


def _terminal_mission(client, db_session, airport_id, status, name):
    """create a mission via the API and force it into a terminal status."""
    from app.models.mission import Mission

    mission = client.post("/api/v1/missions", json={"name": name, "airport_id": airport_id}).json()

    # flip status directly - COMPLETED/CANCELLED is unreachable through the
    # API without a full flight-plan fixture
    db_mission = db_session.query(Mission).filter(Mission.id == mission["id"]).first()
    db_mission.status = status
    db_session.commit()

    return mission["id"]


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_update_terminal_mission_trajectory_field_returns_409(
    client, airport_id, db_session, status
):
    """PUT with a trajectory-affecting field on a terminal mission returns 409."""
    mission_id = _terminal_mission(
        client, db_session, airport_id, status, f"Terminal Update {status}"
    )

    response = client.put(f"/api/v1/missions/{mission_id}", json={"default_speed": 12.0})
    assert response.status_code == 409
    assert "completed or cancelled" in response.json()["detail"]

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["status"] == status
    assert detail["default_speed"] is None


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_update_terminal_mission_non_trajectory_field_is_unguarded(
    client, airport_id, db_session, status
):
    """documents current behavior: a metadata-only PUT on a terminal mission succeeds.

    regress_if_trajectory_changed no-ops when no trajectory field is touched, so
    the terminal guard never fires for rename/notes updates and the status is
    preserved. tightening this is a product decision, not a test fix.
    """
    mission_id = _terminal_mission(
        client, db_session, airport_id, status, f"Terminal Rename {status}"
    )

    response = client.put(f"/api/v1/missions/{mission_id}", json={"name": "Renamed Terminal"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed Terminal"
    assert response.json()["status"] == status


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_delete_terminal_mission_succeeds(client, airport_id, db_session, status):
    """DELETE on a terminal mission succeeds - delete is allowed from any status."""
    mission_id = _terminal_mission(
        client, db_session, airport_id, status, f"Terminal Delete {status}"
    )

    response = client.delete(f"/api/v1/missions/{mission_id}")
    assert response.status_code == 200
    assert response.json()["deleted"] is True

    assert client.get(f"/api/v1/missions/{mission_id}").status_code == 404


@pytest.mark.parametrize("status", ["DRAFT", "PLANNED", "VALIDATED", "EXPORTED", "MEASURED"])
def test_cancel_mission_from_any_non_terminal(client, airport_id, db_session, status):
    """POST cancel succeeds from every non-terminal status and lands CANCELLED."""
    mission_id = _terminal_mission(client, db_session, airport_id, status, f"Cancel {status}")

    response = client.post(f"/api/v1/missions/{mission_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_duplicate_terminal_mission_creates_draft(
    client, airport_id, db_session, lifecycle_template_id, status
):
    """duplicate is allowed from terminal states - SPEC: duplicate instead of editing.

    the copy comes back as a fresh DRAFT with cloned inspections, while the
    terminal original stays untouched.
    """
    mission = client.post(
        "/api/v1/missions",
        json={"name": f"Terminal Duplicate {status}", "airport_id": airport_id},
    ).json()
    client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": lifecycle_template_id, "method": "HORIZONTAL_RANGE"},
    )

    from app.models.mission import Mission

    db_mission = db_session.query(Mission).filter(Mission.id == mission["id"]).first()
    db_mission.status = status
    db_session.commit()

    response = client.post(f"/api/v1/missions/{mission['id']}/duplicate")
    assert response.status_code == 201
    copy = response.json()
    assert copy["status"] == "DRAFT"
    assert "(copy)" in copy["name"]

    copy_detail = client.get(f"/api/v1/missions/{copy['id']}").json()
    assert len(copy_detail["inspections"]) == 1

    original = client.get(f"/api/v1/missions/{mission['id']}").json()
    assert original["status"] == status


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_add_inspection_terminal_mission_returns_409(
    client, airport_id, db_session, lifecycle_template_id, status
):
    """POST inspection on a terminal mission returns 409."""
    mission_id = _terminal_mission(
        client, db_session, airport_id, status, f"Terminal Add Insp {status}"
    )

    response = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": lifecycle_template_id, "method": "HORIZONTAL_RANGE"},
    )
    assert response.status_code == 409
    assert "completed or cancelled" in response.json()["detail"]

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["inspections"] == []


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_delete_inspection_terminal_mission_returns_409(
    client, airport_id, db_session, lifecycle_template_id, status
):
    """DELETE inspection on a terminal mission returns 409 and keeps the inspection."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": f"Terminal Del Insp {status}", "airport_id": airport_id},
    ).json()
    inspection = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": lifecycle_template_id, "method": "HORIZONTAL_RANGE"},
    ).json()

    from app.models.mission import Mission

    db_mission = db_session.query(Mission).filter(Mission.id == mission["id"]).first()
    db_mission.status = status
    db_session.commit()

    response = client.delete(f"/api/v1/missions/{mission['id']}/inspections/{inspection['id']}")
    assert response.status_code == 409
    assert "completed or cancelled" in response.json()["detail"]

    detail = client.get(f"/api/v1/missions/{mission['id']}").json()
    assert len(detail["inspections"]) == 1
    assert detail["status"] == status


def test_inspection_limit_tenth_ok_eleventh_409(client, airport_id, lifecycle_template_id):
    """the 10th inspection is accepted, the 11th returns 409 with the limit message."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Inspection Limit", "airport_id": airport_id},
    ).json()

    for i in range(10):
        response = client.post(
            f"/api/v1/missions/{mission['id']}/inspections",
            json={"template_id": lifecycle_template_id, "method": "HORIZONTAL_RANGE"},
        )
        assert response.status_code == 201, f"inspection {i + 1} rejected: {response.text}"

    eleventh = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": lifecycle_template_id, "method": "HORIZONTAL_RANGE"},
    )
    assert eleventh.status_code == 409
    assert "max limit" in eleventh.json()["detail"]

    detail = client.get(f"/api/v1/missions/{mission['id']}").json()
    assert len(detail["inspections"]) == 10


# duplicate-with-trajectory: deep-copy of the flight plan aggregate (issue #140)


def _make_template(client):
    """create an inspection template via the api and return its id."""
    r = client.post(
        "/api/v1/inspection-templates",
        json={**MISSION_TEMPLATE_PAYLOAD, "name": f"Dup Traj Template {uuid4()}"},
    )
    return r.json()["id"]


def _build_planned_mission_with_plan(client, db_session, airport_id, status, name):
    """create a mission via the api, attach an inspection + flight plan, set status.

    returns (mission_id, inspection_id, measurement_wp_id) - all DB ids.
    """
    from app.models.flight_plan import (
        FlightPlan,
        ValidationResult,
        ValidationViolation,
        Waypoint,
    )
    from app.models.inspection import Inspection
    from app.models.mission import Mission

    template_id = _make_template(client)
    mission = client.post("/api/v1/missions", json={"name": name, "airport_id": airport_id}).json()
    mission_id = mission["id"]

    db_mission = db_session.query(Mission).filter(Mission.id == mission_id).first()

    inspection = Inspection(
        id=uuid4(),
        mission_id=db_mission.id,
        template_id=template_id,
        method="HORIZONTAL_RANGE",
        sequence_order=1,
    )
    db_session.add(inspection)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=db_mission.id, airport_id=db_mission.airport_id)
    fp.compile(123.0, 45.0)
    fp.is_validated = True
    db_session.add(fp)
    db_session.flush()

    takeoff = Waypoint(
        id=uuid4(),
        flight_plan_id=fp.id,
        sequence_order=1,
        position="POINT Z (18.11 49.69 270)",
        waypoint_type="TAKEOFF",
        inspection_id=None,
    )
    measurement = Waypoint(
        id=uuid4(),
        flight_plan_id=fp.id,
        sequence_order=2,
        position="POINT Z (18.12 49.69 290)",
        waypoint_type="MEASUREMENT",
        inspection_id=inspection.id,
    )
    db_session.add_all([takeoff, measurement])
    db_session.flush()

    vr = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(vr)
    db_session.flush()
    db_session.add(
        ValidationViolation(
            id=uuid4(),
            validation_result_id=vr.id,
            category="warning",
            message="near surface",
            waypoint_ids=[str(measurement.id)],
            violation_kind="surface_crossing",
        )
    )

    db_mission.status = status
    db_session.commit()

    return mission_id, str(inspection.id), str(measurement.id)


def test_duplicate_planned_mission_copies_trajectory_and_is_planned(client, airport_id, db_session):
    """a PLANNED original carries its trajectory over and the copy lands PLANNED."""
    from app.models.mission import Mission

    mission_id, orig_insp_id, orig_wp_id = _build_planned_mission_with_plan(
        client, db_session, airport_id, "PLANNED", "Dup Traj Planned"
    )

    response = client.post(f"/api/v1/missions/{mission_id}/duplicate")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "PLANNED"
    copy_id = body["id"]

    db_session.expire_all()
    copy = db_session.query(Mission).filter(Mission.id == copy_id).first()
    assert copy.flight_plan is not None
    assert copy.flight_plan.mission_id == copy.id
    assert copy.flight_plan.total_distance == 123.0
    assert copy.flight_plan.estimated_duration == 45.0
    assert len(copy.flight_plan.waypoints) == 2

    copy_insp_ids = {str(i.id) for i in copy.inspections}
    measurement = next(wp for wp in copy.flight_plan.waypoints if wp.waypoint_type == "MEASUREMENT")
    assert str(measurement.inspection_id) in copy_insp_ids
    assert str(measurement.inspection_id) != orig_insp_id

    violations = copy.flight_plan.validation_result.violations
    assert violations[0].waypoint_ids == [str(measurement.id)]
    assert orig_wp_id not in violations[0].waypoint_ids

    # original is untouched - keeps its own plan and status
    original = db_session.query(Mission).filter(Mission.id == mission_id).first()
    assert original.status == "PLANNED"
    assert original.flight_plan.id != copy.flight_plan.id


@pytest.mark.parametrize("status", ["VALIDATED", "EXPORTED", "MEASURED", "COMPLETED", "CANCELLED"])
def test_duplicate_mission_status_matrix(client, airport_id, db_session, status):
    """a non-DRAFT original with a plan always duplicates to a PLANNED copy."""
    from app.models.mission import Mission

    mission_id, _, _ = _build_planned_mission_with_plan(
        client, db_session, airport_id, status, f"Dup Traj {status}"
    )

    response = client.post(f"/api/v1/missions/{mission_id}/duplicate")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "PLANNED"

    db_session.expire_all()
    copy = db_session.query(Mission).filter(Mission.id == body["id"]).first()
    assert copy.flight_plan is not None
    assert len(copy.flight_plan.waypoints) == 2


def test_duplicate_draft_with_stale_plan_has_no_plan(client, airport_id, db_session):
    """a DRAFT original holding a stale plan row duplicates to a clean DRAFT."""
    from app.models.mission import Mission

    mission_id, _, _ = _build_planned_mission_with_plan(
        client, db_session, airport_id, "DRAFT", "Dup Traj Stale Draft"
    )

    response = client.post(f"/api/v1/missions/{mission_id}/duplicate")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "DRAFT"

    db_session.expire_all()
    copy = db_session.query(Mission).filter(Mission.id == body["id"]).first()
    assert copy.flight_plan is None


def test_duplicate_does_not_copy_export_results(client, airport_id, db_session):
    """export result rows are intentionally not carried over to the copy."""
    from app.models.flight_plan import ExportResult, FlightPlan
    from app.models.mission import Mission

    mission_id, _, _ = _build_planned_mission_with_plan(
        client, db_session, airport_id, "EXPORTED", "Dup Traj Export Results"
    )

    src_fp = (
        db_session.query(FlightPlan)
        .join(Mission, FlightPlan.mission_id == Mission.id)
        .filter(Mission.id == mission_id)
        .first()
    )
    db_session.add(
        ExportResult(
            id=uuid4(),
            flight_plan_id=src_fp.id,
            file_name="plan.kmz",
            format="KMZ",
            file_path="/tmp/plan.kmz",
        )
    )
    db_session.commit()

    response = client.post(f"/api/v1/missions/{mission_id}/duplicate")
    assert response.status_code == 201

    db_session.expire_all()
    copy = db_session.query(Mission).filter(Mission.id == response.json()["id"]).first()
    assert copy.flight_plan is not None
    assert copy.flight_plan.export_results == []


def test_duplicate_records_audit_duplicated_from(client, airport_id, db_session):
    """the duplicate route records the source mission id in the audit details."""
    from app.models.audit_log import AuditLog

    mission_id, _, _ = _build_planned_mission_with_plan(
        client, db_session, airport_id, "PLANNED", "Dup Traj Audit"
    )

    copy_id = client.post(f"/api/v1/missions/{mission_id}/duplicate").json()["id"]

    db_session.expire_all()
    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_id == copy_id, AuditLog.entity_type == "Mission")
        .first()
    )
    assert audit is not None
    assert audit.details["duplicated_from"] == mission_id
