"""derived MSL/AGL fields on obstacle / safety-zone / agl feature responses.

covers the obstacle base/top computed fields, the zone centroid floor/ceiling
AGL sampling (FLAT vs DEM), and the AGL MEHT-altitude enrichment on airport read.
"""

import math
from uuid import uuid4

from app.schemas.obstacle import ObstacleResponse
from app.schemas.safety_zone import SafetyZoneResponse
from app.services.airport import altitude as altitude_svc
from app.services.airport.core import _enrich_derived_altitudes

# unique icao prefix for this file: AD01..

_RING = "POLYGON Z ((14.0 50.0 5, 14.001 50.0 7, 14.001 50.001 6, 14.0 50.001 5, 14.0 50.0 5))"


def _obstacle_payload(boundary: str, height: float) -> dict:
    """minimal ObstacleResponse-shaped dict for schema validation."""
    return {
        "id": uuid4(),
        "airport_id": uuid4(),
        "name": "tower",
        "height": height,
        "boundary": boundary,
        "buffer_distance": 15.0,
        "type": "TOWER",
    }


class TestObstacleDerivedAltitudes:
    """obstacle base/top MSL computed fields."""

    def test_base_and_top_from_ring(self):
        """base is the min ring z, top is base + height."""
        obs = ObstacleResponse.model_validate(_obstacle_payload(_RING, 30.0))
        assert obs.base_altitude_msl == 5
        assert obs.top_altitude_msl == 35

    def test_empty_ring_yields_none(self):
        """a boundary with no usable ring leaves both fields None."""
        obs = ObstacleResponse.model_validate(_obstacle_payload("POLYGON Z EMPTY", 30.0))
        assert obs.base_altitude_msl is None
        assert obs.top_altitude_msl is None

    def test_fields_serialize(self):
        """the computed fields are part of the dumped response."""
        obs = ObstacleResponse.model_validate(_obstacle_payload(_RING, 10.0))
        dumped = obs.model_dump()
        assert dumped["base_altitude_msl"] == 5
        assert dumped["top_altitude_msl"] == 15


class _Airport:
    """bare airport stand-in for provider construction (FLAT by default)."""

    def __init__(self, elevation: float):
        self.elevation = elevation
        self.terrain_source = "FLAT"
        self.dem_file_path = None


class _Zone:
    def __init__(self, geometry, floor, ceiling):
        self.geometry = geometry
        self.altitude_floor = floor
        self.altitude_ceiling = ceiling


_ZONE_WKT = "POLYGON Z ((14.0 50.0 0, 14.01 50.0 0, 14.01 50.01 0, 14.0 50.01 0, 14.0 50.0 0))"


class TestZoneAltitudeAgl:
    """zone centroid floor/ceiling AGL sampling."""

    def test_flat_source(self):
        """FLAT ground is airport.elevation, so agl = bound - elevation."""
        airport = _Airport(elevation=200.0)
        zone = _Zone(_ZONE_WKT, floor=250.0, ceiling=400.0)
        altitude_svc.sample_zone_altitude_agl(airport, [zone])
        assert zone.altitude_floor_agl == 50.0
        assert zone.altitude_ceiling_agl == 200.0

    def test_both_null_bounds(self):
        """a zone with no floor/ceiling leaves both AGL fields None."""
        airport = _Airport(elevation=200.0)
        zone = _Zone(_ZONE_WKT, floor=None, ceiling=None)
        altitude_svc.sample_zone_altitude_agl(airport, [zone])
        assert zone.altitude_floor_agl is None
        assert zone.altitude_ceiling_agl is None

    def test_dem_source_diverges_from_flat(self, monkeypatch):
        """a DEM ground reading of 210 gives floor_agl 40, diverging from the FLAT 50."""

        class _FakeProvider:
            def get_elevation(self, lat, lon):
                return 210.0

        monkeypatch.setattr(
            altitude_svc, "create_elevation_provider", lambda *a, **k: _FakeProvider()
        )
        airport = _Airport(elevation=200.0)
        zone = _Zone(_ZONE_WKT, floor=250.0, ceiling=400.0)
        altitude_svc.sample_zone_altitude_agl(airport, [zone])
        assert zone.altitude_floor_agl == 40.0
        assert zone.altitude_ceiling_agl == 190.0

    def test_unparseable_geometry_is_safe(self):
        """a bad geometry leaves the AGL fields None rather than raising."""
        airport = _Airport(elevation=200.0)
        zone = _Zone("not wkt at all", floor=250.0, ceiling=None)
        altitude_svc.sample_zone_altitude_agl(airport, [zone])
        assert zone.altitude_floor_agl is None


