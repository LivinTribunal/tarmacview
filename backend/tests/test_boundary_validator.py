"""tests for AIRPORT_BOUNDARY mode-aware soft warnings, plus the Shapely ports of
the former PostGIS standalone safety_validator paths."""

from types import SimpleNamespace
from uuid import UUID

import pytest

from app.core.enums import ConstraintType, SafetyZoneType, SurfaceType, WaypointType
from app.services.trajectory.safety_validator import (
    _batch_check_boundary_zones,
    _check_constraint,
    check_safety_zone,
)
from app.services.trajectory.types import LocalBoundary, LocalGeometries, WaypointData
from app.utils.local_projection import LocalProjection

# boundary square around prague area
_BOUNDARY_WKT = (
    "POLYGON Z ((14.25 50.09 0, 14.27 50.09 0, 14.27 50.11 0, 14.25 50.11 0, 14.25 50.09 0))"
)

_REF_LON, _REF_LAT = 14.26, 50.10


@pytest.fixture
def boundary_wkt() -> str:
    """return the WKT boundary polygon string."""
    return _BOUNDARY_WKT


def _boundary_zone(geom: str, name: str = "fence") -> SimpleNamespace:
    """build a minimal SafetyZone-like stub backed by a WKT geometry string."""
    return SimpleNamespace(
        id="zone-1",
        name=name,
        type=SafetyZoneType.AIRPORT_BOUNDARY.value,
        geometry=geom,
        altitude_floor=None,
        altitude_ceiling=None,
    )


def _restricted_zone(geom: str, name: str = "tower") -> SimpleNamespace:
    """build a minimal PROHIBITED (hard) SafetyZone-like stub."""
    return SimpleNamespace(
        id="zone-2",
        name=name,
        type=SafetyZoneType.PROHIBITED.value,
        geometry=geom,
        altitude_floor=None,
        altitude_ceiling=None,
    )


def _constraint(
    constraint_type: str,
    *,
    boundary: str | None = None,
    lateral_buffer: float | None = None,
    is_hard: bool = True,
) -> SimpleNamespace:
    """build a minimal ConstraintRule-like stub."""
    return SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        constraint_type=constraint_type,
        is_hard_constraint=is_hard,
        min_altitude=None,
        max_altitude=None,
        max_horizontal_speed=None,
        max_vertical_speed=None,
        max_flight_time=None,
        reserve_margin=None,
        lateral_buffer=lateral_buffer,
        longitudinal_buffer=None,
        boundary=boundary,
    )


def _surface(geometry: str, identifier: str = "06/24") -> SimpleNamespace:
    """build a minimal AirfieldSurface-like stub for runway-buffer checks."""
    return SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-0000000000aa"),
        surface_type=SurfaceType.RUNWAY.value,
        identifier=identifier,
        geometry=geometry,
    )


def _build_boundary_local_geoms(name: str = "fence") -> LocalGeometries:
    """build LocalGeometries with boundary matching the WKT polygon."""
    proj = LocalProjection(ref_lon=_REF_LON, ref_lat=_REF_LAT)
    corners = [(14.25, 50.09), (14.27, 50.09), (14.27, 50.11), (14.25, 50.11)]
    local_corners = [proj.to_local(lon, lat) for lon, lat in corners]
    from shapely.geometry import Polygon

    poly = Polygon(local_corners)
    boundary = LocalBoundary(polygon=poly, name=name)
    return LocalGeometries(
        proj=proj, obstacles=[], zones=[], boundary_zones=[boundary], surfaces=[]
    )


def test_boundary_warning_suppressed_when_keep_inside_off():
    """when keep-inside is off no warning fires regardless of waypoint side."""
    inside = WaypointData(lon=14.26, lat=50.10, alt=100.0, waypoint_type=WaypointType.TRANSIT)
    outside = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.TRANSIT)
    local_geoms = _build_boundary_local_geoms()

    result = _batch_check_boundary_zones(
        [inside, outside], local_geoms, keep_inside_airport_boundary=False
    )
    assert result == []


def test_boundary_warning_fires_for_transit_outside_when_keep_inside_on():
    """keep-inside on warns on a transit waypoint outside the boundary."""
    outside = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.TRANSIT)
    local_geoms = _build_boundary_local_geoms(name="prague fence")

    result = _batch_check_boundary_zones([outside], local_geoms, keep_inside_airport_boundary=True)

    assert len(result) == 1
    v = result[0]
    assert v.is_warning
    assert v.violation_kind == "geofence"
    assert "prague fence" in v.message
    assert "transit" in v.message.lower()
    assert v.waypoint_index == 0


def test_boundary_warning_silent_for_transit_inside():
    """a transit waypoint inside the boundary never warns even with keep-inside on."""
    inside = WaypointData(lon=14.26, lat=50.10, alt=100.0, waypoint_type=WaypointType.TRANSIT)
    local_geoms = _build_boundary_local_geoms()

    result = _batch_check_boundary_zones([inside], local_geoms, keep_inside_airport_boundary=True)

    assert result == []


