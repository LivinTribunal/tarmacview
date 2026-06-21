"""measurement iteration endpoints - iterate / iterations / compare with enqueue stubbed."""

import itertools
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audit_log import AuditLog
from app.services import measurement_service
from tests.data.airports import AIRPORT_PAYLOAD

_icao_counter = itertools.count()


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MJ' prefix is unique to this file."""
    n = next(_icao_counter)
    return f"MJ{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the iteration api-test inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Iter API Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def inspection_with_media(client, template_id):
    """fresh airport/mission/inspection + one standing media row per test."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Iter API", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    client.post(
        "/api/v1/drone-media/complete-upload",
        json={
            "mission_id": mission["id"],
            "inspection_id": insp["id"],
            "object_key": "drone-media/manual/iter-api.mp4",
            "filename": "iter-api.mp4",
            "size_bytes": 2048,
        },
    )
    return insp["id"]


@pytest.fixture(autouse=True)
def _stub_enqueue(monkeypatch):
    """record enqueue calls instead of importing celery."""
    calls = {"first_frame": [], "processing": []}
    monkeypatch.setattr(
        measurement_service, "enqueue_first_frame", lambda mid: calls["first_frame"].append(mid)
    )
    monkeypatch.setattr(
        measurement_service, "enqueue_processing", lambda mid: calls["processing"].append(mid)
    )
    return calls


def _create_root(client, inspection_id) -> dict:
    """start the mission-wide root run for an inspection."""
    return client.post(f"/api/v1/inspections/{inspection_id}/measurement").json()


def test_iterate_links_run_enqueues_and_audits(
    client, db_engine, inspection_with_media, _stub_enqueue
):
    """POST /iterate links a new run into the parent's group, enqueues it, and audits MEASURE."""
    root = _create_root(client, inspection_with_media)

    r = client.post(
        f"/api/v1/measurements/{root['id']}/iterate",
        json={"media_object_keys": ["iter/a.mp4", "iter/b.mp4"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "QUEUED"
    assert body["iteration_group_id"] == root["iteration_group_id"]
    assert body["iteration_index"] == 2
    # the iterate enqueues the first-frame task (one for the root, one for the iteration)
    enqueued = {str(mid) for mid in _stub_enqueue["first_frame"]}
    assert root["id"] in enqueued
    assert body["id"] in enqueued

    # a MEASURE audit row scoped to the iteration run
    s = sessionmaker(bind=db_engine)()
    try:
        rows = (
            s.query(AuditLog)
            .filter(
                AuditLog.action == "MEASURE",
                AuditLog.entity_type == "Measurement",
                AuditLog.entity_id == UUID(body["id"]),
            )
            .all()
        )
    finally:
        s.close()
    assert len(rows) == 1
    assert rows[0].details["parent_id"] == root["id"]
    assert rows[0].details["iteration_index"] == 2


def test_iterate_empty_keys_is_422(client, inspection_with_media):
    """an iteration with no media is rejected at the wire."""
    root = _create_root(client, inspection_with_media)
    r = client.post(f"/api/v1/measurements/{root['id']}/iterate", json={"media_object_keys": []})
    assert r.status_code == 422


def test_iterate_unknown_parent_is_404(client):
    """iterating an unknown parent 404s."""
    r = client.post(f"/api/v1/measurements/{uuid4()}/iterate", json={"media_object_keys": ["k"]})
    assert r.status_code == 404


def test_list_iterations_returns_group_ordered(client, inspection_with_media):
    """GET /iterations lists every run in the group, ascending by index."""
    root = _create_root(client, inspection_with_media)
    client.post(
        f"/api/v1/measurements/{root['id']}/iterate", json={"media_object_keys": ["i1.mp4"]}
    )
    client.post(
        f"/api/v1/measurements/{root['id']}/iterate", json={"media_object_keys": ["i2.mp4"]}
    )

    r = client.get(f"/api/v1/measurements/{root['id']}/iterations")
    assert r.status_code == 200, r.text
    indices = [item["iteration_index"] for item in r.json()]
    assert indices == [1, 2, 3]


def test_compare_endpoint_all_and_filtered(client, inspection_with_media):
    """GET /compare returns every group run, and ?iterations= narrows the set."""
    root = _create_root(client, inspection_with_media)
    client.post(
        f"/api/v1/measurements/{root['id']}/iterate", json={"media_object_keys": ["i1.mp4"]}
    )
    group_id = root["iteration_group_id"]

    full = client.get(f"/api/v1/iteration-groups/{group_id}/compare")
    assert full.status_code == 200, full.text
    body = full.json()
    assert body["group_id"] == group_id
    assert [it["iteration_index"] for it in body["iterations"]] == [1, 2]
    # four PAPI lights always present
    assert [light["light_name"] for light in body["lights"]] == [
        "PAPI_A",
        "PAPI_B",
        "PAPI_C",
        "PAPI_D",
    ]

    filtered = client.get(f"/api/v1/iteration-groups/{group_id}/compare?iterations=2")
    assert filtered.status_code == 200
    assert [it["iteration_index"] for it in filtered.json()["iterations"]] == [2]


def test_compare_unknown_group_is_404(client):
    """comparing an unknown group 404s."""
    assert client.get(f"/api/v1/iteration-groups/{uuid4()}/compare").status_code == 404
