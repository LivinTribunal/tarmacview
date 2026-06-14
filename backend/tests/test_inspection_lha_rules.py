"""end-to-end coverage for the lha-selection rule write path.

mounts a runway surface with two AGLs, creates a mission, posts inspection
configs that carry per-AGL selection rules, and asserts the resolver wrote
both `lha_selection_rules` (verbatim) and `lha_ids` (resolved union) to the
inspection_configuration row.
"""

from __future__ import annotations

import pytest


@pytest.fixture(scope="module")
def runway_setup(client):
    """build a runway surface with two AGLs (5 lhas each) plus a mission."""
    apt = client.post(
        "/api/v1/airports",
        json={
            "icao_code": "LZTT",
            "name": "Selection Test",
            "elevation": 200.0,
            "location": {"type": "Point", "coordinates": [21.0, 48.65, 200.0]},
        },
    ).json()

    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json={
            "identifier": "06/24",
            "surface_type": "RUNWAY",
            "geometry": {
                "type": "LineString",
                "coordinates": [[21.000, 48.65, 200], [21.030, 48.65, 200]],
            },
            "heading": 90.0,
            "length": 2200.0,
            "width": 45.0,
            "threshold_position": {"type": "Point", "coordinates": [21.000, 48.65, 200]},
            "end_position": {"type": "Point", "coordinates": [21.030, 48.65, 200]},
        },
    ).json()

    agl_a = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={
            "agl_type": "RUNWAY_EDGE_LIGHTS",
            "name": "Edge Lights LEFT",
            "side": "LEFT",
            "position": {"type": "Point", "coordinates": [21.005, 48.65, 200]},
        },
    ).json()
    agl_b = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={
            "agl_type": "RUNWAY_EDGE_LIGHTS",
            "name": "Edge Lights RIGHT",
            "side": "RIGHT",
            "position": {"type": "Point", "coordinates": [21.005, 48.6505, 200]},
        },
    ).json()

    base_a = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl_a['id']}/lhas"
    base_b = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl_b['id']}/lhas"
    lhas_a = []
    lhas_b = []
    # 5 lhas per AGL spaced along the runway. with threshold at lon=21.0 and end
    # at lon=21.030 (~3km east), 0.001 degrees east is ~74m along-track.
    for i in range(5):
        lon = 21.000 + 0.001 * (i + 1)
        r = client.post(
            base_a,
            json={
                "unit_designator": str(i + 1),
                "setting_angle": 0.0,
                "lamp_type": "HALOGEN",
                "position": {"type": "Point", "coordinates": [lon, 48.6498, 200]},
            },
        )
        assert r.status_code == 201, r.text
        lhas_a.append(r.json())

        r = client.post(
            base_b,
            json={
                "unit_designator": str(i + 1),
                "setting_angle": 0.0,
                "lamp_type": "HALOGEN",
                "position": {"type": "Point", "coordinates": [lon, 48.6502, 200]},
            },
        )
        assert r.status_code == 201, r.text
        lhas_b.append(r.json())

    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "LHA Rule Template", "methods": ["HORIZONTAL_RANGE"]},
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={"name": "LHA Rule Mission", "airport_id": apt["id"]},
    ).json()

    return {
        "airport_id": apt["id"],
        "surface_id": surface["id"],
        "agl_a": agl_a,
        "agl_b": agl_b,
        "lhas_a": lhas_a,
        "lhas_b": lhas_b,
        "template_id": template["id"],
        "mission_id": mission["id"],
    }


def test_range_rule_resolves_to_flat_lha_ids(client, runway_setup):
    """RANGE 2..4 across one AGL writes both rule and resolved lha_ids."""
    setup = runway_setup
    expected_ids = {lha["id"] for lha in setup["lhas_a"] if 2 <= lha["sequence_number"] <= 4}

    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {
                        "mode": "RANGE",
                        "params": {"from": 2, "to": 4},
                    }
                }
            },
        },
    )
    assert r.status_code == 201, r.text
    config = r.json()["config"]
    rules = config["lha_selection_rules"]
    assert rules[setup["agl_a"]["id"]]["mode"] == "RANGE"
    assert rules[setup["agl_a"]["id"]]["params"]["from"] == 2
    assert rules[setup["agl_a"]["id"]]["params"]["to"] == 4
    assert set(config["lha_ids"]) == expected_ids


def test_all_rule_picks_every_lha_on_agl(client, runway_setup):
    setup = runway_setup
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_selection_rules": {setup["agl_b"]["id"]: {"mode": "ALL"}}},
        },
    )
    assert r.status_code == 201, r.text
    config = r.json()["config"]
    expected = {lha["id"] for lha in setup["lhas_b"]}
    assert set(config["lha_ids"]) == expected


