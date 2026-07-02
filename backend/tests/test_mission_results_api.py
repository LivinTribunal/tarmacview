"""mission-scale results endpoint - GET /missions/{id}/results protocol aggregation."""

import gzip
import itertools
import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_current_user
from app.core.enums import MeasurementStatus
from app.main import app
from app.models.measurement import Measurement
from app.services import measurement_service
from tests.conftest import TEST_USER_ID, _override_current_user
from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, LHA_PAYLOAD, SURFACE_PAYLOAD

_icao_counter = itertools.count()
_DESIGNATORS = ["A", "B", "C", "D"]


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MZ' prefix keeps this file's codes distinct."""
    n = next(_icao_counter)
    return f"MZ{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


# one frame carrying all four PAPI transition angles so per-light + glidepath resolve
def _blob() -> bytes:
    """gzipped one-frame blob with PAPI_A-D transition angles (B max / C min drive glidepath)."""
    frame = {"frame_number": 0, "timestamp": 0.0}
    for letter, mid in zip("abcd", (3.0, 3.05, 2.95, 2.9)):
        frame[f"papi_{letter}_status"] = "white"
        frame[f"papi_{letter}_transition_angle_min"] = mid
        frame[f"papi_{letter}_transition_angle_middle"] = mid
        frame[f"papi_{letter}_transition_angle_max"] = mid
    return gzip.compress(json.dumps([frame]).encode("utf-8"))


@pytest.fixture(autouse=True)
def _stub_enqueue(monkeypatch):
    """record enqueue calls instead of importing celery."""
    monkeypatch.setattr(measurement_service, "enqueue_first_frame", lambda mid: None)
    monkeypatch.setattr(measurement_service, "enqueue_processing", lambda mid: None)


@pytest.fixture
def _stub_storage(monkeypatch):
    """serve the gzipped blob without touching object storage."""
    monkeypatch.setattr(measurement_service.object_storage, "get_object", lambda key: _blob())
    monkeypatch.setattr(
        measurement_service.object_storage, "presigned_get", lambda key: f"https://signed/{key}"
    )


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the mission-results inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Mission Results Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


def _make_inspection(client, mission_id: str, apt_id: str, template_id: str) -> str:
    """surface + 4 PAPI LHAs + one inspection targeting them + a media row -> inspection id."""
    surface = client.post(f"/api/v1/airports/{apt_id}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt_id}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "name": "PAPI"},
    ).json()
    base = f"/api/v1/airports/{apt_id}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"
    lha_ids = []
    for d in _DESIGNATORS:
        r = client.post(base, json={**LHA_PAYLOAD, "unit_designator": d, "setting_angle": 3.0})
        lha_ids.append(r.json()["id"])
    insp = client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={
            "template_id": template_id,
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_ids": lha_ids},
        },
    ).json()
    client.post(
        "/api/v1/drone-media/complete-upload",
        json={
            "mission_id": mission_id,
            "inspection_id": insp["id"],
            "object_key": f"drone-media/manual/{insp['id']}.mp4",
            "filename": "clip.mp4",
            "size_bytes": 2048,
        },
    )
    return insp["id"]


@pytest.fixture
def mission_ctx(client, template_id):
    """fresh airport + mission + one PAPI inspection -> ids the tests build on."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Protocol Mission", "airport_id": apt["id"]}
    ).json()
    inspection_id = _make_inspection(client, mission["id"], apt["id"], template_id)
    return {"airport_id": apt["id"], "mission_id": mission["id"], "inspection_id": inspection_id}


def _create_run(client, inspection_id: str) -> str:
    """start a run and return its id."""
    return client.post(f"/api/v1/inspections/{inspection_id}/measurement").json()["id"]


def _drive_to_done(db_engine, measurement_id: str, *, fail_light: str | None = None) -> None:
    """walk a run to DONE with four per-light summaries + a results blob key."""
    s = sessionmaker(bind=db_engine)()
    try:
        m = s.query(Measurement).filter(Measurement.id == UUID(measurement_id)).first()
        m.transition_to(MeasurementStatus.FIRST_FRAME)
        m.transition_to(MeasurementStatus.AWAITING_CONFIRM)
        m.transition_to(MeasurementStatus.PROCESSING)
        m.summaries = [
            {
                "light_name": f"PAPI_{d}",
                "setting_angle": 3.0,
                "tolerance": 0.5,
                "measured_transition_angle": 3.0,
                "passed": f"PAPI_{d}" != fail_light,
            }
            for d in _DESIGNATORS
        ]
        m.object_key = "measurements/x/results.json.gz"
        m.transition_to(MeasurementStatus.DONE)
        s.commit()
    finally:
        s.close()


