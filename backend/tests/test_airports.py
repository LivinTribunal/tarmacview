"""tests for airport, surface, obstacle, safety zone, agl/lha, elevation, drone endpoints."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from tests.data.airports import (
    AGL_PAYLOAD,
    AIRPORT_PAYLOAD,
    AIRPORT_UPDATE_PAYLOAD,
    LHA_PAYLOAD,
    OBSTACLE_PAYLOAD,
    SAFETY_ZONE_PAYLOAD,
    SURFACE_PAYLOAD,
    THROWAWAY_AIRPORT_PAYLOAD,
)
from tests.data.drones import DRONE_PAYLOAD


def _make_provider_spy(monkeypatch, *, ground: float = 380.0):
    """patch the package's elevation-provider seam; return (create_spy, provider_mock).

    every obstacle / agl / lha / safety-zone write path resolves
    create_elevation_provider in app.services.airport.altitude (the shared
    normalization module), so a single repoint covers them all.

    the returned provider_mock has a callable get_elevation MagicMock that yields
    `ground` and a no-op close so call sites can both sample and tear down.
    """
    provider = MagicMock()
    provider.get_elevation = MagicMock(return_value=ground)
    provider.close = MagicMock()
    create_spy = MagicMock(return_value=provider)
    monkeypatch.setattr("app.services.airport.altitude.create_elevation_provider", create_spy)
    return create_spy, provider


# Tests
def test_create_airport(client):
    """create an airport and verify response."""
    r = client.post("/api/v1/airports", json=AIRPORT_PAYLOAD)
    assert r.status_code == 201
    data = r.json()
    assert data["icao_code"] == "LKPR"
    assert data["name"] == "Prague Airport"
    assert "id" in data


def _airport_create(icao: str):
    """build an AirportCreate with a unique icao for service-level tests."""
    from app.schemas.airport import AirportCreate

    return AirportCreate(
        icao_code=icao,
        name=f"{icao} Field",
        city="Testville",
        country="Testland",
        elevation=100.0,
        location={"type": "Point", "coordinates": [10.0, 40.0, 100.0]},
    )


def test_create_airport_auto_assigns_coordinator_creator(db_session):
    """a coordinator-created airport is auto-assigned to its creator, so it is not orphaned."""
    from app.core.enums import UserRole
    from app.models.user import User
    from app.services import airport_service

    coord = User(email="apt-coord@tmv.com", name="Apt Coord", role=UserRole.COORDINATOR.value)
    db_session.add(coord)
    db_session.flush()

    airport = airport_service.create_airport(db_session, _airport_create("QXAA"), creator=coord)

    assert airport.id in [a.id for a in coord.airports]


def test_create_airport_by_super_admin_stays_unassigned(db_session):
    """a super-admin-created airport stays unassigned (the admin bypasses airport access)."""
    from app.core.enums import UserRole
    from app.models.user import User
    from app.services import airport_service

    admin = User(email="apt-admin@tmv.com", name="Apt Admin", role=UserRole.SUPER_ADMIN.value)
    db_session.add(admin)
    db_session.flush()

    airport = airport_service.create_airport(db_session, _airport_create("QXAB"), creator=admin)

    assert airport.id not in [a.id for a in admin.airports]


def _assign_rows_for_airport(session, airport_id):
    """ASSIGN_AIRPORT user rows whose details name the given airport id."""
    from app.models.audit_log import AuditLog

    rows = (
        session.query(AuditLog)
        .filter(AuditLog.action == "ASSIGN_AIRPORT", AuditLog.entity_type == "User")
        .all()
    )
    return [r for r in rows if airport_id in (r.details or {}).get("airport_ids", [])]


def test_create_airport_by_coordinator_logs_assign_audit(db_session, as_coordinator):
    """a coordinator-created airport writes exactly one ASSIGN_AIRPORT audit row."""
    with as_coordinator() as coord_client:
        apt = coord_client.post(
            "/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "QXAC"}
        ).json()

    rows = _assign_rows_for_airport(db_session, apt["id"])
    assert len(rows) == 1
    # ASSIGN_AIRPORT carries the airport list in details, not airport_id (mirrors admin route)
    assert rows[0].airport_id is None
    assert rows[0].entity_name == "coordinator@tarmacview.com"


def test_create_airport_by_super_admin_logs_no_assign_audit(client, db_session):
    """a super-admin-created airport writes no ASSIGN_AIRPORT audit row."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": "QXAD"}).json()

    assert _assign_rows_for_airport(db_session, apt["id"]) == []


