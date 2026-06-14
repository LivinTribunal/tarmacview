"""tests that LHA-placement is the only call site that opts into allow_api=True."""

from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest

from app.services import airport_service
from app.services.elevation_provider import (
    REMOTE_PROVIDER_REGISTRY,
    RemoteElevationProvider,
)


class _SpyRemote(RemoteElevationProvider):
    """remote backend that records every lookup."""

    instances: list["_SpyRemote"] = []

    def __init__(self, api_key: str | None = None):
        """register the instance so tests can sum across rebuilds."""
        self.api_key = api_key
        self.calls: list[tuple[float, float]] = []
        _SpyRemote.instances.append(self)

    def lookup(self, lat: float, lon: float) -> float | None:
        """record the (lat, lon) and return a synthetic terrain elevation."""
        self.calls.append((lat, lon))
        return 271.5


@pytest.fixture(autouse=True)
def _reset_spy():
    """clear the instance registry between tests."""
    _SpyRemote.instances.clear()
    yield
    _SpyRemote.instances.clear()


@pytest.fixture(autouse=True)
def _force_master_toggle_on(monkeypatch):
    """flip the master toggle on so allow_api=True actually reaches the spy."""
    monkeypatch.setattr("app.services.runtime_settings.get_api_fallback_enabled", lambda _db: True)
    monkeypatch.setattr(
        "app.services.runtime_settings.get_api_provider", lambda _db: "OPEN_ELEVATION"
    )
    monkeypatch.setattr("app.services.runtime_settings.get_api_key", lambda _db: None)
    monkeypatch.setitem(REMOTE_PROVIDER_REGISTRY, "OPEN_ELEVATION", _SpyRemote)


def _total_remote_calls() -> int:
    """sum lookups across every spy instance that was constructed in this test."""
    return sum(len(spy.calls) for spy in _SpyRemote.instances)


def _make_flat_airport(elev: float = 300.0):
    """return a mock airport that resolves to FLAT terrain."""
    apt = MagicMock()
    apt.terrain_source = "FLAT"
    apt.elevation = elev
    apt.dem_file_path = None
    return apt


class TestNormalizePositionAltitudeOptIn:
    """_normalize_position_altitude opts into allow_api only when caller passes it."""

    def test_default_does_not_call_remote(self):
        """default allow_api=False keeps every non-LHA path on flat."""
        airport = _make_flat_airport()
        coords = [14.27, 50.10, 0.0]
        airport_service._normalize_position_altitude(coords, airport, db=MagicMock())
        # without allow_api the wrapper was never constructed, so no remote spy
        assert _total_remote_calls() == 0

    def test_allow_api_true_calls_remote_once(self):
        """LHA-tier opt-in (allow_api=True) drives one remote lookup per write."""
        airport = _make_flat_airport()
        coords = [14.27, 50.10, 0.0]
        airport_service._normalize_position_altitude(
            coords, airport, db=MagicMock(), allow_api=True
        )
        assert _total_remote_calls() == 1


class TestGetElevationAtPoint:
    """GET /airports/{id}/elevation honors allow_api opt-in."""

    def test_allow_api_false_returns_flat_label(self, monkeypatch):
        """allow_api=False keeps source=FLAT on a flat airport."""
        airport = _make_flat_airport()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = airport

        elevation, source = airport_service.get_elevation_at_point(
            db, airport_id="aid", lat=50.0, lon=14.0
        )
        assert elevation == 300.0
        assert source == "FLAT"
        assert _total_remote_calls() == 0

    def test_allow_api_true_returns_api_label(self):
        """allow_api=True drives one remote lookup and labels source=API."""
        airport = _make_flat_airport()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = airport

        elevation, source = airport_service.get_elevation_at_point(
            db, airport_id="aid", lat=50.0, lon=14.0, allow_api=True
        )
        assert elevation == 271.5
        assert source == "API"
        assert _total_remote_calls() == 1


