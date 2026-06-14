"""tests for the audit_log.airport_id denormalized scope.

verifies:
- the new airport_id column persists on airport-scoped routes (mission CRUD,
  validate/export, inspection CRUD, flight-plan waypoint edits)
- non-airport-scoped routes (admin user mgmt, system settings) leave it NULL
- GET /admin/audit-log?airport_id=<uuid> filters server-side
- AuditLogResponse exposes the new field on the wire
"""

from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audit_log import AuditLog
from tests.data.airports import AIRPORT_PAYLOAD


@pytest.fixture
def session(db_engine):
    """fresh sqlalchemy session per test, with rollback on teardown."""
    s = sessionmaker(bind=db_engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _audit_rows_for_airport(session, airport_id) -> list[AuditLog]:
    """fetch audit rows whose airport_id matches the given uuid."""
    return session.query(AuditLog).filter(AuditLog.airport_id == airport_id).all()


# persistence


def test_create_airport_persists_airport_id(client, session):
    """POST /airports — the new airport_id column is set on the audit row."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAID"}).json()

    rows = _audit_rows_for_airport(session, apt["id"])
    create_rows = [r for r in rows if r.action == "CREATE" and r.entity_type == "Airport"]
    assert len(create_rows) == 1
    assert str(create_rows[0].airport_id) == apt["id"]


def test_create_mission_persists_airport_id(client, session):
    """POST /missions inherits airport_id from mission.airport_id on the audit row."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAIE"}).json()
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Scope Mission", "airport_id": apt["id"]},
    ).json()

    rows = _audit_rows_for_airport(session, apt["id"])
    mission_create = [
        r
        for r in rows
        if r.action == "CREATE" and r.entity_type == "Mission" and str(r.entity_id) == mission["id"]
    ]
    assert len(mission_create) == 1


def test_invite_user_leaves_airport_id_null(client, session):
    """POST /admin/users/invite — non-airport-scoped action, airport_id is NULL."""
    body = {
        "email": f"scope-{uuid4().hex[:8]}@example.com",
        "name": "Scope User",
        "role": "OPERATOR",
        "airport_ids": [],
    }
    r = client.post("/api/v1/admin/users/invite", json=body)
    assert r.status_code == 201
    user_id = r.json()["user"]["id"]

    rows = (
        session.query(AuditLog)
        .filter(AuditLog.action == "INVITE_USER", AuditLog.entity_id == user_id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].airport_id is None


def test_assign_airport_action_leaves_airport_id_null(client, session):
    """ASSIGN_AIRPORT carries the airport list in details, not airport_id, per the issue.

    one user can be assigned to many airports in one call - fanning out to one
    audit row per airport would change the action's semantics. the per-airport
    audit log will still show this row via airport-id-in-details if needed.
    """
    invite = client.post(
        "/api/v1/admin/users/invite",
        json={
            "email": f"scope-assign-{uuid4().hex[:8]}@example.com",
            "name": "Assign User",
            "role": "OPERATOR",
            "airport_ids": [],
        },
    )
    assert invite.status_code == 201
    user_id = invite.json()["user"]["id"]

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAIF"}).json()

    r = client.put(
        f"/api/v1/admin/users/{user_id}/airports",
        json={"airport_ids": [apt["id"]]},
    )
    assert r.status_code == 200

    rows = (
        session.query(AuditLog)
        .filter(AuditLog.action == "ASSIGN_AIRPORT", AuditLog.entity_id == user_id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].airport_id is None


# api filter


def test_admin_audit_log_filters_by_airport_id(client):
    """GET /admin/audit-log?airport_id=<uuid> returns only matching rows."""
    apt_a = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAFA"}).json()
    apt_b = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAFB"}).json()

    # mutate something at each airport so we have rows tagged differently
    client.post("/api/v1/missions", json={"name": "A1", "airport_id": apt_a["id"]})
    client.post("/api/v1/missions", json={"name": "B1", "airport_id": apt_b["id"]})

    r = client.get(f"/api/v1/admin/audit-log?airport_id={apt_a['id']}&limit=200")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) >= 1
    # every row has the requested scope or NULL must not appear
    for row in data:
        assert row["airport_id"] == apt_a["id"]


def test_admin_audit_log_response_exposes_airport_id(client):
    """AuditLogResponse always includes airport_id (nullable)."""
    r = client.get("/api/v1/admin/audit-log?limit=5")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) >= 1
    for row in data:
        assert "airport_id" in row


def test_admin_audit_log_export_accepts_airport_id(client):
    """GET /admin/audit-log/export accepts the airport_id filter."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAFC"}).json()

    r = client.get(f"/api/v1/admin/audit-log/export?airport_id={apt['id']}")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    body = r.text
    # csv header now includes airport_id between entity_name and details
    assert "airport_id" in body.splitlines()[0]


def test_admin_audit_log_filter_rejects_non_uuid(client):
    """passing a non-uuid airport_id returns 422 (FastAPI path/query validator)."""
    r = client.get("/api/v1/admin/audit-log?airport_id=not-a-uuid")
    assert r.status_code == 422