def test_list_airports(client):
    """list airports and verify pagination metadata."""
    r = client.get("/api/v1/airports")
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["total"] >= 1
    assert any(a["icao_code"] == "LKPR" for a in body["data"])


def test_get_airport_detail(client):
    """fetch airport detail with nested surfaces, obstacles, safety zones."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.get(f"/api/v1/airports/{airport_id}")
    assert r.status_code == 200
    data = r.json()
    assert "surfaces" in data
    assert "obstacles" in data
    assert "safety_zones" in data


def test_update_airport(client):
    """update airport name and verify response."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.put(f"/api/v1/airports/{airport_id}", json=AIRPORT_UPDATE_PAYLOAD)
    assert r.status_code == 200
    assert r.json()["name"] == "Vaclav Havel"


def test_create_surface(client):
    """create a surface under an airport."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.post(f"/api/v1/airports/{airport_id}/surfaces", json=SURFACE_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["identifier"] == "06/24"


def test_create_obstacle(client):
    """create an obstacle under an airport."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.post(f"/api/v1/airports/{airport_id}/obstacles", json=OBSTACLE_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["name"] == "Tower"


def test_create_safety_zone(client):
    """create a safety zone under an airport."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.post(f"/api/v1/airports/{airport_id}/safety-zones", json=SAFETY_ZONE_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["name"] == "Prague CTR"


def test_safety_zone_partial_update_rejects_inverted_altitudes(client):
    """partial update that would invert floor/ceiling must be rejected."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LKSZ"},
    ).json()
    zone = client.post(
        f"/api/v1/airports/{apt['id']}/safety-zones", json=SAFETY_ZONE_PAYLOAD
    ).json()

    # floor (0) + existing ceiling (2500) is fine; pushing floor above the
    # stored ceiling via a floor-only patch must be rejected
    r = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"altitude_floor": 5000.0},
    )
    assert r.status_code == 422
    assert "altitude" in r.json()["detail"].lower()

    # dropping ceiling below existing floor via a ceiling-only patch is also bad.
    # raise floor first via a valid update to give us something to invert.
    ok = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"altitude_floor": 500.0},
    )
    assert ok.status_code == 200

    r2 = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"altitude_ceiling": 100.0},
    )
    assert r2.status_code == 422


def test_safety_zone_update_to_boundary_clears_altitudes(client):
    """switching a non-boundary zone to AIRPORT_BOUNDARY nulls stale altitudes."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LKBC"},
    ).json()
    zone = client.post(
        f"/api/v1/airports/{apt['id']}/safety-zones",
        json={**SAFETY_ZONE_PAYLOAD, "altitude_floor": 100.0, "altitude_ceiling": 500.0},
    ).json()
    assert zone["altitude_floor"] == 100.0
    assert zone["altitude_ceiling"] == 500.0

    r = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"type": "AIRPORT_BOUNDARY"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "AIRPORT_BOUNDARY"
    assert body["altitude_floor"] is None
    assert body["altitude_ceiling"] is None

    # re-GET confirms persisted state
    detail = client.get(f"/api/v1/airports/{apt['id']}").json()
    persisted = next(z for z in detail["safety_zones"] if z["id"] == zone["id"])
    assert persisted["type"] == "AIRPORT_BOUNDARY"
    assert persisted["altitude_floor"] is None
    assert persisted["altitude_ceiling"] is None


def test_create_agl_and_lha(client):
    """create an agl and nested lha under a surface."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    surfaces = client.get(f"/api/v1/airports/{airport_id}/surfaces").json()["data"]
    surface_id = surfaces[0]["id"]

    r = client.post(f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls", json=AGL_PAYLOAD)
    assert r.status_code == 201
    agl_id = r.json()["id"]

    r = client.post(
        f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
        json=LHA_PAYLOAD,
    )
    assert r.status_code == 201
    assert r.json()["unit_designator"] == "A"


def test_surface_response_excludes_taxiway_width(client):
    """surface response should not contain taxiway_width field."""
    # create airport + surface to avoid ordering dependency
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LKTW"},
    ).json()

    client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD)
    surfaces = client.get(f"/api/v1/airports/{apt['id']}/surfaces").json()["data"]
    assert len(surfaces) >= 1

    for surface in surfaces:
        assert "taxiway_width" not in surface


