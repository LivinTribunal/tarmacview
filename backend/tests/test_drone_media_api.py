"""drone-media endpoints - grouped listing, manual reassignment, ingest confirm, auth."""

from datetime import datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.main import app
from app.models.audit_log import AuditLog
from app.models.drone_media_file import DroneMediaFile
from tests.data.missions import MISSION_AIRPORT_PAYLOAD

PATH = "/api/v1/drone-media"
MEDIA_EVENTS_PATH = "/api/v1/field-link/media-events"
HUB_SECRET = "s3cret"

# coordinates isolated from every other suite so committed dispatch fixtures
# elsewhere can never become accidental matching candidates
MISSION_A_LON, MISSION_A_LAT = 16.80, 48.80
MISSION_B_LON, MISSION_B_LAT = 16.90, 48.90

DISPATCHED_AT = "2026-06-09T10:00:00+00:00"
CAPTURED_AT = "2026-06-09T12:00:00+00:00"


@pytest.fixture
def hub_secret(monkeypatch):
    """configure the shared secret and return the matching header."""
    monkeypatch.setattr(settings, "fieldhub_shared_secret", HUB_SECRET)
    return {"X-Hub-Secret": HUB_SECRET}


@pytest.fixture(scope="module")
def airport_id(client):
    """create a test airport for drone-media tests."""
    payload = {**MISSION_AIRPORT_PAYLOAD, "icao_code": "LDMA", "name": "Drone Media Airport"}
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


def _seed_mission_with_dispatch(client, db_engine, airport_id, *, lon, lat, name):
    """mission with a plan bbox around (lon, lat) and a committed dispatch row."""
    mission = client.post("/api/v1/missions", json={"name": name, "airport_id": airport_id}).json()

    fp_id = uuid4()
    with db_engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO flight_plan (id, mission_id, airport_id, is_validated) "
                "VALUES (:id, :mid, :aid, true)"
            ),
            {"id": str(fp_id), "mid": mission["id"], "aid": airport_id},
        )
        corners = [(lon - 0.002, lat - 0.002), (lon + 0.002, lat + 0.002)]
        for i, (wlon, wlat) in enumerate(corners, start=1):
            conn.execute(
                text(
                    "INSERT INTO waypoint (id, flight_plan_id, sequence_order, position, "
                    "waypoint_type) VALUES (:id, :fp_id, :seq, :wkt, 'MEASUREMENT')"
                ),
                {
                    "id": str(uuid4()),
                    "fp_id": str(fp_id),
                    "seq": i,
                    "wkt": f"POINT Z ({wlon} {wlat} 420)",
                },
            )
        conn.execute(
            text(
                "INSERT INTO wayline_dispatch (id, mission_id, wayline_id, status, "
                "dispatched_at) VALUES (:id, :mid, :wid, 'DISPATCHED', :at)"
            ),
            {
                "id": str(uuid4()),
                "mid": mission["id"],
                "wid": str(uuid4()),
                "at": DISPATCHED_AT,
            },
        )
        conn.commit()
    return mission["id"]


@pytest.fixture(scope="module")
def mission_a(client, db_engine, airport_id):
    """dispatched mission around (16.80, 48.80)."""
    return _seed_mission_with_dispatch(
        client, db_engine, airport_id, lon=MISSION_A_LON, lat=MISSION_A_LAT, name="Media Mission A"
    )


@pytest.fixture(scope="module")
def mission_b(client, db_engine, airport_id):
    """dispatched mission around (16.90, 48.90)."""
    return _seed_mission_with_dispatch(
        client, db_engine, airport_id, lon=MISSION_B_LON, lat=MISSION_B_LAT, name="Media Mission B"
    )


