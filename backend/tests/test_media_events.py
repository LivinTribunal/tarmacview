"""hub-to-backend media events - secret gate, persistence, idempotency, audit."""

import pytest

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.drone_media_file import DroneMediaFile

PATH = "/api/v1/field-link/media-events"
HUB_SECRET = "s3cret"


def _event(fingerprint: str, **overrides) -> dict:
    """media-event body as the hub posts it."""
    payload = {
        "object_key": "media/DJI_20260609142133_0001.JPG",
        "fingerprint": fingerprint,
        "captured_at": "2026-06-09T14:21:33+02:00",
        "position": {"type": "Point", "coordinates": [17.21, 48.17, 423.6]},
        "device_sn": "1ZNBJ7R0010078",
        "raw_callback": {"fingerprint": fingerprint, "ext": {"sn": "1ZNBJ7R0010078"}},
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def hub_secret(monkeypatch):
    """configure the shared secret and return the matching header."""
    monkeypatch.setattr(settings, "fieldhub_shared_secret", HUB_SECRET)
    return {"X-Hub-Secret": HUB_SECRET}


def test_unconfigured_secret_returns_503(client, monkeypatch):
    """no shared secret in this deployment -> 503, nothing persisted."""
    monkeypatch.setattr(settings, "fieldhub_shared_secret", "")

    response = client.post(PATH, json=_event("fp-unconfigured"))

    assert response.status_code == 503


def test_missing_or_wrong_secret_returns_403(client, hub_secret):
    """missing or mismatched header -> 403."""
    missing = client.post(PATH, json=_event("fp-missing-secret"))
    assert missing.status_code == 403

    wrong = client.post(PATH, json=_event("fp-wrong-secret"), headers={"X-Hub-Secret": "not-it"})
    assert wrong.status_code == 403


def test_event_persists_row_and_runs_matching(client, hub_secret, db_session):
    """happy path -> 201, row stored with WKT position and auto-matched.

    no dispatched mission covers this capture, so matching parks the row
    in the unassigned bucket instead of leaving it RECEIVED.
    """
    response = client.post(PATH, json=_event("fp-happy"), headers=hub_secret)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "UNASSIGNED"
    assert body["fingerprint"] == "fp-happy"
    assert body["object_key"] == "media/DJI_20260609142133_0001.JPG"
    assert body["mission_id"] is None
    # device-reported capture time survives, with its offset
    assert body["captured_at"].startswith("2026-06-09T")
    assert body["capture_position"]["coordinates"] == [17.21, 48.17, 423.6]
    assert body["received_at"]

    row = db_session.query(DroneMediaFile).filter(DroneMediaFile.fingerprint == "fp-happy").one()
    assert row.status == "UNASSIGNED"
    assert row.capture_position == "POINT Z (17.21 48.17 423.6)"
    assert row.device_sn == "1ZNBJ7R0010078"
    assert row.raw_callback["ext"]["sn"] == "1ZNBJ7R0010078"


def test_event_without_position_persists_null(client, hub_secret, db_session):
    """capture gps is optional - missing shoot position stays null."""
    response = client.post(PATH, json=_event("fp-no-gps", position=None), headers=hub_secret)

    assert response.status_code == 201
    row = db_session.query(DroneMediaFile).filter(DroneMediaFile.fingerprint == "fp-no-gps").one()
    assert row.capture_position is None


def test_repost_same_fingerprint_is_idempotent(client, hub_secret, db_session):
    """hub retries return the existing row instead of a duplicate."""
    first = client.post(PATH, json=_event("fp-repost"), headers=hub_secret)
    second = client.post(PATH, json=_event("fp-repost"), headers=hub_secret)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    count = (
        db_session.query(DroneMediaFile).filter(DroneMediaFile.fingerprint == "fp-repost").count()
    )
    assert count == 1


def test_malformed_payload_returns_422(client, hub_secret):
    """missing fingerprint -> 422 at the schema boundary."""
    body = _event("fp-malformed")
    del body["fingerprint"]

    response = client.post(PATH, json=body, headers=hub_secret)

    assert response.status_code == 422


def test_audit_row_attached_once(client, hub_secret, db_session):
    """create logs one system audit row; the idempotent repost adds none."""
    client.post(PATH, json=_event("fp-audited"), headers=hub_secret)
    client.post(PATH, json=_event("fp-audited"), headers=hub_secret)

    rows = (
        db_session.query(AuditLog)
        .filter(
            AuditLog.entity_type == "DroneMediaFile",
            AuditLog.details["fingerprint"].astext == "fp-audited",
        )
        .all()
    )
    assert len(rows) == 1
    assert rows[0].action == "CREATE"
    assert rows[0].user_id is None
    assert rows[0].entity_name == "media/DJI_20260609142133_0001.JPG"