def test_create_airport_invalid_icao(client):
    """reject airports with invalid ICAO codes."""
    invalid_codes = ["lkpr", "LKP", "LK12", "LKPRX"]
    for code in invalid_codes:
        payload = {**AIRPORT_PAYLOAD, "icao_code": code}
        r = client.post("/api/v1/airports", json=payload)
        assert r.status_code == 422, f"expected 422 for ICAO '{code}', got {r.status_code}"


def test_airports_summary(client):
    """fetch airports summary with counts."""
    r = client.get("/api/v1/airports/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["total"] >= 1
    item = body["data"][0]
    assert "surfaces_count" in item
    assert "agls_count" in item
    assert "missions_count" in item
    assert "city" in item
    assert "country" in item


def test_elevation_endpoint_flat_returns_airport_elevation(client):
    """GET /elevation on a FLAT airport returns the airport-wide elevation."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZEV"},
    ).json()

    r = client.get(
        f"/api/v1/airports/{apt['id']}/elevation",
        params={"lat": 50.10, "lon": 14.27},
    )
    assert r.status_code == 200
    body = r.json()
    # without DEM and with API fallback disabled in tests, source falls back to FLAT
    assert body["elevation"] == apt["elevation"]
    assert body["source"] in {"FLAT", "API"}


def test_elevation_endpoint_rejects_out_of_range_coords(client):
    """GET /elevation rejects coordinates outside [-90, 90] / [-180, 180]."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZEW"},
    ).json()

    r = client.get(
        f"/api/v1/airports/{apt['id']}/elevation",
        params={"lat": 95.0, "lon": 14.27},
    )
    assert r.status_code == 422

    r = client.get(
        f"/api/v1/airports/{apt['id']}/elevation",
        params={"lat": 50.10, "lon": 200.0},
    )
    assert r.status_code == 422


def test_elevation_endpoint_missing_params(client):
    """GET /elevation requires lat and lon query params."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZEM"},
    ).json()

    r = client.get(f"/api/v1/airports/{apt['id']}/elevation")
    assert r.status_code == 422


def test_elevation_endpoint_unknown_airport_returns_404(client):
    """GET /elevation on an unknown airport returns 404."""
    r = client.get(
        f"/api/v1/airports/{uuid4()}/elevation",
        params={"lat": 50.10, "lon": 14.27},
    )
    assert r.status_code == 404


def test_delete_airport(client):
    """delete an airport and verify 404 on re-fetch."""
    r = client.post("/api/v1/airports", json=THROWAWAY_AIRPORT_PAYLOAD)
    assert r.status_code == 201
    airport_id = r.json()["id"]

    r = client.delete(f"/api/v1/airports/{airport_id}")
    assert r.status_code == 200

    r = client.get(f"/api/v1/airports/{airport_id}")
    assert r.status_code == 404


def test_set_default_drone(client):
    """set and clear default drone on an airport."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZDD"},
    ).json()

    drone = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Default Drone Test"},
    ).json()

    # set default
    r = client.put(
        f"/api/v1/airports/{apt['id']}/default-drone",
        json={"drone_profile_id": drone["id"]},
    )
    assert r.status_code == 200
    assert r.json()["default_drone_profile_id"] == drone["id"]

    # verify on detail
    detail = client.get(f"/api/v1/airports/{apt['id']}").json()
    assert detail["default_drone_profile_id"] == drone["id"]

    # clear default
    r = client.put(
        f"/api/v1/airports/{apt['id']}/default-drone",
        json={"drone_profile_id": None},
    )
    assert r.status_code == 200
    assert r.json()["default_drone_profile_id"] is None