def _setup_lha_airport_with_runway(client):
    """seed an airport + runway + AGL and return airport_id, surface_id, agl_id."""
    apt = client.post(
        "/api/v1/airports",
        json={
            "icao_code": "ELEV",
            "name": "Elev Airport",
            "elevation": 300.0,
            "location": {"type": "Point", "coordinates": [14.26, 50.10, 300]},
        },
    ).json()
    aid = apt["id"]
    surface = client.post(
        f"/api/v1/airports/{aid}/surfaces",
        json={
            "identifier": "RWY 09L",
            "surface_type": "RUNWAY",
            "geometry": {
                "type": "LineString",
                "coordinates": [[14.26, 50.10, 300], [14.28, 50.10, 300]],
            },
        },
    ).json()
    sid = surface["id"]
    agl = client.post(
        f"/api/v1/airports/{aid}/surfaces/{sid}/agls",
        json={
            "agl_type": "PAPI",
            "name": "PAPI 09L",
            "position": {"type": "Point", "coordinates": [14.27, 50.10, 300]},
        },
    ).json()
    return aid, sid, agl["id"]


class TestCallSiteFanout:
    """integration-style call-counts: LHA placement is the only API-tier site."""

    def test_create_lha_fires_one_remote_lookup(self, client, monkeypatch):
        """create LHA route opts into allow_api=True and fires exactly one remote call."""
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_fallback_enabled", lambda _db: True
        )
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_provider", lambda _db: "OPEN_ELEVATION"
        )
        monkeypatch.setattr("app.services.runtime_settings.get_api_key", lambda _db: None)
        with patch.dict(REMOTE_PROVIDER_REGISTRY, {"OPEN_ELEVATION": _SpyRemote}, clear=False):
            aid, sid, agl_id = _setup_lha_airport_with_runway(client)
            _SpyRemote.instances.clear()

            resp = client.post(
                f"/api/v1/airports/{aid}/surfaces/{sid}/agls/{agl_id}/lhas",
                json={
                    "unit_designator": "A",
                    "setting_angle": 3.0,
                    "lamp_type": "LED",
                    "position": {"type": "Point", "coordinates": [14.271, 50.10, 300]},
                },
            )
            assert resp.status_code in (200, 201)
            assert _total_remote_calls() == 1

    def test_create_obstacle_fires_zero_remote_lookups(self, client, monkeypatch):
        """obstacle create path stays on DEM-or-flat - no remote calls."""
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_fallback_enabled", lambda _db: True
        )
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_provider", lambda _db: "OPEN_ELEVATION"
        )
        monkeypatch.setattr("app.services.runtime_settings.get_api_key", lambda _db: None)
        with patch.dict(REMOTE_PROVIDER_REGISTRY, {"OPEN_ELEVATION": _SpyRemote}, clear=False):
            apt = client.post(
                "/api/v1/airports",
                json={
                    "icao_code": "OBST",
                    "name": "Obs Airport",
                    "elevation": 300.0,
                    "location": {"type": "Point", "coordinates": [14.26, 50.10, 300]},
                },
            ).json()
            _SpyRemote.instances.clear()

            resp = client.post(
                f"/api/v1/airports/{apt['id']}/obstacles",
                json={
                    "name": "Tower",
                    "type": "BUILDING",
                    "height": 15.0,
                    "boundary": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [14.265, 50.105, 0],
                                [14.266, 50.105, 0],
                                [14.266, 50.106, 0],
                                [14.265, 50.106, 0],
                                [14.265, 50.105, 0],
                            ]
                        ],
                    },
                },
            )
            assert resp.status_code in (200, 201)
            assert _total_remote_calls() == 0

    def test_create_agl_fires_zero_remote_lookups(self, client, monkeypatch):
        """AGL create stays on DEM-or-flat even when the master toggle is on."""
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_fallback_enabled", lambda _db: True
        )
        monkeypatch.setattr(
            "app.services.runtime_settings.get_api_provider", lambda _db: "OPEN_ELEVATION"
        )
        monkeypatch.setattr("app.services.runtime_settings.get_api_key", lambda _db: None)
        with patch.dict(REMOTE_PROVIDER_REGISTRY, {"OPEN_ELEVATION": _SpyRemote}, clear=False):
            apt = client.post(
                "/api/v1/airports",
                json={
                    "icao_code": "AGLT",
                    "name": "AGL Airport",
                    "elevation": 300.0,
                    "location": {"type": "Point", "coordinates": [14.26, 50.10, 300]},
                },
            ).json()
            aid = apt["id"]
            surface = client.post(
                f"/api/v1/airports/{aid}/surfaces",
                json={
                    "identifier": "RWY 09R",
                    "surface_type": "RUNWAY",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[14.26, 50.10, 300], [14.28, 50.10, 300]],
                    },
                },
            ).json()
            sid = surface["id"]
            _SpyRemote.instances.clear()

            resp = client.post(
                f"/api/v1/airports/{aid}/surfaces/{sid}/agls",
                json={
                    "agl_type": "RUNWAY_EDGE_LIGHTS",
                    "name": "Edge",
                    "position": {"type": "Point", "coordinates": [14.27, 50.10, 300]},
                },
            )
            assert resp.status_code in (200, 201)
            assert _total_remote_calls() == 0