def test_custom_rule_round_trip_keeps_lha_ids_byte_identical(client, runway_setup):
    """CUSTOM mode must produce the same flat list the caller sent (no trajectory regression)."""
    setup = runway_setup
    picked = [setup["lhas_a"][0]["id"], setup["lhas_a"][2]["id"]]
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_ids": picked,
                "lha_selection_rules": {setup["agl_a"]["id"]: {"mode": "CUSTOM"}},
            },
        },
    )
    assert r.status_code == 201, r.text
    config = r.json()["config"]
    assert set(config["lha_ids"]) == set(picked)
    assert config["lha_selection_rules"][setup["agl_a"]["id"]]["mode"] == "CUSTOM"


def test_range_rejects_from_greater_than_to_at_api_boundary(client, runway_setup):
    setup = runway_setup
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {
                        "mode": "RANGE",
                        "params": {"from": 5, "to": 2},
                    }
                }
            },
        },
    )
    assert r.status_code == 422


def test_update_inspection_overwrites_resolved_lha_ids(client, runway_setup):
    setup = runway_setup
    create = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {"lha_selection_rules": {setup["agl_a"]["id"]: {"mode": "ALL"}}},
        },
    )
    assert create.status_code == 201
    insp_id = create.json()["id"]

    r = client.put(
        f"/api/v1/missions/{setup['mission_id']}/inspections/{insp_id}",
        json={
            "config": {
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {
                        "mode": "RANGE",
                        "params": {"from": 1, "to": 2},
                    }
                }
            }
        },
    )
    assert r.status_code == 200, r.text
    config = r.json()["config"]
    expected = {lha["id"] for lha in setup["lhas_a"][:2]}
    assert set(config["lha_ids"]) == expected


def test_partial_rules_preserve_lha_ids_on_untouched_agls(client, runway_setup):
    """rule for AGL-A must not drop pre-existing lha_ids that belong to AGL-B.

    repro for the multi-AGL regression: an inspection spans two AGLs, the
    operator edits only AGL-A's rule, the frontend POSTs the merged
    `lha_ids` for both AGLs plus a rules dict for AGL-A only - the resolver
    used to skip AGL-B entirely and silently drop its selections.
    """
    setup = runway_setup
    insp_b_ids = [setup["lhas_b"][3]["id"], setup["lhas_b"][4]["id"]]

    # seed: full multi-AGL selection persisted via two ALL rules.
    create = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "HORIZONTAL_RANGE",
            "config": {
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {"mode": "ALL"},
                    setup["agl_b"]["id"]: {"mode": "ALL"},
                }
            },
        },
    )
    assert create.status_code == 201, create.text
    insp_id = create.json()["id"]

    # operator switches AGL-A to RANGE 1..2, leaves AGL-B untouched.
    # frontend posts the merged lha_ids (kept AGL-A 1..2 and original AGL-B 4..5)
    # plus a rules dict that only mentions AGL-A.
    merged_ids = [
        setup["lhas_a"][0]["id"],
        setup["lhas_a"][1]["id"],
        *insp_b_ids,
    ]
    r = client.put(
        f"/api/v1/missions/{setup['mission_id']}/inspections/{insp_id}",
        json={
            "config": {
                "lha_ids": merged_ids,
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {
                        "mode": "RANGE",
                        "params": {"from": 1, "to": 2},
                    }
                },
            }
        },
    )
    assert r.status_code == 200, r.text
    config = r.json()["config"]
    expected = {
        setup["lhas_a"][0]["id"],
        setup["lhas_a"][1]["id"],
        setup["lhas_b"][3]["id"],
        setup["lhas_b"][4]["id"],
    }
    assert set(config["lha_ids"]) == expected
    # rules stored verbatim - only the touched AGL is in the rules dict.
    assert setup["agl_a"]["id"] in config["lha_selection_rules"]
    assert setup["agl_b"]["id"] not in config["lha_selection_rules"]


def test_template_create_carries_rules_through_persistence(client, runway_setup):
    setup = runway_setup
    r = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "LHA Rules Embedded Template",
            "methods": ["HORIZONTAL_RANGE"],
            "default_config": {
                "lha_selection_rules": {
                    setup["agl_a"]["id"]: {
                        "mode": "RANGE",
                        "params": {"from": 1, "to": 3},
                    }
                }
            },
        },
    )
    assert r.status_code in (200, 201), r.text
    cfg = r.json()["default_config"]
    assert cfg is not None
    assert cfg["lha_selection_rules"][setup["agl_a"]["id"]]["params"]["from"] == 1
    expected = {lha["id"] for lha in setup["lhas_a"][:3]}
    assert set(cfg["lha_ids"]) == expected
