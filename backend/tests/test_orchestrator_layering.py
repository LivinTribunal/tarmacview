"""tests for the layered phase-5 trajectory assembly.

verifies the structural claim of issue #294 part A:
    core_waypoints                   = MEASUREMENTS_ONLY output
    + transit bookends               = FULL output
"""

from sqlalchemy import text

from tests.data.trajectory import (
    DEFAULT_LANDING,
    DEFAULT_TAKEOFF,
    TRAJECTORY_AGL_PAYLOAD,
    TRAJECTORY_AIRPORT_PAYLOAD,
    TRAJECTORY_DRONE_PAYLOAD,
    TRAJECTORY_SURFACE_PAYLOAD,
    make_lha_payload,
)


def _setup_two_inspection_mission(client, icao: str, scope: str):
    """create an airport + 2-inspection mission and return its id."""
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao},
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

    for i in range(1, 4):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        )

    template1 = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Layer Tpl A {icao}",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": 3},
        },
    ).json()
    template2 = client.post(
        "/api/v1/inspection-templates",
        json={
            "name": f"Layer Tpl B {icao}",
            "methods": ["HORIZONTAL_RANGE"],
            "target_agl_ids": [agl["id"]],
            "default_config": {"measurement_density": 3},
        },
    ).json()

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission_payload = {
        "name": f"Layer Mission {icao}",
        "airport_id": airport_id,
        "drone_profile_id": drone["id"],
        "default_speed": 5.0,
        "transit_agl": 10.0,
        "flight_plan_scope": scope,
        "takeoff_coordinate": DEFAULT_TAKEOFF,
        "landing_coordinate": DEFAULT_LANDING,
    }
    mission = client.post("/api/v1/missions", json=mission_payload).json()
    mission_id = mission["id"]

    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template1["id"], "method": "HORIZONTAL_RANGE"},
    )
    client.post(
        f"/api/v1/missions/{mission_id}/inspections",
        json={"template_id": template2["id"], "method": "HORIZONTAL_RANGE"},
    )

    return mission_id


def _generate_and_get_waypoints(client, mission_id: str):
    """generate trajectory + return list of waypoints (already sorted)."""
    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = client.get(f"/api/v1/missions/{mission_id}/flight-plan").json()
    return fp["waypoints"]


def test_measurements_only_core_is_only_measurement_hover_transit(client):
    """MEASUREMENTS_ONLY output is the layered "core": passes + inter-pass A* transits."""
    mid = _setup_two_inspection_mission(client, "ZLAY", "MEASUREMENTS_ONLY")
    wps = _generate_and_get_waypoints(client, mid)

    types = [wp["waypoint_type"] for wp in wps]
    assert all(t in ("MEASUREMENT", "HOVER", "TRANSIT") for t in types)
    assert "TAKEOFF" not in types
    assert "LANDING" not in types
    # core never starts/ends with a TRANSIT - first/last are pass boundaries
    assert types[0] in ("MEASUREMENT", "HOVER")
    assert types[-1] in ("MEASUREMENT", "HOVER")
    # at least one inter-pass transit between the two passes
    assert "TRANSIT" in types


def test_full_layered_starts_and_ends_with_transit_bookend(client):
    """FULL wraps the core with at-altitude TRANSIT bookends."""
    mid = _setup_two_inspection_mission(client, "ZLAB", "FULL")
    wps = _generate_and_get_waypoints(client, mid)

    types = [wp["waypoint_type"] for wp in wps]
    assert types[0] == "TRANSIT"
    assert types[-1] == "TRANSIT"
    assert "TAKEOFF" not in types
    assert "LANDING" not in types
    # a multi-pass mission has the core's MEASUREMENT/HOVER waypoints inside
    assert any(t in ("MEASUREMENT", "HOVER") for t in types)


def test_measurement_waypoints_match_across_scopes(client):
    """the same measurement waypoints appear in both scopes (modulo bookends)."""
    mo_id = _setup_two_inspection_mission(client, "ZLMM", "MEASUREMENTS_ONLY")
    nt_id = _setup_two_inspection_mission(client, "ZLNN", "FULL")

    mo = _generate_and_get_waypoints(client, mo_id)
    nt = _generate_and_get_waypoints(client, nt_id)

    def _measurement_signature(wps):
        """return list of (lat, lon) for MEASUREMENT/HOVER waypoints."""
        return [
            (wp["position"]["coordinates"][1], wp["position"]["coordinates"][0])
            for wp in wps
            if wp["waypoint_type"] in ("MEASUREMENT", "HOVER")
        ]

    mo_sig = _measurement_signature(mo)
    nt_sig = _measurement_signature(nt)

    assert mo_sig, "MEASUREMENTS_ONLY produced no measurement waypoints"
    assert mo_sig == nt_sig