def test_set_default_drone_invalid_profile(client):
    """setting a nonexistent drone profile returns 400."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.put(
        f"/api/v1/airports/{airport_id}/default-drone",
        json={"drone_profile_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 400


def test_bulk_change_drone(client):
    """bulk change drone on draft missions at an airport."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZBC"},
    ).json()

    drone1 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Bulk Drone 1"},
    ).json()
    drone2 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Bulk Drone 2"},
    ).json()

    # create two draft missions
    m1 = client.post(
        "/api/v1/missions",
        json={"name": "BulkTest1", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    m2 = client.post(
        "/api/v1/missions",
        json={"name": "BulkTest2", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()

    # bulk change to drone2
    r = client.post(
        f"/api/v1/airports/{apt['id']}/bulk-change-drone",
        json={"drone_profile_id": drone2["id"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated_count"] == 2
    assert m1["id"] in body["mission_ids"]
    assert m2["id"] in body["mission_ids"]


def test_bulk_change_drone_skips_non_draft(client, db_engine):
    """bulk change should not affect non-draft missions."""
    from sqlalchemy import text

    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZSK"},
    ).json()

    drone1 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Skip Drone 1"},
    ).json()
    drone2 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Skip Drone 2"},
    ).json()

    m_draft = client.post(
        "/api/v1/missions",
        json={"name": "SkipDraft", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    m_planned = client.post(
        "/api/v1/missions",
        json={"name": "SkipPlanned", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()

    # force one mission to PLANNED status via raw sql
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE mission SET status = 'PLANNED' WHERE id = :id"),
            {"id": m_planned["id"]},
        )
        conn.commit()

    r = client.post(
        f"/api/v1/airports/{apt['id']}/bulk-change-drone",
        json={"drone_profile_id": drone2["id"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated_count"] == 1
    assert m_draft["id"] in body["mission_ids"]
    assert m_planned["id"] not in body["mission_ids"]

    # verify planned mission still has original drone
    planned_detail = client.get(f"/api/v1/missions/{m_planned['id']}").json()
    assert planned_detail["drone_profile_id"] == drone1["id"]


def test_mission_auto_fills_default_drone(client):
    """mission creation auto-fills drone from airport default."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZAF"},
    ).json()

    drone = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "AutoFill Drone"},
    ).json()

    # set default drone
    client.put(
        f"/api/v1/airports/{apt['id']}/default-drone",
        json={"drone_profile_id": drone["id"]},
    )

    # create mission without specifying drone
    r = client.post(
        "/api/v1/missions",
        json={"name": "AutoFillTest", "airport_id": apt["id"]},
    )
    assert r.status_code == 201
    assert r.json()["drone_profile_id"] == drone["id"]


def test_bulk_change_drone_selected_scope(client, db_engine):
    """bulk change with SELECTED scope updates draft and planned missions."""
    from sqlalchemy import text

    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZSE"},
    ).json()

    drone1 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "SelDrone1"},
    ).json()
    drone2 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "SelDrone2"},
    ).json()

    m_draft = client.post(
        "/api/v1/missions",
        json={"name": "SelDraft", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    m_planned = client.post(
        "/api/v1/missions",
        json={"name": "SelPlanned", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    m_validated = client.post(
        "/api/v1/missions",
        json={"name": "SelValidated", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()

    # force statuses via raw sql
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE mission SET status = 'PLANNED' WHERE id = :id"),
            {"id": m_planned["id"]},
        )
        conn.execute(
            text("UPDATE mission SET status = 'VALIDATED' WHERE id = :id"),
            {"id": m_validated["id"]},
        )
        conn.commit()

    # SELECTED scope targeting all three - validated should be skipped
    r = client.post(
        f"/api/v1/airports/{apt['id']}/bulk-change-drone",
        json={
            "drone_profile_id": drone2["id"],
            "scope": "SELECTED",
            "mission_ids": [m_draft["id"], m_planned["id"], m_validated["id"]],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated_count"] == 2
    assert body["regressed_count"] == 1
    assert m_draft["id"] in body["mission_ids"]
    assert m_planned["id"] in body["mission_ids"]
    assert m_validated["id"] not in body["mission_ids"]


def test_lha_cross_airport_rejected(client):
    """lha operations reject requests where surface belongs to a different airport."""
    apt1 = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZCA"},
    ).json()
    apt2 = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZCB"},
    ).json()

    # create surface + agl under apt1
    surface = client.post(f"/api/v1/airports/{apt1['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt1['id']}/surfaces/{surface['id']}/agls", json=AGL_PAYLOAD
    ).json()

    # list lhas via apt2 should 404
    r = client.get(f"/api/v1/airports/{apt2['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas")
    assert r.status_code == 404

    # create lha via apt2 should 404
    r = client.post(
        f"/api/v1/airports/{apt2['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
        json=LHA_PAYLOAD,
    )
    assert r.status_code == 404

    # create a valid lha under apt1 then try to update/delete via apt2
    lha = client.post(
        f"/api/v1/airports/{apt1['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
        json=LHA_PAYLOAD,
    ).json()

    r = client.put(
        f"/api/v1/airports/{apt2['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha['id']}",
        json={"setting_angle": 5.0},
    )
    assert r.status_code == 404

    r = client.delete(
        f"/api/v1/airports/{apt2['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha['id']}"
    )
    assert r.status_code == 404


def test_lha_crud(client):
    """full lha CRUD lifecycle - create, list, update, delete."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZLC"},
    ).json()

    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=AGL_PAYLOAD
    ).json()

    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"

    # create
    r = client.post(base, json=LHA_PAYLOAD)
    assert r.status_code == 201
    lha = r.json()
    assert lha["unit_designator"] == "A"

    # list
    r = client.get(base)
    assert r.status_code == 200
    assert r.json()["meta"]["total"] == 1

    # update
    r = client.put(f"{base}/{lha['id']}", json={"setting_angle": 5.0})
    assert r.status_code == 200
    assert r.json()["setting_angle"] == 5.0

    # delete
    r = client.delete(f"{base}/{lha['id']}")
    assert r.status_code == 200

    # verify deleted
    r = client.get(base)
    assert r.json()["meta"]["total"] == 0


def test_delete_terrain_dem(client, tmp_path):
    """delete terrain dem removes file and resets airport to flat."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZTD"},
    ).json()

    # delete on airport with no DEM should still succeed
    r = client.delete(f"/api/v1/airports/{apt['id']}/terrain-dem")
    assert r.status_code == 200
    assert r.json()["deleted"] is True


def test_bulk_change_drone_with_from_filter(client):
    """bulk change filters by from_drone_id when provided."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZFF"},
    ).json()

    drone1 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Filter1"},
    ).json()
    drone2 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Filter2"},
    ).json()
    drone3 = client.post(
        "/api/v1/drone-profiles",
        json={**DRONE_PAYLOAD, "name": "Filter3"},
    ).json()

    # mission with drone1
    m1 = client.post(
        "/api/v1/missions",
        json={"name": "FilterM1", "airport_id": apt["id"], "drone_profile_id": drone1["id"]},
    ).json()
    # mission with drone2
    m2 = client.post(
        "/api/v1/missions",
        json={"name": "FilterM2", "airport_id": apt["id"], "drone_profile_id": drone2["id"]},
    ).json()

    # bulk change only drone1 missions to drone3
    r = client.post(
        f"/api/v1/airports/{apt['id']}/bulk-change-drone",
        json={"drone_profile_id": drone3["id"], "from_drone_id": drone1["id"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated_count"] == 1
    assert m1["id"] in body["mission_ids"]
    assert m2["id"] not in body["mission_ids"]


def test_bulk_change_drone_nonexistent(client):
    """bulk change with nonexistent drone profile returns 400."""
    airports = client.get("/api/v1/airports").json()["data"]
    airport_id = airports[0]["id"]

    r = client.post(
        f"/api/v1/airports/{airport_id}/bulk-change-drone",
        json={"drone_profile_id": str(uuid4())},
    )
    assert r.status_code == 400


# recalculate dimensions
def test_recalculate_surface_dimensions(client):
    """recompute surface length/heading from centerline geometry."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZRC"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()

    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/recalculate")
    assert r.status_code == 200
    body = r.json()
    assert "current" in body
    assert "recalculated" in body
    # current should match the seed values
    assert body["current"]["length"] == 3715.0
    assert body["current"]["width"] == 45.0
    assert body["current"]["heading"] == 243.0
    # recalculated length is great-circle along the linestring (~ 2.5km)
    assert body["recalculated"]["length"] is not None
    assert body["recalculated"]["length"] > 0
    # heading is bearing from start to end of centerline
    assert body["recalculated"]["heading"] is not None


def test_recalculate_surface_404(client):
    """recalculate returns 404 for unknown surface."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZNF"},
    ).json()

    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{uuid4()}/recalculate")
    assert r.status_code == 404


def test_recalculate_obstacle_dimensions(client):
    """recompute obstacle dimensions from polygon boundary."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZRO"},
    ).json()
    obstacle = client.post(
        f"/api/v1/airports/{apt['id']}/obstacles",
        json=OBSTACLE_PAYLOAD,
    ).json()

    r = client.post(f"/api/v1/airports/{apt['id']}/obstacles/{obstacle['id']}/recalculate")
    assert r.status_code == 200
    body = r.json()
    assert "recalculated" in body
    rec = body["recalculated"]
    # rectangular obstacle should yield non-zero length and width
    assert rec["length"] is not None and rec["length"] > 0
    assert rec["width"] is not None and rec["width"] > 0
    # radius is half the smaller axis
    assert rec["radius"] is not None
    assert abs(rec["radius"] - rec["width"] / 2) < 1e-6


def test_recalculate_obstacle_404(client):
    """recalculate returns 404 for unknown obstacle."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZNX"},
    ).json()

    r = client.post(f"/api/v1/airports/{apt['id']}/obstacles/{uuid4()}/recalculate")
    assert r.status_code == 404


def test_update_obstacle_preserve_altitude(client):
    """preserve_altitude=True skips boundary z-normalization on update."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZPA"},
    ).json()
    obstacle = client.post(
        f"/api/v1/airports/{apt['id']}/obstacles",
        json=OBSTACLE_PAYLOAD,
    ).json()

    explicit_alt = 999.5
    new_boundary = {
        "type": "Polygon",
        "coordinates": [
            [
                [14.261, 50.100, explicit_alt],
                [14.263, 50.100, explicit_alt],
                [14.263, 50.102, explicit_alt],
                [14.261, 50.102, explicit_alt],
                [14.261, 50.100, explicit_alt],
            ]
        ],
    }

    r = client.put(
        f"/api/v1/airports/{apt['id']}/obstacles/{obstacle['id']}",
        json={"boundary": new_boundary, "preserve_altitude": True},
    )
    assert r.status_code == 200
    body = r.json()
    # the explicit altitude must be preserved (not overwritten by ground elevation)
    for vertex in body["boundary"]["coordinates"][0]:
        assert vertex[2] == explicit_alt


def test_update_agl_preserve_altitude(client):
    """preserve_altitude=True skips position z-normalization on agl update."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZAG"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()

    explicit_alt = 777.25
    new_position = {"type": "Point", "coordinates": [14.2745, 50.0972, explicit_alt]}

    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}",
        json={"position": new_position, "preserve_altitude": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["position"]["coordinates"][2] == explicit_alt


def test_update_surface_clear_boundary(client):
    """PUT with boundary=null on a surface clears the polygon (was silently ignored before)."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZBN"},
    ).json()

    with_boundary = {
        **SURFACE_PAYLOAD,
        "boundary": {
            "type": "Polygon",
            "coordinates": [
                [
                    [14.24, 50.10, 380],
                    [14.27, 50.10, 380],
                    [14.27, 50.09, 380],
                    [14.24, 50.09, 380],
                    [14.24, 50.10, 380],
                ]
            ],
        },
    }
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=with_boundary).json()
    assert surface["boundary"] is not None

    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}",
        json={"boundary": None},
    )
    assert r.status_code == 200
    assert r.json()["boundary"] is None


# taxiway heading derivation

TAXIWAY_PAYLOAD = {
    "identifier": "A",
    "surface_type": "TAXIWAY",
    "geometry": {
        "type": "LineString",
        "coordinates": [[14.24, 50.10, 380], [14.26, 50.10, 380]],
    },
    "width": 23.0,
}


def _airport_with(client, icao_code):
    """create a throwaway airport with the given icao code."""
    return client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao_code}).json()


def test_create_taxiway_without_heading_derives_from_centerline(client):
    """taxiway created without heading gets the centerline bearing (due east ~90)."""
    apt = _airport_with(client, "LZTA")

    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=TAXIWAY_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["heading"] == pytest.approx(90.0, abs=0.2)


def test_create_taxiway_with_explicit_heading_keeps_it(client):
    """explicit heading on create wins over derivation."""
    apt = _airport_with(client, "LZTB")

    r = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json={**TAXIWAY_PAYLOAD, "heading": 123.0},
    )
    assert r.status_code == 201
    assert r.json()["heading"] == 123.0


def test_update_taxiway_geometry_rederives_heading(client):
    """geometry update without heading re-derives it from the new centerline."""
    apt = _airport_with(client, "LZTF")
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=TAXIWAY_PAYLOAD).json()

    # rotate the centerline to due north
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}",
        json={
            "geometry": {
                "type": "LineString",
                "coordinates": [[14.24, 50.10, 380], [14.24, 50.12, 380]],
            }
        },
    )
    assert r.status_code == 200
    assert r.json()["heading"] == pytest.approx(0.0, abs=0.2)


def test_update_taxiway_geometry_with_explicit_heading_wins(client):
    """heading sent alongside a geometry change is never overwritten."""
    apt = _airport_with(client, "LZTH")
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=TAXIWAY_PAYLOAD).json()

    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}",
        json={
            "geometry": {
                "type": "LineString",
                "coordinates": [[14.24, 50.10, 380], [14.24, 50.12, 380]],
            },
            "heading": 321.0,
        },
    )
    assert r.status_code == 200
    assert r.json()["heading"] == 321.0


def test_create_runway_without_heading_stays_null(client):
    """runway create path is untouched - no server-side heading derivation."""
    apt = _airport_with(client, "LZTE")
    payload = {k: v for k, v in SURFACE_PAYLOAD.items() if k != "heading"}

    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=payload)
    assert r.status_code == 201
    assert r.json()["heading"] is None


def test_create_surface_invalid_type_returns_422(client):
    """invalid surface_type fails at the schema layer with 422, not 500."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZIT"},
    ).json()

    bad = {**SURFACE_PAYLOAD, "surface_type": "BOGUS"}
    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=bad)
    assert r.status_code == 422


