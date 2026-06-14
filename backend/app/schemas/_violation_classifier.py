"""legacy violation-kind classification - message-keyword fallback for null-kind rows.

extracted from schemas/flight_plan.py. obeys the schemas invariant: stdlib only,
no service/model imports. the orchestrator persists violation_kind on every new
row, so this machinery exists solely to backfill rows written before the column.
"""

import re

# keyword-to-kind mapping for structured violation classification
_VIOLATION_KIND_RULES: list[tuple[str, list[str], list[str]]] = [
    ("speed_framerate", ["framerate"], []),
    ("speed_framerate", ["frame rate"], []),
    ("altitude", ["altitude"], []),
    ("speed", ["speed"], ["framerate", "frame rate"]),
    ("geofence", ["geofence"], []),
    ("battery", ["battery"], []),
    ("surface_crossing", ["crosses"], []),
    ("runway_buffer", ["runway"], []),
    ("obstacle", ["obstacle"], []),
    ("camera_obstruction", ["obstructed"], []),
    ("safety_zone", ["safety zone"], []),
    ("measurement_density", ["density"], []),
]


def _classify_violation(message: str) -> str | None:
    """derive violation kind from message content."""
    # rules are ordered specific-to-general - excludes skip a generic rule so
    # a more specific one (listed earlier) can match instead, e.g. "speed" is
    # skipped when "framerate" is present so the speed_framerate rule wins
    msg = message.lower()
    for kind, keywords, excludes in _VIOLATION_KIND_RULES:
        if any(kw in msg for kw in excludes):
            continue
        if all(kw in msg for kw in keywords):
            return kind
    return None


# violation kind to human-readable constraint name
_CONSTRAINT_NAME_MAP: dict[str, str] = {
    "altitude": "Altitude",
    "speed": "Speed",
    "speed_framerate": "Speed / Framerate",
    "geofence": "Geofence",
    "battery": "Battery",
    "surface_crossing": "Surface Crossing",
    "runway_buffer": "Runway Buffer",
    "obstacle": "Obstacle Clearance",
    "camera_obstruction": "Camera View",
    "safety_zone": "Safety Zone",
    "measurement_density": "Measurement Density",
}

# regex to extract waypoint references like "wp 3", "wp 1-5", "(wp 2, 4)"
_WP_REF_RE = re.compile(r"\bwp\s+([\d,\s\-]+)", re.IGNORECASE)


def _extract_waypoint_ref(message: str) -> str | None:
    """extract waypoint reference string from a violation message."""
    m = _WP_REF_RE.search(message)
    return m.group(1).strip() if m else None