def _post_event(client, headers, *, lon=None, lat=None, captured_at=CAPTURED_AT):
    """hub media event with a unique fingerprint; returns the created row."""
    fingerprint = f"fp-{uuid4().hex}"
    payload = {
        "object_key": f"media/{fingerprint}.JPG",
        "fingerprint": fingerprint,
        "captured_at": captured_at,
        "device_sn": "1ZNBJ7R0010078",
    }
    if lon is not None:
        payload["position"] = {"type": "Point", "coordinates": [lon, lat, 420.0]}
    r = client.post(MEDIA_EVENTS_PATH, json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _group_for(body: dict, mission_id: str) -> dict | None:
    """mission group out of the list response, none when absent."""
    return next((g for g in body["missions"] if g["mission_id"] == mission_id), None)


# media-event auto-matching


def test_media_event_auto_matches_new_row(client, hub_secret, mission_a):
    """a capture inside the dispatched mission's area lands MATCHED at event time."""
    body = _post_event(client, hub_secret, lon=MISSION_A_LON, lat=MISSION_A_LAT)

    assert body["status"] == "MATCHED"
    assert body["mission_id"] == mission_a


def test_media_event_without_gps_lands_unassigned(client, hub_secret, mission_a):
    """no capture position -> containment cannot pass -> UNASSIGNED bucket."""
    body = _post_event(client, hub_secret)

    assert body["status"] == "UNASSIGNED"
    assert body["mission_id"] is None


# listing


def test_list_groups_by_mission_with_unassigned_bucket(client, hub_secret, mission_a, mission_b):
    """GET returns per-mission groups with names plus the unassigned bucket."""
    in_a = _post_event(client, hub_secret, lon=MISSION_A_LON, lat=MISSION_A_LAT)
    in_b = _post_event(client, hub_secret, lon=MISSION_B_LON, lat=MISSION_B_LAT)
    loose = _post_event(client, hub_secret)

    response = client.get(PATH)
    assert response.status_code == 200
    body = response.json()

    group_a = _group_for(body, mission_a)
    group_b = _group_for(body, mission_b)
    assert group_a is not None and group_a["mission_name"] == "Media Mission A"
    assert group_b is not None and group_b["mission_name"] == "Media Mission B"
    assert in_a["id"] in [f["id"] for f in group_a["files"]]
    assert in_b["id"] in [f["id"] for f in group_b["files"]]
    assert loose["id"] in [f["id"] for f in body["unassigned"]]


def test_list_sweeps_lingering_received_rows(client, hub_secret, db_engine, mission_a):
    """rows stuck RECEIVED (event-time matching failed) are retried by the listing."""
    from sqlalchemy.orm import sessionmaker

    fingerprint = f"fp-{uuid4().hex}"
    session = sessionmaker(bind=db_engine)()
    try:
        session.add(
            DroneMediaFile(
                object_key=f"media/{fingerprint}.JPG",
                fingerprint=fingerprint,
                captured_at=datetime.fromisoformat(CAPTURED_AT),
                capture_position=f"POINT Z ({MISSION_A_LON} {MISSION_A_LAT} 420)",
                device_sn="1ZNBJ7R0010078",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(PATH)
    assert response.status_code == 200

    group_a = _group_for(response.json(), mission_a)
    swept = next(f for f in group_a["files"] if f["fingerprint"] == fingerprint)
    assert swept["status"] == "MATCHED"


def test_list_buckets_mission_deleted_files_as_unassigned(
    client, hub_secret, db_engine, airport_id
):
    """mission delete SET NULLs the fk - the file falls back to the unassigned bucket."""
    mission_id = _seed_mission_with_dispatch(
        client, db_engine, airport_id, lon=16.70, lat=48.70, name="Deleted Mission"
    )
    row = _post_event(client, hub_secret, lon=16.70, lat=48.70)
    assert row["mission_id"] == mission_id

    assert client.delete(f"/api/v1/missions/{mission_id}").status_code == 200

    body = client.get(PATH).json()
    assert _group_for(body, mission_id) is None
    assert row["id"] in [f["id"] for f in body["unassigned"]]


# manual reassignment


def test_assign_moves_file_and_bumps_updated_at(client, hub_secret, mission_a, db_session):
    """manual assign sets MATCHED + mission, bumps updated_at, writes an UPDATE audit row."""
    row = _post_event(client, hub_secret)
    before = datetime.fromisoformat(row["updated_at"])

    response = client.post(f"{PATH}/{row['id']}/assign", json={"mission_id": mission_a})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "MATCHED"
    assert body["mission_id"] == mission_a
    assert datetime.fromisoformat(body["updated_at"]) > before

    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "UPDATE", AuditLog.entity_id == row["id"])
        .all()
    )
    assert len(audits) == 1
    assert audits[0].entity_type == "DroneMediaFile"
    assert audits[0].details["mission_id"] == mission_a


def test_assign_null_moves_to_unassigned_bucket(client, hub_secret, mission_a):
    """a null mission_id parks the file back in the unassigned bucket."""
    row = _post_event(client, hub_secret, lon=MISSION_A_LON, lat=MISSION_A_LAT)
    assert row["status"] == "MATCHED"

    response = client.post(f"{PATH}/{row['id']}/assign", json={"mission_id": None})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "UNASSIGNED"
    assert body["mission_id"] is None


def test_assign_unknown_media_or_mission_404(client, hub_secret, mission_a):
    """missing media file or missing target mission -> 404."""
    missing_media = client.post(f"{PATH}/{uuid4()}/assign", json={"mission_id": mission_a})
    assert missing_media.status_code == 404

    row = _post_event(client, hub_secret)
    missing_mission = client.post(f"{PATH}/{row['id']}/assign", json={"mission_id": str(uuid4())})
    assert missing_mission.status_code == 404


# ingest confirm


def test_confirm_ingest_transitions_and_is_idempotent(
    client, hub_secret, db_engine, airport_id, db_session
):
    """confirm marks the mission's rows INGESTED; the repeat call is a no-op."""
    mission_id = _seed_mission_with_dispatch(
        client, db_engine, airport_id, lon=16.60, lat=48.60, name="Ingest Mission"
    )
    first = _post_event(client, hub_secret, lon=16.60, lat=48.60)
    second = _post_event(client, hub_secret, lon=16.60, lat=48.60)
    assert first["mission_id"] == mission_id and second["mission_id"] == mission_id

    response = client.post(f"{PATH}/confirm-ingest", json={"mission_id": mission_id})
    assert response.status_code == 200
    assert response.json() == {"mission_id": mission_id, "ingested_count": 2}

    # ingested rows leave the listing
    assert _group_for(client.get(PATH).json(), mission_id) is None

    repeat = client.post(f"{PATH}/confirm-ingest", json={"mission_id": mission_id})
    assert repeat.status_code == 200
    assert repeat.json()["ingested_count"] == 0

    rows = (
        db_session.query(DroneMediaFile)
        .filter(DroneMediaFile.id.in_([first["id"], second["id"]]))
        .all()
    )
    assert {r.status for r in rows} == {"INGESTED"}

    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "STATUS_CHANGE", AuditLog.entity_id == mission_id)
        .all()
    )
    assert len(audits) == 2
    assert audits[0].entity_type == "DroneMediaFile"
    assert {a.details["ingested_count"] for a in audits} == {2, 0}


