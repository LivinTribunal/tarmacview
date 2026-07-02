"""measurement endpoints - create/status/preview/confirm flow with enqueue stubbed."""

import itertools
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.constants import (
    DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG,
    DEFAULT_ILS_HARMONIZATION_TOLERANCE_DEG,
)
from app.core.enums import MeasurementStatus
from app.models.audit_log import AuditLog
from app.models.measurement import Measurement
from app.models.mission import Mission
from app.services import measurement_service
from tests.data.airports import AIRPORT_PAYLOAD
from tests.data.trajectory import (
    TRAJECTORY_AGL_PAYLOAD,
    TRAJECTORY_SURFACE_PAYLOAD,
    make_lha_payload,
)

_icao_counter = itertools.count()


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MA' prefix keeps this file's codes out of
    the shared session db's AAAA.. range that other test modules also write."""
    n = next(_icao_counter)
    return f"MA{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the api-test inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "API Measure Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def inspection_with_media(client, template_id):
    """fresh airport/mission/inspection + one media row per test."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "API Measure", "airport_id": apt["id"]}
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
            "object_key": "drone-media/manual/api.mp4",
            "filename": "api.mp4",
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


def test_create_measurement_queues_first_frame(client, inspection_with_media, _stub_enqueue):
    """POST starts a run (QUEUED) and enqueues the first-frame task."""
    r = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "QUEUED"
    assert body["inspection_id"] == inspection_with_media
    assert len(_stub_enqueue["first_frame"]) == 1


def test_create_measurement_missing_inspection_is_404(client):
    """an unknown inspection cannot start a run."""
    r = client.post(f"/api/v1/inspections/{uuid4()}/measurement")
    assert r.status_code == 404


def test_status_and_preview_poll(client, inspection_with_media):
    """status + preview reflect the run's phase; preview has no image yet."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    mid = created["id"]

    status = client.get(f"/api/v1/measurements/{mid}/status")
    assert status.status_code == 200
    assert status.json()["status"] == "QUEUED"

    preview = client.get(f"/api/v1/measurements/{mid}/preview")
    assert preview.status_code == 200
    assert preview.json()["first_frame_url"] is None


def test_status_unknown_measurement_is_404(client):
    """polling an unknown measurement 404s."""
    assert client.get(f"/api/v1/measurements/{uuid4()}/status").status_code == 404


