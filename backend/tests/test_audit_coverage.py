"""audit log coverage tests for state-changing routes.

verifies that every state-changing endpoint under missions.py, airports.py,
and flight_plans.py emits exactly one AuditLog row per successful request,
with the expected action, entity_type, and details payload.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audit_log import AuditLog
from tests.data.airports import (
    AGL_PAYLOAD,
    AIRPORT_PAYLOAD,
    LHA_PAYLOAD,
    OBSTACLE_PAYLOAD,
    SAFETY_ZONE_PAYLOAD,
    SURFACE_PAYLOAD,
)
from tests.data.drones import DRONE_PAYLOAD


@pytest.fixture
def session(db_engine):
    """fresh sqlalchemy session per test, with rollback on teardown."""
    s = sessionmaker(bind=db_engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _audit_rows(session, *, action: str, entity_type: str, entity_id: UUID) -> list[AuditLog]:
    """fetch audit rows matching action + entity_type + entity_id."""
    return (
        session.query(AuditLog)
        .filter(
            AuditLog.action == action,
            AuditLog.entity_type == entity_type,
            AuditLog.entity_id == entity_id,
        )
        .all()
    )


# missions.py


@pytest.fixture(scope="module")
def audit_airport_id(client):
    """shared airport for mission-related audit tests."""
    payload = {**AIRPORT_PAYLOAD, "icao_code": "LAAA"}
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


def test_update_mission_logs_audit(client, audit_airport_id, session):
    """PUT /missions/{id} emits one UPDATE row on Mission with airport_id set."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Update Mission", "airport_id": audit_airport_id},
    ).json()

    r = client.put(f"/api/v1/missions/{mission['id']}", json={"name": "Renamed"})
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Mission", entity_id=mission["id"])
    assert len(rows) == 1
    assert rows[0].entity_name == "Renamed"
    assert str(rows[0].airport_id) == audit_airport_id


def test_duplicate_mission_logs_audit(client, audit_airport_id, session):
    """POST /missions/{id}/duplicate emits CREATE on Mission with duplicated_from detail."""
    original = client.post(
        "/api/v1/missions",
        json={"name": "Audit Dup Source", "airport_id": audit_airport_id},
    ).json()

    r = client.post(f"/api/v1/missions/{original['id']}/duplicate")
    assert r.status_code == 201
    copy_id = r.json()["id"]

    rows = _audit_rows(session, action="CREATE", entity_type="Mission", entity_id=copy_id)
    assert len(rows) == 1
    assert rows[0].details == {"duplicated_from": str(original["id"])}


def test_validate_mission_uses_validate_action(client, audit_airport_id, session):
    """POST /missions/{id}/validate emits VALIDATE on Mission, not STATUS_CHANGE."""
    from app.core.enums import MissionStatus
    from app.models.mission import Mission

    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Validate Mission", "airport_id": audit_airport_id},
    ).json()

    db_mission = session.query(Mission).filter(Mission.id == mission["id"]).first()
    db_mission.status = MissionStatus.PLANNED
    session.commit()

    r = client.post(f"/api/v1/missions/{mission['id']}/validate")
    assert r.status_code == 200

    rows = _audit_rows(session, action="VALIDATE", entity_type="Mission", entity_id=mission["id"])
    assert len(rows) == 1
    assert rows[0].details == {"to": "VALIDATED"}

    legacy = _audit_rows(
        session, action="STATUS_CHANGE", entity_type="Mission", entity_id=mission["id"]
    )
    assert legacy == []


def test_add_inspection_logs_audit(client, audit_airport_id, session):
    """POST /missions/{id}/inspections emits CREATE on Inspection."""
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Audit Tmpl", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Add Insp", "airport_id": audit_airport_id},
    ).json()

    r = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    )
    assert r.status_code == 201
    insp_id = r.json()["id"]

    rows = _audit_rows(session, action="CREATE", entity_type="Inspection", entity_id=insp_id)
    assert len(rows) == 1
    assert rows[0].details["mission_id"] == str(mission["id"])
    assert rows[0].details["method"] == "HORIZONTAL_RANGE"


def test_reorder_inspections_logs_audit_on_mission(client, audit_airport_id, session):
    """PUT /missions/{id}/inspections/reorder emits UPDATE on Mission with reordered ids."""
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Audit Reorder Tmpl", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Reorder Mission", "airport_id": audit_airport_id},
    ).json()

    insp_a = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()
    insp_b = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()

    r = client.put(
        f"/api/v1/missions/{mission['id']}/inspections/reorder",
        json={"inspection_ids": [insp_b["id"], insp_a["id"]]},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Mission", entity_id=mission["id"])
    reorder_rows = [row for row in rows if row.details and "reordered" in row.details]
    assert len(reorder_rows) == 1
    assert reorder_rows[0].details["reordered"] == [insp_b["id"], insp_a["id"]]


def test_update_inspection_logs_audit(client, audit_airport_id, session):
    """PUT /missions/{id}/inspections/{insp_id} emits UPDATE on Inspection."""
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Audit Update Insp Tmpl", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Update Insp Mission", "airport_id": audit_airport_id},
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()

    r = client.put(
        f"/api/v1/missions/{mission['id']}/inspections/{insp['id']}",
        json={"method": "HORIZONTAL_RANGE"},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Inspection", entity_id=insp["id"])
    assert len(rows) == 1
    assert rows[0].details["mission_id"] == str(mission["id"])


def test_delete_inspection_logs_audit(client, audit_airport_id, session):
    """DELETE /missions/{id}/inspections/{insp_id} emits DELETE on Inspection."""
    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "Audit Del Insp Tmpl", "methods": ["HORIZONTAL_RANGE"]},
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Del Insp Mission", "airport_id": audit_airport_id},
    ).json()
    insp = client.post(
        f"/api/v1/missions/{mission['id']}/inspections",
        json={"template_id": template["id"], "method": "HORIZONTAL_RANGE"},
    ).json()

    r = client.delete(f"/api/v1/missions/{mission['id']}/inspections/{insp['id']}")
    assert r.status_code == 200

    rows = _audit_rows(session, action="DELETE", entity_type="Inspection", entity_id=insp["id"])
    assert len(rows) == 1
    assert rows[0].details["mission_id"] == str(mission["id"])


