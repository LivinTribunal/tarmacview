"""tests that trajectory-affecting changes regress to DRAFT but keep the stale flight plan."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.data.missions import MISSION_AIRPORT_PAYLOAD

# stale flight plan retention - integration tests for issue #224.
# trajectory-affecting config changes must regress the mission to DRAFT
# and flag has_unsaved_map_changes, but must keep the existing flight
# plan row so the frontend can render it as a stale reference until the
# operator triggers a fresh recompute.


@pytest.fixture(scope="module")
def stale_airport_id(client):
    """airport for stale-flight-plan tests."""
    payload = {
        **MISSION_AIRPORT_PAYLOAD,
        "icao_code": "LKST",
        "name": "Stale Test Airport",
    }
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


@pytest.fixture(scope="module")
def stale_template_id(client):
    """inspection template used by mission-with-inspection fixtures."""
    r = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Stale FP Template", "methods": ["HORIZONTAL_RANGE"]},
    )
    return r.json()["id"]


def _create_mission(client, airport_id) -> str:
    """create a mission via API with takeoff/landing set."""
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "Stale FP Mission",
            "airport_id": airport_id,
            "transit_agl": 60.0,
            "takeoff_coordinate": {
                "type": "Point",
                "coordinates": [18.11, 49.69, 260.0],
            },
            "landing_coordinate": {
                "type": "Point",
                "coordinates": [18.12, 49.69, 260.0],
            },
        },
    ).json()
    return mission["id"]


def _attach_flight_plan(db_session, mission_id, airport_id, *, status="PLANNED") -> str:
    """insert a FlightPlan row directly via SQL and flip mission status.

    using raw SQL avoids stale ORM relationship state when subsequent API
    calls mutate the mission via different sessions.
    """
    fp_id = uuid4()
    db_session.execute(
        text(
            "INSERT INTO flight_plan (id, mission_id, airport_id, total_distance, "
            "estimated_duration, is_validated, generated_at) VALUES "
            "(:id, :mission_id, :airport_id, 100.0, 60.0, false, NOW())"
        ),
        {
            "id": str(fp_id),
            "mission_id": str(mission_id),
            "airport_id": str(airport_id),
        },
    )
    db_session.execute(
        text("UPDATE mission SET status = :status, has_unsaved_map_changes = false WHERE id = :id"),
        {"status": status, "id": str(mission_id)},
    )
    db_session.commit()
    return str(fp_id)


def _flight_plan_exists(db_session, mission_id) -> bool:
    """check via raw SQL whether a flight plan row still exists for the mission."""
    row = db_session.execute(
        text("SELECT 1 FROM flight_plan WHERE mission_id = :mid"),
        {"mid": str(mission_id)},
    ).first()
    return row is not None


def test_update_mission_keeps_stale_flight_plan(client, stale_airport_id, db_session):
    """trajectory-affecting mission config change keeps the stale flight plan."""
    mission_id = _create_mission(client, stale_airport_id)
    _attach_flight_plan(db_session, mission_id, stale_airport_id)

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json={"transit_agl": 90.0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "DRAFT"
    assert body["has_unsaved_map_changes"] is True
    assert _flight_plan_exists(db_session, mission_id)


def test_update_inspection_keeps_stale_flight_plan(
    client, stale_airport_id, stale_template_id, db_session
):
    """updating an inspection config keeps the stale flight plan and flags unsaved changes."""
    mission_id = _create_mission(client, stale_airport_id)

    add = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": stale_template_id, "method": "HORIZONTAL_RANGE"},
    )
    assert add.status_code == 201
    inspection_id = add.json()["id"]

    # adding inspection now keeps any existing fp - so we attach the fp and flip
    # back to PLANNED *after* the inspection is in place to isolate the update path
    _attach_flight_plan(db_session, mission_id, stale_airport_id)

    response = client.put(
        f"/api/v1/missions/{mission_id}/inspections/{inspection_id}",
        json={"config": {"direction_reversed": True}},
    )
    assert response.status_code == 200

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["status"] == "DRAFT"
    assert detail["has_unsaved_map_changes"] is True
    assert _flight_plan_exists(db_session, mission_id)


def test_add_inspection_keeps_stale_flight_plan(
    client, stale_airport_id, stale_template_id, db_session
):
    """adding an inspection regresses to DRAFT but keeps the existing flight plan."""
    mission_id = _create_mission(client, stale_airport_id)
    _attach_flight_plan(db_session, mission_id, stale_airport_id)

    response = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": stale_template_id, "method": "HORIZONTAL_RANGE"},
    )
    assert response.status_code == 201

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["status"] == "DRAFT"
    assert detail["has_unsaved_map_changes"] is True
    assert _flight_plan_exists(db_session, mission_id)


def test_delete_inspection_keeps_stale_flight_plan(
    client, stale_airport_id, stale_template_id, db_session
):
    """deleting an inspection regresses to DRAFT but keeps the existing flight plan."""
    mission_id = _create_mission(client, stale_airport_id)

    add = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": stale_template_id, "method": "HORIZONTAL_RANGE"},
    )
    inspection_id = add.json()["id"]

    _attach_flight_plan(db_session, mission_id, stale_airport_id)

    response = client.delete(f"/api/v1/missions/{mission_id}/inspections/{inspection_id}")
    assert response.status_code == 200

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["status"] == "DRAFT"
    assert detail["has_unsaved_map_changes"] is True
    assert _flight_plan_exists(db_session, mission_id)


def test_reorder_inspections_keeps_stale_flight_plan(
    client, stale_airport_id, stale_template_id, db_session
):
    """reordering inspections regresses to DRAFT but keeps the existing flight plan."""
    mission_id = _create_mission(client, stale_airport_id)

    insp1 = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": stale_template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    insp2 = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": stale_template_id, "method": "HORIZONTAL_RANGE"},
    ).json()

    _attach_flight_plan(db_session, mission_id, stale_airport_id)

    response = client.put(
        f"/api/v1/missions/{mission_id}/inspections/reorder",
        json={"inspection_ids": [insp2["id"], insp1["id"]]},
    )
    assert response.status_code == 200

    detail = client.get(f"/api/v1/missions/{mission_id}").json()
    assert detail["status"] == "DRAFT"
    assert detail["has_unsaved_map_changes"] is True
    assert _flight_plan_exists(db_session, mission_id)


def test_mission_delete_cascades_flight_plan(client, stale_airport_id, db_session):
    """deleting the mission still cascades the flight plan via DB FK."""
    mission_id = _create_mission(client, stale_airport_id)
    fp_id = _attach_flight_plan(db_session, mission_id, stale_airport_id, status="DRAFT")

    response = client.delete(f"/api/v1/missions/{mission_id}")
    assert response.status_code == 200

    row = db_session.execute(
        text("SELECT 1 FROM flight_plan WHERE id = :id"),
        {"id": fp_id},
    ).first()
    assert row is None
