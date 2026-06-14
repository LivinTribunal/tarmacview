"""tests for build_enriched_response global altitude filtering."""

from uuid import uuid4

import pytest

from app.models.airport import Airport
from app.models.flight_plan import FlightPlan, ValidationResult, Waypoint
from app.models.inspection import Inspection, InspectionTemplate
from app.models.mission import Mission
from app.services import flight_plan_agl
from app.services.flight_plan_service import build_enriched_response
from app.services.geometry_converter import geojson_to_wkt

# elevation chosen to match the original repro report
AIRPORT_ELEVATION = 133.0
INSPECTION_AGL = 30.0


def _make_airport(db_session, icao: str | None = None) -> Airport:
    """create a persisted airport with elevation 133 m.

    icao defaults to a 4-char prefix derived from a fresh UUID so tests can run
    after the lazy-backfill commit in build_enriched_response without colliding
    on the airport_icao_code_key unique constraint across tests in the same
    pytest session.
    """
    if icao is None:
        icao = uuid4().hex[:4].upper()
    airport = Airport(
        id=uuid4(),
        icao_code=icao,
        name="Elevation Test Airport",
        elevation=AIRPORT_ELEVATION,
        location=geojson_to_wkt(
            {"type": "Point", "coordinates": [18.11, 49.69, AIRPORT_ELEVATION]}
        ),
        terrain_source="FLAT",
    )
    db_session.add(airport)
    db_session.flush()
    return airport


def _make_flight_plan(db_session, airport: Airport, waypoint_specs: list[tuple]) -> FlightPlan:
    """create a flight plan with waypoints from (waypoint_type, alt_msl) specs."""
    mission = Mission(
        id=uuid4(),
        name="altitude filter test",
        airport_id=airport.id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport.id)
    fp.compile(100.0, 60.0)
    db_session.add(fp)
    db_session.flush()

    val_result = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(val_result)
    db_session.flush()

    for i, (wtype, alt_msl) in enumerate(waypoint_specs, start=1):
        wp = Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=i,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.11 + i * 0.001, 49.69, alt_msl]}
            ),
            waypoint_type=wtype,
        )
        db_session.add(wp)

    db_session.flush()
    db_session.refresh(fp)
    return fp


@pytest.fixture
def airport(db_session):
    """non-zero-elevation airport."""
    yield _make_airport(db_session)
    db_session.rollback()


def test_global_altitude_excludes_takeoff_and_landing(db_session, airport):
    """global agl range must exclude takeoff/landing so it never reports below ground."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            # takeoff and landing on the ground (msl 0) - if included, agl drops to -133
            ("TAKEOFF", 0.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + INSPECTION_AGL),
            ("TRANSIT", AIRPORT_ELEVATION + INSPECTION_AGL),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl == INSPECTION_AGL
    assert response.max_altitude_agl == INSPECTION_AGL
    assert response.min_altitude_agl >= 0
    assert response.min_altitude_msl == AIRPORT_ELEVATION + INSPECTION_AGL
    assert response.max_altitude_msl == AIRPORT_ELEVATION + INSPECTION_AGL


def test_global_altitude_uses_measurement_and_transit_only(db_session, airport):
    """transit and measurement both contribute to global stats; ground waypoints do not."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("TAKEOFF", 0.0),
            ("TRANSIT", AIRPORT_ELEVATION + 10.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 30.0),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl == 10.0
    assert response.max_altitude_agl == 30.0
    assert response.min_altitude_msl == AIRPORT_ELEVATION + 10.0
    assert response.max_altitude_msl == AIRPORT_ELEVATION + 30.0