def test_measurements_only_is_strict_subset_of_full(client):
    """issue #405: MEASUREMENTS_ONLY is a contiguous byte-for-byte slice of FULL.

    both scopes share one canonical core (MH-only passes joined by
    `compute_inter_pass_transits` between MH boundaries). FULL wraps the core with
    transit-altitude bookends. with no intra-pass TRANSITs from the
    HORIZONTAL_RANGE method, the MEASUREMENTS_ONLY waypoint list appears
    verbatim inside FULL.
    """
    mo_id = _setup_two_inspection_mission(client, "ZSMO", "MEASUREMENTS_ONLY")
    nt_id = _setup_two_inspection_mission(client, "ZSNT", "FULL")

    mo = _generate_and_get_waypoints(client, mo_id)
    nt = _generate_and_get_waypoints(client, nt_id)

    def _signature(wps):
        """tuple of (type, lon, lat, alt) per waypoint - exact-equality comparable."""
        return [
            (
                wp["waypoint_type"],
                wp["position"]["coordinates"][0],
                wp["position"]["coordinates"][1],
                wp["position"]["coordinates"][2],
            )
            for wp in wps
        ]

    mo_sig = _signature(mo)
    nt_sig = _signature(nt)

    def _find_contiguous_slice(needle, haystack):
        """index of the first contiguous occurrence of needle in haystack, or -1."""
        if not needle:
            return -1
        n, m = len(needle), len(haystack)
        for start in range(m - n + 1):
            if haystack[start : start + n] == needle:
                return start
        return -1

    mo_in_nt = _find_contiguous_slice(mo_sig, nt_sig)
    assert mo_in_nt >= 0, "MEASUREMENTS_ONLY is not a contiguous slice of FULL"


