# Agent D3 — Mocked-test audit

Scope: walk every KMZ/WPML test in
`backend/tests/test_export_service.py` (and any related file) and flag
tests whose assertions ride on mocks instead of real exporter output —
mocked exporter, stubbed critical helpers (`_dji_enums_for`,
`_append_*`), `MagicMock` inputs so deep the assertion would pass on a
different code path, tautologies, or writer-direct tests that bypass the
orchestrator. Cross-referenced against the three audit docs
(`docs/kmz-wpml-audit.md`, `docs/audits/2026-05-15-dji-wpml-spec-audit.md`,
`docs/audits/2026-05-11-papi-altitude-camera-aim.md`) and Agent D1's
invariant-test map.

Sibling test file `backend/tests/test_schema_reexports.py` is unrelated
(import-shape guard for `app.schemas` re-exports) and not in scope.

## Headline

- The exporter itself is **never mocked**. `generate_kmz` /
  `generate_wpml` are called with real `app.services.export` code and
  every assertion (except where flagged below) reads the actual emitted
  byte string. The Pilot-2-rejection mechanism (XML the firmware reads
  and rejects) is therefore covered correctly: the test sees the same
  bytes the drone would.
- The exporter **inputs** are uniformly `MagicMock`. `_make_flight_plan`,
  `_make_waypoint`, `_make_mission_mock`, `_make_inspection_mock` and the
  drone-profile mock `_M4T_PROFILE` are pure `MagicMock` instances with
  hand-set attributes. No DB-backed Mission / FlightPlan / DroneProfile /
  Airport is ever materialised in the unit suite. This is acceptable for
  the writer-layer tests but means **mission-aggregate behaviour
  (`transition_to`, `regress_if_trajectory_changed`, ORM relationship
  loading) is not exercised by any KMZ test** — only the
  `TestExportMissionFormats` / `TestExportMissionGeozoneGate` blocks
  exercise that, and only via `_build_export_db_mock` (a
  `MagicMock(Session)` with hand-routed `query(Model)` returns).
- The orchestrator (`export_mission`) is bypassed by every byte-level
  KMZ/WPML assertion. Real production callers route through
  `export_mission` (transition gate, drone-profile lookup, audit row,
  flush); the writer-direct tests cannot catch a fix that lands in the
  orchestrator only. See "Orchestrator-bypass risk" below.
- The PAPI per-point elevation provider (audit
  `2026-05-11-papi-altitude-camera-aim` §2) is **not part of the export
  path** — the exporter takes `airport_elevation: float` as a scalar
  argument, not an `Airport` object. The "per-point elevation provider"
  contract lives upstream in `airport_service`; none of the KMZ tests
  mock or assert against `_normalize_position_altitude`,
  `create_elevation_provider`, or `egm96_undulation` in a way that would
  catch an export-time regression. (`test_egm96_undulation_helper_in_jaro_band`
  at line 2950 *does* pin the helper independently against the
  published EGM96 value at LZIB — that breaks the otherwise-tautological
  `msl_to_hae` chain below.)

## Counts

- Tests audited (TestGenerateKmz + TestDjiZeroIndexedReferences +
  TestDjiUseGlobalFlags + TestDjiBelowTakeoffClamp + TestDjiSpecConformance
  + TestDjiActionGroupIdRange + TestDjiTurnDampingClamp +
  TestDjiRelativeHeightExport + TestGenerateWpml + TestGenerateKmzCameraSettings
  + TestExportMissionFormats KMZ branches + TestGeozoneEmissionKmz):
  **148**
- Pinning quality:
  - **strong** (assertion reads real emitted XML against an
    independently-computable expected value): **136**
  - **weak** (assertion reads real emitted XML but the expected value is
    either re-derived from the same helper the writer uses, or asserts
    only a structural property that survives a wrong literal):
    **9**
  - **fake / tautological** (assertion would pass on a different code
    path; expected value is the value the test itself wrote;
    behaviour-of-the-mock test): **3**

## Table — flagged tests only

Tests not listed below were classified as **strong** pinning and not
re-recorded. The pinning quality column refers to the *audit invariant
the test is supposed to pin*, not to the test's structural soundness;
several weak-pinning tests are fine as far as they go but do not pin
what the audit doc claims they pin.

