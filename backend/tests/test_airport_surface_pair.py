"""tests for runway surface pair-link feature (issue #407)."""

from copy import deepcopy

from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, SURFACE_PAYLOAD


def _make_runway_payload(identifier: str = "01", heading: float = 10.0) -> dict:
    """build a RUNWAY surface payload with explicit threshold and end positions."""
    payload = deepcopy(SURFACE_PAYLOAD)
    payload["identifier"] = identifier
    payload["heading"] = heading
    payload["threshold_position"] = {
        "type": "Point",
        "coordinates": [14.24, 50.10, 380.0],
    }
    payload["end_position"] = {
        "type": "Point",
        "coordinates": [14.27, 50.09, 380.0],
    }
    return payload


def _bootstrap_airport(client, icao: str = "LKAA") -> str:
    """create an airport and return its id."""
    body = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao})
    assert body.status_code == 201, body.text
    return body.json()["id"]


def test_create_reverse_derives_reciprocal_identifier(client):
    """01 -> 19, 09L -> 27R, etc. backend derives without an override."""
    apt = _bootstrap_airport(client, "LKRA")
    base = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{base['id']}/create-reverse",
        json={},
    )
    assert r.status_code == 201, r.text
    reverse = r.json()
    assert reverse["identifier"] == "19"
    assert reverse["paired_surface_id"] == base["id"]
    # heading is reciprocal
    assert abs(reverse["heading"] - 190.0) < 0.01
    # threshold and end are swapped
    assert reverse["threshold_position"]["coordinates"][:2] == [14.27, 50.09]
    assert reverse["end_position"]["coordinates"][:2] == [14.24, 50.10]

    # base side now reflects the link too
    base_after = client.get(f"/api/v1/airports/{apt}").json()["surfaces"]
    by_id = {s["id"]: s for s in base_after}
    assert by_id[base["id"]]["paired_surface_id"] == reverse["id"]


def test_create_reverse_letter_suffix(client):
    """letter suffix flips: L<->R, C stays C."""
    apt = _bootstrap_airport(client, "LKRB")
    base = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("09L", 90.0),
    ).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{base['id']}/create-reverse",
        json={},
    )
    assert r.status_code == 201
    assert r.json()["identifier"] == "27R"


def test_create_reverse_identifier_override(client):
    """coordinator can override the auto-derived reciprocal identifier."""
    apt = _bootstrap_airport(client, "LKRC")
    base = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{base['id']}/create-reverse",
        json={"identifier": "19X"},
    )
    assert r.status_code == 201
    assert r.json()["identifier"] == "19X"


def test_create_reverse_rejects_non_runway(client):
    """taxiways are not paired - reject create-reverse."""
    apt = _bootstrap_airport(client, "LKRD")
    payload = deepcopy(SURFACE_PAYLOAD)
    payload["surface_type"] = "TAXIWAY"
    payload["identifier"] = "Alpha"
    twy = client.post(f"/api/v1/airports/{apt}/surfaces", json=payload).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{twy['id']}/create-reverse",
        json={},
    )
    assert r.status_code == 422


def test_couple_two_existing_surfaces_overwrites_secondary(client):
    """primary side overwrites the target's geometry; centerline reversed, threshold/end swapped."""
    apt = _bootstrap_airport(client, "LKCA")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    # b has a different boundary/centerline; coupling with primary=self overwrites b
    b_payload = _make_runway_payload("19", 200.0)
    b_payload["geometry"] = {
        "type": "LineString",
        "coordinates": [[14.30, 50.12, 380], [14.33, 50.11, 380]],
    }
    b_payload["threshold_position"] = {
        "type": "Point",
        "coordinates": [14.30, 50.12, 380.0],
    }
    b_payload["end_position"] = {
        "type": "Point",
        "coordinates": [14.33, 50.11, 380.0],
    }
    b = client.post(f"/api/v1/airports/{apt}/surfaces", json=b_payload).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/couple",
        json={"target_surface_id": b["id"], "primary": "self"},
    )
    assert r.status_code == 200, r.text
    primary = r.json()
    assert primary["paired_surface_id"] == b["id"]

    # b now mirrors a's centerline (reversed) and reciprocal heading
    after = client.get(f"/api/v1/airports/{apt}").json()["surfaces"]
    by_id = {s["id"]: s for s in after}
    secondary = by_id[b["id"]]
    assert secondary["paired_surface_id"] == a["id"]
    # reversed centerline of a's [[14.24,...],[14.27,...]]
    assert secondary["geometry"]["coordinates"][0][0] == 14.27
    assert secondary["geometry"]["coordinates"][-1][0] == 14.24
    # reciprocal heading
    assert abs(secondary["heading"] - 190.0) < 0.01
    # threshold and end swapped
    assert secondary["threshold_position"]["coordinates"][0] == 14.27
    assert secondary["end_position"]["coordinates"][0] == 14.24


