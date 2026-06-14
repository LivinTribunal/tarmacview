"""unit tests for seeding: seed.py row mappers + user/airport assignment paths.

these run against stubbed openaip responses and mocked sessions, so no
database fixture is required.
"""

import math
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from app import seed
from app.core.enums import UserRole
from app.models.airport import AirfieldSurface, Obstacle, SafetyZone
from app.models.user import User
from app.seed import _seed_obstacles, _seed_runways, _seed_zones
from app.services import seeder


def _parse_point_z(wkt: str) -> tuple[float, float, float]:
    """pull (lon, lat, z) floats out of a 'POINT Z (lon lat z)' string."""
    assert wkt.startswith("POINT Z (") and wkt.endswith(")")
    lon, lat, z = (float(v) for v in wkt[len("POINT Z (") : -1].split())
    return lon, lat, z


class _Geom:
    """stub for a pydantic geometry schema - returns its geojson on model_dump."""

    def __init__(self, geojson: dict):
        """store the geojson dict to echo back."""
        self._geojson = geojson

    def model_dump(self) -> dict:
        """return the wrapped geojson dict."""
        return self._geojson


def _point(lon: float, lat: float, alt: float = 0.0) -> _Geom:
    """build a stub Point geometry."""
    return _Geom({"type": "Point", "coordinates": [lon, lat, alt]})


def _line(coords: list[list[float]]) -> _Geom:
    """build a stub LineString geometry."""
    return _Geom({"type": "LineString", "coordinates": coords})


def _polygon(ring: list[list[float]]) -> _Geom:
    """build a stub single-ring Polygon geometry."""
    return _Geom({"type": "Polygon", "coordinates": [ring]})


def test_seed_runways_maps_fields_without_db():
    """runway rows carry RUNWAY type, the airport id, and WKT-converted geometry."""
    airport_id = uuid4()
    data = SimpleNamespace(
        runways=[
            SimpleNamespace(
                identifier="09/27",
                geometry=_line([[14.255, 50.10, 300.0], [14.265, 50.10, 300.0]]),
                boundary=_polygon(
                    [
                        [14.255, 50.099, 300.0],
                        [14.265, 50.099, 300.0],
                        [14.265, 50.101, 300.0],
                        [14.255, 50.101, 300.0],
                        [14.255, 50.099, 300.0],
                    ]
                ),
                heading=90.0,
                length=2000.0,
                width=45.0,
                threshold_position=_point(14.255, 50.10, 300.0),
                end_position=_point(14.265, 50.10, 300.0),
            )
        ],
    )

    rows = _seed_runways(data, airport_id)

    assert len(rows) == 1
    rw = rows[0]
    assert isinstance(rw, AirfieldSurface)
    assert rw.airport_id == airport_id
    assert rw.surface_type == "RUNWAY"
    assert rw.identifier == "09/27"
    assert rw.heading == 90.0
    assert rw.length == 2000.0
    assert rw.width == 45.0
    assert rw.geometry.startswith("LINESTRING Z (")
    assert rw.boundary.startswith("POLYGON Z (")
    assert rw.threshold_position.startswith("POINT Z (")
    assert rw.end_position.startswith("POINT Z (")


def test_seed_obstacles_z_fallback_to_airport_elevation():
    """a 2D boundary ring (centroid z == 0) falls back to the airport elevation."""
    airport_id = uuid4()
    data = SimpleNamespace(
        elevation=412.0,
        obstacles=[
            SimpleNamespace(
                name="crane",
                height=30.0,
                type="CRANE",
                boundary=_polygon(
                    [
                        [14.260, 50.100],
                        [14.261, 50.100],
                        [14.261, 50.101],
                        [14.260, 50.101],
                        [14.260, 50.100],
                    ]
                ),
            )
        ],
    )

    rows = _seed_obstacles(data, airport_id)

    assert len(rows) == 1
    obs = rows[0]
    assert isinstance(obs, Obstacle)
    assert obs.airport_id == airport_id
    assert obs.name == "crane"
    assert obs.height == 30.0
    ring = data.obstacles[0].boundary.model_dump()["coordinates"][0]
    exp_lon, exp_lat, _ = Obstacle.centroid_from_boundary_ring(ring)
    lon, lat, z = _parse_point_z(obs.position)
    assert math.isclose(lon, exp_lon, abs_tol=1e-9)
    assert math.isclose(lat, exp_lat, abs_tol=1e-9)
    # 2D ring -> centroid z is 0.0 -> falls back to data.elevation
    assert z == 412.0
    assert obs.boundary.startswith("POLYGON Z (")