def _drive_to_error(db_engine, measurement_id: str) -> None:
    """fail a run to ERROR."""
    s = sessionmaker(bind=db_engine)()
    try:
        m = s.query(Measurement).filter(Measurement.id == UUID(measurement_id)).first()
        m.fail("boom")
        s.commit()
    finally:
        s.close()


def test_mission_results_unknown_mission_is_404(client):
    """results for an unknown mission 404."""
    assert client.get(f"/api/v1/missions/{uuid4()}/results").status_code == 404


def test_mission_results_groups_by_runway_and_agl(client, db_engine, mission_ctx, _stub_storage):
    """a DONE PAPI inspection groups under its runway with per-LHA rows + glidepath."""
    mid = _create_run(client, mission_ctx["inspection_id"])
    _drive_to_done(db_engine, mid)

    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    runway = body["runways"][0]
    assert runway["runway_identifier"] == "06/24"
    device = runway["devices"][0]
    assert device["device_type"] == "PAPI"
    assert "06/24" in device["device_label"]
    assert device["status"] == "DONE"
    assert device["measurement_id"] == mid
    assert {light["unit_designator"] for light in device["lights"]} == set(_DESIGNATORS)
    assert all(light["not_measured"] is False for light in device["lights"])
    assert device["glide_slope"]["measured_glide_slope_angle"] == pytest.approx(3.0)
    assert device["glide_slope"]["configured_glide_slope_angle"] == pytest.approx(3.0)


def test_mission_results_placeholder_nulls_for_unmeasured(client, mission_ctx):
    """an inspection with no run yields explicit NOT_MEASURED placeholders (keys present)."""
    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    device = body["runways"][0]["devices"][0]
    assert device["status"] == "NOT_MEASURED"
    assert device["evaluation"] == "NOT_MEASURED"
    assert device["glide_slope"] is None
    assert device["placeholder_rows"]
    assert len(device["lights"]) == 4
    for light in device["lights"]:
        assert light["not_measured"] is True
        assert "measured_transition_angle" in light
        assert light["measured_transition_angle"] is None


def test_mission_results_mixed_done_error_unmeasured(
    client, db_engine, mission_ctx, template_id, _stub_storage
):
    """three inspections resolve to DONE / ERROR(PENDING) / NOT_MEASURED evaluations."""
    apt_id, mission_id = mission_ctx["airport_id"], mission_ctx["mission_id"]
    done_insp = mission_ctx["inspection_id"]
    error_insp = _make_inspection(client, mission_id, apt_id, template_id)
    _make_inspection(client, mission_id, apt_id, template_id)  # left unmeasured

    _drive_to_done(db_engine, _create_run(client, done_insp))
    _drive_to_error(db_engine, _create_run(client, error_insp))

    body = client.get(f"/api/v1/missions/{mission_id}/results").json()
    devices = {
        d["inspection_id"]: d for r in body["runways"] for d in r["devices"] if d["inspection_id"]
    }
    assert devices[done_insp]["evaluation"] in ("PASS", "FAIL")
    assert devices[error_insp]["status"] == "ERROR"
    assert devices[error_insp]["evaluation"] == "PENDING"


def test_mission_results_evaluation_and_fail(client, db_engine, mission_ctx, _stub_storage):
    """a failed per-light summary fails the device and its evaluation-table row."""
    mid = _create_run(client, mission_ctx["inspection_id"])
    _drive_to_done(db_engine, mid, fail_light="PAPI_B")

    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    device = body["runways"][0]["devices"][0]
    assert device["evaluation"] == "FAIL"
    row = next(r for r in body["evaluation"] if r["device_label"] == device["device_label"])
    assert row["result"] == "FAIL"


def test_mission_results_placeholder_als_rls_devices(client, mission_ctx):
    """each resolved runway carries trailing ALS/RLS serviceability placeholder devices."""
    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    devices = body["runways"][0]["devices"]
    placeholders = {d["device_type"]: d for d in devices if d["device_type"] in ("ALS", "RLS")}
    assert set(placeholders) == {"ALS", "RLS"}
    for device in placeholders.values():
        assert device["evaluation"] == "NOT_MEASURED"
        assert device["placeholder_rows"]