def test_failed_update_does_not_leak_audit_row(client, audit_airport_id, session):
    """update with invalid payload (rolled back) must not insert an audit row."""
    mission = client.post(
        "/api/v1/missions",
        json={"name": "Audit Rollback Mission", "airport_id": audit_airport_id},
    ).json()

    # transit_agl below MIN_AGL triggers a 422 before commit
    r = client.put(f"/api/v1/missions/{mission['id']}", json={"transit_agl": 3.0})
    assert r.status_code == 422

    rows = _audit_rows(session, action="UPDATE", entity_type="Mission", entity_id=mission["id"])
    assert rows == []


# airports.py


def test_set_default_drone_logs_audit(client, session):
    """PUT /airports/{id}/default-drone emits UPDATE on Airport."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LAAB"},
    ).json()
    drone = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "Audit Default Drone"}
    ).json()

    r = client.put(
        f"/api/v1/airports/{apt['id']}/default-drone",
        json={"drone_profile_id": drone["id"]},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Airport", entity_id=apt["id"])
    drone_rows = [
        row
        for row in rows
        if row.details and row.details.get("default_drone_profile_id") == str(drone["id"])
    ]
    assert len(drone_rows) == 1


def test_bulk_change_drone_emits_single_row_with_mission_ids(client, session):
    """POST /airports/{id}/bulk-change-drone emits exactly one Airport row with mission_ids list."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LAAC"},
    ).json()
    drone1 = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "Audit Bulk From"}
    ).json()
    drone2 = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "Audit Bulk To"}
    ).json()

    m1 = client.post(
        "/api/v1/missions",
        json={"name": "Bulk M1", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    m2 = client.post(
        "/api/v1/missions",
        json={"name": "Bulk M2", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()

    r = client.post(
        f"/api/v1/airports/{apt['id']}/bulk-change-drone",
        json={"drone_profile_id": drone2["id"]},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Airport", entity_id=apt["id"])
    bulk_rows = [
        row
        for row in rows
        if row.details
        and row.details.get("drone_id") == str(drone2["id"])
        and "mission_count" in row.details
    ]
    assert len(bulk_rows) == 1
    assert bulk_rows[0].entity_name == apt["name"]
    assert str(bulk_rows[0].airport_id) == apt["id"]
    details = bulk_rows[0].details
    assert details["mission_count"] == 2
    assert set(details["mission_ids"]) == {m1["id"], m2["id"]}


def test_create_surface_logs_audit(client, session):
    """POST /airports/{id}/surfaces emits CREATE on Surface."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAD"}).json()

    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD)
    assert r.status_code == 201
    surface_id = r.json()["id"]

    rows = _audit_rows(session, action="CREATE", entity_type="Surface", entity_id=surface_id)
    assert len(rows) == 1
    assert rows[0].details["airport_id"] == apt["id"]
    assert str(rows[0].airport_id) == apt["id"]


def test_update_surface_logs_audit(client, session):
    """PUT surface emits UPDATE on Surface."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAE"}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()

    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}",
        json={"length": 4000.0},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="UPDATE", entity_type="Surface", entity_id=surface["id"])
    assert len(rows) == 1


def test_delete_surface_logs_audit(client, session):
    """DELETE surface emits DELETE on Surface."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAG"}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()

    r = client.delete(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}")
    assert r.status_code == 200

    rows = _audit_rows(session, action="DELETE", entity_type="Surface", entity_id=surface["id"])
    assert len(rows) == 1


def test_obstacle_crud_logs_audit(client, session):
    """obstacle POST/PUT/DELETE each emit one row on Obstacle."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAH"}).json()

    create = client.post(f"/api/v1/airports/{apt['id']}/obstacles", json=OBSTACLE_PAYLOAD)
    assert create.status_code == 201
    obs_id = create.json()["id"]

    update = client.put(
        f"/api/v1/airports/{apt['id']}/obstacles/{obs_id}",
        json={"name": "Renamed Tower"},
    )
    assert update.status_code == 200

    delete = client.delete(f"/api/v1/airports/{apt['id']}/obstacles/{obs_id}")
    assert delete.status_code == 200

    assert len(_audit_rows(session, action="CREATE", entity_type="Obstacle", entity_id=obs_id)) == 1
    assert len(_audit_rows(session, action="UPDATE", entity_type="Obstacle", entity_id=obs_id)) == 1
    del_rows = _audit_rows(session, action="DELETE", entity_type="Obstacle", entity_id=obs_id)
    assert len(del_rows) == 1
    assert del_rows[0].entity_name == "Renamed Tower"