def test_confirm_lights_requires_awaiting_confirm(client, inspection_with_media):
    """confirm-lights on a QUEUED run is rejected (409)."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    r = client.post(
        f"/api/v1/measurements/{created['id']}/confirm-lights",
        json={"boxes": [{"light_name": "PAPI_A", "x": 10, "y": 50, "size": 8}]},
    )
    assert r.status_code == 409


def test_confirm_lights_starts_processing(
    client, db_engine, inspection_with_media, _stub_enqueue, monkeypatch
):
    """once AWAITING_CONFIRM, confirm-lights moves to PROCESSING and enqueues it."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    mid = created["id"]

    # drive the run to AWAITING_CONFIRM via the worker step (engine + storage stubbed)
    monkeypatch.setattr(
        measurement_service.object_storage,
        "download_file",
        lambda key, dest: open(dest, "wb").close(),
    )
    monkeypatch.setattr(measurement_service.object_storage, "upload_file", lambda *a, **k: None)
    # confident=False keeps the run at AWAITING_CONFIRM so confirm-lights drives it on
    monkeypatch.setattr(
        measurement_service,
        "extract_first_frame_and_detect",
        lambda video, image, refs: ({"fps": 30}, {"PAPI_A": {"x": 10, "y": 50, "size": 8}}, False),
    )
    s = sessionmaker(bind=db_engine)()
    try:
        measurement_service.run_first_frame(s, __import__("uuid").UUID(mid))
    finally:
        s.close()

    r = client.post(
        f"/api/v1/measurements/{mid}/confirm-lights",
        json={"boxes": [{"light_name": "PAPI_A", "x": 12, "y": 52, "size": 9}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == MeasurementStatus.PROCESSING.value
    assert len(_stub_enqueue["processing"]) == 1


def _seed_artifacts(db_engine, measurement_id: str) -> set[str]:
    """attach object-storage keys to a created run so delete has artifacts to drop."""
    s = sessionmaker(bind=db_engine)()
    try:
        m = s.query(Measurement).filter(Measurement.id == UUID(measurement_id)).first()
        m.object_key = "measurements/x/results.json.gz"
        m.first_frame_object_key = "measurements/x/first_frame.jpg"
        m.annotated_video_keys = {"PAPI_A": "measurements/x/PAPI_A.mp4"}
        s.commit()
    finally:
        s.close()
    return {
        "measurements/x/results.json.gz",
        "measurements/x/first_frame.jpg",
        "measurements/x/PAPI_A.mp4",
    }


def test_delete_measurement_removes_row_drops_artifacts_and_audits(
    client, db_engine, inspection_with_media, monkeypatch
):
    """DELETE removes the run, writes a DELETE audit row, and drops every artifact key."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    mid = created["id"]
    expected_keys = _seed_artifacts(db_engine, mid)

    dropped: list[str] = []
    monkeypatch.setattr(
        measurement_service.object_storage, "delete_object", lambda key: dropped.append(key)
    )

    r = client.delete(f"/api/v1/measurements/{mid}")
    assert r.status_code == 204, r.text

    # the row is gone
    assert client.get(f"/api/v1/measurements/{mid}/status").status_code == 404

    # every artifact key was dropped after the commit (best-effort, post-commit)
    assert set(dropped) == expected_keys

    # exactly one DELETE audit row on Measurement
    s = sessionmaker(bind=db_engine)()
    try:
        rows = (
            s.query(AuditLog)
            .filter(
                AuditLog.action == "DELETE",
                AuditLog.entity_type == "Measurement",
                AuditLog.entity_id == UUID(mid),
            )
            .all()
        )
    finally:
        s.close()
    assert len(rows) == 1
    assert rows[0].airport_id is not None


def test_delete_measurement_missing_is_404(client):
    """deleting an unknown measurement 404s."""
    assert client.delete(f"/api/v1/measurements/{uuid4()}").status_code == 404


def test_patch_measurement_sets_label_and_round_trips(client, db_engine, inspection_with_media):
    """PATCH sets the label; it round-trips through the aggregate + results and audits UPDATE."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    mid = created["id"]
    assert created["label"] is None

    r = client.patch(f"/api/v1/measurements/{mid}", json={"label": "morning re-fly"})
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "morning re-fly"

    # round-trips through the full aggregate and the results payload
    assert client.get(f"/api/v1/measurements/{mid}").json()["label"] == "morning re-fly"
    assert client.get(f"/api/v1/measurements/{mid}/data").json()["label"] == "morning re-fly"

    # one UPDATE audit row on Measurement
    s = sessionmaker(bind=db_engine)()
    try:
        rows = (
            s.query(AuditLog)
            .filter(
                AuditLog.action == "UPDATE",
                AuditLog.entity_type == "Measurement",
                AuditLog.entity_id == UUID(mid),
            )
            .all()
        )
    finally:
        s.close()
    assert len(rows) == 1
    assert rows[0].entity_name == "morning re-fly"


def test_patch_measurement_blank_label_clears_it(client, inspection_with_media):
    """a blank/whitespace label clears the column so the UI falls back to the inspection label."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    mid = created["id"]
    client.patch(f"/api/v1/measurements/{mid}", json={"label": "temp"})

    r = client.patch(f"/api/v1/measurements/{mid}", json={"label": "   "})
    assert r.status_code == 200
    assert r.json()["label"] is None


def test_patch_label_appears_in_airport_list_and_results_carry_inspection_context(
    client, template_id
):
    """a labelled run carries its label into the airport list + inspection context into results."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Label List", "airport_id": apt["id"]}
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
            "object_key": "drone-media/manual/lbl.mp4",
            "filename": "lbl.mp4",
            "size_bytes": 1024,
        },
    )
    created = client.post(f"/api/v1/inspections/{insp['id']}/measurement").json()
    client.patch(f"/api/v1/measurements/{created['id']}", json={"label": "named run"})

    rows = client.get(f"/api/v1/airports/{apt['id']}/measurements").json()
    assert any(r["id"] == created["id"] and r["label"] == "named run" for r in rows)

    # results carry the inspection context that powers the blank-label fallback
    data = client.get(f"/api/v1/measurements/{created['id']}/data").json()
    assert data["inspection_method"] == "HORIZONTAL_RANGE"
    assert data["inspection_sequence_order"] == insp["sequence_order"]