def test_mission_results_header_and_placeholders(client, mission_ctx):
    """header identity is filled; weather + recommendations stay placeholder null."""
    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    header = body["header"]
    assert header["airport_name"] == "Prague Airport"
    assert header["mission_name"] == "Protocol Mission"
    assert body["weather"]["temperature_c"] is None
    assert body["weather"]["conditions"] is None
    assert body["recommendations"] is None


# ILS-harmonization roll-up


def _blob_with_touchpoint(b_max_tp: float, c_min_tp: float) -> bytes:
    """the shared blob plus PAPI_B/C touchpoint transition angles so the ils mid resolves."""
    frame = {"frame_number": 0, "timestamp": 0.0}
    for letter, mid in zip("abcd", (3.0, 3.05, 2.95, 2.9)):
        frame[f"papi_{letter}_status"] = "white"
        frame[f"papi_{letter}_transition_angle_min"] = mid
        frame[f"papi_{letter}_transition_angle_middle"] = mid
        frame[f"papi_{letter}_transition_angle_max"] = mid
    # touchpoint-referenced edges: B white edge (max) + C red edge (min) drive the ils mid
    frame["papi_b_transition_angle_max_touchpoint"] = b_max_tp
    frame["papi_c_transition_angle_min_touchpoint"] = c_min_tp
    return gzip.compress(json.dumps([frame]).encode("utf-8"))


def _stub_blob(monkeypatch, raw: bytes) -> None:
    """serve a specific gzipped blob for every run in this test."""
    monkeypatch.setattr(measurement_service.object_storage, "get_object", lambda key: raw)
    monkeypatch.setattr(
        measurement_service.object_storage, "presigned_get", lambda key: f"https://signed/{key}"
    )


def test_mission_results_ils_alignment_not_a_placeholder_row(client, mission_ctx):
    """ils_alignment is promoted out of PAPI_PLACEHOLDER_ROWS - it no longer greys out."""
    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    device = body["runways"][0]["devices"][0]
    assert "ils_alignment" not in device["placeholder_rows"]


def test_mission_results_ils_harmonization_pass(client, db_engine, mission_ctx, monkeypatch):
    """a touchpoint glidepath inside the snapshotted band verdicts the ils block PASS."""
    _stub_blob(monkeypatch, _blob_with_touchpoint(3.02, 2.99))  # mid = 3.005, within 0.05 of 3.0
    mid = _create_run(client, mission_ctx["inspection_id"])
    _drive_to_done(db_engine, mid)

    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    device = body["runways"][0]["devices"][0]
    ils = device["ils_harmonization"]
    assert ils["configured_glide_slope_angle"] == pytest.approx(3.0)
    assert ils["ils_harmonization_tolerance"] == pytest.approx(0.05)
    assert ils["measured_glide_slope_angle_touchpoint"] == pytest.approx(3.005)
    assert ils["within_tolerance"] is True
    assert ils["evaluation"] == "PASS"


def test_mission_results_ils_harmonization_pending_without_touchpoint(
    client, db_engine, mission_ctx, _stub_storage
):
    """no touchpoint angles in the blob -> ils verdict None/PENDING, never FAIL."""
    mid = _create_run(client, mission_ctx["inspection_id"])
    _drive_to_done(db_engine, mid)

    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    ils = body["runways"][0]["devices"][0]["ils_harmonization"]
    assert ils["measured_glide_slope_angle_touchpoint"] is None
    assert ils["within_tolerance"] is None
    assert ils["evaluation"] == "PENDING"


def test_mission_results_ils_verdict_does_not_feed_light_based_evaluation(
    client, db_engine, mission_ctx, monkeypatch
):
    """a failing ils harmonization leaves the light-based device + mission evaluation untouched."""
    # touchpoint glidepath far from 3.0 -> ils FAIL, but the per-light summaries all PASS
    _stub_blob(monkeypatch, _blob_with_touchpoint(3.6, 3.4))  # mid = 3.5, well outside 0.05
    mid = _create_run(client, mission_ctx["inspection_id"])
    _drive_to_done(db_engine, mid)

    body = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results").json()
    device = body["runways"][0]["devices"][0]
    assert device["ils_harmonization"]["evaluation"] == "FAIL"
    # the light-based device verdict and the mission-level row stay PASS
    assert device["evaluation"] == "PASS"
    row = next(r for r in body["evaluation"] if r["device_label"] == device["device_label"])
    assert row["result"] == "PASS"


def test_mission_results_forbidden_for_other_airport(client, mission_ctx):
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
        r = client.get(f"/api/v1/missions/{mission_ctx['mission_id']}/results")
        assert r.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = _override_current_user