def test_create_obstacle_invalid_type_returns_422(client):
    """invalid obstacle type fails at the schema layer with 422, not 500."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZIO"},
    ).json()

    bad = {**OBSTACLE_PAYLOAD, "type": "BOGUS"}
    r = client.post(f"/api/v1/airports/{apt['id']}/obstacles", json=bad)
    assert r.status_code == 422


def test_negative_buffer_distance_rejected(client):
    """ge=0 constraint on buffer_distance must reject negatives at the schema layer."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZBD"},
    ).json()

    # surface create
    bad_surface = {**SURFACE_PAYLOAD, "buffer_distance": -1.0}
    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=bad_surface)
    assert r.status_code == 422

    # obstacle create
    bad_obstacle = {**OBSTACLE_PAYLOAD, "buffer_distance": -2.5}
    r = client.post(f"/api/v1/airports/{apt['id']}/obstacles", json=bad_obstacle)
    assert r.status_code == 422

    # surface update - need a valid surface first
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}",
        json={"buffer_distance": -3.0},
    )
    assert r.status_code == 422

    # mission default_buffer_distance
    r = client.post(
        "/api/v1/missions",
        json={
            "name": "BadBuffer",
            "airport_id": apt["id"],
            "default_buffer_distance": -4.0,
        },
    )
    assert r.status_code == 422


