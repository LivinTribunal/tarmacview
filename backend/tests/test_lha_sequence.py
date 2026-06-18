"""end-to-end tests for per-AGL LHA sequence_number invariants.

covers auto-assign on create, explicit-on-create shift, update shift up/down,
no-op, out-of-range rejection, density after several reorderings, bulk-generate
sequence assignment, delete-keeps-dense, and the full-row PAPI reverse flip.
"""

from tests.data.airports import AGL_PAYLOAD, AIRPORT_PAYLOAD, LHA_PAYLOAD, SURFACE_PAYLOAD

DESIGNATORS = ["A", "B", "C", "D"]


def _setup(client, icao: str, count: int = 4, agl_type: str = "PAPI"):
    """create airport + surface + agl + N lhas; returns base url and lha list."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": icao},
    ).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "agl_type": agl_type, "name": "agl"},
    ).json()

    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"
    lhas = []
    for i in range(count):
        if agl_type == "PAPI":
            designator = DESIGNATORS[i]
            payload = {**LHA_PAYLOAD, "unit_designator": designator}
        else:
            designator = str(i + 1)
            payload = {**LHA_PAYLOAD, "unit_designator": designator, "setting_angle": 0.0}
        r = client.post(base, json=payload)
        assert r.status_code == 201
        lhas.append(r.json())
    return base, lhas


def _seqs(client, base):
    """fetch and return the sorted list of (sequence_number, designator) pairs."""
    rows = client.get(base).json()["data"]
    return sorted([(r["sequence_number"], r["unit_designator"]) for r in rows])


def test_create_lha_auto_assigns_next_sequence(client):
    """first LHA gets 1, second gets 2, third gets 3."""
    base, lhas = _setup(client, "LXSA", count=3)
    seqs = sorted(lha["sequence_number"] for lha in lhas)
    assert seqs == [1, 2, 3]


def test_create_lha_with_explicit_sequence_shifts_existing(client):
    """inserting a new LHA at sequence 2 shifts existing 2 and 3 up by one.

    uses RUNWAY_EDGE_LIGHTS so unit_designator stays the user-provided string;
    PAPI relabel-on-shift has its own coverage below.
    """
    base, lhas = _setup(client, "LXSB", count=3, agl_type="RUNWAY_EDGE_LIGHTS")

    # add a 4th LHA, but explicitly request sequence 2
    r = client.post(
        base,
        json={
            **LHA_PAYLOAD,
            "unit_designator": "NEW",
            "sequence_number": 2,
            "setting_angle": 0.0,
        },
    )
    assert r.status_code == 201

    rows = client.get(base).json()["data"]
    assert len(rows) == 4
    by_seq = {r["sequence_number"]: r["unit_designator"] for r in rows}
    # original sequence 1 ("1") stays; new "NEW" occupies 2; old 2 ("2") and 3 ("3")
    # shift to 3 and 4
    assert by_seq == {1: "1", 2: "NEW", 3: "2", 4: "3"}


def test_update_lha_shift_up(client):
    """move LHA from sequence 4 to sequence 2; siblings 2,3 shift to 3,4."""
    base, lhas = _setup(client, "LXSC", count=4)
    moving = next(lha for lha in lhas if lha["sequence_number"] == 4)

    r = client.put(f"{base}/{moving['id']}", json={"sequence_number": 2})
    assert r.status_code == 200
    assert r.json()["sequence_number"] == 2

    # rebuild map by current sequence_number
    rows = client.get(base).json()["data"]
    by_seq = {r["sequence_number"]: r["id"] for r in rows}
    # moving lha now at 2, the lhas previously at 2 and 3 are at 3 and 4
    seq_2_id = by_seq[2]
    assert seq_2_id == moving["id"]
    assert {1, 2, 3, 4} == set(by_seq.keys())


def test_update_lha_shift_down(client):
    """move LHA from sequence 1 to sequence 3; siblings 2,3 shift to 1,2."""
    base, lhas = _setup(client, "LXSD", count=4)
    moving = next(lha for lha in lhas if lha["sequence_number"] == 1)

    r = client.put(f"{base}/{moving['id']}", json={"sequence_number": 3})
    assert r.status_code == 200
    assert r.json()["sequence_number"] == 3

    rows = client.get(base).json()["data"]
    by_seq = {r["sequence_number"]: r["id"] for r in rows}
    assert by_seq[3] == moving["id"]
    assert {1, 2, 3, 4} == set(by_seq.keys())


def test_update_lha_same_value_noop(client):
    """setting sequence_number to its current value leaves siblings untouched."""
    base, lhas = _setup(client, "LXSE", count=3)
    target = next(lha for lha in lhas if lha["sequence_number"] == 2)

    r = client.put(f"{base}/{target['id']}", json={"sequence_number": 2})
    assert r.status_code == 200

    rows = client.get(base).json()["data"]
    by_id = {row["id"]: row["sequence_number"] for row in rows}
    for lha in lhas:
        assert by_id[lha["id"]] == lha["sequence_number"]


def test_update_lha_out_of_range_rejected(client):
    """values < 1 or > N are 4xx errors."""
    base, lhas = _setup(client, "LXSF", count=3)
    target = lhas[0]

    # < 1 is rejected at the schema layer (Field ge=1)
    r = client.put(f"{base}/{target['id']}", json={"sequence_number": 0})
    assert 400 <= r.status_code < 500

    # > N is rejected at the service layer
    r = client.put(f"{base}/{target['id']}", json={"sequence_number": 99})
    assert 400 <= r.status_code < 500


def test_sequence_dense_after_shift(client):
    """sequence is dense 1..N with no duplicates after several reorderings."""
    base, lhas = _setup(client, "LXSG", count=4)

    # several shifts in a row
    r = client.put(f"{base}/{lhas[0]['id']}", json={"sequence_number": 4})
    assert r.status_code == 200
    r = client.put(f"{base}/{lhas[1]['id']}", json={"sequence_number": 1})
    assert r.status_code == 200
    r = client.put(f"{base}/{lhas[3]['id']}", json={"sequence_number": 2})
    assert r.status_code == 200

    rows = client.get(base).json()["data"]
    seqs = sorted(row["sequence_number"] for row in rows)
    assert seqs == [1, 2, 3, 4]


def test_bulk_generate_assigns_sequential_numbers(client):
    """bulk-generated LHAs get monotonically increasing sequence numbers."""
    apt = client.post(
        "/api/v1/airports",
        json={**AIRPORT_PAYLOAD, "icao_code": "LXBS"},
    ).json()
    surface = client.post(f"/api/v1/airports/{apt['id']}/surfaces", json=SURFACE_PAYLOAD).json()
    agl = client.post(
        f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls",
        json={**AGL_PAYLOAD, "agl_type": "RUNWAY_EDGE_LIGHTS", "name": "edge-lights"},
    ).json()
    base = f"/api/v1/airports/{apt['id']}/surfaces/{surface['id']}/agls/{agl['id']}/lhas"

    body = {
        "first_position": {"type": "Point", "coordinates": [14.2700, 50.1000, 380.0]},
        "last_position": {"type": "Point", "coordinates": [14.2706, 50.1000, 380.0]},
        "spacing_m": 10.0,
    }
    r = client.post(f"{base}/bulk", json=body)
    assert r.status_code == 201
    generated = r.json()["generated"]
    seqs = [lha["sequence_number"] for lha in generated]
    assert seqs == list(range(1, len(generated) + 1))


def test_delete_lha_keeps_sequence_dense(client):
    """deleting an LHA shifts higher sequence_numbers down to keep 1..N dense."""
    base, lhas = _setup(client, "LXSH", count=4)
    by_seq = {lha["sequence_number"]: lha for lha in lhas}

    # delete the row at sequence 2
    r = client.delete(f"{base}/{by_seq[2]['id']}")
    assert r.status_code == 200

    rows = client.get(base).json()["data"]
    assert len(rows) == 3
    seqs = sorted(row["sequence_number"] for row in rows)
    assert seqs == [1, 2, 3]


# PAPI letter ↔ sequence_number coupling


def test_papi_sequence_change_relabels_letters(client):
    """PAPI: changing sequence_number rewrites unit_designator to match (1=A..4=D)."""
    base, lhas = _setup(client, "LZPI", count=4)
    moving = next(lha for lha in lhas if lha["sequence_number"] == 2)

    r = client.put(f"{base}/{moving['id']}", json={"sequence_number": 4})
    assert r.status_code == 200

    assert _seqs(client, base) == [(1, "A"), (2, "B"), (3, "C"), (4, "D")]
    body = client.get(base).json()["data"]
    by_id = {row["id"]: row for row in body}
    assert by_id[moving["id"]]["sequence_number"] == 4
    assert by_id[moving["id"]]["unit_designator"] == "D"


def test_papi_letter_change_routes_through_sequence_shift(client):
    """PAPI: PUT unit_designator translates to a sequence shift; siblings relabel."""
    base, lhas = _setup(client, "LZPJ", count=4)
    moving = next(lha for lha in lhas if lha["sequence_number"] == 2)  # was labelled B

    r = client.put(f"{base}/{moving['id']}", json={"unit_designator": "D"})
    assert r.status_code == 200
    assert r.json()["sequence_number"] == 4
    assert r.json()["unit_designator"] == "D"

    # invariant: letters are dense A,B,C,D and follow sequence everywhere
    assert _seqs(client, base) == [(1, "A"), (2, "B"), (3, "C"), (4, "D")]


def test_papi_invalid_letter_rejected(client):
    """PAPI: only A-D accepted as unit_designator."""
    base, lhas = _setup(client, "LZPK", count=4)
    target = lhas[0]
    r = client.put(f"{base}/{target['id']}", json={"unit_designator": "Z"})
    assert r.status_code == 422


def test_papi_conflicting_letter_and_sequence_rejected(client):
    """PAPI: sending both unit_designator and a contradictory sequence_number is 422."""
    base, lhas = _setup(client, "LZPL", count=4)
    target = lhas[0]  # currently A / seq 1

    # "C" maps to seq 3; sending seq=1 alongside is contradictory
    r = client.put(
        f"{base}/{target['id']}",
        json={"unit_designator": "C", "sequence_number": 1},
    )
    assert r.status_code == 422


def test_papi_delete_relabels_remaining(client):
    """PAPI: deleting middle LHA closes the gap and relabels survivors A..N."""
    base, lhas = _setup(client, "LZPM", count=4)
    by_seq = {lha["sequence_number"]: lha for lha in lhas}

    r = client.delete(f"{base}/{by_seq[2]['id']}")
    assert r.status_code == 200

    assert _seqs(client, base) == [(1, "A"), (2, "B"), (3, "C")]


def test_non_papi_unit_designator_still_freeform(client):
    """RUNWAY_EDGE_LIGHTS: unit_designator stays user-controlled, sequence untouched."""
    base, lhas = _setup(client, "LZPV", count=3, agl_type="RUNWAY_EDGE_LIGHTS")
    target = lhas[0]
    original_seq = target["sequence_number"]

    r = client.put(f"{base}/{target['id']}", json={"unit_designator": "FOO"})
    assert r.status_code == 200
    body = r.json()
    assert body["unit_designator"] == "FOO"
    assert body["sequence_number"] == original_seq


# PAPI reverse numbering (A,B,C,D -> D,C,B,A)


def test_reverse_papi_flips_designators(client):
    """reverse flips A,B,C,D -> D,C,B,A; sequence stays dense, letters aligned."""
    base, lhas = _setup(client, "LRVA", count=4)
    a_id = next(lha["id"] for lha in lhas if lha["unit_designator"] == "A")
    d_id = next(lha["id"] for lha in lhas if lha["unit_designator"] == "D")

    r = client.post(f"{base}/reverse")
    assert r.status_code == 200
    # the reverse response returns the reordered list, dense + aligned
    data = r.json()["data"]
    assert [(row["sequence_number"], row["unit_designator"]) for row in data] == [
        (1, "A"),
        (2, "B"),
        (3, "C"),
        (4, "D"),
    ]

    # refetch confirms the invariant holds in the db
    assert _seqs(client, base) == [(1, "A"), (2, "B"), (3, "C"), (4, "D")]

    rows = client.get(base).json()["data"]
    by_id = {row["id"]: row for row in rows}
    # the light that started as A (seq 1) is now D (seq 4) and vice versa
    assert by_id[a_id]["sequence_number"] == 4
    assert by_id[a_id]["unit_designator"] == "D"
    assert by_id[d_id]["sequence_number"] == 1
    assert by_id[d_id]["unit_designator"] == "A"


def test_reverse_preserves_physical_attributes(client):
    """reverse moves only sequence/designator; physical columns ride with the id."""
    base, lhas = _setup(client, "LRVB", count=4)

    # give each light a distinct setting_angle + tolerance so we can track it
    attrs = {}
    for i, lha in enumerate(lhas):
        r = client.put(
            f"{base}/{lha['id']}",
            json={"setting_angle": 2.5 + i, "tolerance": 0.1 + i * 0.05},
        )
        assert r.status_code == 200
        body = r.json()
        attrs[lha["id"]] = {
            "setting_angle": body["setting_angle"],
            "tolerance": body["tolerance"],
            "position": body["position"],
            "lamp_type": body["lamp_type"],
        }

    r = client.post(f"{base}/reverse")
    assert r.status_code == 200

    rows = client.get(base).json()["data"]
    by_id = {row["id"]: row for row in rows}
    for lid, expected in attrs.items():
        assert by_id[lid]["setting_angle"] == expected["setting_angle"]
        assert by_id[lid]["tolerance"] == expected["tolerance"]
        assert by_id[lid]["position"] == expected["position"]
        assert by_id[lid]["lamp_type"] == expected["lamp_type"]


def test_reverse_double_is_identity(client):
    """reversing twice restores the original per-id numbering."""
    base, lhas = _setup(client, "LRVD", count=4)
    before = {lha["id"]: lha["sequence_number"] for lha in lhas}

    assert client.post(f"{base}/reverse").status_code == 200
    assert client.post(f"{base}/reverse").status_code == 200

    rows = client.get(base).json()["data"]
    after = {row["id"]: row["sequence_number"] for row in rows}
    assert after == before
    assert _seqs(client, base) == [(1, "A"), (2, "B"), (3, "C"), (4, "D")]


def test_reverse_non_papi_rejected(client):
    """reverse on a non-PAPI agl is rejected with 422."""
    base, lhas = _setup(client, "LRVE", count=3, agl_type="RUNWAY_EDGE_LIGHTS")
    r = client.post(f"{base}/reverse")
    assert r.status_code == 422


def test_reverse_two_lights(client):
    """reverse works with exactly two lights: A,B -> the lights swap labels."""
    base, lhas = _setup(client, "LRVF", count=2)
    a_id = next(lha["id"] for lha in lhas if lha["unit_designator"] == "A")
    b_id = next(lha["id"] for lha in lhas if lha["unit_designator"] == "B")

    r = client.post(f"{base}/reverse")
    assert r.status_code == 200

    assert _seqs(client, base) == [(1, "A"), (2, "B")]
    rows = client.get(base).json()["data"]
    by_id = {row["id"]: row for row in rows}
    assert by_id[a_id]["sequence_number"] == 2
    assert by_id[a_id]["unit_designator"] == "B"
    assert by_id[b_id]["sequence_number"] == 1
    assert by_id[b_id]["unit_designator"] == "A"
