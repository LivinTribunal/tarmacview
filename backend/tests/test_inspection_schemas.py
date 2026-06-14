"""schema-level guards on inspection config payloads.

complements the orchestrator runtime drop: pydantic floors stop a 0-density
override from ever reaching phase 5 via the regular API path.
"""

import pytest
from pydantic import ValidationError

from app.schemas.inspection_template import InspectionConfigCreate
from app.schemas.mission import InspectionConfigOverride


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_measurement_density_rejects_zero(schema_cls):
    """measurement_density=0 must be rejected on both override and template-default schemas."""
    with pytest.raises(ValidationError):
        schema_cls(measurement_density=0)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_measurement_density_rejects_negative(schema_cls):
    """negative measurement_density is rejected by the same ge=1 floor."""
    with pytest.raises(ValidationError):
        schema_cls(measurement_density=-1)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_measurement_density_accepts_positive(schema_cls):
    """positive measurement_density values pass validation."""
    schema_cls(measurement_density=1)
    schema_cls(measurement_density=42)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_measurement_density_accepts_none(schema_cls):
    """None is still allowed and means inherit from template/server default."""
    schema_cls(measurement_density=None)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_interval_rejects_from_ge_to(schema_cls):
    """INTERVAL mode with scan_length_from >= scan_length_to is rejected (422)."""
    with pytest.raises(ValidationError):
        schema_cls(
            scan_length_mode="INTERVAL",
            scan_length_from=500.0,
            scan_length_to=200.0,
        )
    with pytest.raises(ValidationError):
        schema_cls(
            scan_length_mode="INTERVAL",
            scan_length_from=300.0,
            scan_length_to=300.0,
        )


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_interval_accepts_from_lt_to(schema_cls):
    """INTERVAL mode with from < to passes."""
    schema_cls(scan_length_mode="INTERVAL", scan_length_from=100.0, scan_length_to=600.0)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_interval_not_enforced_for_other_modes(schema_cls):
    """from >= to is only rejected in INTERVAL mode."""
    schema_cls(scan_length_mode="MAX_LENGTH", scan_length_from=500.0, scan_length_to=200.0)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_sidelap_range(schema_cls):
    """scan_sidelap_percent is bounded to [0, 80]."""
    schema_cls(scan_sidelap_percent=0)
    schema_cls(scan_sidelap_percent=80)
    with pytest.raises(ValidationError):
        schema_cls(scan_sidelap_percent=81)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_frontlap_range(schema_cls):
    """scan_frontlap_percent is bounded to [0, 80] (mirrors sidelap)."""
    schema_cls(scan_frontlap_percent=0)
    schema_cls(scan_frontlap_percent=80)
    with pytest.raises(ValidationError):
        schema_cls(scan_frontlap_percent=81)


@pytest.mark.parametrize("schema_cls", [InspectionConfigOverride, InspectionConfigCreate])
def test_scan_run_count_floor(schema_cls):
    """scan_run_count must be >= 1."""
    schema_cls(scan_run_count=1)
    with pytest.raises(ValidationError):
        schema_cls(scan_run_count=0)
