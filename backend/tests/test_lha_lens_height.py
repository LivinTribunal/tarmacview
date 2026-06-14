"""LHA lens-height columns: PAPI carries msl/agl, non-PAPI is forced null."""

from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, LHA_PAYLOAD, SURFACE_PAYLOAD


def _make_agl(client, icao: str, agl_type: str) -> tuple[str, str]:
    """create airport + surface + agl of the given type; return (apt_id, lha_base_url)."""
    apt = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao}).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "agl_type": agl_type, "name": "agl"},
    ).json()
    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"
    return apt["id"], base


def test_papi_lha_persists_lens_height(client):
    """PAPI LHA create + response carry both lens-height fields."""
    _, base = _make_agl(client, "LXHA", "PAPI")
    r = client.post(
        base,
        json={
            **LHA_PAYLOAD,
            "unit_designator": "A",
            "lens_height_msl_m": 325.3,
            "lens_height_agl_m": 25.3,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["lens_height_msl_m"] == 325.3
    assert body["lens_height_agl_m"] == 25.3


def test_papi_lha_update_lens_height(client):
    """updating lens-height on a PAPI LHA persists the new values."""
    _, base = _make_agl(client, "LXHB", "PAPI")
    created = client.post(base, json={**LHA_PAYLOAD, "unit_designator": "A"}).json()
    assert created["lens_height_msl_m"] is None

    r = client.put(
        f"{base}/{created['id']}",
        json={"lens_height_msl_m": 410.0, "lens_height_agl_m": 12.5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lens_height_msl_m"] == 410.0
    assert body["lens_height_agl_m"] == 12.5


def test_non_papi_lha_forces_lens_height_null_on_create(client):
    """lens-height is PAPI-only - non-PAPI create nulls any supplied values."""
    _, base = _make_agl(client, "LXHC", "RUNWAY_EDGE_LIGHTS")
    r = client.post(
        base,
        json={
            **LHA_PAYLOAD,
            "unit_designator": "1",
            "setting_angle": 0.0,
            "lens_height_msl_m": 325.3,
            "lens_height_agl_m": 25.3,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["lens_height_msl_m"] is None
    assert body["lens_height_agl_m"] is None


def test_non_papi_lha_forces_lens_height_null_on_update(client):
    """updating a non-PAPI LHA with lens-height keeps both null."""
    _, base = _make_agl(client, "LXHD", "RUNWAY_EDGE_LIGHTS")
    created = client.post(
        base, json={**LHA_PAYLOAD, "unit_designator": "1", "setting_angle": 0.0}
    ).json()

    r = client.put(
        f"{base}/{created['id']}",
        json={"lens_height_msl_m": 410.0, "lens_height_agl_m": 12.5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lens_height_msl_m"] is None
    assert body["lens_height_agl_m"] is None