def test_safety_zone_crud_logs_audit(client, session):
    """safety zone POST/PUT/DELETE each emit one row on SafetyZone."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAI"}).json()

    create = client.post(f"/api/v1/airports/{apt['id']}/safety-zones", json=SAFETY_ZONE_PAYLOAD)
    assert create.status_code == 201
    zone_id = create.json()["id"]

    update = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone_id}",
        json={"altitude_floor": 500.0},
    )
    assert update.status_code == 200

    delete = client.delete(f"/api/v1/airports/{apt['id']}/safety-zones/{zone_id}")
    assert delete.status_code == 200

    assert (
        len(_audit_rows(session, action="CREATE", entity_type="SafetyZone", entity_id=zone_id)) == 1
    )
    assert (
        len(_audit_rows(session, action="UPDATE", entity_type="SafetyZone", entity_id=zone_id)) == 1
    )
    del_rows = _audit_rows(session, action="DELETE", entity_type="SafetyZone", entity_id=zone_id)
    assert len(del_rows) == 1
    assert del_rows[0].entity_name == "Prague CTR"


def test_agl_crud_logs_audit(client, session):
    """AGL POST/PUT/DELETE each emit one row on AGL."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAJ"}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()

    create = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    )
    assert create.status_code == 201
    agl_id = create.json()["id"]

    update = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl_id}",
        json={"name": "PAPI 24R"},
    )
    assert update.status_code == 200

    delete = client.delete(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl_id}")
    assert delete.status_code == 200

    assert len(_audit_rows(session, action="CREATE", entity_type="AGL", entity_id=agl_id)) == 1
    assert len(_audit_rows(session, action="UPDATE", entity_type="AGL", entity_id=agl_id)) == 1
    del_rows = _audit_rows(session, action="DELETE", entity_type="AGL", entity_id=agl_id)
    assert len(del_rows) == 1
    assert del_rows[0].entity_name == "PAPI 24R"


def test_lha_crud_logs_audit(client, session):
    """LHA POST/PUT/DELETE each emit one row on LHA."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAK"}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()

    create = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
        json=LHA_PAYLOAD,
    )
    assert create.status_code == 201
    lha_id = create.json()["id"]

    update = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha_id}",
        json={"setting_angle": 3.5},
    )
    assert update.status_code == 200

    delete = client.delete(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha_id}"
    )
    assert delete.status_code == 200

    assert len(_audit_rows(session, action="CREATE", entity_type="LHA", entity_id=lha_id)) == 1
    assert len(_audit_rows(session, action="UPDATE", entity_type="LHA", entity_id=lha_id)) == 1
    del_rows = _audit_rows(session, action="DELETE", entity_type="LHA", entity_id=lha_id)
    assert len(del_rows) == 1
    assert del_rows[0].entity_name == "A"


def _bulk_templates_setup(client, icao: str):
    """create airport + surface + PAPI AGL so bulk-create has targets."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    )
    return apt["id"]


def test_bulk_create_templates_emits_aggregate_audit_row(client, session):
    """bulk-create emits exactly one CREATE InspectionTemplate row scoped to the airport."""
    apt_id = _bulk_templates_setup(client, "LACT")

    r = client.post("/api/v1/inspection-templates/bulk", json={"airport_id": apt_id})
    assert r.status_code == 201
    created = r.json()["created"]
    assert len(created) >= 1

    rows = _audit_rows(
        session, action="CREATE", entity_type="InspectionTemplate", entity_id=UUID(apt_id)
    )
    assert len(rows) == 1
    row = rows[0]
    # templates deliberately leave the denormalized airport_id column None
    assert row.airport_id is None
    assert row.details["airport_id"] == apt_id
    assert row.details["created_count"] == len(created)
    assert row.details["template_ids"] == [t["id"] for t in created]

    # bulk-create commits airport-agnostic templates (hover/surface-scan) that are
    # global (no airport scope); clean them up so count-sensitive service tests on
    # the shared session-scoped DB stay self-contained.
    for tpl in created:
        client.delete(f"/api/v1/inspection-templates/{tpl['id']}")


