"""unit tests for the extracted per-waypoint agl helpers (flight_plan_agl).

these cover the cluster lifted out of flight_plan_service in the #552 refactor:
ground sampling, provider-failure fallback, takeoff/landing zeroing, the lazy
backfill commit, and the moved-rows-only refresh. db-free by design - the
helpers only touch attributes, so lightweight fakes keep the units isolated.
"""

from types import SimpleNamespace

import pytest

from app.core.enums import WaypointType
from app.services import flight_plan_agl
from app.services import flight_plan_service as fps
from app.services.flight_plan_agl import (
    _agl_from_ground,
    _backfill_waypoint_agl,
    _camera_target_agl_from_ground,
    _compute_waypoint_agl_values,
    _compute_waypoint_data_agl,
    _refresh_persisted_agl,
)
from app.services.geometry_converter import geojson_to_wkt
from app.services.trajectory.types import Point3D, WaypointData


def _wkt(lon, lat, alt):
    """build a WKT point string for tests."""
    return geojson_to_wkt({"type": "Point", "coordinates": [lon, lat, alt]})


class _WP:
    """minimal stand-in for a persisted Waypoint row (attribute access only)."""

    def __init__(
        self,
        position,
        waypoint_type="MEASUREMENT",
        camera_target=None,
        agl=None,
        camera_target_agl=None,
    ):
        """seed the attributes the agl helpers read and write."""
        self.position = position
        self.waypoint_type = waypoint_type
        self.camera_target = camera_target
        self.agl = agl
        self.camera_target_agl = camera_target_agl


class _Provider:
    """records batch calls; optionally fails or tracks close()."""

    def __init__(self, ground=200.0, fail=False):
        """configure the constant ground value and failure mode."""
        self.ground = ground
        self.fail = fail
        self.batch_calls = 0
        self.closed = False

    def get_elevations_batch(self, points):
        """return constant ground per point unless configured to fail."""
        self.batch_calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return [self.ground] * len(points)

    def close(self):
        """record that the helper closed a provider it owned."""
        self.closed = True


class _FakeDB:
    """records flush/commit so the backfill commit contract is observable."""

    def __init__(self):
        """start with zeroed call counters."""
        self.flushes = 0
        self.commits = 0

    def flush(self):
        """count a flush."""
        self.flushes += 1

    def commit(self):
        """count a commit."""
        self.commits += 1


# position parse: round-trip identity + strict raise (Null-Island removal)


def test_agl_from_ground_round_trips_valid_position():
    """a valid position parses to its z so agl = alt - ground exactly."""
    wp = _WP(_wkt(18.1, 49.6, 280.0), waypoint_type="MEASUREMENT")
    assert _agl_from_ground(wp, 250.0) == pytest.approx(30.0)


def test_agl_from_ground_raises_on_missing_position():
    """a missing position is a data bug - it raises rather than yielding (0,0,0)."""
    with pytest.raises(ValueError):
        _agl_from_ground(_WP(None), 250.0)


def test_compute_waypoint_agl_values_raises_on_missing_position(monkeypatch):
    """a null-position row raises instead of silently sampling Null Island."""
    monkeypatch.setattr(
        flight_plan_agl, "create_elevation_provider", lambda *a, **kw: _Provider(ground=200.0)
    )
    wps = [_WP(_wkt(18.1, 49.6, 300.0)), _WP(None)]
    with pytest.raises(ValueError):
        _compute_waypoint_agl_values(wps, SimpleNamespace(), 133.0)


# agl-from-ground primitives


def test_agl_from_ground_takeoff_landing_force_zero():
    """takeoff/landing clamp to 0 regardless of sampled ground; others clamp >= 0."""
    takeoff = _WP(_wkt(18.1, 49.6, 0.0), waypoint_type=WaypointType.TAKEOFF.value)
    landing = _WP(_wkt(18.1, 49.6, 0.0), waypoint_type=WaypointType.LANDING.value)
    meas = _WP(_wkt(18.1, 49.6, 280.0), waypoint_type="MEASUREMENT")
    below = _WP(_wkt(18.1, 49.6, 100.0), waypoint_type="MEASUREMENT")

    assert _agl_from_ground(takeoff, 250.0) == 0.0
    assert _agl_from_ground(landing, 250.0) == 0.0
    assert _agl_from_ground(meas, 250.0) == pytest.approx(30.0)
    # ground above the waypoint -> clamped to zero, never negative
    assert _agl_from_ground(below, 250.0) == 0.0


