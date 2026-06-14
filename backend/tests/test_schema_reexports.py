"""guards that the schema-module decomposition stays import-compatible.

mission.py / infrastructure.py were split into focused modules; these tests
pin that the old import paths still resolve to the same class objects and
that the SurfaceResponse.agls cross-module forward-ref still serializes.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas import agl, infrastructure, inspection_config, mission, obstacle, safety_zone
from app.schemas import surface as surface_mod
from app.schemas.airport import AirportDetailResponse


def test_inspection_config_reexports_are_same_objects():
    """old app.schemas.mission paths must alias the new inspection_config objects."""
    assert mission.InspectionConfigOverride is inspection_config.InspectionConfigOverride
    assert mission.InspectionConfigResponse is inspection_config.InspectionConfigResponse
    assert mission.LhaSelectionRule is inspection_config.LhaSelectionRule
    assert mission._rule_discriminator is inspection_config._rule_discriminator
    assert mission._validate_transit_altitude is inspection_config._validate_transit_altitude
    assert mission.AngleSourceStr is inspection_config.AngleSourceStr


def test_infrastructure_reexports_are_same_objects():
    """old app.schemas.infrastructure paths must alias the split-module objects."""
    assert infrastructure.SurfaceResponse is surface_mod.SurfaceResponse
    assert infrastructure.AGLResponse is agl.AGLResponse
    assert infrastructure.ObstacleTypeStr is obstacle.ObstacleTypeStr
    assert infrastructure.SafetyZoneTypeStr is safety_zone.SafetyZoneTypeStr
    assert infrastructure.LampTypeStr is agl.LampTypeStr


def _surface_payload():
    """minimal SurfaceResponse payload with one nested AGL."""
    return {
        "id": uuid4(),
        "airport_id": uuid4(),
        "identifier": "RWY09",
        "surface_type": "RUNWAY",
        "geometry": {"type": "LineString", "coordinates": [[0, 0, 0], [1, 1, 1]]},
        "agls": [
            {
                "id": uuid4(),
                "surface_id": uuid4(),
                "agl_type": "PAPI",
                "name": "P1",
                "position": {"type": "Point", "coordinates": [0, 0, 0]},
            }
        ],
    }


def test_surface_response_nested_agls_round_trip():
    """the cross-module agls forward-ref must resolve and serialize post-split."""
    sr = infrastructure.SurfaceResponse.model_validate(_surface_payload())
    assert len(sr.agls) == 1
    assert isinstance(sr.agls[0], agl.AGLResponse)
    assert sr.agls[0].agl_type == "PAPI"


def test_airport_detail_transitive_nesting():
    """AirportDetailResponse resolves SurfaceResponse.agls transitively."""
    ad = AirportDetailResponse.model_validate(
        {
            "id": uuid4(),
            "icao_code": "LZIB",
            "name": "x",
            "elevation": 100.0,
            "location": {"type": "Point", "coordinates": [0, 0, 0]},
            "surfaces": [_surface_payload()],
        }
    )
    assert ad.surfaces[0].agls[0].name == "P1"


def test_angle_band_validator_fires_through_shim():
    """_check_angle_band must still 422 when imported via the mission shim."""
    with pytest.raises(ValidationError, match="angle_start must be less than angle_end"):
        mission.InspectionConfigOverride(angle_start=10.0, angle_end=5.0)
