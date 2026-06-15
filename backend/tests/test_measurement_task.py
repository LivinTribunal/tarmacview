"""measurement worker runners - first-frame + full processing with the engine mocked.

the celery tasks are thin wrappers over these service runners; testing the runners
covers the task logic (status transitions, object_key write, error path) without
importing celery or opencv, neither of which ships in the test image. a real-engine
smoke test against a synthetic clip rides behind ``importorskip('cv2')``.
"""

import gzip
import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.enums import MeasurementStatus
from app.schemas.measurement import LightBox
from app.services import measurement_service
from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, LHA_PAYLOAD, SURFACE_PAYLOAD

_DESIGNATORS = ["A", "B", "C", "D"]
_LIGHTS = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]


def _confirm_boxes():
    """schema confirm-lights boxes for the four PAPI slots (the service wire shape)."""
    return [LightBox(light_name=name, x=10.0, y=50.0, size=8.0) for name in _LIGHTS]


@pytest.fixture(scope="module")
def inspection_with_media(client):
    """airport + 4 PAPI LHAs + mission + inspection targeting them + one media row."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LZTK"}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "name": "PAPI"},
    ).json()
    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"
    lha_ids = []
    for d in _DESIGNATORS:
        r = client.post(base, json={**LHA_PAYLOAD, "unit_designator": d, "setting_angle": 3.0})
        lha_ids.append(r.json()["id"])

    mission = client.post(
        "/api/v1/missions", json={"name": "Measure Mission", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={
            "template_id": _template_id(client),
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_ids": lha_ids},
        },
    ).json()
    client.post(
        "/api/v1/drone-media/complete-upload",
        json={
            "mission_id": mission["id"],
            "inspection_id": insp["id"],
            "object_key": "drone-media/manual/clip.mp4",
            "filename": "clip.mp4",
            "size_bytes": 4096,
        },
    )
    return insp["id"]


def _template_id(client):
    """horizontal-range template (created once, reused)."""
    if not hasattr(_template_id, "_id"):
        _template_id._id = client.post(
            "/api/v1/inspection-templates",
            json={"name": "Measure Template", "methods": ["HORIZONTAL_RANGE"]},
        ).json()["id"]
    return _template_id._id


@pytest.fixture
def session(db_engine):
    """committing session with measurement-row cleanup after the test."""
    s = sessionmaker(bind=db_engine)()
    created: list = []
    try:
        yield s, created
    finally:
        from app.models.measurement import Measurement as MeasurementORM

        for mid in created:
            s.query(MeasurementORM).filter(MeasurementORM.id == mid).delete()
        s.commit()
        s.close()


def _stub_storage(monkeypatch):
    """no-op object storage so the runners never touch a real bucket."""
    monkeypatch.setattr(
        measurement_service.object_storage,
        "download_file",
        lambda key, dest: open(dest, "wb").close(),
    )
    monkeypatch.setattr(measurement_service.object_storage, "upload_file", lambda *a, **k: None)
    monkeypatch.setattr(measurement_service.object_storage, "put_object", lambda *a, **k: None)


def _drive_to_processing(s, created, inspection_id):
    """create a run and walk it through confirm so run_processing can pick it up."""
    m = measurement_service.create_measurement(s, inspection_id)
    s.commit()
    created.append(m.id)
    m.transition_to(MeasurementStatus.FIRST_FRAME)
    m.transition_to(MeasurementStatus.AWAITING_CONFIRM)
    measurement_service._repo(s).save(m)
    s.commit()
    measurement_service.confirm_lights(s, m.id, _confirm_boxes())
    s.commit()
    return m


def test_create_snapshots_reference_points(session, inspection_with_media):
    """create_measurement captures the LHA ground truth + media keys at run start."""
    s, created = session
    m = measurement_service.create_measurement(s, inspection_with_media)
    s.commit()
    created.append(m.id)

    assert m.status == MeasurementStatus.QUEUED
    assert m.media_object_keys == ["drone-media/manual/clip.mp4"]
    names = {rp.light_name for rp in m.reference_points}
    assert names == set(_LIGHTS)
    assert all(rp.setting_angle == 3.0 for rp in m.reference_points)


def test_create_without_media_is_422(session, client):
    """an inspection with no uploaded media cannot start a run."""
    from app.core.exceptions import DomainError

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LZNM"}).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "No Media", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": _template_id(client), "method": "HORIZONTAL_RANGE"},
    ).json()

    s, _ = session
    with pytest.raises(DomainError) as exc:
        measurement_service.create_measurement(s, insp["id"])
    assert exc.value.status_code == 422


def _stub_detect(monkeypatch, confident):
    """stub the first-frame engine seam with a fixed confidence flag (3-tuple)."""
    monkeypatch.setattr(
        measurement_service,
        "extract_first_frame_and_detect",
        lambda video, image, refs: (
            {"fps": 30, "total_frames": 10},
            {name: {"x": 10.0 + i, "y": 50.0, "size": 8.0} for i, name in enumerate(_LIGHTS)},
            confident,
        ),
    )


def test_run_first_frame_reaches_awaiting_confirm(session, inspection_with_media, monkeypatch):
    """an uncertain detection pre-places boxes and parks for manual confirm."""
    s, created = session
    _stub_storage(monkeypatch)
    _stub_detect(monkeypatch, confident=False)

    m = measurement_service.create_measurement(s, inspection_with_media)
    s.commit()
    created.append(m.id)

    result = measurement_service.run_first_frame(s, m.id)
    assert result.status == MeasurementStatus.AWAITING_CONFIRM
    assert result.first_frame_object_key.endswith("first_frame.jpg")
    assert {b.light_name for b in result.light_boxes} == set(_LIGHTS)


def test_run_first_frame_confident_reaches_processing(session, inspection_with_media, monkeypatch):
    """a confident detection auto-confirms straight to PROCESSING with boxes persisted."""
    s, created = session
    _stub_storage(monkeypatch)
    _stub_detect(monkeypatch, confident=True)

    m = measurement_service.create_measurement(s, inspection_with_media)
    s.commit()
    created.append(m.id)

    result = measurement_service.run_first_frame(s, m.id)
    assert result.status == MeasurementStatus.PROCESSING
    assert result.first_frame_object_key.endswith("first_frame.jpg")
    assert {b.light_name for b in result.light_boxes} == set(_LIGHTS)


def test_run_processing_reaches_done_and_writes_object_key(
    session, inspection_with_media, monkeypatch
):
    """run_processing runs the engine, writes results, scores per-light, finishes done."""
    s, created = session
    _stub_storage(monkeypatch)
    monkeypatch.setattr(measurement_service, "extract_gps_data", lambda video: [object()])
    measurements_data = [{f"{name.lower()}_transition_angle_middle": 3.05 for name in _LIGHTS}]
    monkeypatch.setattr(
        measurement_service,
        "run_two_pass_processing",
        lambda **kw: (measurements_data, {}, None, None),
    )

    m = measurement_service.create_measurement(s, inspection_with_media)
    s.commit()
    created.append(m.id)
    # move through the confirm gate so the run is PROCESSING
    m.transition_to(MeasurementStatus.FIRST_FRAME)
    m.transition_to(MeasurementStatus.AWAITING_CONFIRM)
    measurement_service._repo(s).save(m)
    s.commit()
    measurement_service.confirm_lights(s, m.id, _confirm_boxes())
    s.commit()

    result = measurement_service.run_processing(s, m.id)
    assert result.status == MeasurementStatus.DONE
    assert result.object_key.endswith("results.json.gz")
    by_name = {sm.light_name: sm for sm in result.summaries}
    assert by_name["PAPI_A"].measured_transition_angle == 3.05
    assert by_name["PAPI_A"].passed is True


def test_run_processing_engine_failure_routes_to_error(session, inspection_with_media, monkeypatch):
    """an engine exception leaves the measurement in ERROR with a message."""
    s, created = session
    _stub_storage(monkeypatch)
    monkeypatch.setattr(measurement_service, "extract_gps_data", lambda video: [object()])

    def boom(**kw):
        raise RuntimeError("opencv exploded")

    monkeypatch.setattr(measurement_service, "run_two_pass_processing", boom)

    m = measurement_service.create_measurement(s, inspection_with_media)
    s.commit()
    created.append(m.id)
    m.transition_to(MeasurementStatus.FIRST_FRAME)
    m.transition_to(MeasurementStatus.AWAITING_CONFIRM)
    measurement_service._repo(s).save(m)
    s.commit()
    measurement_service.confirm_lights(s, m.id, _confirm_boxes())
    s.commit()

    result = measurement_service.run_processing(s, m.id)
    assert result.status == MeasurementStatus.ERROR
    assert "opencv exploded" in result.error_message


def test_run_processing_no_gps_routes_to_error(session, inspection_with_media, monkeypatch):
    """a video with no GPS telemetry fails loudly instead of a silent empty DONE."""
    s, created = session
    _stub_storage(monkeypatch)
    monkeypatch.setattr(measurement_service, "extract_gps_data", lambda video: [])

    def engine_must_not_run(**kw):
        raise AssertionError("engine should not run without gps")

    monkeypatch.setattr(measurement_service, "run_two_pass_processing", engine_must_not_run)

    m = _drive_to_processing(s, created, inspection_with_media)
    result = measurement_service.run_processing(s, m.id)
    assert result.status == MeasurementStatus.ERROR
    assert "GPS" in result.error_message


def test_run_processing_serializes_numpy_scalars(session, inspection_with_media, monkeypatch):
    """engine numpy scalars don't crash json.dumps - the gzipped blob still round-trips."""
    np = pytest.importorskip("numpy")
    s, created = session
    _stub_storage(monkeypatch)
    captured: dict = {}
    monkeypatch.setattr(
        measurement_service.object_storage,
        "put_object",
        lambda key, data, **kw: captured.update(data=data),
    )
    monkeypatch.setattr(measurement_service, "extract_gps_data", lambda video: [object()])
    measurements_data = [
        {f"{name.lower()}_transition_angle_middle": np.float64(3.05) for name in _LIGHTS}
    ]
    monkeypatch.setattr(
        measurement_service,
        "run_two_pass_processing",
        lambda **kw: (measurements_data, {}, None, None),
    )

    m = _drive_to_processing(s, created, inspection_with_media)
    result = measurement_service.run_processing(s, m.id)

    assert result.status == MeasurementStatus.DONE
    assert result.object_key.endswith("results.json.gz")
    decoded = json.loads(gzip.decompress(captured["data"]).decode("utf-8"))
    assert decoded[0]["papi_a_transition_angle_middle"] == 3.05


