"""end-to-end coverage for the VERTICAL_PROFILE angle bookend rework.

covers PAPI vs CUSTOM resolution, schema-level rejection of inverted bands,
and the inspection-service guard that rejects PAPI mode when LHAs are missing
setting angles.
"""

from __future__ import annotations

import math

import pytest


@pytest.fixture(scope="module")
def vp_setup(client):
    """build a runway with one PAPI AGL (with setting angles) and a mission."""
    apt = client.post(
        "/api/v1/airports",
        json={
            "icao_code": "LZVP",
            "name": "VP Angle Test",
            "elevation": 200.0,
            "location": {"type": "Point", "coordinates": [21.5, 48.7, 200.0]},
        },
    ).json()

    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json={
            "identifier": "06/24",
            "surface_type": "RUNWAY",
            "geometry": {
                "type": "LineString",
                "coordinates": [[21.500, 48.70, 200], [21.530, 48.70, 200]],
            },
            "heading": 90.0,
            "length": 2200.0,
            "width": 45.0,
            "threshold_position": {
                "type": "Point",
                "coordinates": [21.500, 48.70, 200],
            },
            "end_position": {"type": "Point", "coordinates": [21.530, 48.70, 200]},
        },
    ).json()

    papi_agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={
            "agl_type": "PAPI",
            "name": "PAPI 06",
            "side": "LEFT",
            "position": {"type": "Point", "coordinates": [21.505, 48.6995, 200]},
        },
    ).json()

    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{papi_agl['id']}/lhas"
    setting_angles = [3.5, 3.333, 3.167, 3.0]
    lhas = []
    for i, angle in enumerate(setting_angles):
        r = client.post(
            base,
            json={
                "unit_designator": chr(ord("A") + i),
                "setting_angle": angle,
                "lamp_type": "HALOGEN",
                "position": {
                    "type": "Point",
                    "coordinates": [21.505 + 0.0001 * i, 48.6995, 200],
                },
            },
        )
        assert r.status_code == 201, r.text
        lhas.append(r.json())

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "VP Template",
            "methods": ["VERTICAL_PROFILE"],
            "target_agl_ids": [papi_agl["id"]],
        },
    ).json()

    mission = client.post(
        "/api/v1/missions",
        json={"name": "VP Angle Mission", "airport_id": apt["id"]},
    ).json()

    return {
        "airport_id": apt["id"],
        "papi_agl": papi_agl,
        "lhas": lhas,
        "template_id": template["id"],
        "mission_id": mission["id"],
    }


def test_custom_angle_band_round_trips(client, vp_setup):
    """CUSTOM mode persists angle_start, angle_end and angle_source."""
    setup = vp_setup
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "VERTICAL_PROFILE",
            "config": {
                "angle_source": "CUSTOM",
                "angle_start": 2.0,
                "angle_end": 12.0,
            },
        },
    )
    assert r.status_code == 201, r.text
    config = r.json()["config"]
    assert config["angle_source"] == "CUSTOM"
    assert math.isclose(config["angle_start"], 2.0)
    assert math.isclose(config["angle_end"], 12.0)


def test_papi_mode_round_trips(client, vp_setup):
    """PAPI mode persists angle_offset_above / angle_offset_below."""
    setup = vp_setup
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "VERTICAL_PROFILE",
            "config": {
                "angle_source": "PAPI",
                "angle_offset_above": 0.5,
                "angle_offset_below": 0.25,
            },
        },
    )
    assert r.status_code == 201, r.text
    config = r.json()["config"]
    assert config["angle_source"] == "PAPI"
    assert math.isclose(config["angle_offset_above"], 0.5)
    assert math.isclose(config["angle_offset_below"], 0.25)


def test_inverted_band_rejected_at_schema(client, vp_setup):
    """angle_start >= angle_end is rejected by the pydantic validator (422)."""
    setup = vp_setup
    r = client.post(
        f"/api/v1/missions/{setup['mission_id']}/inspections",
        json={
            "template_id": setup["template_id"],
            "method": "VERTICAL_PROFILE",
            "config": {
                "angle_source": "CUSTOM",
                "angle_start": 6.0,
                "angle_end": 3.0,
            },
        },
    )
    assert r.status_code == 422, r.text


def test_papi_mode_rejects_when_lha_missing_setting_angle(client, vp_setup):
    """PAPI mode against an LHA with no setting angle returns 422 naming the unit."""
    setup = vp_setup
    # null one existing PAPI light's setting_angle, then narrow PAPI mode to it
    target = setup["lhas"][0]
    base_lhas = (
        f"/api/v1/airports/{setup['airport_id']}/surfaces/"
        f"{setup['papi_agl']['surface_id']}/agls/{setup['papi_agl']['id']}/lhas"
    )
    r = client.put(
        f"{base_lhas}/{target['id']}",
        json={"setting_angle": None},
    )
    assert r.status_code == 200, r.text

    try:
        r = client.post(
            f"/api/v1/missions/{setup['mission_id']}/inspections",
            json={
                "template_id": setup["template_id"],
                "method": "VERTICAL_PROFILE",
                "config": {
                    "angle_source": "PAPI",
                    "lha_ids": [target["id"]],
                },
            },
        )
        assert r.status_code == 422, r.text
        assert target["unit_designator"] in r.text
    finally:
        # restore to keep module-scoped fixture clean for downstream tests
        client.put(
            f"{base_lhas}/{target['id']}",
            json={"setting_angle": target["setting_angle"]},
        )