def test_to_response_maps_full_aggregate():
    """service to_response renders every field of a populated row (layering-move guard)."""
    from datetime import datetime, timezone

    insp_id, lha_id = uuid4(), uuid4()
    m = Measurement(
        id=uuid4(),
        inspection_id=insp_id,
        status=MeasurementStatus.DONE.value,
        runway_heading=187.0,
        reference_points=[
            {
                "light_name": "PAPI_A",
                "latitude": 48.1,
                "longitude": 17.2,
                "elevation": 133.0,
                "lha_id": str(lha_id),
                "unit_designator": "A",
                "setting_angle": 3.0,
                "tolerance": 0.17,
            }
        ],
        light_boxes=[{"light_name": "PAPI_A", "x": 10.0, "y": 50.0, "size": 8.0}],
        summaries=[
            {
                "light_name": "PAPI_A",
                "setting_angle": 3.0,
                "tolerance": 0.17,
                "measured_transition_angle": 3.05,
                "passed": True,
            }
        ],
        object_key="measurements/x/results.json.gz",
        first_frame_object_key="measurements/x/first_frame.jpg",
        created_at=datetime(2026, 6, 14, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 14, tzinfo=timezone.utc),
    )

    resp = measurement_service.to_response(m)
    assert resp.id == m.id
    assert resp.inspection_id == insp_id
    assert resp.status == "DONE"
    assert resp.runway_heading == 187.0
    assert resp.reference_points[0].lha_id == lha_id
    assert resp.reference_points[0].setting_angle == 3.0
    assert resp.light_boxes[0].light_name == "PAPI_A"
    assert resp.summaries[0].passed is True
    assert resp.summaries[0].measured_transition_angle == 3.05
    assert resp.object_key.endswith("results.json.gz")
    assert resp.first_frame_object_key.endswith("first_frame.jpg")


# measurement kickoff -> mission MEASURED transition


