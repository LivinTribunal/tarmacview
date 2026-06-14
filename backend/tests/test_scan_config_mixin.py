"""lock-in for the shared ScanConfigFields mixin.

the 10 scan_* fields and the _check_scan_interval validator live exactly once
on the mixin; all four config schemas inherit them. these assertions pin the
mixin as the single definition site and that the interval check now fires on
the response shapes too (benign - responses are built from validated rows).
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.inspection_config import InspectionConfigOverride, ScanConfigFields
from app.schemas.inspection_config import InspectionConfigResponse as OverrideConfigResponse
from app.schemas.inspection_template import InspectionConfigCreate
from app.schemas.inspection_template import InspectionConfigResponse as TemplateConfigResponse

SCAN_FIELDS = {
    "scan_surface_id",
    "scan_length_mode",
    "scan_length_from",
    "scan_length_to",
    "scan_width",
    "scan_width_side",
    "scan_height",
    "scan_run_count",
    "scan_run_orientation",
    "scan_sidelap_percent",
}

# every config schema that should ride on the mixin
CONFIG_CLASSES = [
    InspectionConfigOverride,
    OverrideConfigResponse,
    InspectionConfigCreate,
    TemplateConfigResponse,
]


def _build(cls, **extra):
    """construct cls, supplying the required id only for the template response."""
    base = {"id": uuid4()} if cls is TemplateConfigResponse else {}
    return cls(**base, **extra)


def test_mixin_owns_the_ten_scan_fields():
    """the mixin declares exactly the 10 scan_* fields."""
    assert set(ScanConfigFields.model_fields) == SCAN_FIELDS


@pytest.mark.parametrize("cls", CONFIG_CLASSES)
def test_every_config_class_inherits_the_mixin(cls):
    """all four config classes inherit the 10 scan_* fields from the mixin."""
    assert issubclass(cls, ScanConfigFields)
    assert SCAN_FIELDS <= set(cls.model_fields)


@pytest.mark.parametrize("cls", CONFIG_CLASSES)
def test_interval_ordering_rejected_everywhere(cls):
    """INTERVAL with scan_length_from >= scan_length_to is rejected on every class."""
    with pytest.raises(ValidationError):
        _build(cls, scan_length_mode="INTERVAL", scan_length_from=500.0, scan_length_to=200.0)
    with pytest.raises(ValidationError):
        _build(cls, scan_length_mode="INTERVAL", scan_length_from=300.0, scan_length_to=300.0)


@pytest.mark.parametrize("cls", CONFIG_CLASSES)
@pytest.mark.parametrize("mode", ["FULL", "MAX_LENGTH"])
def test_interval_check_skipped_for_other_modes(cls, mode):
    """from >= to passes for FULL / MAX_LENGTH on every class."""
    _build(cls, scan_length_mode=mode, scan_length_from=500.0, scan_length_to=200.0)
