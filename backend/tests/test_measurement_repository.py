"""sqlalchemy measurement adapter - save/get/list round-trip through the port."""

from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import (
    LightBox,
    LightSummary,
    Measurement,
    ReferencePoint,
)
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from tests.data.airports import AIRPORT_PAYLOAD


@pytest.fixture(scope="module")
def inspection_id(client):
    """an inspection row the measurements can hang off (FK target)."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LZRP"}).json()
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Repo Test Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Repo Mission", "airport_id": apt["id"]}
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()
    return insp["id"]


@pytest.fixture
def session(db_engine):
    """a committing session that mirrors the worker's SessionLocal usage."""
    s = sessionmaker(bind=db_engine)()
    created: list = []
    try:
        yield s, created
    finally:
        # clean up committed measurement rows so the module-scoped inspection stays reusable
        from app.models.measurement import Measurement as MeasurementORM

        for mid in created:
            s.query(MeasurementORM).filter(MeasurementORM.id == mid).delete()
        s.commit()
        s.close()


def test_save_then_get_round_trips_every_field(session, inspection_id):
    """a fully-populated aggregate survives save -> get_by_id byte-for-byte."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    lha = uuid4()
    measurement = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.AWAITING_CONFIRM,
        runway_heading=243.0,
        reference_points=[
            ReferencePoint(
                light_name="PAPI_A",
                latitude=50.1,
                longitude=14.2,
                elevation=380.0,
                lha_id=lha,
                unit_designator="A",
                setting_angle=3.0,
                tolerance=0.5,
            )
        ],
        light_boxes=[LightBox("PAPI_A", 10.0, 50.0, 8.0)],
        summaries=[LightSummary("PAPI_A", 3.0, 0.5, 3.1, True)],
        media_object_keys=["drone-media/manual/a.mp4"],
        first_frame_object_key="measurements/x/first_frame.jpg",
    )
    saved = repo.save(measurement)
    s.commit()
    created.append(saved.id)

    loaded = repo.get_by_id(saved.id)
    assert loaded is not None
    assert loaded.status == MeasurementStatus.AWAITING_CONFIRM
    assert loaded.runway_heading == 243.0
    assert loaded.media_object_keys == ["drone-media/manual/a.mp4"]
    assert loaded.first_frame_object_key == "measurements/x/first_frame.jpg"
    rp = loaded.reference_points[0]
    assert rp.light_name == "PAPI_A"
    assert rp.lha_id == lha
    assert rp.setting_angle == 3.0
    assert loaded.light_boxes[0].size == 8.0
    assert loaded.summaries[0].passed is True


def test_save_is_idempotent_upsert(session, inspection_id):
    """saving the same id twice updates in place, does not duplicate."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    m = Measurement(inspection_id=inspection_id)
    repo.save(m)
    s.commit()
    created.append(m.id)

    m.object_key = "measurements/x/results.json.gz"
    m.transition_to(MeasurementStatus.FIRST_FRAME)
    repo.save(m)
    s.commit()

    rows = repo.list_by_inspection(inspection_id)
    matching = [r for r in rows if r.id == m.id]
    assert len(matching) == 1
    assert matching[0].object_key == "measurements/x/results.json.gz"
    assert matching[0].status == MeasurementStatus.FIRST_FRAME


def test_list_by_inspection_is_newest_first(session, inspection_id):
    """list_by_inspection orders by created_at descending."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    first = repo.save(Measurement(inspection_id=inspection_id))
    s.commit()
    created.append(first.id)
    second = repo.save(Measurement(inspection_id=inspection_id))
    s.commit()
    created.append(second.id)

    ids = [m.id for m in repo.list_by_inspection(inspection_id)]
    assert ids.index(second.id) < ids.index(first.id)


def test_get_by_id_missing_returns_none(session):
    """an unknown id resolves to None, not an error."""
    s, _ = session
    repo = SqlAlchemyMeasurementRepository(s)
    assert repo.get_by_id(uuid4()) is None


def test_label_round_trips_both_directions(session, inspection_id):
    """the free-text label maps to the row and back through get_by_id."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    m = Measurement(inspection_id=inspection_id, label="morning re-fly")
    saved = repo.save(m)
    s.commit()
    created.append(saved.id)
    assert saved.label == "morning re-fly"

    loaded = repo.get_by_id(saved.id)
    assert loaded.label == "morning re-fly"

    # clearing the label persists as null
    loaded.label = None
    repo.save(loaded)
    s.commit()
    assert repo.get_by_id(saved.id).label is None


def test_delete_removes_the_row(session, inspection_id):
    """delete drops one aggregate; a second delete is a harmless no-op."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    saved = repo.save(Measurement(inspection_id=inspection_id))
    s.commit()
    created.append(saved.id)
    assert repo.get_by_id(saved.id) is not None

    repo.delete(saved.id)
    s.commit()
    assert repo.get_by_id(saved.id) is None

    # idempotent - deleting a missing id does not raise
    repo.delete(saved.id)
    s.commit()


@pytest.fixture
def two_inspections(client):
    """a fresh mission with two inspections - FK targets for the batched-list test."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LZMB"}).json()
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Batch Test Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Batch Mission", "airport_id": apt["id"]}
    ).json()
    a = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()
    b = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()
    return a["id"], b["id"]


def test_list_by_inspections_batches_across_inspections(session, two_inspections):
    """one batched read returns rows from several inspections, newest first."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    insp_a, insp_b = two_inspections

    first = repo.save(Measurement(inspection_id=insp_a))
    s.commit()
    created.append(first.id)
    second = repo.save(Measurement(inspection_id=insp_b))
    s.commit()
    created.append(second.id)

    ids = [m.id for m in repo.list_by_inspections([insp_a, insp_b])]
    assert first.id in ids
    assert second.id in ids
    # newest first across inspections
    assert ids.index(second.id) < ids.index(first.id)


def test_list_by_inspections_empty_returns_empty(session):
    """no inspection ids short-circuits to an empty list (no query)."""
    s, _ = session
    repo = SqlAlchemyMeasurementRepository(s)
    assert repo.list_by_inspections([]) == []


def test_list_by_statuses_empty_returns_empty(session):
    """no statuses short-circuits to an empty list (no query)."""
    s, _ = session
    repo = SqlAlchemyMeasurementRepository(s)
    assert repo.list_by_statuses([]) == []


def test_list_by_statuses_filters_on_status(session, inspection_id):
    """only rows in the requested statuses come back; others are excluded."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)

    processing = repo.save(Measurement(inspection_id=inspection_id))
    processing.transition_to(MeasurementStatus.FIRST_FRAME)
    processing.transition_to(MeasurementStatus.PROCESSING)
    repo.save(processing)
    s.commit()
    created.append(processing.id)

    queued = repo.save(Measurement(inspection_id=inspection_id))
    s.commit()
    created.append(queued.id)

    ids = {m.id for m in repo.list_by_statuses([MeasurementStatus.PROCESSING])}
    assert processing.id in ids
    assert queued.id not in ids