def test_run_processing_summaries_are_plain_floats(session, inspection_with_media, monkeypatch):
    """measured angles land on the summaries as plain floats, never numpy scalars."""
    np = pytest.importorskip("numpy")
    s, created = session
    _stub_storage(monkeypatch)
    monkeypatch.setattr(measurement_service, "extract_gps_data", lambda video: [object()])
    measurements_data = [
        {f"{name.lower()}_transition_angle_middle": np.float64(3.05) for name in _LIGHTS}
    ]
    monkeypatch.setattr(
        measurement_service,
        "run_two_pass_processing",
        lambda **kw: (measurements_data, {}, None, None),
    )

    m = _drive_to_processing(s, created, inspection_with_media)
    result = measurement_service.run_processing(s, m.id)

    by_name = {sm.light_name: sm for sm in result.summaries}
    measured = by_name["PAPI_A"].measured_transition_angle
    assert measured == 3.05
    assert type(measured) is float


def test_run_first_frame_missing_measurement_raises(session):
    """a runner on an unknown id raises not-found."""
    from app.core.exceptions import NotFoundError

    s, _ = session
    with pytest.raises(NotFoundError):
        measurement_service.run_first_frame(s, uuid4())


def test_real_engine_first_frame_on_synthetic_clip(tmp_path):
    """real engine: extract the first frame + detect lights on a tiny generated clip."""
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    video_path = str(tmp_path / "clip.mp4")
    width, height = 320, 240
    writer = cv2.VideoWriter(video_path, cv2.VideoWriter_fourcc(*"mp4v"), 5, (width, height))
    assert writer.isOpened()
    for _ in range(5):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # four bright white blobs in a horizontal line - a crude PAPI stand-in
        for i in range(4):
            cv2.circle(frame, (60 + i * 60, 120), 6, (255, 255, 255), -1)
        writer.write(frame)
    writer.release()

    image_path = str(tmp_path / "frame.jpg")
    metadata, detected, confident = measurement_service.extract_first_frame_and_detect(
        video_path, image_path, []
    )
    assert metadata.get("frame_width") == width
    # detection always returns the four PAPI slots (real detection or default fallback)
    assert set(detected.keys()) == set(_LIGHTS)
    # the real engine treats this crude clip as uncertain (falls to default positions),
    # so it is never auto-confirmed - the conservative default
    assert confident is False