def test_update_lha_preserve_altitude(client):
    """preserve_altitude=True skips position z-normalization on lha update."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZLH"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()
    lha = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
        json=LHA_PAYLOAD,
    ).json()

    explicit_alt = 555.75
    new_position = {"type": "Point", "coordinates": [14.2748, 50.0979, explicit_alt]}

    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha['id']}",
        json={"position": new_position, "preserve_altitude": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["position"]["coordinates"][2] == explicit_alt


# elevation-skip optimization on update routes
def test_update_obstacle_unchanged_boundary_skips_provider(client, monkeypatch):
    """PUT same boundary ring as stored fires zero elevation-provider lookups."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZQA"},
    ).json()
    obstacle = client.post(
        f"/api/v1/airports/{apt['id']}/obstacles",
        json=OBSTACLE_PAYLOAD,
    ).json()
    stored_boundary = obstacle["boundary"]

    create_spy, provider = _make_provider_spy(monkeypatch)

    r = client.put(
        f"/api/v1/airports/{apt['id']}/obstacles/{obstacle['id']}",
        json={"boundary": stored_boundary},
    )
    assert r.status_code == 200
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0

    # stored per-vertex altitudes preserved byte-for-byte
    new_ring = r.json()["boundary"]["coordinates"][0]
    old_ring = stored_boundary["coordinates"][0]
    for new_v, old_v in zip(new_ring, old_ring):
        assert new_v[2] == old_v[2]