def test_confirm_ingest_unknown_mission_404(client, hub_secret):
    """confirming a missing mission -> 404."""
    response = client.post(f"{PATH}/confirm-ingest", json={"mission_id": str(uuid4())})
    assert response.status_code == 404


def test_assign_after_ingest_409(client, hub_secret, db_engine, airport_id, mission_a):
    """reassignment is blocked once the file left for the pipeline."""
    mission_id = _seed_mission_with_dispatch(
        client, db_engine, airport_id, lon=16.50, lat=48.50, name="Locked Mission"
    )
    row = _post_event(client, hub_secret, lon=16.50, lat=48.50)
    assert row["mission_id"] == mission_id
    assert client.post(f"{PATH}/confirm-ingest", json={"mission_id": mission_id}).status_code == 200

    response = client.post(f"{PATH}/{row['id']}/assign", json={"mission_id": mission_a})

    assert response.status_code == 409


# auth gate


def test_routes_require_auth():
    """401 without a jwt on every drone-media endpoint."""
    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    try:
        anon = TestClient(app)
        assert anon.get(PATH).status_code == 401
        assert anon.post(f"{PATH}/{uuid4()}/assign", json={"mission_id": None}).status_code == 401
        assert (
            anon.post(f"{PATH}/confirm-ingest", json={"mission_id": str(uuid4())}).status_code
            == 401
        )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved_overrides)
