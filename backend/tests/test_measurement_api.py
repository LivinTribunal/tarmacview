"""measurement endpoints - create/status/preview/confirm flow with enqueue stubbed."""

import itertools
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_current_user
from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import LightSummary, Measurement
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.main import app
from app.models.mission import Mission
from app.services import measurement_service
from tests.conftest import TEST_USER_ID, _override_current_user
from tests.data.airports import AIRPORT_PAYLOAD

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


# measurement kickoff transitions the mission to MEASURED


@pytest.fixture
def mission_inspection_with_media(client, template_id):
    """fresh airport/mission/inspection + one media row; returns both ids."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Kickoff Measure", "airport_id": apt["id"]}
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
            "object_key": "drone-media/manual/kickoff.mp4",
            "filename": "kickoff.mp4",
            "size_bytes": 2048,
        },
    )
    return {"mission_id": mission["id"], "inspection_id": insp["id"]}


def _force_mission_status(db_engine, mission_id, status):
    """set a mission's status directly (test setup bypasses the state machine)."""
    s = sessionmaker(bind=db_engine)()
    try:
        mission = s.query(Mission).filter(Mission.id == mission_id).first()
        mission.status = status
        s.commit()
    finally:
        s.close()


def _mission_status(client, mission_id):
    """read a mission's current status through the api."""
    return client.get(f"/api/v1/missions/{mission_id}").json()["status"]


@pytest.mark.parametrize("start_status", ["VALIDATED", "EXPORTED"])
def test_create_measurement_transitions_mission_to_measured(
    client, db_engine, mission_inspection_with_media, start_status, _stub_enqueue
):
    """kicking off a run on a VALIDATED/EXPORTED mission flips it to MEASURED."""
    mission_id = mission_inspection_with_media["mission_id"]
    inspection_id = mission_inspection_with_media["inspection_id"]
    _force_mission_status(db_engine, mission_id, start_status)

    r = client.post(f"/api/v1/inspections/{inspection_id}/measurement")
    assert r.status_code == 200, r.text
    assert _mission_status(client, mission_id) == "MEASURED"


def test_create_measurement_is_idempotent_on_measured(
    client, db_engine, mission_inspection_with_media, _stub_enqueue
):
    """a second run on an already-MEASURED mission does not error or re-transition."""
    mission_id = mission_inspection_with_media["mission_id"]
    inspection_id = mission_inspection_with_media["inspection_id"]
    _force_mission_status(db_engine, mission_id, "VALIDATED")

    first = client.post(f"/api/v1/inspections/{inspection_id}/measurement")
    assert first.status_code == 200, first.text
    assert _mission_status(client, mission_id) == "MEASURED"

    second = client.post(f"/api/v1/inspections/{inspection_id}/measurement")
    assert second.status_code == 200, second.text
    assert _mission_status(client, mission_id) == "MEASURED"


def test_create_measurement_leaves_non_post_plan_mission_untouched(
    client, mission_inspection_with_media, _stub_enqueue
):
    """a DRAFT mission (not VALIDATED/EXPORTED) is not transitioned by a run."""
    mission_id = mission_inspection_with_media["mission_id"]
    inspection_id = mission_inspection_with_media["inspection_id"]
    assert _mission_status(client, mission_id) == "DRAFT"

    r = client.post(f"/api/v1/inspections/{inspection_id}/measurement")
    assert r.status_code == 200, r.text
    assert _mission_status(client, mission_id) == "DRAFT"


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


# mission-scoped measurements list


