"""results endpoints - /data pivots the blob, /pdf-report renders a pdf."""

import gzip
import itertools
import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import LightSummary
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.services import measurement_service
from tests.data.airports import AIRPORT_PAYLOAD

_icao_counter = itertools.count()


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MR' prefix keeps this file's codes out of
    the shared session db's AAAA.. range that other test modules also write."""
    n = next(_icao_counter)
    return f"MR{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


# one frame of the engine blob - papi_a readings keyed lowercase
def _frame(i: int) -> dict:
    """build a single per-frame blob dict for PAPI_A at frame i."""
    return {
        "frame_number": i,
        "timestamp": i / 30.0,
        "drone_latitude": 48.1 + i * 1e-5,
        "drone_longitude": 17.2 + i * 1e-5,
        "drone_elevation_wgs84": 150.0 + i,
        "papi_a_status": "white" if i > 1 else "red",
        "papi_a_rgb": {"r": 200, "g": 200, "b": 200} if i > 1 else {"r": 200, "g": 50, "b": 50},
        "papi_a_intensity": 0.5 + i * 0.1,
        "papi_a_angle": 3.0 + i * 0.1,
        "papi_a_horizontal_angle": 0.2,
        "papi_a_area_pixels": 120 + i,
        "papi_a_transition_angle_min": 2.8,
        "papi_a_transition_angle_middle": 3.0,
        "papi_a_transition_angle_max": 3.2,
    }


_BLOB = [_frame(i) for i in range(4)]


