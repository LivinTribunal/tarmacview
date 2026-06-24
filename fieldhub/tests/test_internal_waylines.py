"""internal wayline endpoints - shared-secret gated list and idempotent delete."""

import pytest

from app.core.config import settings
from app.core.db import SessionLocal
from app.models.wayline import Wayline
from app.services import object_store
from tests.data.wayline_samples import (
    RECORDED_LIST_ITEM,
    SAMPLE_KMZ_BYTES,
    SAMPLE_REGISTER_FORM,
)

REGISTER_PATH = "/internal/api/v1/waylines"
LIST_PATH = "/internal/api/v1/waylines"


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    """configure the backend shared secret for internal calls."""
    monkeypatch.setattr(settings, "shared_secret", "hub-secret")


@pytest.fixture(autouse=True)
def fake_store(monkeypatch):
    """record object-store calls instead of dialing minio."""
    store = {"objects": {}, "removed": []}

    def put_object(object_key, data, content_type):
        """capture the stored object."""
        store["objects"][object_key] = {"data": data, "content_type": content_type}

    def remove_object(object_key):
        """capture deletions."""
        store["removed"].append(object_key)

    monkeypatch.setattr(object_store, "put_object", put_object)
    monkeypatch.setattr(object_store, "remove_object", remove_object)
    return store


@pytest.fixture(autouse=True)
def _clean_waylines():
    """wipe wayline rows between tests."""
    yield
    db = SessionLocal()
    try:
        db.query(Wayline).delete()
        db.commit()
    finally:
        db.close()


def _hub_headers() -> dict:
    """headers carrying the backend shared secret."""
    return {"X-Hub-Secret": "hub-secret"}


def _register(client, **overrides):
    """register a wayline through the internal endpoint."""
    form = {**SAMPLE_REGISTER_FORM, **overrides}
    filename = form["object_key"].rsplit("/", 1)[-1]
    return client.post(
        REGISTER_PATH,
        data=form,
        files={"file": (filename, SAMPLE_KMZ_BYTES, "application/vnd.google-earth.kmz")},
        headers=_hub_headers(),
    )


# list


def test_list_returns_registered_waylines_with_millis(client):
    """list serves each registered wayline with epoch-millis time fields."""
    _register(client)

    response = client.get(LIST_PATH, headers=_hub_headers())

    assert response.status_code == 200
    waylines = response.json()["waylines"]
    assert len(waylines) == 1
    item = waylines[0]
    assert item["id"] == RECORDED_LIST_ITEM["id"]
    assert item["mission_id"] == SAMPLE_REGISTER_FORM["mission_id"]
    assert item["name"] == RECORDED_LIST_ITEM["name"]
    assert item["drone_model_key"] == RECORDED_LIST_ITEM["drone_model_key"]
    assert item["payload_model_keys"] == RECORDED_LIST_ITEM["payload_model_keys"]
    assert item["object_key"] == RECORDED_LIST_ITEM["object_key"]
    assert item["favorited"] is False
    assert item["username"] == "tarmacview"
    assert isinstance(item["create_time"], int)
    assert item["create_time"] > 10**12
    assert isinstance(item["update_time"], int)


def test_list_is_newest_first(client):
    """list orders newest first."""
    for i in range(3):
        _register(
            client,
            wayline_id=f"00000000-0000-0000-0000-00000000000{i}",
            mission_id=f"10000000-0000-0000-0000-00000000000{i}",
            name=f"Mission {i}",
            object_key=f"wayline/{i}.kmz",
        )

    waylines = client.get(LIST_PATH, headers=_hub_headers()).json()["waylines"]

    assert [w["name"] for w in waylines] == ["Mission 2", "Mission 1", "Mission 0"]


def test_list_empty_registry(client):
    """no waylines yet -> empty list, not an error."""
    response = client.get(LIST_PATH, headers=_hub_headers())

    assert response.status_code == 200
    assert response.json()["waylines"] == []


def test_list_unconfigured_secret_returns_503(client, monkeypatch):
    """no shared secret configured -> 503."""
    monkeypatch.setattr(settings, "shared_secret", "")

    assert client.get(LIST_PATH, headers={"X-Hub-Secret": "anything"}).status_code == 503


def test_list_wrong_secret_returns_403(client):
    """mismatched secret -> 403."""
    assert client.get(LIST_PATH, headers={"X-Hub-Secret": "nope"}).status_code == 403


def test_list_missing_secret_returns_403(client):
    """absent header -> 403."""
    assert client.get(LIST_PATH).status_code == 403


# delete


def test_delete_removes_row_and_object(client, fake_store, db_session):
    """delete drops the library row, cleans the kmz, and reports deleted true."""
    _register(client)
    wayline_id = SAMPLE_REGISTER_FORM["wayline_id"]

    response = client.delete(f"{LIST_PATH}/{wayline_id}", headers=_hub_headers())

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert db_session.get(Wayline, wayline_id) is None
    assert fake_store["removed"] == [SAMPLE_REGISTER_FORM["object_key"]]


def test_delete_missing_id_is_idempotent(client, fake_store):
    """unknown wayline -> deleted false, http 200, no object cleanup."""
    response = client.delete(
        f"{LIST_PATH}/ffffffff-0000-0000-0000-000000000000", headers=_hub_headers()
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": False}
    assert fake_store["removed"] == []


def test_delete_unconfigured_secret_returns_503(client, monkeypatch):
    """no shared secret configured -> 503."""
    monkeypatch.setattr(settings, "shared_secret", "")

    response = client.delete(
        f"{LIST_PATH}/{SAMPLE_REGISTER_FORM['wayline_id']}", headers={"X-Hub-Secret": "anything"}
    )
    assert response.status_code == 503


def test_delete_wrong_secret_returns_403(client):
    """mismatched secret -> 403."""
    response = client.delete(
        f"{LIST_PATH}/{SAMPLE_REGISTER_FORM['wayline_id']}", headers={"X-Hub-Secret": "nope"}
    )
    assert response.status_code == 403


def test_delete_missing_secret_returns_403(client):
    """absent header -> 403."""
    assert client.delete(f"{LIST_PATH}/{SAMPLE_REGISTER_FORM['wayline_id']}").status_code == 403
