"""airport-scoped measurements list - rows across an airport's missions/inspections."""

import itertools
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_current_user
from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import LightSummary, Measurement
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.main import app
from app.services import measurement_service
from tests.conftest import TEST_USER_ID, _override_current_user
from tests.data.airports import AIRPORT_PAYLOAD

_icao_counter = itertools.count()


def _unique_icao() -> str:
    """fresh db-unique 4-alpha ICAO under the 'MV' prefix (measurement-view tests)."""
    n = next(_icao_counter)
    return f"MV{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the airport-list inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Airport Measure Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


@pytest.fixture
def airport_ctx(client, template_id):
    """one airport, two missions, each with one inspection - the multi-mission shape."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    missions = {}
    for name in ("Alpha", "Bravo"):
        mission = client.post(
            "/api/v1/missions", json={"name": name, "airport_id": apt["id"]}
        ).json()
        insp = client.post(
            f"/api/v1/missions/{mission['id']}/inspections",
            json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
        ).json()
        missions[name] = {"mission_id": mission["id"], "inspection_id": insp["id"]}
    return {"airport_id": apt["id"], "missions": missions}


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


def test_list_spans_missions_with_context(client, db_engine, airport_ctx):
    """one row per measurement across the airport's missions, carrying mission + rollup."""
    alpha = airport_ctx["missions"]["Alpha"]
    bravo = airport_ctx["missions"]["Bravo"]
    queued_id = _save_measurement(
        db_engine, alpha["inspection_id"], status=MeasurementStatus.QUEUED
    )
    done_id = _save_measurement(
        db_engine,
        bravo["inspection_id"],
        status=MeasurementStatus.DONE,
        object_key="measurements/x/results.json.gz",
        summaries=[
            LightSummary("PAPI_A", 3.0, 0.5, 3.1, True),
            LightSummary("PAPI_B", 3.0, 0.5, 5.0, False),
        ],
    )

    r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
    assert r.status_code == 200, r.text
    rows = {row["id"]: row for row in r.json()}
    assert set(rows) == {queued_id, done_id}

    done_row = rows[done_id]
    assert done_row["mission_id"] == bravo["mission_id"]
    assert done_row["mission_name"] == "Bravo"
    assert done_row["status"] == "DONE"
    assert done_row["has_results"] is True
    assert done_row["pass_count"] == 1
    assert done_row["fail_count"] == 1
    assert done_row["inspection_method"] == "HORIZONTAL_RANGE"
    assert done_row["inspection_sequence_order"] >= 1

    queued_row = rows[queued_id]
    assert queued_row["mission_name"] == "Alpha"
    assert queued_row["status"] == "QUEUED"
    assert queued_row["has_results"] is False
    assert queued_row["pass_count"] == 0
    assert queued_row["fail_count"] == 0


def test_list_scoped_to_airport(client, db_engine, airport_ctx, template_id):
    """another airport's measurements never leak into this airport's list."""
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
        db_engine,
        airport_ctx["missions"]["Alpha"]["inspection_id"],
        status=MeasurementStatus.QUEUED,
    )

    r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()}
    assert mine_id in ids
    assert other_id not in ids


def test_list_error_carries_message(client, db_engine, airport_ctx):
    """an ERROR run surfaces its failure message in the list row."""
    err_id = _save_measurement(
        db_engine,
        airport_ctx["missions"]["Alpha"]["inspection_id"],
        status=MeasurementStatus.ERROR,
        error_message="processing failed: boom",
    )

    r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[err_id]["status"] == "ERROR"
    assert rows[err_id]["error_message"] == "processing failed: boom"
    assert rows[err_id]["has_results"] is False


def test_list_empty_airport(client):
    """an airport with no missions returns an empty list."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    r = client.get(f"/api/v1/airports/{apt['id']}/measurements")
    assert r.status_code == 200
    assert r.json() == []


def test_list_cross_airport_is_403(client, airport_ctx):
    """an operator without access to the airport is refused."""
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
        r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
        assert r.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = _override_current_user


def test_list_has_no_n_plus_one(db_engine, airport_ctx):
    """resolving the list is one inspections+missions join + one batched measurements read."""
    alpha = airport_ctx["missions"]["Alpha"]
    bravo = airport_ctx["missions"]["Bravo"]
    _save_measurement(db_engine, alpha["inspection_id"], status=MeasurementStatus.QUEUED)
    _save_measurement(
        db_engine,
        bravo["inspection_id"],
        status=MeasurementStatus.DONE,
        object_key="measurements/x/results.json.gz",
    )

    selects: list[str] = []

    def _count(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    s = sessionmaker(bind=db_engine)()
    event.listen(db_engine, "before_cursor_execute", _count)
    try:
        rows = measurement_service.list_airport_measurements(s, UUID(airport_ctx["airport_id"]))
    finally:
        event.remove(db_engine, "before_cursor_execute", _count)
        s.close()

    assert len(rows) == 2
    # exactly two reads regardless of row count - the join, then the batched IN
    assert len(selects) == 2, selects
