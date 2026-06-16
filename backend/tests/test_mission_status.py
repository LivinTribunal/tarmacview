"""tests for mission status-transition guards from DRAFT and trajectory-field updates."""

from uuid import uuid4

import pytest

from app.core.enums import MissionStatus
from app.models.mission import Mission
from tests.data.missions import MISSION_SPEED_UPDATE_PAYLOAD, STATUS_TEST_AIRPORT_PAYLOAD


@pytest.fixture(scope="module")
def airport_id(client):
    """create a test airport for status tests"""
    r = client.post("/api/v1/airports", json=STATUS_TEST_AIRPORT_PAYLOAD)

    return r.json()["id"]


def _create_mission(client, airport_id: str, name="Status Test") -> str:
    """helper - create a DRAFT mission and return its id"""
    response = client.post("/api/v1/missions", json={"name": name, "airport_id": airport_id})

    return response.json()["id"]


# Tests
def test_draft_cannot_validate(client, airport_id):
    """DRAFT -> VALIDATED should fail (must go through PLANNED first)"""
    mission_id = _create_mission(client, airport_id)

    response = client.post(f"/api/v1/missions/{mission_id}/validate")
    assert response.status_code == 409
    detail = response.json()["detail"]

    assert detail["current_status"] == "DRAFT"


def test_draft_cannot_export(client, airport_id):
    """DRAFT -> EXPORTED should fail"""
    mission_id = _create_mission(client, airport_id)

    response = client.post(f"/api/v1/missions/{mission_id}/export", json={"formats": ["KML"]})
    assert response.status_code == 409


def test_draft_cannot_complete(client, airport_id):
    """DRAFT -> COMPLETED should fail"""
    mission_id = _create_mission(client, airport_id)

    response = client.post(f"/api/v1/missions/{mission_id}/complete")
    assert response.status_code == 409


def test_draft_cannot_cancel(client, airport_id):
    """DRAFT -> CANCELLED should fail"""
    mission_id = _create_mission(client, airport_id)

    response = client.post(f"/api/v1/missions/{mission_id}/cancel")
    assert response.status_code == 409


def test_invalid_transition_returns_allowed(client, airport_id):
    """invalid transition response includes allowed transitions"""
    mission_id = _create_mission(client, airport_id)

    response = client.post(f"/api/v1/missions/{mission_id}/export", json={"formats": ["KML"]})
    assert response.status_code == 409


def test_update_trajectory_fields_on_draft(client, airport_id):
    """changing trajectory fields on DRAFT mission should still work"""
    mission_id = _create_mission(client, airport_id)

    response = client.put(
        f"/api/v1/missions/{mission_id}",
        json=MISSION_SPEED_UPDATE_PAYLOAD,
    )
    assert response.status_code == 200
    assert response.json()["default_speed"] == 10.0


# MEASURED state-machine unit tests (in-memory, no DB)
def _mission(status: str) -> Mission:
    """in-memory mission pinned at a status - never flushed, no FK round-trip."""
    return Mission(name="SM", airport_id=uuid4(), status=status)


@pytest.mark.parametrize("start", ["VALIDATED", "EXPORTED"])
def test_transition_to_measured_allowed(start):
    """VALIDATED and EXPORTED can both move to MEASURED."""
    m = _mission(start)
    m.transition_to(MissionStatus.MEASURED)
    assert m.status == MissionStatus.MEASURED


def test_validated_to_measured_skips_exported():
    """a mission measured straight from VALIDATED skips EXPORTED."""
    m = _mission("VALIDATED")
    m.transition_to(MissionStatus.MEASURED)
    assert m.status == "MEASURED"


@pytest.mark.parametrize("target", ["COMPLETED", "CANCELLED"])
def test_measured_to_terminal_allowed(target):
    """MEASURED can move to either terminal state."""
    m = _mission("MEASURED")
    m.transition_to(getattr(MissionStatus, target))
    assert m.status == target


@pytest.mark.parametrize("start", ["DRAFT", "PLANNED"])
def test_measured_blocked_before_export(start):
    """MEASURED is unreachable before VALIDATED/EXPORTED."""
    m = _mission(start)
    with pytest.raises(ValueError):
        m.transition_to(MissionStatus.MEASURED)


def test_measured_cannot_regress_to_exported():
    """MEASURED -> EXPORTED is not a legal transition."""
    m = _mission("MEASURED")
    with pytest.raises(ValueError):
        m.transition_to(MissionStatus.EXPORTED)


@pytest.mark.parametrize("start", ["VALIDATED", "EXPORTED"])
def test_mark_measured_fires_from_post_plan(start):
    """mark_measured flips a VALIDATED/EXPORTED mission to MEASURED."""
    m = _mission(start)
    m.mark_measured()
    assert m.status == MissionStatus.MEASURED


def test_mark_measured_idempotent_second_call_is_noop():
    """a second mark_measured on an already-MEASURED mission is a no-op, not a raise."""
    m = _mission("VALIDATED")
    m.mark_measured()
    assert m.status == MissionStatus.MEASURED
    m.mark_measured()
    assert m.status == MissionStatus.MEASURED


@pytest.mark.parametrize("start", ["DRAFT", "PLANNED", "COMPLETED", "CANCELLED"])
def test_mark_measured_noop_outside_post_plan(start):
    """mark_measured leaves a non-VALIDATED/EXPORTED mission untouched, never raises."""
    m = _mission(start)
    m.mark_measured()
    assert m.status == start