def _mission_with_inspection_media(client, template_id, n_inspections=1):
    """fresh airport/mission with n inspections, each carrying one media row."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Kickoff", "airport_id": apt["id"]}
    ).json()
    insp_ids = []
    for _ in range(n_inspections):
        insp = client.post(
            f"/api/v1/missions/{mission['id']}/inspections",
            json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
        ).json()
        client.post(
            "/api/v1/drone-media/complete-upload",
            json={
                "mission_id": mission["id"],
                "inspection_id": insp["id"],
                "object_key": f"drone-media/manual/{insp['id']}.mp4",
                "filename": "k.mp4",
                "size_bytes": 2048,
            },
        )
        insp_ids.append(insp["id"])
    return mission["id"], insp_ids


def _set_mission_status(db_engine, mission_id, status):
    """force a mission to a status for kickoff setup (bypasses the state machine)."""
    s = sessionmaker(bind=db_engine)()
    try:
        m = s.query(Mission).filter(Mission.id == UUID(mission_id)).first()
        m.status = status
        s.commit()
    finally:
        s.close()


@pytest.mark.parametrize("start", ["VALIDATED", "EXPORTED"])
def test_create_measurement_marks_mission_measured(client, db_engine, template_id, start):
    """creating a measurement for a VALIDATED/EXPORTED mission flips it to MEASURED."""
    mission_id, insp_ids = _mission_with_inspection_media(client, template_id)
    _set_mission_status(db_engine, mission_id, start)

    r = client.post(f"/api/v1/inspections/{insp_ids[0]}/measurement")
    assert r.status_code == 200, r.text
    assert client.get(f"/api/v1/missions/{mission_id}").json()["status"] == "MEASURED"


def test_second_inspection_create_keeps_mission_measured(client, db_engine, template_id):
    """a second inspection's create leaves an already-MEASURED mission MEASURED (idempotent)."""
    mission_id, insp_ids = _mission_with_inspection_media(client, template_id, n_inspections=2)
    _set_mission_status(db_engine, mission_id, "VALIDATED")

    assert client.post(f"/api/v1/inspections/{insp_ids[0]}/measurement").status_code == 200
    assert client.get(f"/api/v1/missions/{mission_id}").json()["status"] == "MEASURED"

    assert client.post(f"/api/v1/inspections/{insp_ids[1]}/measurement").status_code == 200
    assert client.get(f"/api/v1/missions/{mission_id}").json()["status"] == "MEASURED"


def test_create_measurement_on_draft_does_not_transition(client, template_id):
    """creating a measurement for a non-POST_PLAN mission does not transition it."""
    mission_id, insp_ids = _mission_with_inspection_media(client, template_id)

    assert client.post(f"/api/v1/inspections/{insp_ids[0]}/measurement").status_code == 200
    assert client.get(f"/api/v1/missions/{mission_id}").json()["status"] == "DRAFT"


def _snapshot_glide_slope(client, db_engine, template_id, agl_override):
    """run a measurement for a fresh PAPI inspection; return its snapshotted (angle, tolerance)."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**TRAJECTORY_AGL_PAYLOAD, **agl_override},  # glide_slope_angle = 3.0
    ).json()
    lha_ids = [
        client.post(
            f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        ).json()["id"]
        for i in (1, 2)
    ]
    mission = client.post(
        "/api/v1/missions", json={"name": "Snapshot", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_ids": lha_ids},
        },
    ).json()
    client.post(
        "/api/v1/drone-media/complete-upload",
        json={
            "mission_id": mission["id"],
            "inspection_id": insp["id"],
            "object_key": "drone-media/manual/snap.mp4",
            "filename": "snap.mp4",
            "size_bytes": 2048,
        },
    )

    mid = client.post(f"/api/v1/inspections/{insp['id']}/measurement").json()["id"]

    s = sessionmaker(bind=db_engine)()
    try:
        row = s.query(Measurement).filter(Measurement.id == UUID(mid)).first()
        return row.glide_slope_angle, row.glide_slope_angle_tolerance
    finally:
        s.close()


def test_create_measurement_snapshots_glide_slope_from_agl(client, db_engine, template_id):
    """the run snapshots the AGL glide slope + the AGL's configured tolerance."""
    angle, tolerance = _snapshot_glide_slope(
        client, db_engine, template_id, {"glide_slope_angle_tolerance": 0.3}
    )
    assert angle == 3.0
    assert tolerance == 0.3


def test_create_measurement_glide_slope_tolerance_falls_back_to_default(
    client, db_engine, template_id
):
    """an AGL with no tolerance set falls back to the default verdict band."""
    _, tolerance = _snapshot_glide_slope(client, db_engine, template_id, {})
    assert tolerance == DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG


def test_create_measurement_no_tolerance_band_without_glide_slope(client, db_engine, template_id):
    """no configured glide slope - no tolerance band (fallback is gated on the angle)."""
    angle, tolerance = _snapshot_glide_slope(
        client, db_engine, template_id, {"glide_slope_angle": None}
    )
    assert angle is None
    assert tolerance is None