def test_bulk_create_templates_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during bulk-create, no template rows persist."""
    import app.api.routes.inspection_templates as templates_route

    apt_id = _bulk_templates_setup(client, "LACU")

    # airport-agnostic templates from earlier committed tests already show up under
    # any airport filter, so compare the id set before/after rather than expect empty.
    before = {
        t["id"]
        for t in client.get(f"/api/v1/inspection-templates?airport_id={apt_id}").json()["data"]
    }

    _force_log_audit_failure(monkeypatch, templates_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post("/api/v1/inspection-templates/bulk", json={"airport_id": apt_id})

    monkeypatch.undo()

    after = {
        t["id"]
        for t in client.get(f"/api/v1/inspection-templates?airport_id={apt_id}").json()["data"]
    }
    assert after == before


def _measured_mission(client, db_engine, airport_id: str, name: str) -> str:
    """create a mission and force it to MEASURED via direct sql; returns its id.

    MEASURED is the only state the complete/cancel transitions accept.
    """
    from sqlalchemy import text

    from app.core.enums import MissionStatus

    mission = client.post(
        "/api/v1/missions",
        json={"name": name, "airport_id": airport_id},
    ).json()
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE mission SET status = :s WHERE id = :id"),
            {"s": MissionStatus.MEASURED.value, "id": mission["id"]},
        )
        conn.commit()
    return mission["id"]


def test_complete_mission_audit_has_entity_name(client, audit_airport_id, db_engine, session):
    """POST /missions/{id}/complete emits a STATUS_CHANGE row carrying the mission name."""
    mission_id = _measured_mission(client, db_engine, audit_airport_id, "Audit Complete Mission")

    r = client.post(f"/api/v1/missions/{mission_id}/complete")
    assert r.status_code == 200

    rows = _audit_rows(session, action="STATUS_CHANGE", entity_type="Mission", entity_id=mission_id)
    complete_rows = [row for row in rows if row.details and row.details.get("to") == "COMPLETED"]
    assert len(complete_rows) == 1
    assert complete_rows[0].entity_name == "Audit Complete Mission"


def test_cancel_mission_audit_has_entity_name(client, audit_airport_id, db_engine, session):
    """POST /missions/{id}/cancel emits a STATUS_CHANGE row carrying the mission name."""
    mission_id = _measured_mission(client, db_engine, audit_airport_id, "Audit Cancel Mission")

    r = client.post(f"/api/v1/missions/{mission_id}/cancel")
    assert r.status_code == 200

    rows = _audit_rows(session, action="STATUS_CHANGE", entity_type="Mission", entity_id=mission_id)
    cancel_rows = [row for row in rows if row.details and row.details.get("to") == "CANCELLED"]
    assert len(cancel_rows) == 1
    assert cancel_rows[0].entity_name == "Audit Cancel Mission"


def _fake_rasterio(epsg: int, bounds: tuple):
    """build a stand-in rasterio module whose dataset reports epsg + bounds."""
    import types

    module = types.ModuleType("rasterio")

    class _FakeDataset:
        crs = types.SimpleNamespace(to_epsg=lambda: epsg)

        def __init__(self):
            self.bounds = bounds
            self.transform = types.SimpleNamespace(a=0.001, e=-0.001)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    module.open = lambda _path: _FakeDataset()
    return module


def test_upload_terrain_dem_rejects_non_wgs84(client, monkeypatch):
    """a DEM whose CRS is not EPSG:4326 is rejected with 400."""
    import sys

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LADV"}).json()

    monkeypatch.setitem(sys.modules, "rasterio", _fake_rasterio(3857, (14.0, 50.0, 14.5, 50.2)))

    r = client.post(
        f"/api/v1/airports/{apt['id']}/terrain-dem",
        files={"file": ("dem.tif", b"fake-tiff-bytes", "image/tiff")},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "DEM must be in WGS84 (EPSG:4326)"


def test_upload_terrain_dem_rejects_dem_not_covering_airport(client, monkeypatch):
    """a DEM whose bounds do not contain the airport is rejected with 400."""
    import sys

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LADW"}).json()

    monkeypatch.setitem(sys.modules, "rasterio", _fake_rasterio(4326, (0.0, 0.0, 1.0, 1.0)))

    r = client.post(
        f"/api/v1/airports/{apt['id']}/terrain-dem",
        files={"file": ("dem.tif", b"fake-tiff-bytes", "image/tiff")},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "DEM does not cover airport location"


def test_delete_terrain_dem_logs_audit(client, session):
    """DELETE /airports/{id}/terrain-dem emits DELETE on TerrainDEM."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAL"}).json()

    r = client.delete(f"/api/v1/airports/{apt['id']}/terrain-dem")
    assert r.status_code == 200

    rows = _audit_rows(session, action="DELETE", entity_type="TerrainDEM", entity_id=apt["id"])
    assert len(rows) == 1


def test_upload_terrain_dem_logs_audit(client, session, monkeypatch):
    """POST /airports/{id}/terrain-dem (upload) emits one CREATE row on TerrainDEM."""
    import sys
    import types

    from app.api.routes.airports import terrain as airports_route

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAM"}).json()

    # fake rasterio module - bounds covers the airport, CRS is WGS84
    fake_rasterio = types.ModuleType("rasterio")

    class _FakeDataset:
        crs = types.SimpleNamespace(to_epsg=lambda: 4326)
        bounds = (14.0, 50.0, 14.5, 50.2)
        transform = types.SimpleNamespace(a=0.001, e=-0.001)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    fake_rasterio.open = lambda _path: _FakeDataset()
    monkeypatch.setitem(sys.modules, "rasterio", fake_rasterio)

    # avoid actually moving the temp file to TERRAIN_DIR
    monkeypatch.setattr(airports_route.shutil, "move", lambda *a, **k: None)

    # stub the service so we don't need a real file or db schema work
    apt_id = UUID(apt["id"])
    apt_name = apt["name"]
    fake_airport = types.SimpleNamespace(id=apt_id, name=apt_name)
    monkeypatch.setattr(
        airports_route.airport_service,
        "upload_terrain_dem",
        lambda db, airport_id, file_path, terrain_source="DEM_UPLOAD", **kwargs: (
            fake_airport,
            None,
        ),
    )

    r = client.post(
        f"/api/v1/airports/{apt['id']}/terrain-dem",
        files={"file": ("dem.tif", b"fake-tiff-bytes", "image/tiff")},
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="CREATE", entity_type="TerrainDEM", entity_id=apt["id"])
    assert len(rows) == 1
    assert rows[0].details == {"terrain_source": "DEM_UPLOAD", "rewrite_existing": True}


def test_download_terrain_dem_logs_audit(client, session, monkeypatch):
    """POST /airports/{id}/terrain-download emits one CREATE row on TerrainDEM with API details."""
    import types

    from app.api.routes import airports as airports_route

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LAAN"}).json()

    fake_result = {
        "terrain_source": "DEM_API",
        "points_downloaded": 42,
        "bounds": [14.0, 50.0, 14.5, 50.2],
        "resolution": [0.001, 0.001],
        "file_path": "/tmp/fake-dem.tif",
    }
    monkeypatch.setattr(
        airports_route.airport_service,
        "download_terrain_for_location",
        lambda **kwargs: fake_result,
    )

    apt_id = UUID(apt["id"])
    fake_airport = types.SimpleNamespace(id=apt_id, name=apt["name"])
    monkeypatch.setattr(
        airports_route.airport_service,
        "upload_terrain_dem",
        lambda db, airport_id, file_path, terrain_source="DEM_API", **kwargs: (
            fake_airport,
            None,
        ),
    )

    r = client.post(f"/api/v1/airports/{apt['id']}/terrain-download")
    assert r.status_code == 200

    rows = _audit_rows(session, action="CREATE", entity_type="TerrainDEM", entity_id=apt["id"])
    api_rows = [
        row for row in rows if row.details and row.details.get("terrain_source") == "DEM_API"
    ]
    assert len(api_rows) == 1
    assert api_rows[0].details == {
        "terrain_source": "DEM_API",
        "points_downloaded": 42,
        "rewrite_existing": True,
    }