def test_camera_target_agl_from_ground_clamped():
    """camera-target agl clamps to zero."""
    wp = _WP(_wkt(18.1, 49.6, 200.0), camera_target=_wkt(18.11, 49.61, 195.0))
    assert _camera_target_agl_from_ground(wp, 180.0) == pytest.approx(15.0)
    assert _camera_target_agl_from_ground(wp, 220.0) == 0.0


# _compute_waypoint_data_agl (persist seam)


def test_compute_waypoint_data_agl_takeoff_landing_and_missing_ct(monkeypatch):
    """takeoff/landing force agl=0; missing camera_target yields None."""
    monkeypatch.setattr(
        flight_plan_agl, "create_elevation_provider", lambda *a, **kw: _Provider(ground=200.0)
    )
    airport = SimpleNamespace(elevation=133.0)
    wps = [
        WaypointData(lon=18.1, lat=49.6, alt=0.0, waypoint_type=WaypointType.TAKEOFF),
        WaypointData(lon=18.1, lat=49.6, alt=260.0, waypoint_type=WaypointType.MEASUREMENT),
        WaypointData(
            lon=18.1,
            lat=49.6,
            alt=260.0,
            waypoint_type=WaypointType.MEASUREMENT,
            camera_target=Point3D(lon=18.11, lat=49.61, alt=210.0),
        ),
        WaypointData(lon=18.1, lat=49.6, alt=0.0, waypoint_type=WaypointType.LANDING),
    ]

    agls, ct_agls = _compute_waypoint_data_agl(wps, airport)

    assert agls == pytest.approx([0.0, 60.0, 60.0, 0.0])
    assert ct_agls[0] is None
    assert ct_agls[1] is None
    assert ct_agls[2] == pytest.approx(10.0)
    assert ct_agls[3] is None


def test_compute_waypoint_data_agl_provider_failure_falls_back(monkeypatch):
    """provider raising -> per-entry fallback is wp.alt - airport.elevation, clamped."""
    monkeypatch.setattr(
        flight_plan_agl,
        "create_elevation_provider",
        lambda *a, **kw: _Provider(fail=True),
    )
    airport = SimpleNamespace(elevation=100.0)
    wps = [
        WaypointData(lon=18.1, lat=49.6, alt=125.0, waypoint_type=WaypointType.MEASUREMENT),
        WaypointData(lon=18.1, lat=49.6, alt=175.0, waypoint_type=WaypointType.MEASUREMENT),
    ]

    agls, ct_agls = _compute_waypoint_data_agl(wps, airport)

    assert agls == pytest.approx([25.0, 75.0])
    assert ct_agls == [None, None]


def test_compute_waypoint_data_agl_empty_returns_empty():
    """empty input short-circuits to ([], [])."""
    assert _compute_waypoint_data_agl([], SimpleNamespace(elevation=10.0)) == ([], [])


# _compute_waypoint_agl_values (read/refresh seam)


def test_compute_waypoint_agl_values_provider_failure_uses_fallback(monkeypatch):
    """on provider failure every entry falls back to elevation_fallback."""
    monkeypatch.setattr(
        flight_plan_agl,
        "create_elevation_provider",
        lambda *a, **kw: _Provider(fail=True),
    )
    wps = [
        _WP(_wkt(18.1, 49.6, 300.0)),
        _WP(_wkt(18.1, 49.6, 320.0), camera_target=_wkt(18.11, 49.61, 290.0)),
    ]

    wp_grounds, ct_grounds = _compute_waypoint_agl_values(wps, SimpleNamespace(), 133.0)

    assert wp_grounds == [133.0, 133.0]
    assert ct_grounds == {1: 133.0}


def test_compute_waypoint_agl_values_reuses_passed_provider(monkeypatch):
    """a supplied provider is reused (no create) and not closed by the helper."""

    def _boom(*a, **kw):
        raise AssertionError("create_elevation_provider must not be called")

    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", _boom)
    provider = _Provider(ground=210.0)
    wps = [_WP(_wkt(18.1, 49.6, 300.0))]

    wp_grounds, ct_grounds = _compute_waypoint_agl_values(
        wps, SimpleNamespace(), 0.0, elevation_provider=provider
    )

    assert wp_grounds == [210.0]
    assert ct_grounds == {}
    assert provider.batch_calls == 1
    # helper does not own the caller-supplied provider, so it must not close it
    assert provider.closed is False


