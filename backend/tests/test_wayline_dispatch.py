"""mission dispatch into the field hub - route, service seam, idempotency, audit."""

import hashlib
import io
import zipfile
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.enums import MissionStatus
from app.core.exceptions import DomainError
from app.services import wayline_dispatch_service
from tests.data.missions import MISSION_AIRPORT_PAYLOAD


@pytest.fixture(scope="module")
def airport_id(client):
    """create a test airport for dispatch tests."""
    payload = {**MISSION_AIRPORT_PAYLOAD, "icao_code": "LDIS", "name": "Dispatch Airport"}
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


@pytest.fixture
def dispatchable_mission(client, airport_id, db_engine):
    """build a VALIDATED mission with a flight plan so /dispatch passes the gate.

    follows the same direct-INSERT pattern test_missions._exportable_mission
    uses for the export route.
    """
    drone = client.post(
        "/api/v1/drone-profiles",
        json={
            "name": f"Dispatch M4T {uuid4().hex[:6]}",
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
            "name": "Dispatch Mission",
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
        conn.execute(
            text("UPDATE mission SET status=:s WHERE id=:id"),
            {"s": MissionStatus.VALIDATED.value, "id": mission_id},
        )
        conn.commit()

    return {"mission_id": mission_id, "drone_id": drone["id"]}


@pytest.fixture
def fake_hub(monkeypatch):
    """record _post_kmz_to_hub calls instead of dialing a hub."""
    calls = []

    def _record(kmz_bytes, metadata, transport=None):
        """capture the register payload."""
        calls.append({"kmz": kmz_bytes, "metadata": metadata})

    monkeypatch.setattr(wayline_dispatch_service, "_post_kmz_to_hub", _record)
    return calls


def _dispatch_rows(db_session, mission_id):
    """wayline_dispatch rows for a mission, fresh from the db."""
    from app.models.wayline_dispatch import WaylineDispatch

    db_session.expire_all()
    return db_session.query(WaylineDispatch).filter(WaylineDispatch.mission_id == mission_id).all()


# route + service


def test_dispatch_exports_kmz_and_registers_with_hub(
    client, dispatchable_mission, fake_hub, db_session
):
    """dispatch returns the mapping, ships a wpmz KMZ to the hub, persists the row."""
    mission_id = dispatchable_mission["mission_id"]

    response = client.post(f"/api/v1/missions/{mission_id}/dispatch")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["mission_id"] == mission_id
    assert body["status"] == "DISPATCHED"
    assert body["device_sn"] is None
    assert body["dispatched_at"]

    # the hub got exactly one register call with the same wayline id
    assert len(fake_hub) == 1
    metadata = fake_hub[0]["metadata"]
    assert metadata["wayline_id"] == body["wayline_id"]
    assert metadata["mission_id"] == mission_id
    assert metadata["object_key"] == f"wayline/{body['wayline_id']}.kmz"

    # the artifact is a real wpmz archive - template + waylines
    archive = zipfile.ZipFile(io.BytesIO(fake_hub[0]["kmz"]))
    assert set(archive.namelist()) >= {"wpmz/template.kml", "wpmz/waylines.wpml"}
    assert metadata["sign"] == hashlib.md5(fake_hub[0]["kmz"], usedforsecurity=False).hexdigest()

    # device keys derive from the mission's drone (M4T wpml enum 99/1, payload 89/0)
    assert metadata["drone_model_key"] == "0-99-1"
    assert metadata["payload_model_keys"] == "1-89-0"

    rows = _dispatch_rows(db_session, mission_id)
    assert len(rows) == 1
    assert str(rows[0].wayline_id) == body["wayline_id"]

    # dispatch reuses the export pipeline, so the status side effect matches export
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "EXPORTED"


def test_redispatch_updates_in_place(client, dispatchable_mission, fake_hub, db_session):
    """a second dispatch reuses the row and the wayline uuid - no duplicates."""
    mission_id = dispatchable_mission["mission_id"]

    first = client.post(f"/api/v1/missions/{mission_id}/dispatch").json()
    second = client.post(f"/api/v1/missions/{mission_id}/dispatch").json()

    assert second["id"] == first["id"]
    assert second["wayline_id"] == first["wayline_id"]
    assert len(fake_hub) == 2
    assert fake_hub[1]["metadata"]["wayline_id"] == first["wayline_id"]

    rows = _dispatch_rows(db_session, mission_id)
    assert len(rows) == 1


def test_dispatch_measured_mission_succeeds(
    client, dispatchable_mission, fake_hub, db_session, db_engine
):
    """a MEASURED mission dispatches (no 409), persists the row, stays MEASURED."""
    mission_id = dispatchable_mission["mission_id"]
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE mission SET status=:s WHERE id=:id"),
            {"s": MissionStatus.MEASURED.value, "id": mission_id},
        )
        conn.commit()

    response = client.post(f"/api/v1/missions/{mission_id}/dispatch")
    assert response.status_code == 200, response.text

    rows = _dispatch_rows(db_session, mission_id)
    assert len(rows) == 1

    # dispatch must not bump MEASURED -> EXPORTED (the transition keys on VALIDATED)
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "MEASURED"


def test_dispatch_draft_mission_409(client, airport_id, fake_hub, db_session):
    """the export status gate applies - DRAFT missions are refused."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Draft Dispatch", "airport_id": airport_id},
    ).json()

    response = client.post(f"/api/v1/missions/{mission['id']}/dispatch")

    assert response.status_code == 409
    assert fake_hub == []
    assert _dispatch_rows(db_session, mission["id"]) == []


def test_dispatch_hub_down_502_and_nothing_persists(
    client, dispatchable_mission, monkeypatch, db_session
):
    """hub unreachable -> 502; no dispatch row, status transition rolled back."""
    mission_id = dispatchable_mission["mission_id"]

    def _down(kmz_bytes, metadata, transport=None):
        """simulate an unreachable hub."""
        raise DomainError("field hub unreachable - wayline not dispatched", status_code=502)

    monkeypatch.setattr(wayline_dispatch_service, "_post_kmz_to_hub", _down)

    response = client.post(f"/api/v1/missions/{mission_id}/dispatch")

    assert response.status_code == 502
    assert _dispatch_rows(db_session, mission_id) == []

    # the VALIDATED -> EXPORTED transition flushed inside the service must not stick
    mission = client.get(f"/api/v1/missions/{mission_id}").json()
    assert mission["status"] == "VALIDATED"


def test_dispatch_unconfigured_hub_502(client, dispatchable_mission, monkeypatch, db_session):
    """an unset fieldhub_url means no hub in this deployment - 502, nothing stored."""
    mission_id = dispatchable_mission["mission_id"]
    monkeypatch.setattr(settings, "fieldhub_url", "")

    response = client.post(f"/api/v1/missions/{mission_id}/dispatch")

    assert response.status_code == 502
    assert _dispatch_rows(db_session, mission_id) == []


def test_dispatch_logs_audit_row(client, dispatchable_mission, fake_hub, db_session):
    """DISPATCH audit row lands with the wayline id in details."""
    from app.models.audit_log import AuditLog

    mission_id = dispatchable_mission["mission_id"]
    body = client.post(f"/api/v1/missions/{mission_id}/dispatch").json()

    db_session.expire_all()
    rows = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "DISPATCH", AuditLog.entity_id == mission_id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].entity_type == "Mission"
    assert rows[0].details["wayline_id"] == body["wayline_id"]
    assert rows[0].details["acknowledge_altitude_clamps"] is False


def test_dispatch_forwards_export_options(client, dispatchable_mission, fake_hub, db_session):
    """dispatch threads the export options (geozones + heading mode) through
    export_mission, so the dispatched KMZ matches a download of the same config.

    proven via the heading write-back: export_mission persists the override as
    the operator's last-used preference, exactly like a download export. the
    audit row records every forwarded flag.
    """
    from app.models.audit_log import AuditLog
    from app.models.mission import Mission

    mission_id = dispatchable_mission["mission_id"]
    resp = client.post(
        f"/api/v1/missions/{mission_id}/dispatch",
        json={"dji_heading_mode_override": "followWayline"},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    persisted = db_session.query(Mission).filter(Mission.id == mission_id).first()
    # export_mission applied + persisted the forwarded override
    assert persisted.dji_heading_mode == "followWayline"

    row = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "DISPATCH", AuditLog.entity_id == mission_id)
        .one()
    )
    assert row.details["dji_heading_mode_override"] == "followWayline"
    assert row.details["include_geozones"] is False
    assert row.details["include_runway_buffers"] is False


def test_dispatch_rolls_back_when_audit_fails(
    client, dispatchable_mission, fake_hub, db_session, monkeypatch
):
    """if log_audit raises, the dispatch row must not persist (same-transaction rule)."""
    from app.api.routes.missions import core as missions_route

    mission_id = dispatchable_mission["mission_id"]

    def _boom(*args, **kwargs):
        """force the audit insert to fail."""
        raise RuntimeError("audit-insert-failure")

    monkeypatch.setattr(missions_route, "log_audit", _boom)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(f"/api/v1/missions/{mission_id}/dispatch")

    monkeypatch.undo()

    assert _dispatch_rows(db_session, mission_id) == []


# hub register seam


def test_post_kmz_to_hub_sends_secret_and_multipart(monkeypatch):
    """register call carries the shared secret, form metadata, and the kmz file."""
    monkeypatch.setattr(settings, "fieldhub_url", "https://fieldhub:8443")
    monkeypatch.setattr(settings, "fieldhub_shared_secret", "s3cret")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        """fake hub register endpoint."""
        seen["path"] = request.url.path
        seen["secret"] = request.headers.get("X-Hub-Secret")
        seen["body"] = request.read()
        return httpx.Response(200, json={"wayline_id": "w", "mission_id": "m", "object_key": "k"})

    wayline_dispatch_service._post_kmz_to_hub(
        b"kmz-bytes",
        {
            "wayline_id": "w-1",
            "mission_id": "m-1",
            "name": "Mission",
            "drone_model_key": "0-99-1",
            "payload_model_keys": "1-89-0",
            "sign": "abc",
            "object_key": "wayline/w-1.kmz",
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen["path"] == "/internal/api/v1/waylines"
    assert seen["secret"] == "s3cret"
    assert b"kmz-bytes" in seen["body"]
    assert b'name="wayline_id"' in seen["body"]


def test_post_kmz_to_hub_raises_502_on_connect_error(monkeypatch):
    """transport failure surfaces as a 502 domain error."""
    monkeypatch.setattr(settings, "fieldhub_url", "https://fieldhub:8443")

    def handler(request):
        """simulate a refused connection."""
        raise httpx.ConnectError("refused")

    with pytest.raises(DomainError) as exc:
        wayline_dispatch_service._post_kmz_to_hub(
            b"x", {"object_key": "wayline/x.kmz"}, transport=httpx.MockTransport(handler)
        )
    assert exc.value.status_code == 502


def test_post_kmz_to_hub_raises_502_on_hub_error_response(monkeypatch):
    """a non-2xx hub answer also fails the dispatch."""
    monkeypatch.setattr(settings, "fieldhub_url", "https://fieldhub:8443")
    transport = httpx.MockTransport(lambda request: httpx.Response(500))

    with pytest.raises(DomainError) as exc:
        wayline_dispatch_service._post_kmz_to_hub(
            b"x", {"object_key": "wayline/x.kmz"}, transport=transport
        )
    assert exc.value.status_code == 502