def test_update_obstacle_partial_vertex_move_resolves_only_moved(client, monkeypatch):
    """moving 1 of N vertices resamples only the moved vertex via the provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZQB"},
    ).json()
    obstacle = client.post(
        f"/api/v1/airports/{apt['id']}/obstacles",
        json=OBSTACLE_PAYLOAD,
    ).json()
    stored_ring = obstacle["boundary"]["coordinates"][0]

    # shift vertex 2 ~70 m (> 1 cm threshold). closed ring keeps v0==v4 unchanged
    # so exactly one unique vertex moves.
    moved_ring = [list(v) for v in stored_ring]
    moved_ring[2] = [moved_ring[2][0] + 0.001, moved_ring[2][1] + 0.001, moved_ring[2][2]]
    new_boundary = {"type": "Polygon", "coordinates": [moved_ring]}

    new_ground = 410.0
    create_spy, provider = _make_provider_spy(monkeypatch, ground=new_ground)

    r = client.put(
        f"/api/v1/airports/{apt['id']}/obstacles/{obstacle['id']}",
        json={"boundary": new_boundary},
    )
    assert r.status_code == 200
    # one provider built (per-write entrypoint), one ground lookup for the lone move
    assert create_spy.call_count == 1
    assert provider.get_elevation.call_count == 1

    resp_ring = r.json()["boundary"]["coordinates"][0]
    # vertex 2 picked up the resampled ground
    assert resp_ring[2][2] == new_ground
    # untouched vertices kept their stored z, not the mock's resample value
    for i, v in enumerate(resp_ring):
        if i == 2:
            continue
        assert v[2] == stored_ring[i][2]


def test_update_obstacle_non_positional_only_no_provider_constructed(client, monkeypatch):
    """height-only PUT on an obstacle never constructs a provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZNP"},
    ).json()
    obstacle = client.post(
        f"/api/v1/airports/{apt['id']}/obstacles",
        json=OBSTACLE_PAYLOAD,
    ).json()

    create_spy, provider = _make_provider_spy(monkeypatch)

    r = client.put(
        f"/api/v1/airports/{apt['id']}/obstacles/{obstacle['id']}",
        json={"height": 42.0},
    )
    assert r.status_code == 200
    assert r.json()["height"] == 42.0
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0