def test_default_positions_project_reference_points():
    """the no-detection fallback pre-places boxes from the LHA geometry, not a grid."""
    pytest.importorskip("cv2")
    from app.services.video_processing.processor.detection import (
        _generate_default_positions,
        _project_reference_points,
    )

    # four colinear PAPI lights with deliberately uneven spacing (along-bar 0, 1, 2, 5)
    refs = [{"latitude": 50.0, "longitude": lon} for lon in (0.0, 0.001, 0.002, 0.005)]

    projected = _project_reference_points(refs)
    assert set(projected) == set(_LIGHTS)
    xs = [projected[name]["x"] for name in _LIGHTS]
    # monotonic left-to-right; spacing mirrors the ground truth (A-B == B-C < C-D)
    assert xs == sorted(xs)
    assert (xs[1] - xs[0]) == pytest.approx(xs[2] - xs[1])
    assert (xs[3] - xs[2]) > (xs[2] - xs[1])

    # the fallback consumes the projection; an empty ref set keeps the even grid
    assert _generate_default_positions(320, 240, refs) == projected
    grid = _generate_default_positions(320, 240, [])
    assert [grid[name]["x"] for name in _LIGHTS] != xs


def test_detect_lights_with_confidence_clean_line_is_confident(tmp_path, monkeypatch):
    """a coherent line of all four PAPI lights is a confident detection.

    the detector is stubbed with four bright colinear lights so the confidence wiring is
    exercised deterministically, independent of the vendored engine's pixel heuristics.
    """
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    from app.services.video_processing import detection as engine
    from app.services.video_processing.models import DetectedLight
    from app.services.video_processing.processor.detection import detect_lights_with_confidence

    class _LineDetector:
        """returns four bright, evenly-spaced colinear lights - a clean PAPI bar."""

        def __init__(self, *a, **k):
            pass

        def detect_lights(self, frame):
            """stand in for the real CV detector with a coherent four-light line."""
            return [
                DetectedLight(
                    x=60.0 + i * 60,
                    y=120.0,
                    width=12.0,
                    height=12.0,
                    confidence=1.0,
                    class_name="high_intensity_light",
                    brightness=255.0,
                    r=255,
                    g=255,
                    b=255,
                    intensity=255.0,
                )
                for i in range(4)
            ]

    monkeypatch.setattr(engine, "RunwayLightDetector", _LineDetector)

    image_path = str(tmp_path / "line.png")
    cv2.imwrite(image_path, np.zeros((240, 320, 3), dtype=np.uint8))

    detected, confident = detect_lights_with_confidence(image_path, [])
    assert set(detected.keys()) == set(_LIGHTS)
    assert confident is True


