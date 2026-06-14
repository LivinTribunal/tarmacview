"""unit tests for the extracted schemas._violation_classifier module (#552).

mirrors the legacy-classification cases and pins the re-export contract: the
public schemas.flight_plan surface must expose the same function objects so
existing importers (test_flight_plan_schema, downstream consumers) are unbroken.
"""

import pytest

from app.schemas import flight_plan as schema_flight_plan
from app.schemas._violation_classifier import (
    _CONSTRAINT_NAME_MAP,
    _VIOLATION_KIND_RULES,
    _classify_violation,
    _extract_waypoint_ref,
)


class TestClassifyViolation:
    """keyword -> kind matching, including the specific-over-general ordering."""

    @pytest.mark.parametrize(
        "message,expected",
        [
            ("altitude exceeds limit", "altitude"),
            ("speed is too high", "speed"),
            ("framerate incompatible", "speed_framerate"),
            ("frame rate too low", "speed_framerate"),
            ("speed limited by framerate", "speed_framerate"),
            ("outside geofence boundary", "geofence"),
            ("battery insufficient", "battery"),
            ("runway buffer exceeded", "runway_buffer"),
            ("transit crosses RUNWAY 09L (5m)", "surface_crossing"),
            ("waypoint crosses TAXIWAY B", "surface_crossing"),
            ("obstacle clearance violated", "obstacle"),
            ("camera view obstructed by tower", "camera_obstruction"),
            ("entered safety zone perimeter", "safety_zone"),
            ("auto-set density to 5 pts", "measurement_density"),
            ("ALTITUDE limit exceeded", "altitude"),
            ("outside landing zone", None),
            ("something unknown happened", None),
        ],
    )
    def test_classify(self, message, expected):
        """each message maps to its expected kind (or None when unmatched)."""
        assert _classify_violation(message) == expected


class TestExtractWaypointRef:
    """waypoint-reference regex extraction."""

    @pytest.mark.parametrize(
        "message,expected",
        [
            ("problem at wp 3", "3"),
            ("issue at wp 1-5", "1-5"),
            ("problems at wp 2, 4", "2, 4"),
            ("issue at WP 7", "7"),
            ("no waypoint here", None),
        ],
    )
    def test_extract(self, message, expected):
        """waypoint references are pulled out; absent refs return None."""
        assert _extract_waypoint_ref(message) == expected


class TestConstraintNameMap:
    """the kind -> human-readable name table stays intact after extraction."""

    def test_known_kinds_map(self):
        """sample kinds resolve to their display names."""
        assert _CONSTRAINT_NAME_MAP["altitude"] == "Altitude"
        assert _CONSTRAINT_NAME_MAP["speed_framerate"] == "Speed / Framerate"
        assert _CONSTRAINT_NAME_MAP["surface_crossing"] == "Surface Crossing"

    def test_every_classifiable_kind_has_a_name(self):
        """every kind the classifier can emit has a display name."""
        kinds = {kind for kind, _, _ in _VIOLATION_KIND_RULES}
        assert kinds <= set(_CONSTRAINT_NAME_MAP)


class TestReexportIdentity:
    """schemas.flight_plan re-exports the same objects from the new module."""

    def test_same_objects(self):
        """re-export must be the identical function/dict, not a copy."""
        assert schema_flight_plan._classify_violation is _classify_violation
        assert schema_flight_plan._extract_waypoint_ref is _extract_waypoint_ref
        assert schema_flight_plan._CONSTRAINT_NAME_MAP is _CONSTRAINT_NAME_MAP