def test_update_agl_unchanged_position_skips_provider(client, monkeypatch):
    """PUT same (lat, lon) on an agl preserves stored z and skips the provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZUA"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()
    stored_position = agl["position"]

    create_spy, provider = _make_provider_spy(monkeypatch)

    # resubmit identical position but with an obviously-different alt the server
    # must ignore because lat/lon are unchanged
    submitted = {
        "type": "Point",
        "coordinates": [
            stored_position["coordinates"][0],
            stored_position["coordinates"][1],
            999.0,
        ],
    }
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}",
        json={"position": submitted},
    )
    assert r.status_code == 200
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0
    # stored z preserved verbatim, submitted z overridden
    assert r.json()["position"]["coordinates"][2] == stored_position["coordinates"][2]


def test_update_agl_moved_position_resolves_once(client, monkeypatch):
    """shifting (lat, lon) past the 1 cm threshold triggers exactly one provider sample."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZMA"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()

    new_ground = 425.5
    create_spy, provider = _make_provider_spy(monkeypatch, ground=new_ground)

    # ~70 m east + ~110 m north, well past the 7-dp tolerance
    new_position = {"type": "Point", "coordinates": [14.275, 50.098, 380]}
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}",
        json={"position": new_position},
    )
    assert r.status_code == 200
    assert create_spy.call_count == 1
    assert provider.get_elevation.call_count == 1
    assert r.json()["position"]["coordinates"][2] == new_ground


def test_update_lha_unchanged_position_skips_provider(client, monkeypatch):
    """PUT same (lat, lon) on an lha preserves stored z and skips the provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZUL"},
    ).json()
    surface = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces",
        json=SURFACE_PAYLOAD,
    ).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()
    lha = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas",
        json=LHA_PAYLOAD,
    ).json()
    stored_position = lha["position"]

    create_spy, provider = _make_provider_spy(monkeypatch)

    submitted = {
        "type": "Point",
        "coordinates": [
            stored_position["coordinates"][0],
            stored_position["coordinates"][1],
            123.0,
        ],
    }
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas/{lha['id']}",
        json={"position": submitted},
    )
    assert r.status_code == 200
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0
    assert r.json()["position"]["coordinates"][2] == stored_position["coordinates"][2]


def test_update_safety_zone_unchanged_polygon_skips_provider(client, monkeypatch):
    """PUT same polygon on a safety zone never constructs an elevation provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZSZ"},
    ).json()
    zone = client.post(
        f"/api/v1/airports/{apt['id']}/safety-zones",
        json=SAFETY_ZONE_PAYLOAD,
    ).json()
    stored_geometry = zone["geometry"]

    create_spy, provider = _make_provider_spy(monkeypatch)

    r = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"geometry": stored_geometry},
    )
    assert r.status_code == 200
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0


def test_update_safety_zone_is_active_toggle_no_provider(client, monkeypatch):
    """is_active-only toggle on a safety zone never constructs a provider."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LZTG"},
    ).json()
    zone = client.post(
        f"/api/v1/airports/{apt['id']}/safety-zones",
        json=SAFETY_ZONE_PAYLOAD,
    ).json()

    create_spy, provider = _make_provider_spy(monkeypatch)

    r = client.put(
        f"/api/v1/airports/{apt['id']}/safety-zones/{zone['id']}",
        json={"is_active": False},
    )
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    assert create_spy.call_count == 0
    assert provider.get_elevation.call_count == 0