def test_seed_obstacles_uses_ring_z_when_present():
    """a 3D boundary ring keeps the ring's own corner z (no elevation fallback)."""
    airport_id = uuid4()
    data = SimpleNamespace(
        elevation=412.0,
        obstacles=[
            SimpleNamespace(
                name="mast",
                height=50.0,
                type="MAST",
                boundary=_polygon(
                    [
                        [14.260, 50.100, 305.0],
                        [14.262, 50.100, 305.0],
                        [14.262, 50.102, 305.0],
                        [14.260, 50.102, 305.0],
                        [14.260, 50.100, 305.0],
                    ]
                ),
            )
        ],
    )

    rows = _seed_obstacles(data, airport_id)

    _, _, z = _parse_point_z(rows[0].position)
    assert z == 305.0


def test_seed_zones_maps_fields_and_defaults_null_altitudes():
    """zones copy type/geometry; null altitude floor/ceiling default to 0.0."""
    airport_id = uuid4()
    data = SimpleNamespace(
        safety_zones=[
            SimpleNamespace(
                name="CTR",
                type="CONTROLLED_AIRSPACE",
                geometry=_polygon(
                    [
                        [14.25, 50.09],
                        [14.27, 50.09],
                        [14.27, 50.11],
                        [14.25, 50.11],
                        [14.25, 50.09],
                    ]
                ),
                altitude_floor=None,
                altitude_ceiling=None,
            )
        ],
    )

    rows = _seed_zones(data, airport_id)

    assert len(rows) == 1
    zone = rows[0]
    assert isinstance(zone, SafetyZone)
    assert zone.airport_id == airport_id
    assert zone.name == "CTR"
    assert zone.type == "CONTROLLED_AIRSPACE"
    assert zone.altitude_floor == 0.0
    assert zone.altitude_ceiling == 0.0
    assert zone.is_active is True
    assert zone.geometry.startswith("POLYGON Z (")


def test_seed_users_assigns_every_airport_to_the_coordinator(monkeypatch):
    """seeded users (incl. the coordinator) get every airport, so no airport ships orphaned."""
    monkeypatch.setattr(seeder.settings, "environment", "test")
    monkeypatch.setattr(seeder.settings, "seed_users", True)

    airport_a = SimpleNamespace(id=uuid4())
    airport_b = SimpleNamespace(id=uuid4())

    user_query = MagicMock()
    user_query.count.return_value = 0
    airport_query = MagicMock()
    airport_query.all.return_value = [airport_a, airport_b]

    added: list[User] = []
    db = MagicMock()
    db.query.side_effect = lambda model: user_query if model is User else airport_query
    db.add.side_effect = added.append

    seeder.seed_users(db)

    coordinators = [u for u in added if u.role == UserRole.COORDINATOR.value]
    assert coordinators, "expected a coordinator to be seeded"
    for coord in coordinators:
        assert {a.id for a in coord.airports} == {airport_a.id, airport_b.id}


def test_seed_airport_assigns_new_airport_to_existing_users(monkeypatch):
    """an airport seeded after users already exist is appended to every user."""
    coordinator = SimpleNamespace(role=UserRole.COORDINATOR.value, airports=[])
    operator = SimpleNamespace(role=UserRole.OPERATOR.value, airports=[])

    airport_query = MagicMock()
    airport_query.filter_by.return_value.first.return_value = None
    user_query = MagicMock()
    user_query.all.return_value = [coordinator, operator]

    db = MagicMock()
    db.query.side_effect = lambda model: user_query if model is User else airport_query

    data = SimpleNamespace(
        icao_code="LZPP",
        name="Piestany Airport",
        city="Piestany",
        country="SK",
        elevation=160.0,
        location=_point(17.828, 48.625, 160.0),
        runways=[],
        obstacles=[],
        safety_zones=[],
    )

    monkeypatch.setattr(seed, "SessionLocal", lambda: db)
    monkeypatch.setattr(seed, "lookup_airport_by_icao", lambda icao: data)

    seed.seed_airport("LZPP")

    db.rollback.assert_not_called()
    db.commit.assert_called_once()
    assert [a.icao_code for a in coordinator.airports] == ["LZPP"]
    assert [a.icao_code for a in operator.airports] == ["LZPP"]