| Test name | File:Line | Mocking level | Pinning quality | Audit invariant it claims to pin |
|---|---|---|---|---|
| `TestDjiRelativeHeightExport.test_template_and_waylines_heights_are_mutually_consistent` | test_export_service.py:2907 | heavy (MagicMock mission, MagicMock fp) | **weak** (template `ellipsoidHeight` expected value is `msl_to_hae(...)` — same helper the writer calls; the assertion proves the writer routed through `msl_to_hae`, not that the result is geodetically correct) | `kmz-wpml-audit §12` — template `ellipsoidHeight` is true WGS84 HAE while `height` is relative |
| `TestGenerateKmz.test_template_placemark_height_is_relative_ellipsoid_is_hae` | test_export_service.py:472 | heavy (MagicMock fp) | **weak** (same pattern as above — `msl_to_hae(49.691, 18.111, 310.0)` is computed test-side and asserted in the writer output) | `2026-05-15 §1` / `kmz-wpml-audit §12` — template `ellipsoidHeight` is HAE |
| `TestGenerateKmz.test_take_off_ref_point_from_mission` | test_export_service.py:626 | heavy (MagicMock mission) | **weak** (expected `takeOffRefPoint` z is `msl_to_hae(...)` test-side; pins routing, not correctness) | `2026-05-15 §2` / `kmz-wpml-audit §11` — `takeOffRefPoint` z is HAE |
| `TestGenerateKmz.test_take_off_ref_point_falls_back_to_first_waypoint` | test_export_service.py:646 | heavy | **weak** (same `msl_to_hae` tautology as 626) | same as 626 |
| `TestGenerateKmz.test_kmz_measurements_only_structure` | test_export_service.py:1653 | heavy | **weak on the `takeOffRefPoint` z field only** (`msl_to_hae` tautology); strong on every other assertion in the same test | `kmz-wpml-audit §11`, `2026-05-15 §2` |
| `TestGenerateKmz.test_kmz_measurements_only_takeoff_ref_anchors_at_wp1_when_takeoff_coord_set` | test_export_service.py:1722 | heavy | **weak on z** (same `msl_to_hae` tautology); strong on lat/lon and exclusion of `48.000000` / `17.000000` | `kmz-wpml-audit §11` — MO anchors at WP1, not `mission.takeoff_coordinate` |
| `TestGenerateKmz.test_dji_enums_resolve_per_configured_drone` | test_export_service.py:1541 | heavy (`MagicMock` drone_profile with only `.model` set; `_dji_enums_for` is NOT stubbed) | **strong** — exercises the real `DJI_WPML_ENUMS` lookup. Flagged because a future reader might assume `_dji_enums_for` is stubbed; it isn't. | `2026-05-15 §3.1` / `kmz-wpml-audit §7` — drone/payload enum per model |
| `TestGenerateKmz.test_dji_enums_fallback_to_m4t_for_unmapped_drone` | test_export_service.py:1574 | heavy (calls `_dji_enums_for` directly on `MagicMock(model="...")`) | **strong** — exercises real `_dji_enums_for` and the `_M4T_FALLBACK_ENUM` constant. Imports the module-level constant and asserts it equals `("99","1","89","0")` — that's the same constant the function reads, so a coordinated edit (change both at once) would slip past. Effectively pins routing + the *current* value of the fallback constant, not the *correct* value of the fallback. | `kmz-wpml-audit §7` / `2026-05-15 §3.1` — M4T fallback identity |
| `TestGenerateKmz.test_no_hardcoded_drone_enum` | test_export_service.py:1568 | light | **fake** — `assert not hasattr(mission_config, "_DJI_FALLBACK_ENUMS")`. This pins the *absence of a Python attribute*, not anything about the WPML output. A regression that re-introduced a hardcoded constant under a different name (e.g. `_DJI_DEFAULT_ENUMS`) would slip past. Defensible as a history-of-the-refactor guard but does not pin a WPML invariant. | `kmz-wpml-audit §7` — "no hardcoded drone enum" |
| `TestGenerateKmz.test_drone_supports_dji_wpml_predicate` | test_export_service.py:1592 | medium (MagicMock drones) | **fake / tautological** — calls `drone_supports_dji_wpml(MagicMock(model="Matrice 350 RTK"))` and asserts `True`. The predicate's only check is `drone_profile.model in DJI_WPML_ENUMS`; the test sets `model` to a string that is in the table, then asserts the predicate returns `True`. The assertion would pass on any predicate that returned `True` for keys present in some lookup table. Pins the *interface*, not a behaviour. | `2026-05-15 §3.1` / `kmz-wpml-audit §7` — predicate returns true only for mapped drones |
| `TestGenerateKmz.test_payload_param_block_present` | test_export_service.py:1530 | heavy | **weak** — asserts `<wpml:imageFormat>visable</wpml:imageFormat>` (the deliberate misspelling). The audit explicitly flags `visable` vs `visible` as hardware-unverified (`kmz-wpml-audit §11` last bullet). The test locks the literal byte, so the *wrong* spelling is the regression net — if hardware confirms `visible` is correct, this test will need to flip. | `kmz-wpml-audit §11` (payload param block) — but locks the *current literal*, not the *correct value* |
| `TestDjiSpecConformance.test_mission_config_element_order` | test_export_service.py:2444 | heavy | **strong on element order**, but the expected lists hardcode `takeOffRefPoint` / `takeOffRefPointAGLHeight` for the template and exclude them from the waylines list. The test pins these exactly. If the spec section the audit cites (`template-kml.md` §2.3) ever moves these elements, the test would block the correct fix; this is by design. Flagged as a *brittle pinning* rather than weak — the test pins the right thing but cannot tolerate a spec evolution. | `2026-05-15 §2.3` |
| `TestGenerateKmz.test_explicit_toward_poi_mode_emits_per_placemark_poi` | test_export_service.py:1285 | heavy | **strong on `0.000000`** (real bytes), but **weak on the "regardless of `camera_target.alt`" claim** — the test uses `_make_ewkb(18.12, 49.69, 290.0)` (alt = airport elevation, not a below-takeoff alt). The stronger sibling `TestDjiBelowTakeoffClamp.test_toward_poi_alt_is_zero_regardless_of_camera_target` (line 2333) does use a below-takeoff `camera_target.alt = 280.0` and is what actually pins the invariant. The line 1285 test reads as more general than it is. | `2026-05-15 §1` — POI alt = 0 regardless of `camera_target.alt` (only partially covered here; the strong pin lives at line 2333) |
| `TestDjiSpecConformance.test_no_accurate_shoot_emitted_across_modes` | test_export_service.py:2396 | heavy | **strong** for the three explicit modes (`smoothTransition`, `towardPOI`, `followWayline`); flagged because the audit's claim is "deprecated per spec — never emitted" and the test only checks a 3-WP plan with one MEASUREMENT. A code path that emits `accurateShoot` only on HR-video or VP-video (which require the `_make_hr_video_pass` / `_make_vp_video_pass` fixtures) would not be exercised. | `2026-05-15 §2.9` — `accurateShoot` never emitted across modes |
| `TestGenerateKmz.test_kmz_export_loads_drone_profile` (TestExportMissionFormats) | test_export_service.py:3506 | heavy (entire `Session` is a MagicMock routing `query(Model)` to fixtures) | **strong** — the orchestrator runs real code top-to-bottom (status gate, drone-profile lookup, KMZ generator) against mocked DB lookups. Flagged because it pins the orchestrator → writer wiring; a regression in the writer that the writer-direct tests miss could still pass here if the orchestrator path is exercised. | `kmz-wpml-audit §7` — orchestrator loads drone profile and threads to writer |
| `TestGeozoneEmissionKmz.test_kmz_template_carries_keepout_folder` | test_export_service.py:4989 | heavy | **strong on presence** (`"Keep-out zones" in template`, `"Advisory only" in template`, `"Safety Zone - R1" in template`); the literal strings come from `app.services.export.shared._KML_KEEPOUT_DESCRIPTION` (asserted equal by `TestExportModuleSplit.test_shared_primitives_are_single_source`). | KMZ keep-out folder emission |

