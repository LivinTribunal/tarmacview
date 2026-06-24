"""measurement iteration service - group linking, media isolation, compare math."""

import itertools

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.enums import MeasurementStatus
from app.core.exceptions import DomainError
from app.domain.measurement.entities import LightSummary, Measurement
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.services import measurement_service
from tests.data.airports import AIRPORT_PAYLOAD

_icao_counter = itertools.count()


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MI' prefix is unique to this file."""
    n = next(_icao_counter)
    return f"MI{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


@pytest.fixture(autouse=True)
def _stub_enqueue(monkeypatch):
    """record enqueue calls instead of importing celery (the api-create path enqueues)."""
    monkeypatch.setattr(measurement_service, "enqueue_first_frame", lambda mid: None)
    monkeypatch.setattr(measurement_service, "enqueue_processing", lambda mid: None)


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the iteration-test inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Iter Service Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def inspection_with_media(client, template_id):
    """fresh airport/mission/inspection carrying one standing media row."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission = client.post(
        "/api/v1/missions", json={"name": "Iter Service", "airport_id": apt["id"]}
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
            "object_key": "drone-media/manual/standing.mp4",
            "filename": "standing.mp4",
            "size_bytes": 2048,
        },
    )
    return insp["id"]


@pytest.fixture
def session(db_engine):
    """a committing session that cleans up its measurement rows on teardown."""
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


def _seed_root(repo, s, created, inspection_id) -> Measurement:
    """persist a root run (its own group, index 1)."""
    root = Measurement(inspection_id=inspection_id)
    root.start_iteration_group()
    repo.save(root)
    s.commit()
    created.append(root.id)
    return root


def test_create_measurement_seeds_root_group(client, inspection_with_media):
    """a mission-wide create is the root of its own group (group == id, index 1)."""
    created = client.post(f"/api/v1/inspections/{inspection_with_media}/measurement").json()
    assert created["iteration_group_id"] == created["id"]
    assert created["iteration_index"] == 1


def test_iterate_increments_index_within_group(session, inspection_with_media):
    """each iterate shares the parent's group and takes the next index."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    root = _seed_root(repo, s, created, inspection_with_media)

    second = measurement_service.iterate_measurement(s, root.id, ["k1"])
    s.commit()
    created.append(second.id)
    assert second.iteration_group_id == root.id
    assert second.iteration_index == 2

    third = measurement_service.iterate_measurement(s, second.id, ["k2"])
    s.commit()
    created.append(third.id)
    assert third.iteration_group_id == root.id
    assert third.iteration_index == 3


def test_iterate_uses_only_supplied_media_keys(session, inspection_with_media):
    """per-run isolation: the new run consumes the request keys, not standing media."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    root = _seed_root(repo, s, created, inspection_with_media)

    new_run = measurement_service.iterate_measurement(s, root.id, ["iter/a.mp4", "iter/b.mp4"])
    s.commit()
    created.append(new_run.id)

    assert new_run.media_object_keys == ["iter/a.mp4", "iter/b.mp4"]
    # the inspection's standing media is never swept in
    assert "drone-media/manual/standing.mp4" not in new_run.media_object_keys


def test_iterate_empty_keys_is_422(session, inspection_with_media):
    """an iteration with no media is rejected."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    root = _seed_root(repo, s, created, inspection_with_media)

    with pytest.raises(DomainError) as exc:
        measurement_service.iterate_measurement(s, root.id, [])
    assert exc.value.status_code == 422


def _seed_group_with_summaries(repo, s, created, inspection_id):
    """two linked runs: PAPI_A fails on iter 1, passes on iter 2 (same setpoint)."""
    root = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.DONE,
        summaries=[LightSummary("PAPI_A", 3.0, 0.1, 3.5, False)],
    )
    root.start_iteration_group()
    repo.save(root)
    s.commit()
    created.append(root.id)

    second = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.DONE,
        iteration_group_id=root.id,
        iteration_index=2,
        summaries=[LightSummary("PAPI_A", 3.0, 0.1, 3.05, True)],
    )
    repo.save(second)
    s.commit()
    created.append(second.id)
    return root, second


def _papi_a(compare):
    """pull the PAPI_A light comparison out of a compare response."""
    return next(light for light in compare.lights if light.light_name == "PAPI_A")


def test_compare_math_delta_and_verdict_change(session, inspection_with_media, monkeypatch):
    """compare carries the setpoint, per-iteration delta, and the FAIL->PASS marker."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    # DONE runs would otherwise hit object storage for frames - no blob seeded here
    monkeypatch.setattr(measurement_service, "_load_frames", lambda m: [])
    root, _second = _seed_group_with_summaries(repo, s, created, inspection_with_media)

    compare = measurement_service.compare_iterations(s, root.id, None)
    papi_a = _papi_a(compare)

    assert papi_a.setting_angle == 3.0
    assert papi_a.tolerance == 0.1
    assert [c.iteration_index for c in papi_a.cells] == [1, 2]
    # delta = measured - setpoint
    assert papi_a.cells[0].delta_from_setpoint == pytest.approx(0.5)
    assert papi_a.cells[1].delta_from_setpoint == pytest.approx(0.05)
    # FAIL on iter 1, PASS on iter 2 -> the second cell flags the flip
    assert papi_a.cells[0].verdict_changed_to_pass is False
    assert papi_a.cells[1].verdict_changed_to_pass is True


def test_compare_filters_to_selected_iterations(session, inspection_with_media, monkeypatch):
    """the iterations filter narrows both the column set and the meta list."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    monkeypatch.setattr(measurement_service, "_load_frames", lambda m: [])
    root, _second = _seed_group_with_summaries(repo, s, created, inspection_with_media)

    compare = measurement_service.compare_iterations(s, root.id, [2])
    assert [it.iteration_index for it in compare.iterations] == [2]
    papi_a = _papi_a(compare)
    assert [c.iteration_index for c in papi_a.cells] == [2]
    # with no prior cell in the selected slice, no flip is reported
    assert papi_a.cells[0].verdict_changed_to_pass is False


def test_compare_missing_group_is_404(session, monkeypatch):
    """comparing an empty/unknown group 404s."""
    from uuid import uuid4

    from app.core.exceptions import NotFoundError

    s, _ = session
    with pytest.raises(NotFoundError):
        measurement_service.compare_iterations(s, uuid4(), None)


def test_list_iterations_ordered_with_rollups(session, inspection_with_media, monkeypatch):
    """list_iterations returns the group ordered by index, carrying pass/fail counts."""
    s, created = session
    repo = SqlAlchemyMeasurementRepository(s)
    root, second = _seed_group_with_summaries(repo, s, created, inspection_with_media)

    items = measurement_service.list_iterations(s, root.id)
    assert [it.iteration_index for it in items] == [1, 2]
    # iter 1 fails PAPI_A, iter 2 passes it
    assert items[0].fail_count == 1 and items[0].pass_count == 0
    assert items[1].pass_count == 1 and items[1].fail_count == 0