def test_vertical_profile_no_papi_angle_band_warning_regression(client):
    """regression test #389: a healthy VERTICAL_PROFILE run no longer fires
    `papi_angle_band` warnings on every measurement waypoint.

    pre-fix the orchestrator filtered HR-style violations to just the bookends
    but the HR threshold (max(setting_angles) + tolerance) is mismatched against
    the VP climb that intentionally sweeps below the all-white edge. now the VP
    code path uses the per-bookend resolved angles instead.
    """
    from tests.data.trajectory import (
        DEFAULT_LANDING,
        DEFAULT_TAKEOFF,
        TRAJECTORY_AGL_PAYLOAD,
        TRAJECTORY_AIRPORT_PAYLOAD,
        TRAJECTORY_DRONE_PAYLOAD,
        TRAJECTORY_SURFACE_PAYLOAD,
        make_lha_payload,
    )

    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": "VPRG"},
    ).json()
    airport_id = airport["id"]

    surface = client.post(
        f"/api/v1/airports/{airport_id}/surfaces", json=TRAJECTORY_SURFACE_PAYLOAD
    ).json()
    surface_id = surface["id"]

    agl = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls",
        json=TRAJECTORY_AGL_PAYLOAD,
    ).json()
    agl_id = agl["id"]

    for i in range(1, 5):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
            json=make_lha_payload(i),
        )

    template = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": "VP Regression Template",
            "methods": ["VERTICAL_PROFILE"],
            "target_agl_ids": [agl_id],
            "default_config": {"measurement_density": 8},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "VP Regression",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 3.0,
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template["id"], "method": "VERTICAL_PROFILE"},
    )

    response = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert response.status_code == 200, response.text

    fp = response.json()["flight_plan"]
    warnings = fp.get("warnings") or []

    # the false positive landed in warnings as a "papi_angle_band" warning;
    # message text from validate_papi_angle_band carries "PAPI all-white-zone edge".
    band_warnings = [w for w in warnings if "all-white-zone edge" in w.get("message", "")]
    assert band_warnings == [], f"unexpected PAPI band warnings: {band_warnings}"


# matches the angle_end backfill UPDATE from migrations/versions/c5d6e7f8a9b0
VP_BACKFILL_SQL = """
UPDATE inspection_configuration
   SET angle_source = 'CUSTOM',
       angle_end = LEAST(
           16.5,
           GREATEST(
               1.0,
               DEGREES(
                   ATAN2(
                       vertical_profile_height,
                       COALESCE(horizontal_distance, 400)
                   )
               )
           )
       )
 WHERE vertical_profile_height IS NOT NULL
"""


def test_migration_c5d6e7f8a9b0_backfill_preserves_top_bookend_altitude(db_session):
    """regression: c5d6e7f8a9b0 backfill must keep the legacy top bookend.

    legacy rows had `vertical_profile_height` driving the climb apex. the
    migration converts that into `angle_end = atan2(height, distance or 400)`
    and drops the column. this test re-stages the legacy column on the test
    schema, inserts a row with height=15 / horizontal_distance=350, runs the
    migration's UPDATE + DROP, then resolves the resulting CUSTOM-mode config
    through `calculate_vertical_path` and asserts the top waypoint altitude
    matches `center.alt + 350*tan(atan2(15, 350))` within 0.1 m.
    """
    from uuid import uuid4

    from sqlalchemy import text

    from app.services.trajectory.methods.vertical_profile import (
        calculate_vertical_path,
    )
    from app.services.trajectory.types import Point3D, ResolvedConfig

    # base.metadata.create_all already gave us the post-migration schema, so we
    # add the legacy column back, populate it, run the upgrade UPDATE, then drop
    # the column - mirroring the migration's order of operations.
    db_session.execute(
        text(
            "ALTER TABLE inspection_configuration "
            "ADD COLUMN vertical_profile_height DOUBLE PRECISION"
        )
    )
    config_id = uuid4()
    db_session.execute(
        text(
            """
            INSERT INTO inspection_configuration (
                id, vertical_profile_height, horizontal_distance, lha_selection_rules
            ) VALUES (
                :id, 15, 350, '{}'::jsonb
            )
            """
        ),
        {"id": str(config_id)},
    )

    db_session.execute(text(VP_BACKFILL_SQL))
    db_session.execute(
        text("ALTER TABLE inspection_configuration DROP COLUMN vertical_profile_height")
    )

    row = (
        db_session.execute(
            text(
                """
                SELECT angle_source, angle_start, angle_end, horizontal_distance
                  FROM inspection_configuration
                 WHERE id = :id
                """
            ),
            {"id": str(config_id)},
        )
        .mappings()
        .one()
    )

    assert row["angle_source"] == "CUSTOM"
    expected_angle_end = math.degrees(math.atan2(15, 350))
    assert math.isclose(row["angle_end"], expected_angle_end, abs_tol=1e-6)
    # angle_start stays null - resolve_vertical_profile_angles falls back to the
    # legacy 1.9 deg default; only angle_end carries the geometric top bookend.
    assert row["angle_start"] is None

    # density=2 so waypoints[0] sits at the resolved start and waypoints[-1] at
    # the resolved end; the top altitude on a strictly increasing climb is the
    # last waypoint's altitude.
    config = ResolvedConfig(
        angle_source=row["angle_source"],
        angle_start=row["angle_start"],
        angle_end=row["angle_end"],
        horizontal_distance=row["horizontal_distance"],
        measurement_density=2,
    )
    center = Point3D(lon=21.5, lat=48.7, alt=200.0)
    waypoints = calculate_vertical_path(
        center=center,
        runway_heading=90.0,
        config=config,
        inspection_id=None,
        speed=3.0,
        setting_angles=[],
    )

    top = max(w.alt for w in waypoints)
    expected_top = center.alt + 350.0 * math.tan(math.atan2(15, 350))
    assert abs(top - expected_top) <= 0.1