# flight_plans.py


@pytest.fixture(scope="module")
def fp_audit_airport_id(client):
    """shared airport for flight-plan audit tests."""
    payload = {**AIRPORT_PAYLOAD, "icao_code": "LAFP"}
    r = client.post("/api/v1/airports", json=payload)
    return r.json()["id"]


@pytest.fixture
def fp_audit_setup(client, db_engine, fp_audit_airport_id):
    """create mission + flight plan + waypoints to exercise flight-plan audit routes.

    each invocation builds a fresh mission + flight plan + waypoints under the shared
    airport so the three tests can each insert their own waypoint chain without
    conflicting on uuids.
    """
    from sqlalchemy import text

    apt_id = fp_audit_airport_id

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "FP Audit Mission",
            "airport_id": apt_id,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.10, 380.0]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.27, 50.10, 380.0]},
        },
    ).json()
    mission_id = mission["id"]

    fp_id = uuid4()
    val_id = uuid4()
    wp_ids = [uuid4() for _ in range(4)]

    with db_engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO flight_plan (id, mission_id, airport_id, total_distance, "
                "estimated_duration, is_validated) "
                "VALUES (:id, :mid, :aid, 100.0, 60.0, true)"
            ),
            {"id": str(fp_id), "mid": mission_id, "aid": apt_id},
        )
        conn.execute(
            text(
                "INSERT INTO validation_result (id, flight_plan_id, passed) "
                "VALUES (:id, :fp_id, true)"
            ),
            {"id": str(val_id), "fp_id": str(fp_id)},
        )
        types = ["TAKEOFF", "TRANSIT", "MEASUREMENT", "LANDING"]
        for i, (wp_id, wt) in enumerate(zip(wp_ids, types), start=1):
            conn.execute(
                text(
                    "INSERT INTO waypoint (id, flight_plan_id, sequence_order, position, "
                    "waypoint_type) VALUES (:id, :fp_id, :seq, :wkt, :wt)"
                ),
                {
                    "id": str(wp_id),
                    "fp_id": str(fp_id),
                    "seq": i,
                    "wkt": f"POINT Z (14.{260 + i} 50.10 380.{i})",
                    "wt": wt,
                },
            )
        conn.commit()

    return {
        "mission_id": mission_id,
        "flight_plan_id": fp_id,
        "waypoint_ids": wp_ids,
    }


def test_batch_update_waypoints_logs_audit(client, fp_audit_setup, session):
    """PUT /flight-plan/waypoints emits UPDATE on FlightPlan with count detail."""
    transit_wp = fp_audit_setup["waypoint_ids"][1]
    r = client.put(
        f"/api/v1/missions/{fp_audit_setup['mission_id']}/flight-plan/waypoints",
        json={
            "updates": [
                {
                    "waypoint_id": str(transit_wp),
                    "position": {"type": "Point", "coordinates": [14.265, 50.105, 385.0]},
                }
            ]
        },
    )
    assert r.status_code == 200

    rows = _audit_rows(
        session,
        action="UPDATE",
        entity_type="FlightPlan",
        entity_id=fp_audit_setup["flight_plan_id"],
    )
    assert len(rows) == 1
    assert rows[0].details["count"] == 1
    assert rows[0].details["mission_id"] == fp_audit_setup["mission_id"]


def test_insert_transit_waypoint_logs_audit(client, fp_audit_setup, session):
    """POST /flight-plan/waypoints/transit emits CREATE on Waypoint."""
    r = client.post(
        f"/api/v1/missions/{fp_audit_setup['mission_id']}/flight-plan/waypoints/transit",
        json={
            "after_sequence": 1,
            "position": {"type": "Point", "coordinates": [14.262, 50.10, 382.0]},
        },
    )
    assert r.status_code == 200

    inserted = next(wp for wp in r.json()["waypoints"] if wp["sequence_order"] == 2)
    rows = _audit_rows(session, action="CREATE", entity_type="Waypoint", entity_id=inserted["id"])
    assert len(rows) == 1
    assert rows[0].details["mission_id"] == fp_audit_setup["mission_id"]
    assert rows[0].details["after_sequence"] == 1


def test_delete_transit_waypoint_logs_audit(client, fp_audit_setup, session):
    """DELETE /flight-plan/waypoints/{id} emits DELETE on Waypoint."""
    transit_wp = fp_audit_setup["waypoint_ids"][1]

    r = client.delete(
        f"/api/v1/missions/{fp_audit_setup['mission_id']}/flight-plan/waypoints/{transit_wp}"
    )
    assert r.status_code == 200

    rows = _audit_rows(session, action="DELETE", entity_type="Waypoint", entity_id=transit_wp)
    assert len(rows) == 1
    assert rows[0].details["mission_id"] == fp_audit_setup["mission_id"]