def test_global_altitude_msl_and_agl_consistent(db_session, airport):
    """msl and agl ranges derive from the same filtered set, differing only by elevation."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("TAKEOFF", 0.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 25.0),
            ("TRANSIT", AIRPORT_ELEVATION + 50.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 75.0),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.max_altitude_msl - response.min_altitude_msl == pytest.approx(
        response.max_altitude_agl - response.min_altitude_agl
    )
    assert response.min_altitude_msl - response.min_altitude_agl == pytest.approx(AIRPORT_ELEVATION)
    assert response.max_altitude_msl - response.max_altitude_agl == pytest.approx(AIRPORT_ELEVATION)


def test_global_altitude_none_when_only_takeoff_landing(db_session, airport):
    """flight plan with only takeoff/landing leaves all four altitude fields none."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("TAKEOFF", 0.0),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl is None
    assert response.max_altitude_agl is None
    assert response.min_altitude_msl is None
    assert response.max_altitude_msl is None


def test_global_altitude_none_when_no_waypoints(db_session, airport):
    """empty trajectory preserves the early-return: altitude fields stay none."""
    mission = Mission(
        id=uuid4(),
        name="empty trajectory",
        airport_id=airport.id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport.id)
    fp.compile(0.0, 0.0)
    db_session.add(fp)
    db_session.flush()
    db_session.refresh(fp)

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl is None
    assert response.max_altitude_agl is None
    assert response.min_altitude_msl is None
    assert response.max_altitude_msl is None


def test_per_inspection_stats_unchanged(db_session, airport):
    """per-inspection agl still reflects each inspection's own waypoints."""
    mission = Mission(
        id=uuid4(),
        name="per inspection stats",
        airport_id=airport.id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    template = InspectionTemplate(id=uuid4(), name="per-inspection-stats template")
    db_session.add(template)
    db_session.flush()

    inspection = Inspection(
        id=uuid4(),
        mission_id=mission.id,
        template_id=template.id,
        method="HORIZONTAL_RANGE",
        sequence_order=1,
    )
    db_session.add(inspection)
    db_session.flush()
    inspection_id = inspection.id

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport.id)
    fp.compile(100.0, 60.0)
    db_session.add(fp)
    db_session.flush()

    val_result = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(val_result)
    db_session.flush()

    # takeoff (no inspection) + 2 measurements (linked to inspection) + landing
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=1,
            position=geojson_to_wkt({"type": "Point", "coordinates": [18.11, 49.69, 0.0]}),
            waypoint_type="TAKEOFF",
        )
    )
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            inspection_id=inspection_id,
            sequence_order=2,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.111, 49.69, AIRPORT_ELEVATION + 20.0]}
            ),
            waypoint_type="MEASUREMENT",
        )
    )
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            inspection_id=inspection_id,
            sequence_order=3,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.112, 49.69, AIRPORT_ELEVATION + 40.0]}
            ),
            waypoint_type="MEASUREMENT",
        )
    )
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=4,
            position=geojson_to_wkt({"type": "Point", "coordinates": [18.113, 49.69, 0.0]}),
            waypoint_type="LANDING",
        )
    )
    db_session.flush()
    db_session.refresh(fp)

    response = build_enriched_response(db_session, fp)

    assert len(response.inspection_stats) == 1
    stats = response.inspection_stats[0]
    assert stats.inspection_id == inspection_id
    assert stats.min_altitude_agl == pytest.approx(20.0)
    assert stats.max_altitude_agl == pytest.approx(40.0)
    assert stats.waypoint_count == 2


def test_global_altitude_includes_hover_point_lock(db_session, airport):
    """measurements-only hover-only inspection populates the global envelope."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("HOVER", AIRPORT_ELEVATION + 25.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl == pytest.approx(25.0)
    assert response.max_altitude_agl == pytest.approx(25.0)
    assert response.min_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 25.0)
    assert response.max_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 25.0)


def test_global_altitude_includes_video_hover_bookends(db_session, airport):
    """video-mode RECORDING_START/STOP HOVERs at flight altitude widen the envelope."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            # video bookends sit at first/last MEASUREMENT altitudes
            ("HOVER", AIRPORT_ELEVATION + 50.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 50.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 60.0),
            ("HOVER", AIRPORT_ELEVATION + 60.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl == pytest.approx(50.0)
    assert response.max_altitude_agl == pytest.approx(60.0)
    assert response.min_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 50.0)
    assert response.max_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 60.0)