_TOUCHPOINT = {
    "touchpoint_latitude": 50.101,
    "touchpoint_longitude": 14.241,
    "touchpoint_altitude": 300.0,
}


def _snapshot_ils(client, db_engine, template_id, *, surface_override, agl_override):
    """run a measurement for a fresh PAPI inspection; return (row, apt, surface, agl) ids.

    the surface can carry a touchpoint and the AGL an ils tolerance so the snapshot resolves
    both the touchpoint triple and the harmonization tolerance at create time.
    """
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json={**TRAJECTORY_SURFACE_PAYLOAD, **surface_override},
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**TRAJECTORY_AGL_PAYLOAD, **agl_override},
    ).json()
    lha_ids = [
        client.post(
            f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        ).json()["id"]
        for i in (1, 2)
    ]
    mission = client.post(
        "/api/v1/missions", json={"name": "IlsSnap", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_ids": lha_ids},
        },
    ).json()
    client.post(
        "/api/v1/drone-media/complete-upload",
        json={
            "mission_id": mission["id"],
            "inspection_id": insp["id"],
            "object_key": "drone-media/manual/ils.mp4",
            "filename": "ils.mp4",
            "size_bytes": 2048,
        },
    )
    mid = client.post(f"/api/v1/inspections/{insp['id']}/measurement").json()["id"]
    s = sessionmaker(bind=db_engine)()
    try:
        row = s.query(Measurement).filter(Measurement.id == UUID(mid)).first()
        s.expunge(row)
    finally:
        s.close()
    return row, apt["id"], surface["id"], agl["id"]


def test_create_measurement_snapshots_touchpoint_and_ils_tolerance(client, db_engine, template_id):
    """the run snapshots the surface touchpoint triple + the AGL's ils tolerance."""
    row, *_ = _snapshot_ils(
        client,
        db_engine,
        template_id,
        surface_override=_TOUCHPOINT,
        agl_override={"ils_harmonization_tolerance": 0.03},
    )
    assert row.touchpoint_latitude == pytest.approx(50.101)
    assert row.touchpoint_longitude == pytest.approx(14.241)
    assert row.touchpoint_altitude == pytest.approx(300.0)
    assert row.ils_harmonization_tolerance == pytest.approx(0.03)


def test_create_measurement_ils_tolerance_falls_back_to_default(client, db_engine, template_id):
    """an AGL with no ils tolerance set falls back to the default harmonization band."""
    row, *_ = _snapshot_ils(
        client, db_engine, template_id, surface_override=_TOUCHPOINT, agl_override={}
    )
    assert row.ils_harmonization_tolerance == DEFAULT_ILS_HARMONIZATION_TOLERANCE_DEG


def test_create_measurement_no_touchpoint_leaves_snapshot_null(client, db_engine, template_id):
    """a surface without a touchpoint leaves the run's touchpoint columns null (degrades later)."""
    row, *_ = _snapshot_ils(client, db_engine, template_id, surface_override={}, agl_override={})
    assert row.touchpoint_latitude is None
    assert row.touchpoint_longitude is None
    assert row.touchpoint_altitude is None


def test_snapshot_reproducible_after_later_agl_edit(client, db_engine, template_id):
    """editing the AGL tolerance after create does not rewrite the run's snapshot."""
    row, apt_id, surface_id, agl_id = _snapshot_ils(
        client,
        db_engine,
        template_id,
        surface_override=_TOUCHPOINT,
        agl_override={"ils_harmonization_tolerance": 0.03},
    )
    # a later coordinator edit of the AGL tolerance
    client.put(
        f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}",
        json={"ils_harmonization_tolerance": 0.09},
    )
    s = sessionmaker(bind=db_engine)()
    try:
        refetched = s.query(Measurement).filter(Measurement.id == row.id).first()
        assert refetched.ils_harmonization_tolerance == pytest.approx(0.03)
    finally:
        s.close()