def test_generate_trajectory_logs_audit(client, fp_audit_airport_id, session, monkeypatch):
    """POST /missions/{id}/generate-trajectory emits one GENERATE_TRAJECTORY row on FlightPlan."""
    from sqlalchemy import text

    from app.api.routes import flight_plans as flight_plans_route

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "FP Audit Generate",
            "airport_id": fp_audit_airport_id,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.10, 380.0]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.27, 50.10, 380.0]},
        },
    ).json()
    mission_id = mission["id"]

    fp_id = uuid4()

    def _stub_generate_trajectory(db, mid):
        """insert a minimal flight plan + waypoints so the route can return a response."""
        db.execute(
            text(
                "INSERT INTO flight_plan (id, mission_id, airport_id, total_distance, "
                "estimated_duration, is_validated) "
                "VALUES (:id, :mid, :aid, 100.0, 60.0, true)"
            ),
            {"id": str(fp_id), "mid": str(mid), "aid": fp_audit_airport_id},
        )
        types_ = ["TAKEOFF", "TRANSIT", "LANDING"]
        for i, wt in enumerate(types_, start=1):
            db.execute(
                text(
                    "INSERT INTO waypoint (id, flight_plan_id, sequence_order, position, "
                    "waypoint_type) VALUES (:id, :fp_id, :seq, :wkt, :wt)"
                ),
                {
                    "id": str(uuid4()),
                    "fp_id": str(fp_id),
                    "seq": i,
                    "wkt": f"POINT Z (14.{260 + i} 50.10 380.{i})",
                    "wt": wt,
                },
            )
        db.flush()

        from app.models.flight_plan import FlightPlan

        return db.query(FlightPlan).filter(FlightPlan.id == fp_id).first(), []

    monkeypatch.setattr(flight_plans_route, "generate_trajectory", _stub_generate_trajectory)

    r = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert r.status_code == 200

    rows = _audit_rows(
        session, action="GENERATE_TRAJECTORY", entity_type="FlightPlan", entity_id=fp_id
    )
    assert len(rows) == 1
    assert rows[0].details == {"mission_id": mission_id}


# same-transaction guarantee
#
# the routes flush state changes in services and commit alongside the audit
# row at the route boundary. if the audit insert fails, the state change must
# roll back too. these tests force log_audit to raise and then check that the
# attempted mutation did not persist.


def _force_log_audit_failure(monkeypatch, route_module):
    """patch log_audit on the given route module so it raises on call."""

    def _boom(*args, **kwargs):
        raise RuntimeError("audit-insert-failure")

    monkeypatch.setattr(route_module, "log_audit", _boom)


def test_update_mission_rolls_back_when_audit_fails(client, audit_airport_id, session, monkeypatch):
    """if log_audit raises, the mission rename must not persist."""
    from app.api.routes.missions import core as missions_route

    mission = client.post(
        "/api/v1/missions",
        json={"name": "TX Original", "airport_id": audit_airport_id},
    ).json()

    _force_log_audit_failure(monkeypatch, missions_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.put(f"/api/v1/missions/{mission['id']}", json={"name": "TX Renamed"})

    monkeypatch.undo()

    after = client.get(f"/api/v1/missions/{mission['id']}").json()
    assert after["name"] == "TX Original"

    rows = _audit_rows(session, action="UPDATE", entity_type="Mission", entity_id=mission["id"])
    assert rows == []


def test_create_surface_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises, the surface row must not persist."""
    from app.api.routes.airports import surfaces as airports_route

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LATX"}).json()

    _force_log_audit_failure(monkeypatch, airports_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD)

    monkeypatch.undo()

    listing = client.get(f"/api/v1/airports/{apt['id']}/surfaces").json()
    assert listing["data"] == []


def test_bulk_change_drone_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises, the bulk drone-profile change must not persist."""
    from app.api.routes.airports import core as airports_route

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LATY"}).json()
    drone_from = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "TX Bulk From"}
    ).json()
    drone_to = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "TX Bulk To"}
    ).json()
    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "TX Bulk Mission",
            "airport_id": apt["id"],
            "drone_profile_id": drone_from["id"],
        },
    ).json()

    _force_log_audit_failure(monkeypatch, airports_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            f"/api/v1/airports/{apt['id']}/bulk-change-drone",
            json={"drone_profile_id": drone_to["id"]},
        )

    monkeypatch.undo()

    after = client.get(f"/api/v1/missions/{mission['id']}").json()
    assert after["drone_profile_id"] == drone_from["id"]

    rows = _audit_rows(session, action="UPDATE", entity_type="Airport", entity_id=apt["id"])
    bulk_rows = [row for row in rows if row.details and "mission_count" in row.details]
    assert bulk_rows == []