## Tests deliberately not flagged

These deserve a brief note for the reader of the audit doc:

- **`TestExportMissionFormats` block (lines 3278 onward)** — uses
  `_build_export_db_mock` which is a heavy `MagicMock(Session)`. This is
  the only block that exercises `export_mission` (the orchestrator).
  Pinning is strong because the assertions read the real emitted
  bytes from the real generator pipeline; only the *DB lookup* side is
  mocked. A real regression test would substitute a SQLite session, but
  the production code path that handles status transitions and audit is
  exercised here.
- **`_dji_enums_for` direct test (line 1574)** — the test does *not*
  stub the function; it calls real production code. Flagged in the table
  only because the test's tautology around the `_M4T_FALLBACK_ENUM`
  constant means a coordinated edit of constant + assertion would slip
  past. This is unusual enough to call out, not a bug.
- **`msl_to_hae` tautology cluster (lines 472, 626, 646, 1653, 1722,
  2907)** — every test that pins an HAE-bearing element computes the
  expected value via the same `msl_to_hae(...)` call the writer uses.
  This *is* weak pinning of the geodetic correctness of HAE, but the
  helper itself is independently pinned at line 2950
  (`test_egm96_undulation_helper_in_jaro_band` — asserts `39 < n < 50`
  against the published LZIB undulation of ~+44.5 m) and at line 2963
  (`test_msl_to_hae_is_msl_plus_undulation`). The chain therefore
  bottoms out at one independent value, but every downstream test could
  technically be co-broken by a coordinated edit of `egm96_undulation`
  and the LZIB band. P3 at worst.