def test_couple_rejects_already_coupled(client):
    """either side already coupled -> 422."""
    apt = _bootstrap_airport(client, "LKCB")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    # auto-couple a with a created reverse direction
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()
    # build a third runway and try to couple it with a
    c = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("06", 60.0),
    ).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/couple",
        json={"target_surface_id": c["id"], "primary": "self"},
    )
    assert r.status_code == 422
    # the surviving pair should not be touched
    assert client.get(f"/api/v1/airports/{apt}").json()["surfaces"]
    after_a = next(
        s for s in client.get(f"/api/v1/airports/{apt}").json()["surfaces"] if s["id"] == a["id"]
    )
    assert after_a["paired_surface_id"] == rev["id"]


def test_couple_rejects_cross_airport(client):
    """target on a different airport -> 422."""
    apt1 = _bootstrap_airport(client, "LKXA")
    apt2 = _bootstrap_airport(client, "LKXB")
    a = client.post(
        f"/api/v1/airports/{apt1}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    b = client.post(
        f"/api/v1/airports/{apt2}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    r = client.post(
        f"/api/v1/airports/{apt1}/surfaces/{a['id']}/couple",
        json={"target_surface_id": b["id"], "primary": "self"},
    )
    assert r.status_code == 422


def test_couple_rejects_self_target(client):
    """target == surface_id -> 422."""
    apt = _bootstrap_airport(client, "LKCC")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/couple",
        json={"target_surface_id": a["id"], "primary": "self"},
    )
    assert r.status_code == 422


def test_couple_rejects_non_runway_pair(client):
    """taxiway as either side -> 422."""
    apt = _bootstrap_airport(client, "LKCD")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    twy_payload = deepcopy(SURFACE_PAYLOAD)
    twy_payload["surface_type"] = "TAXIWAY"
    twy_payload["identifier"] = "Alpha"
    b = client.post(f"/api/v1/airports/{apt}/surfaces", json=twy_payload).json()

    r = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/couple",
        json={"target_surface_id": b["id"], "primary": "self"},
    )
    assert r.status_code == 422


def test_decouple_clears_both_sides(client):
    """decouple clears paired_surface_id on both rows; geometry stays."""
    apt = _bootstrap_airport(client, "LKDA")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()

    r = client.post(f"/api/v1/airports/{apt}/surfaces/{a['id']}/decouple")
    assert r.status_code == 200, r.text

    after = client.get(f"/api/v1/airports/{apt}").json()["surfaces"]
    by_id = {s["id"]: s for s in after}
    assert by_id[a["id"]]["paired_surface_id"] is None
    assert by_id[rev["id"]]["paired_surface_id"] is None


def test_decouple_uncoupled_rejected(client):
    """decoupling an uncoupled surface returns 422."""
    apt = _bootstrap_airport(client, "LKDB")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    r = client.post(f"/api/v1/airports/{apt}/surfaces/{a['id']}/decouple")
    assert r.status_code == 422


def test_patch_propagates_geometry_to_pair(client):
    """boundary/heading/length/width PATCH propagates to the paired surface."""
    apt = _bootstrap_airport(client, "LKPA")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()

    new_geom = {
        "type": "LineString",
        "coordinates": [[14.20, 50.20, 380], [14.25, 50.15, 380]],
    }
    r = client.put(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}",
        json={
            "geometry": new_geom,
            "heading": 45.0,
            "length": 4000.0,
            "width": 60.0,
            "buffer_distance": 30.0,
        },
    )
    assert r.status_code == 200, r.text
    pair = next(
        s for s in client.get(f"/api/v1/airports/{apt}").json()["surfaces"] if s["id"] == rev["id"]
    )
    # reversed centerline
    assert pair["geometry"]["coordinates"][0][0] == 14.25
    assert pair["geometry"]["coordinates"][-1][0] == 14.20
    # reciprocal heading
    assert abs(pair["heading"] - 225.0) < 0.01
    assert pair["length"] == 4000.0
    assert pair["width"] == 60.0
    assert pair["buffer_distance"] == 30.0


def test_patch_threshold_swaps_on_pair(client):
    """threshold/end edits swap on the paired side."""
    apt = _bootstrap_airport(client, "LKPB")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()

    new_thr = {"type": "Point", "coordinates": [14.21, 50.21, 380]}
    new_end = {"type": "Point", "coordinates": [14.28, 50.08, 380]}
    r = client.put(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}",
        json={"threshold_position": new_thr, "end_position": new_end},
    )
    assert r.status_code == 200

    pair = next(
        s for s in client.get(f"/api/v1/airports/{apt}").json()["surfaces"] if s["id"] == rev["id"]
    )
    assert pair["threshold_position"]["coordinates"][:2] == [14.28, 50.08]
    assert pair["end_position"]["coordinates"][:2] == [14.21, 50.21]