def _bulk_generate_setup(client, icao: str):
    """create airport + surface + edge-lights AGL for bulk-generate tests."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "agl_type": "RUNWAY_EDGE_LIGHTS", "name": "edge-lights"},
    ).json()
    return apt["id"], surface["id"], agl["id"]


def test_bulk_generate_lhas_emits_aggregate_audit_row(client, session):
    """bulk-generate emits exactly one CREATE LHA row scoped to the airport."""
    apt_id, surface_id, agl_id = _bulk_generate_setup(client, "LABG")

    body = {
        "first_position": {"type": "Point", "coordinates": [14.2700, 50.1000, 380.0]},
        "last_position": {"type": "Point", "coordinates": [14.2704, 50.1000, 380.0]},
        "spacing_m": 10.0,
    }
    r = client.post(
        f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/bulk",
        json=body,
    )
    assert r.status_code == 201
    generated = r.json()["generated"]
    count = len(generated)
    assert count >= 2

    rows = _audit_rows(session, action="CREATE", entity_type="LHA", entity_id=UUID(agl_id))
    assert len(rows) == 1
    row = rows[0]
    assert str(row.airport_id) == apt_id
    assert row.details["count"] == count
    assert row.details["airport_id"] == apt_id
    assert row.details["surface_id"] == surface_id
    assert row.details["agl_id"] == agl_id
    assert row.details["lha_ids"] == [lha["id"] for lha in generated]


def test_bulk_generate_lhas_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during bulk-generate, no LHA rows persist."""
    from app.api.routes.airports import lhas as airports_route

    apt_id, surface_id, agl_id = _bulk_generate_setup(client, "LABF")

    _force_log_audit_failure(monkeypatch, airports_route)

    body = {
        "first_position": {"type": "Point", "coordinates": [14.2700, 50.1000, 380.0]},
        "last_position": {"type": "Point", "coordinates": [14.2704, 50.1000, 380.0]},
        "spacing_m": 10.0,
    }
    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/bulk",
            json=body,
        )

    monkeypatch.undo()

    listing = client.get(
        f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}/lhas"
    ).json()
    assert listing["data"] == []


