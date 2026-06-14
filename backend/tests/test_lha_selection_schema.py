"""validators on LhaSelectionRule and InspectionConfigOverride.lha_selection_rules."""

from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.inspection_template import InspectionConfigCreate
from app.schemas.mission import InspectionConfigOverride, LhaSelectionRule

_rule_adapter = TypeAdapter(LhaSelectionRule)


def test_rule_all_parses():
    assert _rule_adapter.validate_python({"mode": "ALL"}).mode == "ALL"


def test_rule_custom_parses():
    assert _rule_adapter.validate_python({"mode": "CUSTOM"}).mode == "CUSTOM"


def test_range_alias_from_accepted():
    rule = _rule_adapter.validate_python({"mode": "RANGE", "params": {"from": 2, "to": 4}})
    assert rule.params.from_ == 2
    assert rule.params.to == 4


def test_range_field_name_from_underscore_accepted():
    rule = _rule_adapter.validate_python({"mode": "RANGE", "params": {"from_": 1, "to": 3}})
    assert rule.params.from_ == 1


def test_range_dump_uses_from_alias():
    rule = _rule_adapter.validate_python({"mode": "RANGE", "params": {"from": 1, "to": 3}})
    dumped = _rule_adapter.dump_python(rule, by_alias=True)
    assert dumped["params"]["from"] == 1
    assert "from_" not in dumped["params"]


def test_range_from_greater_than_to_rejected():
    with pytest.raises(ValidationError):
        _rule_adapter.validate_python({"mode": "RANGE", "params": {"from": 5, "to": 2}})


def test_range_negative_from_rejected():
    with pytest.raises(ValidationError):
        _rule_adapter.validate_python({"mode": "RANGE", "params": {"from": -1, "to": 2}})


def test_from_threshold_negative_distance_rejected():
    with pytest.raises(ValidationError):
        _rule_adapter.validate_python(
            {"mode": "FROM_THRESHOLD", "params": {"threshold": "START", "distance_m": -1}}
        )


def test_from_threshold_unknown_anchor_rejected():
    with pytest.raises(ValidationError):
        _rule_adapter.validate_python(
            {"mode": "FROM_THRESHOLD", "params": {"threshold": "MIDDLE", "distance_m": 10}}
        )


def test_unknown_mode_rejected():
    with pytest.raises(ValidationError):
        _rule_adapter.validate_python({"mode": "WHATEVER"})


def test_inspection_config_override_carries_rules():
    agl_id = uuid4()
    payload = {
        "lha_selection_rules": {
            str(agl_id): {"mode": "RANGE", "params": {"from": 2, "to": 4}},
        }
    }
    override = InspectionConfigOverride.model_validate(payload)
    assert override.lha_selection_rules is not None
    rule = override.lha_selection_rules[agl_id]
    assert rule.mode == "RANGE"
    assert rule.params.from_ == 2


def test_inspection_template_config_create_carries_rules():
    agl_id = uuid4()
    payload = {
        "lha_selection_rules": {
            str(agl_id): {"mode": "ALL"},
        }
    }
    cfg = InspectionConfigCreate.model_validate(payload)
    assert cfg.lha_selection_rules is not None
    assert cfg.lha_selection_rules[agl_id].mode == "ALL"