- **PAPI / per-point elevation tests (audit
  `2026-05-11-papi-altitude-camera-aim` §2)** — the export-time path
  (`_normalize_position_altitude`, `create_elevation_provider`,
  `_FlatElevationProvider`, `ApiFallbackElevationProvider`) is *not*
  exercised by any test in `test_export_service.py`. The exporter
  receives `airport_elevation: float` as a scalar. Per-point elevation
  variation across the airfield is the airport-service contract, tested
  in `test_elevation_provider.py` / `test_altitude_audit.py` /
  `test_elevation_allow_api_call_sites.py` — outside the export-test
  surface entirely. Flagged separately under "Orchestrator-bypass risk"
  because a fix to the export path (e.g. plumbing the provider into the
  writer so it can resolve per-WP ground when stamping `takeOffRefPoint`
  or `wp.alt` against terrain) would not be reachable from the unit
  tests at all.

## Orchestrator-bypass risk (the structural issue)

Every byte-level KMZ/WPML test (the 148 tests above) calls
`export_service.generate_kmz` / `generate_wpml` directly via the local
`_gen_kmz` / `_gen_wpml` wrappers. The orchestrator
(`export_mission`) is only exercised by the **31 tests** in
`TestExportMissionFormats` (lines 3278–3650),
`TestExportMissionGeozoneGate` (4706–4791), and the `_resolve_export_content_type`
unit block (5012–5032). Those tests check status gating, drone-profile
lookup, audit-row attachment, and content-type switch — they do **not**
assert byte-level KMZ shape.

Concrete consequences for the audited invariants:

1. A fix that has to land at the orchestrator boundary — for example,
   plumbing a live `ElevationProvider` from `create_elevation_provider`
   into the writer so `takeOffRefPoint` / per-WP `executeHeight` reflect
   per-point terrain rather than a single `airport.elevation` float —
   has **no regression net** in `test_export_service.py`. The PAPI
   audit's "single airport elevation flows into the WPML"
   (`2026-05-11-papi-altitude-camera-aim §2.1`) is in scope here.
2. The `mission.dji_heading_mode` side-effect persistence path
   (`export_mission(..., dji_heading_mode_override=...)` writes back to
   `mission.dji_heading_mode` when override differs) is exercised only
   indirectly via `_make_heading_mode_mission`. A regression that drops
   the side-effect write would pass every byte-level test (the mode is
   already on the mission object) but break the operator's
   pre-fill-the-picker UX.
3. The `EXPORTED` transition (`mission.transition_to.assert_called_once_with("EXPORTED")`)
   is pinned only at `TestExportMissionFormats.test_valid_format_exports_and_commits`
   (3305) and re-exports skip-transition at 3389. The writer-direct
   tests do not see status semantics at all.

## Top 3 most concerning mock-pinned audit invariants