def test_compute_waypoint_agl_values_closes_owned_provider(monkeypatch):
    """a provider the helper created is closed in the finally block."""
    provider = _Provider(ground=200.0)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    _compute_waypoint_agl_values([_WP(_wkt(18.1, 49.6, 250.0))], SimpleNamespace(), 0.0)

    assert provider.closed is True


# _backfill_waypoint_agl (lazy read-path commit)


def test_backfill_waypoint_agl_noop_when_columns_populated(monkeypatch):
    """fully-populated rows skip the provider and never flush/commit."""

    def _boom(*a, **kw):
        raise AssertionError("provider must not be built when nothing is missing")

    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", _boom)
    wps = [
        _WP(_wkt(18.1, 49.6, 250.0), agl=30.0),
        _WP(_wkt(18.1, 49.6, 260.0), agl=40.0),
    ]
    flight_plan = SimpleNamespace(waypoints=wps, airport=SimpleNamespace(elevation=133.0))
    db = _FakeDB()

    _backfill_waypoint_agl(db, flight_plan, 133.0)

    assert db.flushes == 0
    assert db.commits == 0


def test_backfill_waypoint_agl_commits_after_writing(monkeypatch):
    """null columns trigger one batched compute, a write-back, and a single commit."""
    provider = _Provider(ground=200.0)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)
    wps = [
        _WP(_wkt(18.1, 49.6, 260.0), agl=None),
        _WP(
            _wkt(18.1, 49.6, 280.0),
            agl=None,
            camera_target=_wkt(18.11, 49.61, 215.0),
            camera_target_agl=None,
        ),
    ]
    flight_plan = SimpleNamespace(waypoints=wps, airport=SimpleNamespace(elevation=133.0))
    db = _FakeDB()

    _backfill_waypoint_agl(db, flight_plan, 133.0)

    assert provider.batch_calls == 1
    assert wps[0].agl == pytest.approx(60.0)
    assert wps[1].agl == pytest.approx(80.0)
    assert wps[1].camera_target_agl == pytest.approx(15.0)
    assert db.flushes == 1
    assert db.commits == 1


# _refresh_persisted_agl (moved-rows-only write)


def test_refresh_persisted_agl_touches_only_passed_rows(monkeypatch):
    """only the supplied rows are recomputed; takeoff -> 0; no camera_target -> None."""
    provider = _Provider(ground=200.0)
    monkeypatch.setattr(flight_plan_agl, "create_elevation_provider", lambda *a, **kw: provider)

    moved = _WP(_wkt(18.1, 49.6, 260.0), camera_target=_wkt(18.11, 49.61, 215.0))
    takeoff = _WP(_wkt(18.1, 49.6, 0.0), waypoint_type=WaypointType.TAKEOFF.value)
    no_ct = _WP(_wkt(18.1, 49.6, 250.0), camera_target_agl=99.0)
    untouched = _WP(_wkt(18.1, 49.6, 999.0), agl=7.0, camera_target_agl=7.0)

    _refresh_persisted_agl([moved, takeoff, no_ct], SimpleNamespace(elevation=133.0))

    assert moved.agl == pytest.approx(60.0)
    assert moved.camera_target_agl == pytest.approx(15.0)
    assert takeoff.agl == 0.0
    assert no_ct.agl == pytest.approx(50.0)
    # row with no camera_target has its stale camera_target_agl cleared
    assert no_ct.camera_target_agl is None
    # row not passed to the refresh keeps its persisted values
    assert untouched.agl == 7.0
    assert untouched.camera_target_agl == 7.0


# public re-export identity: airport_service lazily imports _refresh_persisted_agl
# from flight_plan_service, so the surface must stay the same object post-split


def test_flight_plan_service_reexports_agl_cluster():
    """flight_plan_service re-exports the moved helpers as the same objects."""
    assert fps._refresh_persisted_agl is _refresh_persisted_agl
    assert fps._compute_waypoint_data_agl is _compute_waypoint_data_agl
    assert fps._backfill_waypoint_agl is _backfill_waypoint_agl
    assert fps._GROUND_LEVEL_WAYPOINT_TYPES is flight_plan_agl._GROUND_LEVEL_WAYPOINT_TYPES
