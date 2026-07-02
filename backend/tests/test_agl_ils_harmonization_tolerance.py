"""AGL ils-harmonization-tolerance: coordinator-edited ground truth (PAPI-only)."""

from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, SURFACE_PAYLOAD


def _make_surface(client, icao):
    """create an airport + surface and return both json bodies."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    return apt, surface


def test_create_papi_agl_persists_ils_tolerance(client):
    """a PAPI AGL stores and returns its ils_harmonization_tolerance."""
    apt, surface = _make_surface(client, "LZWA")
    payload = {**AGL_PAYLOAD, "ils_harmonization_tolerance": 0.03}
    r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=payload)
    assert r.status_code == 201
    assert r.json()["ils_harmonization_tolerance"] == 0.03


def test_update_agl_ils_tolerance(client):
    """updating the AGL edits its ils tolerance - the coordinator edit flow."""
    apt, surface = _make_surface(client, "LZWB")
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=AGL_PAYLOAD
    ).json()
    r = client.put(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}",
        json={"ils_harmonization_tolerance": 0.08},
    )
    assert r.status_code == 200
    assert r.json()["ils_harmonization_tolerance"] == 0.08


def test_ils_tolerance_rejects_non_positive(client):
    """tolerance must be strictly positive (gt 0)."""
    apt, surface = _make_surface(client, "LZWC")
    for value in (0, -0.05):
        payload = {**AGL_PAYLOAD, "ils_harmonization_tolerance": value}
        r = client.post(f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls", json=payload)
        assert r.status_code == 422