class _Agl:
    def __init__(self, glide_slope_angle=None, meht_height_m=None, distance_from_threshold=None):
        self.glide_slope_angle = glide_slope_angle
        self.meht_height_m = meht_height_m
        self.distance_from_threshold = distance_from_threshold
        self.meht_altitude_msl = None


class _Surface:
    def __init__(self, threshold_position, agls):
        self.threshold_position = threshold_position
        self.agls = agls


class _EnrichAirport(_Airport):
    def __init__(self, elevation, surfaces, safety_zones):
        super().__init__(elevation)
        self.surfaces = surfaces
        self.safety_zones = safety_zones


_THRESHOLD = "POINT Z (14.0 50.0 300)"


class TestAglMehtEnrichment:
    """agl meht_altitude_msl derivation on airport read."""

    def test_surveyed_meht_height(self):
        """surveyed meht rides directly on top of threshold ground z."""
        agl = _Agl(glide_slope_angle=3.0, meht_height_m=15.0)
        airport = _EnrichAirport(0.0, [_Surface(_THRESHOLD, [agl])], [])
        _enrich_derived_altitudes(None, airport)
        assert agl.meht_altitude_msl == 315.0

    def test_derived_from_distance_and_glide(self):
        """meht derives from distance * tan(glide) when not surveyed."""
        agl = _Agl(glide_slope_angle=3.0, distance_from_threshold=300.0)
        airport = _EnrichAirport(0.0, [_Surface(_THRESHOLD, [agl])], [])
        _enrich_derived_altitudes(None, airport)
        expected = 300.0 + 300.0 * math.tan(math.radians(3.0))
        assert agl.meht_altitude_msl is not None
        assert abs(agl.meht_altitude_msl - expected) < 1e-6

    def test_no_threshold_yields_none(self):
        """a surface with no threshold leaves meht_altitude_msl None."""
        agl = _Agl(glide_slope_angle=3.0, meht_height_m=15.0)
        airport = _EnrichAirport(0.0, [_Surface(None, [agl])], [])
        _enrich_derived_altitudes(None, airport)
        assert agl.meht_altitude_msl is None

    def test_no_meht_data_yields_none(self):
        """edge lights (no meht height, no distance) leave the field None."""
        agl = _Agl(glide_slope_angle=None)
        airport = _EnrichAirport(0.0, [_Surface(_THRESHOLD, [agl])], [])
        _enrich_derived_altitudes(None, airport)
        assert agl.meht_altitude_msl is None

    def test_zone_enrichment_runs_from_airport_read(self):
        """the enrichment step also fills zone floor/ceiling AGL."""
        zone = _Zone(_ZONE_WKT, floor=250.0, ceiling=None)
        airport = _EnrichAirport(200.0, [], [zone])
        _enrich_derived_altitudes(None, airport)
        assert zone.altitude_floor_agl == 50.0


def test_safety_zone_response_carries_agl_fields():
    """SafetyZoneResponse serializes the derived AGL fields set as transient attrs."""
    zone = _Zone(_ZONE_WKT, floor=250.0, ceiling=400.0)
    zone.id = uuid4()
    zone.airport_id = uuid4()
    zone.name = "ctr"
    zone.type = "CTR"
    zone.is_active = True
    altitude_svc.sample_zone_altitude_agl(_Airport(200.0), [zone])
    resp = SafetyZoneResponse.model_validate(zone, from_attributes=True)
    assert resp.altitude_floor_agl == 50.0
    assert resp.altitude_ceiling_agl == 200.0