def test_assemble_core_calls_compute_transit_path_only_for_bookends(client, monkeypatch):
    """issue #405: compute_transit_path is the bookend-only A* after the refactor.

    inter-pass connections always go through `compute_inter_pass_transits`. for
    NTL the only `compute_transit_path` calls are the two bookend builders.
    """
    import app.services.trajectory.orchestrator as orch

    bookend_calls: list[tuple[float, float, float, float]] = []
    real_fn = orch.compute_transit_path

    def _spy(from_pt, to_pt, *args, **kwargs):
        """record bookend A* invocations and delegate to the real implementation."""
        bookend_calls.append((from_pt.lon, from_pt.lat, to_pt.lon, to_pt.lat))
        return real_fn(from_pt, to_pt, *args, **kwargs)

    monkeypatch.setattr(orch, "compute_transit_path", _spy)

    nt_id = _setup_two_inspection_mission(client, "ZSCT", "FULL")
    gen = client.post(f"/api/v1/missions/{nt_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text

    # exactly two bookend calls: takeoff bookend + landing bookend
    assert len(bookend_calls) == 2, f"expected 2 bookend calls, got {len(bookend_calls)}"


def _setup_three_inspection_mission(client, icao: str):
    """create a 3-inspection MEASUREMENTS_ONLY mission and return ids.

    middle inspection is created with a measurement_density override of 1 so it
    has its own InspectionConfiguration row that the test can later mutate via
    raw SQL to force density=0.
    """
    airport = client.post(
        "/api/v1/airports",
        json={**TRAJECTORY_AIRPORT_PAYLOAD, "icao_code": icao},
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

    for i in range(1, 4):
        client.post(
            f"/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl['id']}/lhas",
            json=make_lha_payload(i),
        )

    templates = []
    for letter in ("A", "B", "C"):
        tpl = client.post(
            "/api/v1/inspection-templates",
            json={
                "name": f"Empty Mid Tpl {letter} {icao}",
                "methods": ["HORIZONTAL_RANGE"],
                "target_agl_ids": [agl["id"]],
                "default_config": {"measurement_density": 3},
            },
        ).json()
        templates.append(tpl)

    drone = client.post("/api/v1/drone-profiles", json=TRAJECTORY_DRONE_PAYLOAD).json()

    mission = client.post(
        "/api/v1/missions",
        json={
            "name": f"Empty Mid Mission {icao}",
            "airport_id": airport_id,
            "drone_profile_id": drone["id"],
            "default_speed": 5.0,
            "transit_agl": 10.0,
            "flight_plan_scope": "MEASUREMENTS_ONLY",
            "takeoff_coordinate": DEFAULT_TAKEOFF,
            "landing_coordinate": DEFAULT_LANDING,
        },
    ).json()
    mission_id = mission["id"]

    inspection_ids: list[str] = []
    for idx, tpl in enumerate(templates):
        body: dict = {"template_id": tpl["id"], "method": "HORIZONTAL_RANGE"}
        # middle inspection gets its own config row so the test can force density=0
        if idx == 1:
            body["config"] = {"measurement_density": 1}
        inspection_ids.append(
            client.post(
                f"/api/v1/missions/{mission_id}/inspections",
                json=body,
            ).json()["id"]
        )

    return mission_id, inspection_ids


def _force_density_zero(db_session, inspection_id: str) -> None:
    """bypass the schema floor and set the inspection's measurement_density to 0."""
    db_session.execute(
        text(
            "UPDATE inspection_configuration SET measurement_density = 0 "
            "WHERE id = (SELECT config_id FROM inspection WHERE id = :iid)"
        ),
        {"iid": inspection_id},
    )
    db_session.commit()


def test_empty_middle_pass_does_not_misalign_transits(client, db_session):
    """forcing the middle inspection to density=0 drops it; the surviving transit
    pairs pass-1.last_mh -> pass-3.first_mh, not pass-1 -> pass-2 or pass-2 -> pass-3.
    """
    mission_id, inspection_ids = _setup_three_inspection_mission(client, "ZLEM")
    _force_density_zero(db_session, inspection_ids[1])

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text
    fp = client.get(f"/api/v1/missions/{mission_id}/flight-plan").json()
    waypoints = fp["waypoints"]

    # no waypoint belongs to the dropped inspection
    seen_inspection_ids = {wp.get("inspection_id") for wp in waypoints}
    assert inspection_ids[1] not in seen_inspection_ids

    # both surviving inspections produced waypoints
    assert inspection_ids[0] in seen_inspection_ids
    assert inspection_ids[2] in seen_inspection_ids

    # exactly one inter-pass transit (single TRANSIT block between the two passes)
    types = [wp["waypoint_type"] for wp in waypoints]
    transit_indices = [i for i, t in enumerate(types) if t == "TRANSIT"]
    assert transit_indices, "expected at least one TRANSIT waypoint between surviving passes"

    # transit waypoints sit strictly between the last MH of pass-1 and the first MH of pass-3
    pass1_indices = [
        i
        for i, wp in enumerate(waypoints)
        if wp.get("inspection_id") == inspection_ids[0]
        and wp["waypoint_type"] in ("MEASUREMENT", "HOVER")
    ]
    pass3_indices = [
        i
        for i, wp in enumerate(waypoints)
        if wp.get("inspection_id") == inspection_ids[2]
        and wp["waypoint_type"] in ("MEASUREMENT", "HOVER")
    ]
    assert pass1_indices and pass3_indices
    assert max(pass1_indices) < min(transit_indices)
    assert max(transit_indices) < min(pass3_indices)

    # transit's last waypoint is at pass-3 first MH lon/lat (fast-path single-wp transit
    # rule: destination at to_point), and the next MH waypoint lon/lat matches.
    last_transit_wp = waypoints[transit_indices[-1]]
    pass3_first = waypoints[min(pass3_indices)]
    assert (
        last_transit_wp["position"]["coordinates"][0] == pass3_first["position"]["coordinates"][0]
    )
    assert (
        last_transit_wp["position"]["coordinates"][1] == pass3_first["position"]["coordinates"][1]
    )


def test_empty_pass_emits_warning(client, db_session):
    """dropping an empty pass surfaces a warning that names the inspection label."""
    mission_id, inspection_ids = _setup_three_inspection_mission(client, "ZLEW")
    _force_density_zero(db_session, inspection_ids[1])

    gen = client.post(f"/api/v1/missions/{mission_id}/generate-trajectory")
    assert gen.status_code == 200, gen.text

    fp = client.get(f"/api/v1/missions/{mission_id}/flight-plan").json()
    messages = [v["message"] for v in fp["validation_result"]["violations"]]
    # template B is the middle inspection (sequence_order=2)
    assert any("empty pass dropped" in m and "#2" in m for m in messages), messages
