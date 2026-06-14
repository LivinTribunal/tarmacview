"""per-inspection drone media - upload, dense ordering, reorder, move, listing (T3)."""

import pytest
from sqlalchemy import text

from app.core.exceptions import DomainError
from app.models.drone_media_file import DroneMediaFile
from app.services import drone_media_service, object_storage
from tests.data.missions import MISSION_AIRPORT_PAYLOAD

PATH = "/api/v1/drone-media"


@pytest.fixture(scope="module")
def airport_id(client):
    """airport dedicated to the per-inspection media tests."""
    payload = {**MISSION_AIRPORT_PAYLOAD, "icao_code": "EPWA", "name": "Per-Inspection Media"}
    return client.post("/api/v1/airports", json=payload).json()["id"]


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template the inspections hang off."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Per-Inspection Media Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def mission_with_inspections(client, airport_id, template_id):
    """a mission with two inspections - returns (mission_id, [insp_a, insp_b])."""
    mission = client.post(
        "/api/v1/missions", json={"name": "Media Mission", "airport_id": airport_id}
    ).json()
    inspections = []
    for _ in range(2):
        r = client.post(
            f"/api/v1/missions/{mission['id']}/inspections",
            json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
        )
        inspections.append(r.json()["id"])
    return mission["id"], inspections