def test_boundary_warning_fires_for_takeoff_landing():
    """TAKEOFF and LANDING outside the boundary warn when keep-inside is on."""
    takeoff = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.TAKEOFF)
    landing = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.LANDING)
    local_geoms = _build_boundary_local_geoms()

    result = _batch_check_boundary_zones(
        [takeoff, landing], local_geoms, keep_inside_airport_boundary=True
    )
    assert len(result) == 2
    messages = " ".join(v.message for v in result)
    assert "takeoff" in messages.lower()
    assert "landing" in messages.lower()


def test_boundary_warning_exempts_measurement_and_hover():
    """measurement and hover waypoints never warn for boundary side."""
    measurement = WaypointData(
        lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.MEASUREMENT
    )
    hover = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.HOVER)
    local_geoms = _build_boundary_local_geoms()

    result = _batch_check_boundary_zones(
        [measurement, hover], local_geoms, keep_inside_airport_boundary=True
    )
    assert result == []


def test_boundary_warning_default_is_off():
    """default keep_inside_airport_boundary (False) suppresses every warning."""
    outside = WaypointData(lon=14.30, lat=50.20, alt=100.0, waypoint_type=WaypointType.TRANSIT)
    local_geoms = _build_boundary_local_geoms()

    assert _batch_check_boundary_zones([outside], local_geoms) == []


def test_check_safety_zone_inverted_for_boundary(boundary_wkt):
    """check_safety_zone applies inverted semantics to AIRPORT_BOUNDARY zones.

    this is the legacy WKT path used outside the trajectory pipeline; mode-aware
    logic only applies inside `_batch_check_boundary_zones`.
    """
    outside = WaypointData(lon=14.30, lat=50.20, alt=100.0)
    zone = _boundary_zone(boundary_wkt)

    result = check_safety_zone(None, outside, zone)

    assert result is not None
    assert result.is_warning
    assert result.violation_kind == "geofence"


def test_check_safety_zone_inside_boundary_no_violation(boundary_wkt):
    """waypoint inside the boundary returns no violation via check_safety_zone."""
    inside = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    zone = _boundary_zone(boundary_wkt)

    assert check_safety_zone(None, inside, zone) is None


def test_check_safety_zone_inside_restricted_zone_hard_violation(boundary_wkt):
    """waypoint inside a non-boundary zone is a hard safety-zone violation."""
    inside = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    zone = _restricted_zone(boundary_wkt)

    result = check_safety_zone(None, inside, zone)

    assert result is not None
    assert not result.is_warning
    assert result.violation_kind == "safety_zone"


def test_check_safety_zone_outside_restricted_zone_no_violation(boundary_wkt):
    """waypoint outside a non-boundary zone is fine."""
    outside = WaypointData(lon=14.50, lat=50.50, alt=100.0)
    zone = _restricted_zone(boundary_wkt)

    assert check_safety_zone(None, outside, zone) is None


def test_check_constraint_geofence_inside_no_violation(boundary_wkt):
    """waypoint inside the GEOFENCE polygon is fine."""
    inside = WaypointData(lon=14.26, lat=50.10, alt=100.0)
    constraint = _constraint(ConstraintType.GEOFENCE, boundary=boundary_wkt)

    assert _check_constraint(None, inside, constraint, []) is None


def test_check_constraint_geofence_outside_violation(boundary_wkt):
    """waypoint outside the GEOFENCE polygon is a hard violation."""
    outside = WaypointData(lon=14.50, lat=50.50, alt=100.0)
    constraint = _constraint(ConstraintType.GEOFENCE, boundary=boundary_wkt)

    result = _check_constraint(None, outside, constraint, [])
    assert result is not None
    assert not result.is_warning
    assert "outside geofence" in result.message


def test_check_constraint_runway_buffer_within_violates():
    """waypoint within the lateral runway buffer triggers a hard violation."""
    centerline = "LINESTRING Z (14.255 50.10 0, 14.265 50.10 0)"
    surface = _surface(centerline)
    wp = WaypointData(lon=14.260, lat=50.1000451, alt=100.0)
    constraint = _constraint(ConstraintType.RUNWAY_BUFFER, lateral_buffer=200.0)

    result = _check_constraint(None, wp, constraint, [surface])
    assert result is not None
    assert "runway 06/24" in result.message


def test_check_constraint_runway_buffer_outside_no_violation():
    """waypoint beyond the lateral runway buffer is fine."""
    centerline = "LINESTRING Z (14.255 50.10 0, 14.265 50.10 0)"
    surface = _surface(centerline)
    wp = WaypointData(lon=14.260, lat=50.20, alt=100.0)
    constraint = _constraint(ConstraintType.RUNWAY_BUFFER, lateral_buffer=200.0)

    assert _check_constraint(None, wp, constraint, [surface]) is None