@pytest.fixture
def mission_ctx(client, template_id):
    """fresh airport + mission + two inspections for the list endpoint."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "List Measure", "airport_id": apt["id"]}
    ).json()
    insp_a = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    insp_b = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    return {
        "airport_id": apt["id"],
        "mission_id": mission["id"],
        "inspection_a": insp_a["id"],
        "inspection_b": insp_b["id"],
    }


def _save_measurement(
    db_engine, inspection_id, *, status, summaries=None, object_key=None, error_message=None
):
    """persist a measurement in a chosen state directly via the port (no media needed)."""
    s = sessionmaker(bind=db_engine)()
    try:
        repo = SqlAlchemyMeasurementRepository(s)
        m = Measurement(
            inspection_id=inspection_id,
            status=status,
            object_key=object_key,
            summaries=summaries or [],
            error_message=error_message,
        )
        repo.save(m)
        s.commit()
        return str(m.id)
    finally:
        s.close()


def test_list_measurements_across_inspections(client, db_engine, mission_ctx):
    """one row per measurement across the mission's inspections, with context + rollup."""
    queued_id = _save_measurement(
        db_engine, mission_ctx["inspection_a"], status=MeasurementStatus.QUEUED
    )
    done_id = _save_measurement(
        db_engine,
        mission_ctx["inspection_b"],
        status=MeasurementStatus.DONE,
        object_key="measurements/x/results.json.gz",
        summaries=[
            LightSummary("PAPI_A", 3.0, 0.5, 3.1, True),
            LightSummary("PAPI_B", 3.0, 0.5, 5.0, False),
        ],
    )

    r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/measurements")
    assert r.status_code == 200, r.text
    rows = {row["id"]: row for row in r.json()}
    assert set(rows) == {queued_id, done_id}

    done_row = rows[done_id]
    assert done_row["status"] == "DONE"
    assert done_row["has_results"] is True
    assert done_row["pass_count"] == 1
    assert done_row["fail_count"] == 1
    assert done_row["inspection_id"] == mission_ctx["inspection_b"]
    assert done_row["inspection_method"] == "HORIZONTAL_RANGE"
    assert done_row["inspection_sequence_order"] >= 1

    queued_row = rows[queued_id]
    assert queued_row["status"] == "QUEUED"
    assert queued_row["has_results"] is False
    assert queued_row["pass_count"] == 0
    assert queued_row["fail_count"] == 0


def test_list_measurements_scoped_to_mission(client, db_engine, mission_ctx, template_id):
    """another mission's measurements never leak into this mission's list."""
    other_apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    other_mission = client.post(
        "/api/v1/missions", json={"name": "Other", "airport_id": other_apt["id"]}
    ).json()
    other_insp = client.post(
        f"/api/v1/missions/{other_mission['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    other_id = _save_measurement(db_engine, other_insp["id"], status=MeasurementStatus.QUEUED)

    mine_id = _save_measurement(
        db_engine, mission_ctx["inspection_a"], status=MeasurementStatus.QUEUED
    )

    r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/measurements")
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()}
    assert mine_id in ids
    assert other_id not in ids


def test_list_measurements_error_carries_message(client, db_engine, mission_ctx):
    """an ERROR run surfaces its failure message in the list row."""
    err_id = _save_measurement(
        db_engine,
        mission_ctx["inspection_a"],
        status=MeasurementStatus.ERROR,
        error_message="processing failed: boom",
    )

    r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/measurements")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[err_id]["status"] == "ERROR"
    assert rows[err_id]["error_message"] == "processing failed: boom"
    assert rows[err_id]["has_results"] is False


def test_list_measurements_empty_mission(client, mission_ctx):
    """a mission with inspections but no runs returns an empty list."""
    r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/measurements")
    assert r.status_code == 200
    assert r.json() == []


def test_list_measurements_cross_airport_is_403(client, mission_ctx):
    """an operator without access to the mission's airport is refused."""
    denied = SimpleNamespace(
        id=TEST_USER_ID,
        email="x@y.z",
        name="No Access",
        role="OPERATOR",
        is_active=True,
        airports=[],
    )
    denied.has_airport_access = lambda airport_id: False
    app.dependency_overrides[get_current_user] = lambda: denied
    try:
        r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/measurements")
        assert r.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = _override_current_user


def test_to_response_maps_full_aggregate():
    """service to_response renders every field of a populated aggregate (layering-move guard)."""
    from datetime import datetime, timezone

    from app.domain.measurement.entities import LightBox, LightSummary, Measurement, ReferencePoint

    insp_id, lha_id = uuid4(), uuid4()
    m = Measurement(
        inspection_id=insp_id,
        status=MeasurementStatus.DONE,
        runway_heading=187.0,
        reference_points=[
            ReferencePoint(
                light_name="PAPI_A",
                latitude=48.1,
                longitude=17.2,
                elevation=133.0,
                lha_id=lha_id,
                unit_designator="A",
                setting_angle=3.0,
                tolerance=0.17,
            )
        ],
        light_boxes=[LightBox(light_name="PAPI_A", x=10.0, y=50.0, size=8.0)],
        summaries=[
            LightSummary(
                light_name="PAPI_A",
                setting_angle=3.0,
                tolerance=0.17,
                measured_transition_angle=3.05,
                passed=True,
            )
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
