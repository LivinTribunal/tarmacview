"""openaip unit conversion helpers (length, altitude limit)."""

import logging

from app.core.constants import METERS_PER_FOOT, METERS_PER_KM, METERS_PER_NM

logger = logging.getLogger(__name__)


def _convert_length(value: float | None, unit: int | None) -> float | None:
    """convert a length value (openaip unit code) to meters."""
    if value is None:
        return None

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    if unit is None or unit == 0:
        return parsed
    if unit == 1:
        return parsed * METERS_PER_FOOT
    if unit == 6:
        return parsed * METERS_PER_KM
    if unit == 7:
        return parsed * METERS_PER_NM

    # unrecognized unit - log and treat as meters so callers can still see the value
    logger.warning("openaip: unrecognized length unit code %r; treating as meters", unit)
    return parsed


def _convert_altitude_limit(limit: dict | None) -> float | None:
    """convert an openaip altitude limit dict to meters above msl.

    openaip shape: {"value": <num>, "unit": <code>, "referenceDatum": <code>}
    - unit 2 (flight level) -> value * 100 ft -> meters
    - unit 1 (feet) -> meters
    - unit 0 or missing (meters) -> as-is
    returns None if value is missing or the unit code is unrecognized.
    """
    if not limit or "value" not in limit:
        return None

    value = limit.get("value")
    unit = limit.get("unit")
    if value is None:
        return None

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    # absent unit defaults to meters - matches _convert_length behavior
    if unit is None or unit == 0:
        return parsed
    if unit == 2:
        # flight level - 1 FL = 100 ft
        return parsed * 100.0 * METERS_PER_FOOT
    if unit == 1:
        return parsed * METERS_PER_FOOT

    # unrecognized unit - safer to drop than silently mis-scale
    logger.warning("openaip: unrecognized altitude unit code %r; skipping limit", unit)
    return None