def test_global_altitude_full_scope_excludes_takeoff_landing_only(db_session, airport):
    """full scope: ground TAKEOFF/LANDING dropped, HOVER above ground retained."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("TAKEOFF", 0.0),
            ("TRANSIT", AIRPORT_ELEVATION + 20.0),
            ("HOVER", AIRPORT_ELEVATION + 70.0),
            ("TRANSIT", AIRPORT_ELEVATION + 20.0),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert response.min_altitude_agl == pytest.approx(20.0)
    assert response.max_altitude_agl == pytest.approx(70.0)
    assert response.min_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 20.0)
    assert response.max_altitude_msl == pytest.approx(AIRPORT_ELEVATION + 70.0)


# fixtures + helpers for per-WP agl population tests below.


class _CountingProvider:
    """records every batch call and returns ground from a lat-keyed callable."""

    def __init__(self, ground_fn):
        """initialize with a (lat, lon) -> ground callable."""
        self.ground_fn = ground_fn
        self.batch_calls = 0

    def get_elevation(self, lat, lon):
        """return ground for one point."""
        return self.ground_fn(lat, lon)

    def get_elevations_batch(self, points):
        """return ground for every (lat, lon) in points."""
        self.batch_calls += 1
        return [self.ground_fn(lat, lon) for lat, lon in points]


def test_build_enriched_response_populates_agl_dem(db_session, airport, monkeypatch):
    """non-flat provider: agl = wp.alt - sampled_ground per waypoint, clamped to zero."""

    # synthetic DEM: ground at airport is 200 m, much higher than the 133 m
    # airport.elevation, so naive agl = wp.alt - airport.elevation would be
    # off by +67 m. the per-wp lookup must use the sampled ground instead.
    def _ground(lat, lon):
        return 200.0

    provider = _CountingProvider(_ground)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", 230.0),
            ("MEASUREMENT", 250.0),
            ("MEASUREMENT", 190.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert provider.batch_calls == 1
    assert [wp.agl for wp in response.waypoints] == pytest.approx([30.0, 50.0, 0.0])


def test_build_enriched_response_flat_provider_agl_matches_subtract(db_session, airport):
    """flat-mode airport: agl matches wp.alt - airport.elevation byte-for-byte."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 20.0),
            ("TRANSIT", AIRPORT_ELEVATION + 40.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 60.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    assert [wp.agl for wp in response.waypoints] == pytest.approx([20.0, 40.0, 60.0])


def test_build_enriched_response_takeoff_landing_agl_zero(db_session, airport, monkeypatch):
    """TAKEOFF/LANDING force agl=0 regardless of sampled ground or persisted alt."""

    # provider returns ground at 250 m, but TAKEOFF/LANDING must still sit on
    # the rendered terrain (agl=0) and never compute wp.alt - sampled.
    def _ground(lat, lon):
        return 250.0

    monkeypatch.setattr(
        flight_plan_agl,
        "create_elevation_provider",
        lambda *a, **kw: _CountingProvider(_ground),
    )

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("TAKEOFF", 0.0),
            ("MEASUREMENT", 280.0),
            ("LANDING", 0.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    by_type = {wp.waypoint_type: wp for wp in response.waypoints}
    assert by_type["TAKEOFF"].agl == 0.0
    assert by_type["LANDING"].agl == 0.0
    assert by_type["MEASUREMENT"].agl == pytest.approx(30.0)


def test_build_enriched_response_camera_target_agl_populated(db_session, airport, monkeypatch):
    """measurement with camera_target gets camera_target_agl from batched provider."""

    # synthetic DEM: ground = 180 m everywhere. waypoint at 230 -> agl=50.
    # camera_target at 195 -> camera_target_agl = 15.
    def _ground(lat, lon):
        return 180.0

    monkeypatch.setattr(
        flight_plan_agl,
        "create_elevation_provider",
        lambda *a, **kw: _CountingProvider(_ground),
    )

    mission = Mission(
        id=uuid4(),
        name="camera target agl",
        airport_id=airport.id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport.id)
    fp.compile(50.0, 30.0)
    db_session.add(fp)
    db_session.flush()

    val_result = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(val_result)
    db_session.flush()

    wp = Waypoint(
        id=uuid4(),
        flight_plan_id=fp.id,
        sequence_order=1,
        position=geojson_to_wkt({"type": "Point", "coordinates": [18.111, 49.69, 230.0]}),
        waypoint_type="MEASUREMENT",
        camera_target=geojson_to_wkt({"type": "Point", "coordinates": [18.112, 49.6905, 195.0]}),
    )
    db_session.add(wp)
    db_session.flush()
    db_session.refresh(fp)

    response = build_enriched_response(db_session, fp)

    assert response.waypoints[0].agl == pytest.approx(50.0)
    assert response.waypoints[0].camera_target_agl == pytest.approx(15.0)


def test_build_enriched_response_provider_failure_falls_back(db_session, airport, monkeypatch):
    """on provider exception every waypoint falls back to wp.alt - airport.elevation."""

    class _BrokenProvider:
        """raises on the first batch call."""

        def get_elevation(self, lat, lon):
            """unused in tests."""
            raise RuntimeError("boom")

        def get_elevations_batch(self, points):
            """raise so the service hits its fallback path."""
            raise RuntimeError("boom")

    monkeypatch.setattr(
        flight_plan_agl,
        "create_elevation_provider",
        lambda *a, **kw: _BrokenProvider(),
    )

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 25.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 75.0),
        ],
    )

    response = build_enriched_response(db_session, fp)

    # falls back to wp.alt - airport.elevation per waypoint.
    assert [wp.agl for wp in response.waypoints] == pytest.approx([25.0, 75.0])


