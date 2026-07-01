"""AGL surveyed meht_height_m: coordinator-edited per-PAPI eye height over threshold."""

from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, SURFACE_PAYLOAD


def _make_surface(client, icao):
    """create an airport + surface and return both json bodies."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    return apt, surface


def test_create_papi_agl_persists_meht_height(client):
    """a PAPI AGL stores and returns its surveyed meht_height_m."""
    apt, surface = _make_surface(client, "LZMH")
    payload = {**AGL_PAYLOAD, "meht_height_m": 15.5}
    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=payload)
    assert r.status_code == 201
    assert r.json()["meht_height_m"] == 15.5


def test_meht_height_defaults_to_null(client):
    """omitting meht_height_m leaves it null (derived at trajectory time)."""
    apt, surface = _make_surface(client, "LZMI")
    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=AGL_PAYLOAD)
    assert r.status_code == 201
    assert r.json()["meht_height_m"] is None


def test_update_agl_meht_height(client):
    """updating the AGL edits its surveyed meht_height_m - the coordinator edit flow."""
    apt, surface = _make_surface(client, "LZMJ")
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=AGL_PAYLOAD
    ).json()
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}",
        json={"meht_height_m": 17.25},
    )
    assert r.status_code == 200
    assert r.json()["meht_height_m"] == 17.25