class TestRenormalizeFanout:
    """renormalize sweep fires N remote calls = N LHAs, independent of obstacle/AGL count."""

    def test_renormalize_remote_calls_equal_lha_count(self, client, db_session):
        """flat airport with many obstacles + AGLs but N LHAs fires exactly N remote calls.

        the renormalize protocol opens a bare provider for obstacles / AGLs / missions
        / waypoints (allow_api=False) and a separate allow_api=True provider for the
        LHA loop. only the LHA loop should reach the remote backend, regardless of
        how many obstacles or AGLs the airport carries.
        """
        apt = client.post(
            "/api/v1/airports",
            json={
                "icao_code": "RFAN",
                "name": "Renorm Fanout",
                "elevation": 300.0,
                "location": {"type": "Point", "coordinates": [14.26, 50.10, 300]},
            },
        ).json()
        aid = apt["id"]

        surface = client.post(
            f"/api/v1/airports/{aid}/surfaces",
            json={
                "identifier": "RWY 09F",
                "surface_type": "RUNWAY",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[14.26, 50.10, 300], [14.30, 50.10, 300]],
                },
            },
        ).json()
        sid = surface["id"]

        # 3 AGLs at distinct positions - exceeds the LHA count so the assertion
        # discriminates between "fires per AGL" and "fires per LHA"
        agl_ids = []
        for i, lon in enumerate([14.262, 14.270, 14.278]):
            agl = client.post(
                f"/api/v1/airports/{aid}/surfaces/{sid}/agls",
                json={
                    "agl_type": "PAPI",
                    "name": f"PAPI {i}",
                    "position": {"type": "Point", "coordinates": [lon, 50.10, 300]},
                },
            ).json()
            agl_ids.append(agl["id"])

        # 4 obstacles with 5-vertex outer rings - 20 ring points total. if the
        # obstacle loop accidentally used an allow_api provider this would
        # dominate the call count
        for i in range(4):
            off = 0.001 * (i + 1)
            resp = client.post(
                f"/api/v1/airports/{aid}/obstacles",
                json={
                    "name": f"Tower {i}",
                    "type": "BUILDING",
                    "height": 15.0,
                    "boundary": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [14.265 + off, 50.105, 0],
                                [14.266 + off, 50.105, 0],
                                [14.266 + off, 50.106, 0],
                                [14.265 + off, 50.106, 0],
                                [14.265 + off, 50.105, 0],
                            ]
                        ],
                    },
                },
            )
            assert resp.status_code in (200, 201)

        # 5 LHAs distributed across the 3 AGLs at distinct (lat, lon) so the
        # per-instance LRU cache on the shared lha_provider does not dedupe
        lha_specs = [
            (agl_ids[0], "A", [14.2625, 50.100, 300]),
            (agl_ids[0], "B", [14.2626, 50.101, 300]),
            (agl_ids[1], "A", [14.2705, 50.100, 300]),
            (agl_ids[1], "B", [14.2706, 50.101, 300]),
            (agl_ids[2], "A", [14.2785, 50.100, 300]),
        ]
        for agl_id, designator, coords in lha_specs:
            resp = client.post(
                f"/api/v1/airports/{aid}/surfaces/{sid}/agls/{agl_id}/lhas",
                json={
                    "unit_designator": designator,
                    "setting_angle": 3.0,
                    "lamp_type": "LED",
                    "position": {"type": "Point", "coordinates": coords},
                },
            )
            assert resp.status_code in (200, 201)

        lha_count = len(lha_specs)
        # LHA create itself opts into allow_api=True and fired one spy per write;
        # clear so the assertion only counts the renormalize-sweep calls.
        _SpyRemote.instances.clear()

        airport_service.renormalize_airport_altitudes(db_session, UUID(aid))

        assert _total_remote_calls() == lha_count
