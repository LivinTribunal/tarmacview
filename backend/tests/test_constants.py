"""tests that the shared constants module is the single source of truth."""

from app.core.constants import (
    DEFAULT_BUFFER_DISTANCE_M,
    METERS_PER_FOOT,
    METERS_PER_KM,
    METERS_PER_NM,
    MIN_TRANSIT_ALTITUDE_AGL_M,
    OPENAIP_NEARBY_RADIUS_KM,
)
from app.services.trajectory import types as trajectory_types


def test_min_transit_altitude_value():
    """min transit altitude is the audit-mandated 5.0m floor."""
    assert MIN_TRANSIT_ALTITUDE_AGL_M == 5.0


def test_default_buffer_distance_value():
    """default buffer distance matches the column server default."""
    assert DEFAULT_BUFFER_DISTANCE_M == 5.0


def test_trajectory_alias_matches_canonical_constant():
    """trajectory MINIMUM_ALTITUDE_THRESHOLD aliases the canonical constant."""
    assert trajectory_types.MINIMUM_ALTITUDE_THRESHOLD == MIN_TRANSIT_ALTITUDE_AGL_M


def test_unit_conversion_constants():
    """unit conversion factors match the canonical numeric values."""
    assert METERS_PER_FOOT == 0.3048
    assert METERS_PER_NM == 1852.0
    assert METERS_PER_KM == 1000.0


def test_openaip_nearby_radius_value():
    """openaip nearby search radius is the discoverable 25km default."""
    assert OPENAIP_NEARBY_RADIUS_KM == 25.0
