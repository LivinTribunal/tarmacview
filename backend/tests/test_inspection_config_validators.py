"""shared from/to validator helper for the inspection-config schemas.

validate_range_order backs three from/to checks; these pin that the two
operators (inclusive range vs strict angle band) and the verbatim error
messages do not drift now that they share one helper.
"""

import pytest
from pydantic import ValidationError

from app.schemas.common import validate_range_order
from app.schemas.inspection_config import (
    InspectionConfigOverride,
    LhaSelectionRuleRangeParams,
)
from app.schemas.inspection_template import InspectionConfigCreate

# validate_range_order helper


def test_passes_when_either_bound_is_none():
    """the check only fires when both bounds are supplied."""
    validate_range_order(None, 5, "boom")
    validate_range_order(5, None, "boom")
    validate_range_order(None, None, "boom")


def test_strict_default_rejects_equal_and_greater():
    """default rejects from == to and from > to."""
    with pytest.raises(ValueError, match="boom"):
        validate_range_order(3, 3, "boom")
    with pytest.raises(ValueError, match="boom"):
        validate_range_order(4, 3, "boom")


def test_allow_equal_permits_equal_but_rejects_greater():
    """allow_equal lets equal bounds through, still rejects from > to."""
    validate_range_order(3, 3, "boom", allow_equal=True)
    with pytest.raises(ValueError, match="boom"):
        validate_range_order(4, 3, "boom", allow_equal=True)


# range bounds (inclusive)


def test_range_from_equal_to_accepted():
    """range from == to is valid - bounds are inclusive."""
    params = LhaSelectionRuleRangeParams.model_validate({"from": 3, "to": 3})
    assert params.from_ == 3
    assert params.to == 3


def test_range_from_greater_than_to_rejected_message():
    """range from > to raises the verbatim message."""
    with pytest.raises(ValidationError, match="range from must be <= to"):
        LhaSelectionRuleRangeParams.model_validate({"from": 5, "to": 2})


# angle band (strict)


def test_angle_band_equal_rejected_on_override():
    """override angle_start == angle_end is rejected."""
    with pytest.raises(ValidationError, match="angle_start must be less than angle_end"):
        InspectionConfigOverride(angle_start=5.0, angle_end=5.0)


def test_angle_band_equal_rejected_on_template_create():
    """template angle_start == angle_end is rejected the same way."""
    with pytest.raises(ValidationError, match="angle_start must be less than angle_end"):
        InspectionConfigCreate(angle_start=5.0, angle_end=5.0)


def test_angle_band_strictly_increasing_accepted():
    """a strictly increasing band passes on both schemas."""
    assert InspectionConfigOverride(angle_start=2.0, angle_end=6.0).angle_end == 6.0
    assert InspectionConfigCreate(angle_start=2.0, angle_end=6.0).angle_end == 6.0