def test_build_enriched_response_single_batched_call(db_session, airport, monkeypatch):
    """assert one batched lookup covers waypoints with no camera targets."""

    def _ground(lat, lon):
        return AIRPORT_ELEVATION

    provider = _CountingProvider(_ground)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 25.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 25.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 25.0),
        ],
    )

    build_enriched_response(db_session, fp)

    # no camera targets -> one batch call only (the waypoint batch).
    assert provider.batch_calls == 1


def test_build_enriched_response_single_batched_call_with_camera_targets(
    db_session, airport, monkeypatch
):
    """one batch call even when waypoints carry camera targets (concat + slice)."""

    def _ground(lat, lon):
        return AIRPORT_ELEVATION

    provider = _CountingProvider(_ground)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    mission = Mission(
        id=uuid4(),
        name="single batched call with cts",
        airport_id=airport.id,
        status="DRAFT",
    )
    db_session.add(mission)
    db_session.flush()

    fp = FlightPlan(id=uuid4(), mission_id=mission.id, airport_id=airport.id)
    fp.compile(50.0, 30.0)
    db_session.add(fp)
    db_session.flush()

    val_result = ValidationResult(id=uuid4(), flight_plan_id=fp.id, passed=True)
    db_session.add(val_result)
    db_session.flush()

    # two measurements with camera targets + one without
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=1,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.111, 49.69, AIRPORT_ELEVATION + 30.0]}
            ),
            waypoint_type="MEASUREMENT",
            camera_target=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.112, 49.6905, AIRPORT_ELEVATION + 15.0]}
            ),
        )
    )
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=2,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.113, 49.69, AIRPORT_ELEVATION + 40.0]}
            ),
            waypoint_type="MEASUREMENT",
        )
    )
    db_session.add(
        Waypoint(
            id=uuid4(),
            flight_plan_id=fp.id,
            sequence_order=3,
            position=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.114, 49.69, AIRPORT_ELEVATION + 50.0]}
            ),
            waypoint_type="MEASUREMENT",
            camera_target=geojson_to_wkt(
                {"type": "Point", "coordinates": [18.115, 49.6905, AIRPORT_ELEVATION + 25.0]}
            ),
        )
    )
    db_session.flush()
    db_session.refresh(fp)

    response = build_enriched_response(db_session, fp)

    # combined batch (3 wp + 2 ct) -> still one provider call.
    assert provider.batch_calls == 1
    assert response.waypoints[0].agl == pytest.approx(30.0)
    assert response.waypoints[0].camera_target_agl == pytest.approx(15.0)
    assert response.waypoints[1].agl == pytest.approx(40.0)
    assert response.waypoints[1].camera_target_agl is None
    assert response.waypoints[2].agl == pytest.approx(50.0)
    assert response.waypoints[2].camera_target_agl == pytest.approx(25.0)