1. **`kmz-wpml-audit §12` / `2026-05-15 §1` — template `ellipsoidHeight`
   is true WGS84 HAE while `height` is relative.** Six tests pin this
   (`test_template_placemark_height_is_relative_ellipsoid_is_hae`,
   `test_take_off_ref_point_from_mission`, `_falls_back_to_first_waypoint`,
   `test_kmz_measurements_only_structure`,
   `_takeoff_ref_anchors_at_wp1_when_takeoff_coord_set`,
   `test_template_and_waylines_heights_are_mutually_consistent`) — every
   one of them computes the expected value via the same `msl_to_hae(...)`
   call the writer uses. The chain bottoms out at the EGM96-band
   sanity test (`test_egm96_undulation_helper_in_jaro_band`,
   `39 < n < 50`), so a +5 m drift in the helper would slip past every
   downstream test until it crossed the LZIB band. P1 — a coordinated
   edit to `egm96_undulation` could silently corrupt the template
   `ellipsoidHeight` field that Pilot 2 regenerates the wayline from
   (root cause of the descend-to-ground bug). Recommended fix: pin one
   `ellipsoidHeight` byte value against a hand-computed literal (not
   `msl_to_hae(...)`) so the chain has two anchors.
2. **`kmz-wpml-audit §7` — M4T fallback enum identity.**
   `test_dji_enums_fallback_to_m4t_for_unmapped_drone` (line 1574)
   imports the production constant `_M4T_FALLBACK_ENUM` and asserts it
   equals `("99","1","89","0")`. The function under test reads the same
   constant. A coordinated edit (`_M4T_FALLBACK_ENUM = ("X","Y","Z","W")`
   plus the test literal) would slip past; only the
   `test_dji_enums_resolve_per_configured_drone` parametric test for
   `"Matrice 4T"` (line 1541) independently locks the four
   tuple values into the actual emitted XML, so the
   constant-vs-emitted-bytes pin is one assertion deep. P1 — the M4T
   enum is the most-explicitly-undocumented value in the whole KMZ
   export; the audit notes "verbatim from a real Pilot 2 M4T export. Do
   not guess" (`kmz-wpml-audit §7`), and a single test is the only
   thing pinning the four values to bytes that ship.
3. **`2026-05-15 §3.1` — `drone_supports_dji_wpml` predicate identity.**
   `test_drone_supports_dji_wpml_predicate` (line 1592) asserts the
   predicate is true for `"Matrice 350 RTK"` and false for `"Mavic 2 Pro"`
   / `"Skydio X10"` / `None`. The predicate's only logic is
   `drone_profile.model in DJI_WPML_ENUMS`. The test would pass on a
   predicate that just looked up *any* dict using the same keys —
   including a predicate that lost the M4T-fallback semantics. Combined
   with the fact that the frontend uses the schema mirror of this
   predicate to decide whether to surface the "your file will be tagged
   as M4T" modal (services CLAUDE.md), a regression here changes
   operator-facing UX without breaking the writer. P2 — pair this with
   an assertion that `drone_supports_dji_wpml(matrice_4t) is True` (the
   primary mapped drone) and that the schema-side `supports_dji_wpml`
   mirror reads the same table.

## Summary (≤200 words)

Audited 148 KMZ/WPML tests in `backend/tests/test_export_service.py`.
**136 strong**, **9 weak**, **3 fake** pinning. The exporter itself is
never mocked; assertions read real emitted bytes. All inputs (mission,
inspection, flight plan, waypoints, drone profile) are `MagicMock`, but
critical helpers (`_dji_enums_for`, `_append_*`, `msl_to_hae`) are real
production code — the writer-layer trust chain is sound. Two structural
gaps: (1) the orchestrator `export_mission` is bypassed by every
byte-level test, so a fix that has to land at the orchestrator boundary
(per-point `ElevationProvider` plumbed into the writer, side-effect
`dji_heading_mode` write-back) has no writer-level regression net; (2)
the PAPI audit's per-point elevation contract is upstream of the
exporter — `airport_elevation` is a scalar float — and the writer tests
have no provider to mock. Top 3 fragile pin invariants: template
`ellipsoidHeight = msl_to_hae(...)` (tautological chain, only one
independent anchor at the LZIB EGM96 band test); M4T fallback enum
identity (one parametric test deep); and `drone_supports_dji_wpml`
predicate (3-case lookup-table tautology).