@pytest.fixture(autouse=True)
def _stub_enqueue(monkeypatch):
    """record enqueue calls instead of importing celery."""
    monkeypatch.setattr(measurement_service, "enqueue_first_frame", lambda mid: None)
    monkeypatch.setattr(measurement_service, "enqueue_processing", lambda mid: None)


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the results-test inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Results Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def inspection_id(client, template_id):
    """fresh airport/mission/inspection + one media row per test."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Results", "airport_id": apt["id"]}
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
            "object_key": "drone-media/manual/r.mp4",
            "filename": "r.mp4",
            "size_bytes": 2048,
        },
    )
    return insp["id"]


def _create(client, inspection_id: str) -> str:
    """start a run and return its id."""
    return client.post(f"/api/v1/inspections/{inspection_id}/measurement").json()["id"]


def _drive_to_done(db_engine, measurement_id: str) -> None:
    """walk the aggregate to DONE with a results blob, a summary, and a video key."""
    s = sessionmaker(bind=db_engine)()
    try:
        repo = SqlAlchemyMeasurementRepository(s)
        m = repo.get_by_id(UUID(measurement_id))
        m.transition_to(MeasurementStatus.FIRST_FRAME)
        m.transition_to(MeasurementStatus.AWAITING_CONFIRM)
        m.transition_to(MeasurementStatus.PROCESSING)
        m.summaries = [
            LightSummary(
                light_name="PAPI_A",
                setting_angle=3.0,
                tolerance=0.5,
                measured_transition_angle=3.0,
                passed=True,
            )
        ]
        m.object_key = "measurements/x/results.json.gz"
        m.annotated_video_keys = {"PAPI_A": "measurements/x/PAPI_A.mp4"}
        m.transition_to(MeasurementStatus.DONE)
        repo.save(m)
        s.commit()
    finally:
        s.close()


@pytest.fixture
def _stub_storage(monkeypatch):
    """serve the gzipped blob + presign video urls without touching object storage."""
    monkeypatch.setattr(
        measurement_service.object_storage,
        "get_object",
        lambda key: gzip.compress(json.dumps(_BLOB).encode("utf-8")),
    )
    monkeypatch.setattr(
        measurement_service.object_storage,
        "presigned_get",
        lambda key: f"https://signed/{key}",
    )


def test_data_unknown_measurement_is_404(client):
    """results for an unknown measurement 404."""
    assert client.get(f"/api/v1/measurements/{uuid4()}/data").status_code == 404


def test_data_not_done_returns_empty_series(client, inspection_id):
    """a QUEUED run returns metadata with no results blob."""
    mid = _create(client, inspection_id)
    body = client.get(f"/api/v1/measurements/{mid}/data").json()
    assert body["status"] == "QUEUED"
    assert body["has_results"] is False
    assert body["lights"] == []
    assert body["drone_path"] == []
    assert body["video_urls"] == {}


def test_data_done_pivots_blob(client, db_engine, inspection_id, _stub_storage):
    """a DONE run pivots the blob into per-light series, drone path, and video urls."""
    mid = _create(client, inspection_id)
    _drive_to_done(db_engine, mid)

    body = client.get(f"/api/v1/measurements/{mid}/data").json()
    assert body["has_results"] is True
    assert body["status"] == "DONE"

    papi_a = next(light for light in body["lights"] if light["light_name"] == "PAPI_A")
    assert len(papi_a["points"]) == len(_BLOB)
    assert papi_a["transition_angle_middle"] == 3.0
    assert papi_a["passed"] is True
    # chromaticity derived from the rgb triple, not a direct blob key
    first = papi_a["points"][0]
    assert first["chromaticity_x"] == pytest.approx(200 / 300)

    assert len(body["drone_path"]) == len(_BLOB)
    assert body["drone_path"][0]["latitude"] == pytest.approx(48.1)
    assert body["video_urls"]["PAPI_A"] == "https://signed/measurements/x/PAPI_A.mp4"
    assert any(s["light_name"] == "PAPI_A" and s["passed"] for s in body["summaries"])


def test_drone_path_reads_engine_keys():
    """_drone_path pivots the drone_* engine keys into an ordered path."""
    frames = [_frame(i) for i in range(3)]
    path = measurement_service._drone_path(frames)
    assert len(path) == 3
    assert path[0].latitude == pytest.approx(48.1)
    assert path[0].longitude == pytest.approx(17.2)
    # elevation carried through from drone_elevation_wgs84
    assert path[0].elevation == pytest.approx(150.0)
    assert path[2].elevation == pytest.approx(152.0)
    assert [p.frame_number for p in path] == [0, 1, 2]


def test_drone_path_skips_frames_without_gps():
    """a frame missing lat/lon is skipped, not coerced to null island."""
    frames = [
        _frame(0),
        {"frame_number": 1, "timestamp": 0.03},  # no gps
        _frame(2),
    ]
    path = measurement_service._drone_path(frames)
    assert [p.frame_number for p in path] == [0, 2]


def test_drone_path_empty_blob_is_empty():
    """no frames -> empty path, not an error."""
    assert measurement_service._drone_path([]) == []


def test_drone_path_accepts_bare_gps_keys():
    """the bare latitude/longitude/elevation_wgs84 shape also draws."""
    frames = [
        {
            "frame_number": 5,
            "timestamp": 0.16,
            "latitude": 49.3,
            "longitude": 18.4,
            "elevation_wgs84": 222.0,
        }
    ]
    path = measurement_service._drone_path(frames)
    assert len(path) == 1
    assert path[0].latitude == pytest.approx(49.3)
    assert path[0].longitude == pytest.approx(18.4)
    assert path[0].elevation == pytest.approx(222.0)


def test_pdf_report_unknown_measurement_is_404(client):
    """pdf for an unknown measurement 404."""
    assert client.get(f"/api/v1/measurements/{uuid4()}/pdf-report").status_code == 404


def test_pdf_report_returns_pdf(client, db_engine, inspection_id, _stub_storage):
    """a DONE run renders a downloadable pdf."""
    mid = _create(client, inspection_id)
    _drive_to_done(db_engine, mid)

    r = client.get(f"/api/v1/measurements/{mid}/pdf-report")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert "attachment" in r.headers["content-disposition"]
    assert r.content[:4] == b"%PDF"