# persisted-agl regression guards (#496): build_enriched_response reads the
# Waypoint.agl column directly; the elevation provider only fires when a row
# still has a null column (lazy backfill for legacy plans).


def test_build_enriched_response_no_elevation_calls_on_populated_plan(
    db_session, airport, monkeypatch
):
    """populated waypoint columns short-circuit the provider on read."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 30.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 50.0),
            ("TRANSIT", AIRPORT_ELEVATION + 40.0),
        ],
    )
    # pre-populate the new persisted columns so the read path has no work.
    for wp, expected in zip(fp.waypoints, [30.0, 50.0, 40.0]):
        wp.agl = expected
    db_session.flush()

    provider = _CountingProvider(lambda lat, lon: AIRPORT_ELEVATION)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    response = build_enriched_response(db_session, fp)

    # zero provider calls is the load-bearing assertion for the issue #496 fix.
    assert provider.batch_calls == 0
    assert [wp.agl for wp in response.waypoints] == pytest.approx([30.0, 50.0, 40.0])


def test_build_enriched_response_lazy_backfill_persists(db_session, airport, monkeypatch):
    """null columns trigger one-shot backfill; second read fires zero calls."""
    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 20.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 40.0),
        ],
    )

    provider = _CountingProvider(lambda lat, lon: AIRPORT_ELEVATION)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    first = build_enriched_response(db_session, fp)
    assert provider.batch_calls == 1
    assert [wp.agl for wp in first.waypoints] == pytest.approx([20.0, 40.0])

    # second read on the same plan must not re-fire the provider.
    second = build_enriched_response(db_session, fp)
    assert provider.batch_calls == 1
    assert [wp.agl for wp in second.waypoints] == pytest.approx([20.0, 40.0])

    # columns are persisted so a fresh load also sees populated values.
    for wp in fp.waypoints:
        assert wp.agl is not None


def test_batch_update_waypoints_refreshes_only_moved_rows(db_session, airport, monkeypatch):
    """untouched waypoints keep their persisted agl; moved rows are refreshed."""
    from app.schemas.flight_plan import WaypointPositionUpdate
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import batch_update_waypoints

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 30.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 60.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 80.0),
        ],
    )
    # seed sentinel agls on every row so we can tell which were left alone.
    fp.waypoints[0].agl = 999.0
    fp.waypoints[1].agl = 999.0
    fp.waypoints[2].agl = 999.0
    db_session.flush()

    provider = _CountingProvider(lambda lat, lon: AIRPORT_ELEVATION)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    mid = fp.waypoints[1]
    updates = [
        WaypointPositionUpdate(
            waypoint_id=mid.id,
            position=PointZ(
                type="Point",
                coordinates=(18.12, 49.69, AIRPORT_ELEVATION + 70.0),
            ),
        )
    ]

    batch_update_waypoints(db_session, fp.mission_id, updates)

    db_session.refresh(fp.waypoints[0])
    db_session.refresh(fp.waypoints[1])
    db_session.refresh(fp.waypoints[2])

    assert fp.waypoints[0].agl == 999.0
    assert fp.waypoints[2].agl == 999.0
    # moved row recomputed: alt - flat ground = 70.
    assert fp.waypoints[1].agl == pytest.approx(70.0)


def test_insert_transit_waypoint_populates_agl(db_session, airport, monkeypatch):
    """newly inserted TRANSIT row has agl persisted at insert time."""
    from app.schemas.flight_plan import TransitWaypointInsertRequest
    from app.schemas.geometry import PointZ
    from app.services.flight_plan_service import insert_transit_waypoint

    fp = _make_flight_plan(
        db_session,
        airport,
        [
            ("MEASUREMENT", AIRPORT_ELEVATION + 30.0),
            ("MEASUREMENT", AIRPORT_ELEVATION + 50.0),
        ],
    )

    provider = _CountingProvider(lambda lat, lon: AIRPORT_ELEVATION)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    request = TransitWaypointInsertRequest(
        position=PointZ(
            type="Point",
            coordinates=(18.115, 49.69, AIRPORT_ELEVATION + 45.0),
        ),
        after_sequence=1,
    )
    insert_transit_waypoint(db_session, fp.mission_id, request)

    # find the new TRANSIT row by sequence_order
    new_wp = next(wp for wp in fp.waypoints if wp.waypoint_type == "TRANSIT")
    assert new_wp.agl == pytest.approx(45.0)


# _write_violations unit coverage (#552): the helper that collapsed the three
# duplicated dedup-and-insert loops in persist_flight_plan /
# _persist_validation_result. db is faked so the unit stays isolated.


class _RecordingDB:
    """captures every db.add(...) so the inserted rows can be inspected."""

    def __init__(self):
        """start with an empty capture list."""
        self.added = []

    def add(self, obj):
        """record an added ORM object."""
        self.added.append(obj)


def test_write_violations_dedups_by_message_per_category():
    """duplicate messages within one call collapse to the first occurrence."""
    from app.services.flight_plan_service import _write_violations

    db = _RecordingDB()
    rid = uuid4()
    entries = [
        ("same message", ["a"], "altitude"),
        ("same message", ["b"], "speed"),
        ("other message", ["c"], None),
    ]

    _write_violations(db, rid, "warning", entries)

    assert len(db.added) == 2
    first, second = db.added
    # first occurrence wins; the duplicate (different ids/kind) is dropped
    assert first.message == "same message"
    assert first.waypoint_ids == ["a"]
    assert first.violation_kind == "altitude"
    assert second.message == "other message"


def test_write_violations_seen_set_is_per_call_not_shared():
    """a fresh seen-set per call keeps dedup category-local (matches old .clear())."""
    from app.services.flight_plan_service import _write_violations

    db = _RecordingDB()
    rid = uuid4()

    _write_violations(db, rid, "warning", [("dup", [], "speed")])
    _write_violations(db, rid, "violation", [("dup", [], "altitude")])

    # same message, different categories -> both persisted (no cross-call dedup)
    assert [v.category for v in db.added] == ["warning", "violation"]
    assert all(v.message == "dup" for v in db.added)
    assert db.added[0].violation_kind == "speed"
    assert db.added[1].violation_kind == "altitude"


def test_write_violations_default_resolver_is_identity():
    """without a resolver waypoint_ids pass through unchanged."""
    from app.services.flight_plan_service import _write_violations

    db = _RecordingDB()
    rid = uuid4()

    _write_violations(db, rid, "suggestion", [("msg", ["w1", "w2"], None)])

    row = db.added[0]
    assert row.category == "suggestion"
    assert row.waypoint_ids == ["w1", "w2"]
    assert row.violation_kind is None
    assert row.validation_result_id == rid


def test_write_violations_applies_custom_resolver():
    """a supplied resolver (persist_flight_plan's idx->uuid) is applied to ids."""
    from app.services.flight_plan_service import _write_violations

    db = _RecordingDB()
    rid = uuid4()
    mapping = {"idx:0": "uuid-0", "idx:1": "uuid-1"}

    _write_violations(
        db,
        rid,
        "violation",
        [("crosses RUNWAY", ["idx:0", "idx:1"], "surface_crossing")],
        resolve=lambda ids: [mapping[i] for i in ids],
    )

    row = db.added[0]
    assert row.waypoint_ids == ["uuid-0", "uuid-1"]
    assert row.violation_kind == "surface_crossing"