def _complete_upload(client, mission_id, inspection_id, name):
    """record one manual upload through the complete-upload endpoint."""
    r = client.post(
        f"{PATH}/complete-upload",
        json={
            "mission_id": mission_id,
            "inspection_id": inspection_id,
            "object_key": f"drone-media/manual/{name}",
            "filename": name,
            "size_bytes": 1234,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# upload-url


def test_upload_url_returns_presigned_target(client, monkeypatch):
    """upload-url issues a presigned PUT + object key without creating a row."""
    monkeypatch.setattr(
        object_storage, "presigned_put", lambda key, content_type=None: f"https://minio/{key}?sig=x"
    )

    r = client.post(
        f"{PATH}/upload-url", json={"filename": "clip.mp4", "content_type": "video/mp4"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["object_key"].startswith("drone-media/manual/")
    assert body["object_key"].endswith("clip.mp4")
    assert body["upload_url"].startswith("https://minio/")


# complete-upload + dense ordering


def test_complete_upload_assigns_dense_order(client, mission_with_inspections):
    """consecutive uploads on one inspection get order_index 1, 2, 3."""
    mission_id, (insp_a, _) = mission_with_inspections

    first = _complete_upload(client, mission_id, insp_a, "a1.mp4")
    second = _complete_upload(client, mission_id, insp_a, "a2.mp4")
    third = _complete_upload(client, mission_id, insp_a, "a3.mp4")

    assert [first["order_index"], second["order_index"], third["order_index"]] == [1, 2, 3]
    assert first["origin"] == "MANUAL"
    assert first["status"] == "MATCHED"
    assert first["inspection_id"] == insp_a


def test_complete_upload_cross_mission_inspection_422(client, mission_with_inspections, airport_id):
    """completing against an inspection from another mission is rejected 422."""
    mission_id, (insp_a, _) = mission_with_inspections
    other = client.post(
        "/api/v1/missions", json={"name": "Other Mission", "airport_id": airport_id}
    ).json()

    r = client.post(
        f"{PATH}/complete-upload",
        json={
            "mission_id": other["id"],
            "inspection_id": insp_a,
            "object_key": "drone-media/manual/x.mp4",
            "filename": "x.mp4",
            "size_bytes": 1,
        },
    )
    assert r.status_code == 422


def test_complete_upload_missing_mission_404(client, mission_with_inspections):
    """completing against a missing mission is 404."""
    _, (insp_a, _) = mission_with_inspections
    r = client.post(
        f"{PATH}/complete-upload",
        json={
            "mission_id": "00000000-0000-0000-0000-000000000000",
            "inspection_id": insp_a,
            "object_key": "drone-media/manual/x.mp4",
            "filename": "x.mp4",
            "size_bytes": 1,
        },
    )
    assert r.status_code == 404


# list grouped by inspection + persistence


def test_list_by_inspection_round_trips(client, mission_with_inspections):
    """media persists grouped by inspection, ordered, and survives a re-fetch."""
    mission_id, (insp_a, insp_b) = mission_with_inspections
    _complete_upload(client, mission_id, insp_a, "a1.mp4")
    _complete_upload(client, mission_id, insp_a, "a2.mp4")
    _complete_upload(client, mission_id, insp_b, "b1.mp4")

    r = client.get(f"/api/v1/missions/{mission_id}/drone-media")
    assert r.status_code == 200, r.text
    body = r.json()
    groups = {g["inspection_id"]: g for g in body["inspections"]}

    assert [f["filename"] for f in groups[insp_a]["files"]] == ["a1.mp4", "a2.mp4"]
    assert [f["order_index"] for f in groups[insp_a]["files"]] == [1, 2]
    assert [f["filename"] for f in groups[insp_b]["files"]] == ["b1.mp4"]
    assert body["unassigned"] == []


# reorder within an inspection


def test_reorder_renumbers_dense(client, mission_with_inspections):
    """reorder renumbers the inspection's media 1..N to match the supplied order."""
    mission_id, (insp_a, _) = mission_with_inspections
    f1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")
    f2 = _complete_upload(client, mission_id, insp_a, "a2.mp4")
    f3 = _complete_upload(client, mission_id, insp_a, "a3.mp4")

    r = client.put(
        f"{PATH}/inspections/{insp_a}/reorder",
        json={"ordered_ids": [f3["id"], f1["id"], f2["id"]]},
    )
    assert r.status_code == 200, r.text
    group = r.json()
    assert [f["id"] for f in group["files"]] == [f3["id"], f1["id"], f2["id"]]
    assert [f["order_index"] for f in group["files"]] == [1, 2, 3]


def test_reorder_rejects_non_permutation_422(client, mission_with_inspections):
    """reorder with ids that aren't the inspection's full media set is 422."""
    mission_id, (insp_a, _) = mission_with_inspections
    f1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")
    _complete_upload(client, mission_id, insp_a, "a2.mp4")

    r = client.put(
        f"{PATH}/inspections/{insp_a}/reorder",
        json={"ordered_ids": [f1["id"]]},
    )
    assert r.status_code == 422


# move between inspections


def test_move_redensifies_source_and_dest(client, mission_with_inspections):
    """moving a file out of A into B re-densifies both inspections 1..N."""
    mission_id, (insp_a, insp_b) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")
    a2 = _complete_upload(client, mission_id, insp_a, "a2.mp4")
    b1 = _complete_upload(client, mission_id, insp_b, "b1.mp4")

    r = client.put(f"{PATH}/{a1['id']}/move", json={"inspection_id": insp_b, "order_index": 1})
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["inspection_id"] == insp_b
    assert moved["order_index"] == 1

    body = client.get(f"/api/v1/missions/{mission_id}/drone-media").json()
    groups = {g["inspection_id"]: g for g in body["inspections"]}
    # source closed its gap: a2 is now the lone row at order 1
    assert [(f["id"], f["order_index"]) for f in groups[insp_a]["files"]] == [(a2["id"], 1)]
    # dest densified: moved a1 at 1, original b1 shifted to 2
    assert [(f["id"], f["order_index"]) for f in groups[insp_b]["files"]] == [
        (a1["id"], 1),
        (b1["id"], 2),
    ]


def test_move_to_unassigned_detaches(client, mission_with_inspections):
    """moving with a null inspection detaches the file to the unassigned bucket."""
    mission_id, (insp_a, _) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")

    r = client.put(f"{PATH}/{a1['id']}/move", json={"inspection_id": None})
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["inspection_id"] is None
    assert moved["order_index"] is None

    body = client.get(f"/api/v1/missions/{mission_id}/drone-media").json()
    assert [f["id"] for f in body["unassigned"]] == [a1["id"]]


def test_move_cross_mission_inspection_422(
    client, mission_with_inspections, airport_id, template_id
):
    """moving into an inspection of a different mission is rejected 422."""
    mission_id, (insp_a, _) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")

    other = client.post(
        "/api/v1/missions", json={"name": "Foreign Mission", "airport_id": airport_id}
    ).json()
    foreign = client.post(
        f"/api/v1/missions/{other['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()["id"]

    r = client.put(f"{PATH}/{a1['id']}/move", json={"inspection_id": foreign})
    assert r.status_code == 422


def test_move_missing_media_404(client):
    """moving a media id that doesn't exist is 404."""
    r = client.put(
        f"{PATH}/00000000-0000-0000-0000-000000000000/move",
        json={"inspection_id": None},
    )
    assert r.status_code == 404


# delete


def test_delete_redensifies_inspection_and_drops_object(
    client, mission_with_inspections, monkeypatch
):
    """deleting a manual file removes it, drops its object, and renumbers 1..N."""
    deleted_keys = []
    monkeypatch.setattr(object_storage, "delete_object", lambda key: deleted_keys.append(key))

    mission_id, (insp_a, _) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")
    a2 = _complete_upload(client, mission_id, insp_a, "a2.mp4")
    a3 = _complete_upload(client, mission_id, insp_a, "a3.mp4")

    r = client.delete(f"{PATH}/{a2['id']}")
    assert r.status_code == 204, r.text
    assert deleted_keys == [a2["object_key"]]

    body = client.get(f"/api/v1/missions/{mission_id}/drone-media").json()
    groups = {g["inspection_id"]: g for g in body["inspections"]}
    assert [(f["id"], f["order_index"]) for f in groups[insp_a]["files"]] == [
        (a1["id"], 1),
        (a3["id"], 2),
    ]


def test_delete_missing_media_404(client):
    """deleting a media id that doesn't exist is 404."""
    r = client.delete(f"{PATH}/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# model-level guards


def test_validate_order_target_guard():
    """the model range guard rejects out-of-band targets with 422."""
    DroneMediaFile.validate_order_target(1, 1)
    DroneMediaFile.validate_order_target(3, 3)
    with pytest.raises(DomainError) as exc:
        DroneMediaFile.validate_order_target(0, 2)
    assert exc.value.status_code == 422
    with pytest.raises(DomainError):
        DroneMediaFile.validate_order_target(3, 2)


def test_origin_check_rejects_bad_value(db_engine):
    """the origin CHECK constraint rejects values outside the enum (rolled back)."""
    with db_engine.connect() as conn:
        with pytest.raises(Exception) as exc:
            conn.execute(
                text(
                    "INSERT INTO drone_media_file "
                    "(id, object_key, origin, status, received_at, updated_at) "
                    "VALUES (gen_random_uuid(), 'k', 'BOGUS', 'RECEIVED', now(), now())"
                )
            )
        # connection closes without commit - nothing persists
    assert "ck_drone_media_file_origin" in str(exc.value)


def test_null_fingerprint_rows_coexist(db_engine):
    """the partial unique index lets multiple null-fingerprint manual rows coexist."""
    with db_engine.connect() as conn:
        # both inserts succeed under one (uncommitted, rolled-back) transaction;
        # a column UNIQUE would raise on the second
        for key in ("manual-a", "manual-b"):
            conn.execute(
                text(
                    "INSERT INTO drone_media_file "
                    "(id, object_key, fingerprint, origin, status, received_at, updated_at) "
                    "VALUES (gen_random_uuid(), :k, NULL, 'MANUAL', 'MATCHED', now(), now())"
                ),
                {"k": key},
            )
        conn.rollback()


def test_service_move_after_ingest_blocked_409(client, mission_with_inspections, db_session):
    """a move on an INGESTED row raises the model's 409 block."""
    mission_id, (insp_a, insp_b) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")

    # flush (not commit) so the INGESTED status stays inside the rolled-back session
    row = db_session.query(DroneMediaFile).filter(DroneMediaFile.id == a1["id"]).first()
    row.status = "INGESTED"
    db_session.flush()

    with pytest.raises(DomainError) as exc:
        drone_media_service.move_media(db_session, a1["id"], insp_b, None)
    assert exc.value.status_code == 409


def test_service_delete_rejects_hub_origin_422(client, mission_with_inspections, db_session):
    """only manual uploads are deletable - a hub-origin row raises 422."""
    mission_id, (insp_a, _) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")

    row = db_session.query(DroneMediaFile).filter(DroneMediaFile.id == a1["id"]).first()
    row.origin = "HUB"
    db_session.flush()

    with pytest.raises(DomainError) as exc:
        drone_media_service.delete_media(db_session, a1["id"])
    assert exc.value.status_code == 422


def test_service_delete_after_ingest_blocked_409(client, mission_with_inspections, db_session):
    """a delete on an INGESTED row raises the model's 409 block."""
    mission_id, (insp_a, _) = mission_with_inspections
    a1 = _complete_upload(client, mission_id, insp_a, "a1.mp4")

    row = db_session.query(DroneMediaFile).filter(DroneMediaFile.id == a1["id"]).first()
    row.status = "INGESTED"
    db_session.flush()

    with pytest.raises(DomainError) as exc:
        drone_media_service.delete_media(db_session, a1["id"])
    assert exc.value.status_code == 409