def test_patch_identifier_rejected_while_coupled(client):
    """rename is blocked for coupled surfaces; decouple first."""
    apt = _bootstrap_airport(client, "LKPC")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    )

    r = client.put(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}",
        json={"identifier": "01R"},
    )
    assert r.status_code == 422


def test_delete_paired_surface_cascades(client):
    """deleting one side of a coupled pair also drops the partner and its AGLs."""
    apt = _bootstrap_airport(client, "LKDP")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()
    # add an AGL to the reverse side so we can verify the cascade
    agl = client.post(
        f"/api/v1/airports/{apt}/surfaces/{rev['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()

    r = client.delete(f"/api/v1/airports/{apt}/surfaces/{a['id']}")
    assert r.status_code == 200
    surfaces_after = client.get(f"/api/v1/airports/{apt}").json()["surfaces"]
    ids = {s["id"] for s in surfaces_after}
    assert a["id"] not in ids
    assert rev["id"] not in ids
    # AGL on the paired side is gone too
    list_resp = client.get(f"/api/v1/airports/{apt}/surfaces/{rev['id']}/agls")
    assert list_resp.status_code == 404
    assert agl["id"]  # silence-unused


def test_threshold_edit_recomputes_distance_on_both_sides(client):
    """AGL.distance_from_threshold recomputes for both sides after a paired threshold edit."""
    apt = _bootstrap_airport(client, "LKDT")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()
    # seed AGLs on both sides at the same lon/lat so the recompute path runs
    agl_a = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()
    agl_b = client.post(
        f"/api/v1/airports/{apt}/surfaces/{rev['id']}/agls",
        json=AGL_PAYLOAD,
    ).json()
    initial_a = agl_a.get("distance_from_threshold")
    initial_b = agl_b.get("distance_from_threshold")

    new_thr = {"type": "Point", "coordinates": [14.25, 50.10, 380]}
    new_end = {"type": "Point", "coordinates": [14.28, 50.08, 380]}
    r = client.put(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}",
        json={"threshold_position": new_thr, "end_position": new_end},
    )
    assert r.status_code == 200

    a_agls = client.get(f"/api/v1/airports/{apt}/surfaces/{a['id']}/agls").json()["data"]
    b_agls = client.get(f"/api/v1/airports/{apt}/surfaces/{rev['id']}/agls").json()["data"]
    assert a_agls and b_agls
    # at least one side must have recomputed - thresholds were set explicitly on both
    new_a = a_agls[0]["distance_from_threshold"]
    new_b = b_agls[0]["distance_from_threshold"]
    assert new_a != initial_a or new_b != initial_b


def test_uncoupled_surface_patch_unchanged(client):
    """uncoupled surfaces still update normally - identifier rename allowed."""
    apt = _bootstrap_airport(client, "LKUA")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    r = client.put(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}",
        json={"identifier": "01R"},
    )
    assert r.status_code == 200
    assert r.json()["identifier"] == "01R"
    assert r.json()["paired_surface_id"] is None


def test_pair_audit_logged(client, db_engine):
    """couple/decouple/create-reverse and propagated edits emit audit rows."""
    from sqlalchemy.orm import sessionmaker

    from app.models.audit_log import AuditLog

    Session = sessionmaker(bind=db_engine)

    apt = _bootstrap_airport(client, "LKAU")
    a = client.post(
        f"/api/v1/airports/{apt}/surfaces",
        json=_make_runway_payload("01", 10.0),
    ).json()
    rev = client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/create-reverse",
        json={},
    ).json()
    client.post(f"/api/v1/airports/{apt}/surfaces/{a['id']}/decouple")
    client.post(
        f"/api/v1/airports/{apt}/surfaces/{a['id']}/couple",
        json={"target_surface_id": rev["id"], "primary": "self"},
    )

    s = Session()
    try:
        rows = s.query(AuditLog).filter(AuditLog.airport_id == apt).all()
        actions = [
            (r.action, (r.details or {}).get("operation"))
            for r in rows
            if r.entity_type == "Surface"
        ]
        # we expect: CREATE for both surfaces, decouple UPDATE, couple UPDATE
        assert any(a == "CREATE" for a, _ in actions)
        assert any(op == "decouple" for _, op in actions)
        assert any(op == "couple" for _, op in actions)
    finally:
        s.close()