def _reverse_setup(client, icao: str):
    """create airport + surface + PAPI AGL with 4 LHAs (A-D) for reverse tests."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "agl_type": "PAPI", "name": "papi"},
    ).json()
    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"
    for letter in ("A", "B", "C", "D"):
        client.post(base, json={**LHA_PAYLOAD, "unit_designator": letter})
    return apt["id"], surface["id"], agl["id"]


def test_reverse_lhas_emits_aggregate_audit_row(client, session):
    """reverse emits exactly one UPDATE LHA row scoped to the airport + agl."""
    apt_id, surface_id, agl_id = _reverse_setup(client, "LARV")

    r = client.post(f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/reverse")
    assert r.status_code == 200
    reordered = r.json()["data"]

    rows = _audit_rows(session, action="UPDATE", entity_type="LHA", entity_id=UUID(agl_id))
    assert len(rows) == 1
    row = rows[0]
    assert str(row.airport_id) == apt_id
    assert row.details["count"] == len(reordered)
    assert row.details["airport_id"] == apt_id
    assert row.details["surface_id"] == surface_id
    assert row.details["agl_id"] == agl_id
    assert sorted(row.details["lha_ids"]) == sorted(lha["id"] for lha in reordered)


def test_reverse_lhas_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during reverse, the numbering is left untouched."""
    from app.api.routes.airports import lhas as airports_route

    apt_id, surface_id, agl_id = _reverse_setup(client, "LARW")
    base = f"/api/v1/airports/{apt_id}/surfaces/{surface_id}/agls/{agl_id}/lhas"
    before = {row["id"]: row["sequence_number"] for row in client.get(base).json()["data"]}

    _force_log_audit_failure(monkeypatch, airports_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(f"{base}/reverse")

    monkeypatch.undo()

    after = {row["id"]: row["sequence_number"] for row in client.get(base).json()["data"]}
    assert after == before


def test_download_terrain_dem_unlinks_file_on_audit_failure(client, session, monkeypatch, tmp_path):
    """if log_audit raises after API download, the new GeoTIFF is unlinked."""
    import types

    from app.api.routes.airports import terrain as airports_route

    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "LABT"}).json()

    # write a stand-in GeoTIFF the route can unlink
    fake_path = tmp_path / f"{apt['id']}_api_cache.tif"
    fake_path.write_bytes(b"fake-tiff-bytes")
    assert fake_path.exists()

    fake_result = {
        "terrain_source": "DEM_API",
        "points_downloaded": 42,
        "bounds": [14.0, 50.0, 14.5, 50.2],
        "resolution": [0.001, 0.001],
        "file_path": str(fake_path),
    }
    monkeypatch.setattr(
        airports_route.airport_service,
        "download_terrain_for_location",
        lambda **kwargs: fake_result,
    )

    apt_id = UUID(apt["id"])
    fake_airport = types.SimpleNamespace(id=apt_id, name=apt["name"])
    monkeypatch.setattr(
        airports_route.airport_service,
        "upload_terrain_dem",
        lambda db, airport_id, file_path, terrain_source="DEM_API", **kwargs: (
            fake_airport,
            None,
        ),
    )

    _force_log_audit_failure(monkeypatch, airports_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(f"/api/v1/airports/{apt['id']}/terrain-download")

    monkeypatch.undo()

    # the freshly-downloaded GeoTIFF must be unlinked - the audit failure
    # rolled back the airport.dem_file_path update so nothing references it
    assert not fake_path.exists()


# rollback regressions for services that previously committed internally


def test_login_rolls_back_last_login_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during LOGIN, last_login must not be bumped."""
    from app.api.routes import auth as auth_route
    from app.models.user import User

    email = "test@tarmacview.com"

    user_before = session.query(User).filter(User.email == email).first()
    last_login_before = user_before.last_login
    login_rows_before = (
        session.query(AuditLog)
        .filter(AuditLog.action == "LOGIN", AuditLog.user_email == email)
        .count()
    )

    _force_log_audit_failure(monkeypatch, auth_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "testpassword"},
        )

    monkeypatch.undo()

    session.expire_all()
    user_after = session.query(User).filter(User.email == email).first()
    assert user_after.last_login == last_login_before

    login_rows_after = (
        session.query(AuditLog)
        .filter(AuditLog.action == "LOGIN", AuditLog.user_email == email)
        .count()
    )
    assert login_rows_after == login_rows_before


def test_export_rolls_back_status_when_audit_fails(
    client, db_engine, fp_audit_airport_id, session, monkeypatch
):
    """if log_audit raises during EXPORT, status must stay VALIDATED."""
    from sqlalchemy import text

    from app.api.routes.missions import core as missions_route
    from app.core.enums import MissionStatus

    apt_id = fp_audit_airport_id

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": "TX Export Mission",
            "airport_id": apt_id,
            "takeoff_coordinate": {"type": "Point", "coordinates": [14.26, 50.10, 380.0]},
            "landing_coordinate": {"type": "Point", "coordinates": [14.27, 50.10, 380.0]},
        },
    ).json()
    mission_id = mission["id"]

    fp_id = uuid4()
    with db_engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO flight_plan (id, mission_id, airport_id, total_distance, "
                "estimated_duration, is_validated) "
                "VALUES (:id, :mid, :aid, 100.0, 60.0, true)"
            ),
            {"id": str(fp_id), "mid": mission_id, "aid": apt_id},
        )
        wp_types = ["TAKEOFF", "TRANSIT", "LANDING"]
        for i, wt in enumerate(wp_types, start=1):
            conn.execute(
                text(
                    "INSERT INTO waypoint (id, flight_plan_id, sequence_order, position, "
                    "waypoint_type) VALUES (:id, :fp_id, :seq, :wkt, :wt)"
                ),
                {
                    "id": str(uuid4()),
                    "fp_id": str(fp_id),
                    "seq": i,
                    "wkt": f"POINT Z (14.{260 + i} 50.10 380.{i})",
                    "wt": wt,
                },
            )
        conn.execute(
            text("UPDATE mission SET status = :s WHERE id = :id"),
            {"s": MissionStatus.VALIDATED.value, "id": mission_id},
        )
        conn.commit()

    _force_log_audit_failure(monkeypatch, missions_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            f"/api/v1/missions/{mission_id}/export",
            json={"formats": ["JSON"]},
        )

    monkeypatch.undo()

    after = client.get(f"/api/v1/missions/{mission_id}").json()
    assert after["status"] == MissionStatus.VALIDATED.value

    rows = _audit_rows(session, action="EXPORT", entity_type="Mission", entity_id=mission_id)
    assert rows == []


def test_create_template_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during template CREATE, no template row persists."""
    from app.api.routes import inspection_templates as templates_route

    _force_log_audit_failure(monkeypatch, templates_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            "/api/v1/inspection-templates",
            json={"name": "TX Create Tmpl", "methods": ["HORIZONTAL_RANGE"]},
        )

    monkeypatch.undo()

    listing = client.get("/api/v1/inspection-templates").json()
    names = [t["name"] for t in listing["data"]]
    assert "TX Create Tmpl" not in names


def test_update_template_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during template UPDATE, the rename must not persist."""
    from app.api.routes import inspection_templates as templates_route

    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "TX Update Original", "methods": ["HORIZONTAL_RANGE"]},
    ).json()

    _force_log_audit_failure(monkeypatch, templates_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.put(
            f"/api/v1/inspection-templates/{template['id']}",
            json={"name": "TX Update Renamed"},
        )

    monkeypatch.undo()

    after = client.get(f"/api/v1/inspection-templates/{template['id']}").json()
    assert after["name"] == "TX Update Original"


def test_delete_template_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during template DELETE, the row must still exist."""
    from app.api.routes import inspection_templates as templates_route

    template = client.post(
        "/api/v1/inspection-templates",
        json={"name": "TX Delete Tmpl", "methods": ["HORIZONTAL_RANGE"]},
    ).json()

    _force_log_audit_failure(monkeypatch, templates_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.delete(f"/api/v1/inspection-templates/{template['id']}")

    monkeypatch.undo()

    after = client.get(f"/api/v1/inspection-templates/{template['id']}")
    assert after.status_code == 200
    assert after.json()["name"] == "TX Delete Tmpl"


def test_create_drone_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during drone CREATE, no drone row persists."""
    from app.api.routes import drone_profiles as drones_route

    _force_log_audit_failure(monkeypatch, drones_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.post(
            "/api/v1/drone-profiles",
            json={**DRONE_PAYLOAD, "name": "TX Create Drone"},
        )

    monkeypatch.undo()

    listing = client.get("/api/v1/drone-profiles").json()
    names = [d["name"] for d in listing["data"]]
    assert "TX Create Drone" not in names


def test_update_drone_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during drone UPDATE, the rename must not persist."""
    from app.api.routes import drone_profiles as drones_route

    drone = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "TX Update Drone"}
    ).json()

    _force_log_audit_failure(monkeypatch, drones_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.put(
            f"/api/v1/drone-profiles/{drone['id']}",
            json={"name": "TX Drone Renamed"},
        )

    monkeypatch.undo()

    after = client.get(f"/api/v1/drone-profiles/{drone['id']}").json()
    assert after["name"] == "TX Update Drone"


def test_delete_drone_rolls_back_when_audit_fails(client, session, monkeypatch):
    """if log_audit raises during drone DELETE, the row must still exist."""
    from app.api.routes import drone_profiles as drones_route

    drone = client.post(
        "/api/v1/drone-profiles", json={**DRONE_PAYLOAD, "name": "TX Delete Drone"}
    ).json()

    _force_log_audit_failure(monkeypatch, drones_route)

    with pytest.raises(RuntimeError, match="audit-insert-failure"):
        client.delete(f"/api/v1/drone-profiles/{drone['id']}")

    monkeypatch.undo()

    after = client.get(f"/api/v1/drone-profiles/{drone['id']}")
    assert after.status_code == 200
    assert after.json()["name"] == "TX Delete Drone"