def test_detect_lights_with_confidence_blank_frame_not_confident(tmp_path):
    """a blank frame falls back to default positions and is never confident."""
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    from app.services.video_processing.processor.detection import detect_lights_with_confidence

    width, height = 320, 240
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    image_path = str(tmp_path / "blank.png")
    cv2.imwrite(image_path, frame)

    detected, confident = detect_lights_with_confidence(image_path, [])
    assert set(detected.keys()) == set(_LIGHTS)
    assert confident is False


def test_extract_first_frame_task_enqueues_processing_only_when_confident(monkeypatch):
    """the task chains processing on a PROCESSING runner result, not on AWAITING_CONFIRM."""
    pytest.importorskip("celery")
    from app.workers import measurement_tasks

    enqueued: list = []
    monkeypatch.setattr(
        measurement_tasks.process_measurement_task,
        "delay",
        lambda mid: enqueued.append(mid),
    )

    # confident auto-confirm: runner returns PROCESSING -> processing enqueued
    monkeypatch.setattr(
        measurement_tasks, "_run", lambda runner, mid: MeasurementStatus.PROCESSING.value
    )
    assert measurement_tasks.extract_first_frame_task("abc") == MeasurementStatus.PROCESSING.value
    assert enqueued == ["abc"]

    # uncertain detection: runner parks at AWAITING_CONFIRM -> nothing enqueued
    enqueued.clear()
    monkeypatch.setattr(
        measurement_tasks, "_run", lambda runner, mid: MeasurementStatus.AWAITING_CONFIRM.value
    )
    assert (
        measurement_tasks.extract_first_frame_task("xyz")
        == MeasurementStatus.AWAITING_CONFIRM.value
    )
    assert enqueued == []
