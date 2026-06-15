"""airport-scoped measurements list - every run across the airport's missions.

mirrors the mission-scoped list shape (status + rollup) but spans all of an airport's
missions/inspections, carrying mission context so rows disambiguate. read-only path.
"""

import itertools
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_current_user
from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import LightSummary, Measurement
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.main import app
from app.models.measurement import Measurement as MeasurementORM
from tests.conftest import TEST_USER_ID, _override_current_user
from tests.data.airports import AIRPORT_PAYLOAD

_icao_counter = itertools.count()
_BASE_TIME = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)


def _unique_icao() -> str:
    """a fresh db-unique 4-alpha ICAO - 'MB' prefix keeps this file's codes clear of
    test_measurement_api ('MA') and test_measurement_results_api ('MR')."""
    n = next(_icao_counter)
    return f"MB{chr(ord('A') + (n // 26) % 26)}{chr(ord('A') + n % 26)}"


@pytest.fixture(scope="module")
def template_id(client):
    """horizontal-range template for the list-test inspections."""
    return client.post(
        "/api/v1/inspection-templates",
        json={"name": "Airport Measure Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()["id"]


def _make_mission(client, airport_id, name, template_id):
    """one mission + one inspection at the airport; returns (mission_id, inspection_id)."""
    mission = client.post("/api/v1/missions", json={"name": name, "airport_id": airport_id}).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template_id, "method": "HORIZONTAL_RANGE"},
    ).json()
    return mission["id"], insp["id"]


@pytest.fixture
def airport_ctx(client, template_id):
    """fresh airport with two missions, each carrying one inspection."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    mission_a, insp_a = _make_mission(client, apt["id"], "Alpha", template_id)
    mission_b, insp_b = _make_mission(client, apt["id"], "Bravo", template_id)
    return {
        "airport_id": apt["id"],
        "mission_a": mission_a,
        "inspection_a": insp_a,
        "mission_b": mission_b,
        "inspection_b": insp_b,
    }


def _save_measurement(
    db_engine,
    inspection_id,
    *,
    status,
    summaries=None,
    object_key=None,
    error_message=None,
    created_at=None,
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
        # override the server-default timestamp so ordering is deterministic
        if created_at is not None:
            row = s.query(MeasurementORM).filter(MeasurementORM.id == m.id).first()
            row.created_at = created_at
            s.flush()
        s.commit()
        return str(m.id)
    finally:
        s.close()


def test_list_airport_measurements_spans_missions_with_context(client, db_engine, airport_ctx):
    """every run across the airport's missions is returned, each carrying mission name."""
    done_id = _save_measurement(
        db_engine,
        airport_ctx["inspection_a"],
        status=MeasurementStatus.DONE,
        object_key="measurements/x/results.json.gz",
        summaries=[
            LightSummary("PAPI_A", 3.0, 0.5, 3.1, True),
            LightSummary("PAPI_B", 3.0, 0.5, 5.0, False),
        ],
    )
    queued_id = _save_measurement(
        db_engine, airport_ctx["inspection_b"], status=MeasurementStatus.QUEUED
    )

    r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
    assert r.status_code == 200, r.text
    rows = {row["id"]: row for row in r.json()}
    assert set(rows) == {done_id, queued_id}

    done_row = rows[done_id]
    assert done_row["mission_id"] == airport_ctx["mission_a"]
    assert done_row["mission_name"] == "Alpha"
    assert done_row["status"] == "DONE"
    assert done_row["has_results"] is True
    assert done_row["pass_count"] == 1
    assert done_row["fail_count"] == 1
    assert done_row["inspection_method"] == "HORIZONTAL_RANGE"
    assert done_row["inspection_sequence_order"] >= 1

    queued_row = rows[queued_id]
    assert queued_row["mission_id"] == airport_ctx["mission_b"]
    assert queued_row["mission_name"] == "Bravo"
    assert queued_row["has_results"] is False


def test_list_airport_measurements_grouped_newest_first(client, db_engine, airport_ctx):
    """rows group by mission (newest activity first), newest-first within each group."""
    alpha_old = _save_measurement(
        db_engine,
        airport_ctx["inspection_a"],
        status=MeasurementStatus.QUEUED,
        created_at=_BASE_TIME + timedelta(minutes=1),
    )
    bravo_mid = _save_measurement(
        db_engine,
        airport_ctx["inspection_b"],
        status=MeasurementStatus.QUEUED,
        created_at=_BASE_TIME + timedelta(minutes=2),
    )
    alpha_new = _save_measurement(
        db_engine,
        airport_ctx["inspection_a"],
        status=MeasurementStatus.QUEUED,
        created_at=_BASE_TIME + timedelta(minutes=3),
    )

    r = client.get(f"/api/v1/airports/{airport_ctx['airport_id']}/measurements")
    assert r.status_code == 200, r.text
    order = [row["id"] for row in r.json()]
    # Alpha leads (its newest run is the most recent overall), its two runs are
    # contiguous and newest-first, then Bravo.
    assert order == [alpha_new, alpha_old, bravo_mid]


def test_list_airport_measurements_empty_airport(client):
    """an airport with no missions returns an empty list."""
    apt = client.post(
        "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": _unique_icao()}
    ).json()
    r = client.get(f"/api/v1/airports/{apt['id']}/measurements")
    assert r.status_code == 200
    assert r.json() == []


def test_list_airport_measurements_unknown_airport_is_404(client):
    """an unknown airport id is a 404, not an empty list."""
    r = client.get(f"/api/v1/airports/{uuid4()}/measurements")
    assert r.status_code == 404


def test_list_airport_measurements_no_access_is_403(client, airport_ctx):
    """an operator without access to the airport is refused before any read."""
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
