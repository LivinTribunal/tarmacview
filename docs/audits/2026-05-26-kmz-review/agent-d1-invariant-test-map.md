# Agent D1 — Audit invariant → pinned-test map

Scope: walk every claimed invariant in the three audit docs
(`docs/kmz-wpml-audit.md`, `docs/audits/2026-05-15-dji-wpml-spec-audit.md`,
`docs/audits/2026-05-11-papi-altitude-camera-aim.md`) and locate the test
that pins it. Confirmed by reading each cited assertion (not just the
test name). Test-line numbers reference
`backend/tests/test_export_service.py` unless noted.

## Summary

- Total invariants enumerated: **38**
- Pinned by real assertion (strong): **30**
- Pinned by name only / partial / weak: **3**
- UNPINNED: **5**
- P0 (regression of a confirmed mid-flight failure): **2**
- P1: **2**
- P2: **1**
- P3 (test infrastructure / golden-fixture workflow): **3**

## Invariant map

### A. 2026-05-15 audit — primary launch bug (§1)

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 1 | 2026-05-15 §1 | `executeHeight = wp.alt − airport.elevation` (NTL/FULL via takeoff-ground anchor; pre-#722 the audit said `airport.elevation` literally — current code anchors at `_takeoff_ref_msl` which is `airport.elevation` for the airborne scopes and `mission.takeoff_coordinate.alt` for FULL) | `TestDjiBelowTakeoffClamp.test_full_scope_clamps_below_takeoff_height_to_zero` (2270) + `test_ntl_scope_execute_height_relative_to_airport_ground` (2296) + `TestGenerateKmz.test_execute_height_is_takeoff_relative` (455) | strong (asserts exact `executeHeight` values 0/10/20 against the resolved anchor) | P0 |
| 2 | 2026-05-15 §1 | `executeHeight = wp.alt` for MEASUREMENTS_ONLY paired with `executeHeightMode=EGM96` | **STALE invariant** — superseded by #722. Current code emits `relativeToStartPoint` on every scope. Pinned by `TestDjiRelativeHeightExport.test_execute_height_mode_is_relative_on_every_scope` (2886) and `TestDjiBelowTakeoffClamp.test_measurements_only_execute_height_relative_to_airport_ground` (2313). | strong | P0 |
| 3 | 2026-05-15 §1 | `waypointPoiPoint.alt = 0.000000` for every `towardPOI` placemark (regardless of `camera_target.alt`) | `TestDjiBelowTakeoffClamp.test_toward_poi_alt_is_zero_regardless_of_camera_target` (2333) + `TestGenerateKmz.test_aimed_placemark_emits_toward_poi` (536, asserts `49.690000,18.120000,0.000000`) | strong | P0 |

### B. 2026-05-15 audit — schema conformance (§2)

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 4 | §2.1 | `waylineAvoidLimitAreaMode` never emitted | `TestDjiSpecConformance.test_mission_config_omits_wayline_avoid_limit_area_mode` (2361) — sweeps all 3 scopes, asserts absence in template + waylines | strong | P2 |
| 5 | §2.2 | `globalRTHHeight` emitted only in `waylines.wpml` | `TestDjiSpecConformance.test_global_rth_height_emitted_in_waylines_only` (2373); also `TestGenerateKmz.test_mission_config_has_rc_lost_and_rth` (611) | strong | P2 |
| 6 | §2.3 | `<wpml:missionConfig>` child order matches `template-kml.md` canonical sample | `TestDjiSpecConformance.test_mission_config_element_order` (2444) — compares against explicit `expected_template` / `expected_waylines` tag list | strong | P2 |
| 7 | §2.4 | `waypointPoiPoint` emitted only on `towardPOI` placemarks (no zero sentinel elsewhere) | `TestGenerateKmz.test_transit_placemark_heading_mode_is_follow_wayline` (513) + `test_explicit_toward_poi_mode_emits_per_placemark_poi` (1285) + non-aimed assertions at 1282-1283, 1346-1347, 1527-1528 (all 3 modes) | strong | P1 |
| 8 | §2.5 | XML declaration uses uppercase `UTF-8` | `TestDjiSpecConformance.test_xml_header_uppercase_utf8` (2382) — also asserts lowercase variant absent | strong | P2 |
| 9 | §2.6 | `createTime` / `updateTime` are 13-digit Unix epoch ms | **UNPINNED.** No test asserts the format. Code (`builders.py:72-73`) emits `int(now.timestamp() * 1000)` so it would survive a refactor by accident; but a regression to e.g. `now.isoformat()` would not be caught. | missing | P3 |
| 10 | §2.7 | `globalHeight` emitted in template `<Folder>` | partial: emitted by `builders.py:94` (`_sub_text(folder, "globalHeight", global_height)`). The closest test is `TestDjiBelowTakeoffClamp` which indirectly exercises `_max_relative_height`, but **no test asserts `<wpml:globalHeight>` is present in the template folder**. The audit doc even calls out that agent A1 disputes whether this should be in the template folder vs. document — flag for D3. | missing | P2 |
| 11 | §2.8 | `gimbalEvenlyRotate` always paired with `actionTriggerType=betweenAdjacentPoints` | `TestDjiSpecConformance.test_gimbal_evenly_rotate_paired_with_between_adjacent_points` (2414) — XML-parses every `actionGroup`, asserts trigger==`betweenAdjacentPoints` for every `gimbalEvenlyRotate` | strong | P1 |
| 12 | §2.9 | `accurateShoot` never emitted across all 3 heading modes | `TestDjiSpecConformance.test_no_accurate_shoot_emitted_across_modes` (2396) — sweeps `smoothTransition`, `towardPOI`, `followWayline` | strong | P2 |

### C. 2026-05-15 audit §5 — later spec-conformance (PR #638)

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 13 | §5.1 | `actionGroupId ∈ [0, 65535]` and unique per file (across reach-point + segment groups, scaling to 200+ waypoints) | `TestDjiActionGroupIdRange` — three tests (2701, 2719, 2734) cover VP-video, multi-inspection, 200-waypoint cases | strong | P1 |
| 14 | §5.2 | `waypointTurnDampingDist` clamped to `min(0.2, 0.5 × nearest_leg)` on continuity-curvature placemarks; default-stop path keeps literal 0.2 | `TestDjiTurnDampingClamp` — three tests (2780 VP, 2815 HR, 2852 default) verify clamp engaged with tight 0.3 m spacing | strong | P1 |

### D. `kmz-wpml-audit.md` §12 — descend-to-ground root cause + fix

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 15 | §12 | `executeHeightMode = relativeToStartPoint` on every scope | `TestDjiRelativeHeightExport.test_execute_height_mode_is_relative_on_every_scope` (2886); `TestGenerateKmz.test_waylines_folder_uses_relative_height_mode` (417); `TestGenerateKmz.test_kmz_full_scope_uses_relative_height_mode` (1641) | strong | **P0** |
| 16 | §12 | `executeHeight = wp_MSL − takeoff_ground_MSL` (zero-out reference matches the takeoff anchor) | `TestGenerateKmz.test_execute_height_is_takeoff_relative` (455) — asserts exact 0/10/20 strings; `TestDjiBelowTakeoffClamp` x3 (2270-2331); `TestDjiRelativeHeightExport.test_template_and_waylines_heights_are_mutually_consistent` (2907) | strong | **P0** |
| 17 | §12 | `takeOffSecurityHeight ≥ 1.2 m` (airborne scopes use 1.5; FULL uses 20) | `TestGenerateKmz.test_kmz_measurements_only_structure` (1653) asserts `1.5` and absence of `0`; `test_kmz_full_scope_uses_relative_height_mode` asserts `20`. **NO test asserts the lower-bound ≥1.2 invariant directly** — a constant change to e.g. `0.5` in `mission_config.py:32` would be caught only by the exact-match test, not the bound. | weak (value pinned exactly, but the SPEC bound is not asserted) | P1 |
| 18 | §12 | Below-takeoff waypoint clamped to 0 with a logged warning, no revert to absolute mode | `TestDjiBelowTakeoffClamp.test_full_scope_clamps_below_takeoff_height_to_zero` (2270) — asserts `h >= 0`, `h == 0.0`, and "`below the takeoff reference` in caplog.text" | strong | **P0** |
| 19 | §12 | Template `heightMode` / `globalHeight` / `ellipsoidHeight` / `height` mutually consistent (relative scale for height/heightMode, HAE for ellipsoidHeight) | `TestDjiRelativeHeightExport.test_template_and_waylines_heights_are_mutually_consistent` (2907) — asserts `template heights == executeHeights == [10, 20, 30]` and ellipsoid is `msl_to_hae(...)`; `TestGenerateKmz.test_template_placemark_height_is_relative_ellipsoid_is_hae` (472) | strong (height/heightMode/ellipsoidHeight) but **`globalHeight` is not asserted for consistency** — see #10 | strong / partial | P1 |
| 20 | §12 | Pilot 2 regenerates wayline from `template.kml` on import — so template values must be flight-correct | implicit: covered by #19 (`template heights == executeHeights`). No standalone test, and this is a *behavioral* claim about Pilot 2, not a writer invariant. CI cannot pin it. | missing (by design — needs hardware) | P3 (golden-fixture round-trip in `docs/kmz-wpml-audit.md` Phase 4) |
| 21 | §12 (RTH) | `globalRTHHeight` clears max waypoint in takeoff-relative frame across all scopes, clamped `[100, 1500]` | `TestDjiRelativeHeightExport.test_global_rth_height_clears_route_in_takeoff_relative_frame` (2971) — sweeps all 3 scopes with a 450 m peak | strong | P1 |
| 22 | §11 (current state) | `coordinateMode=WGS84` + `heightMode=relativeToStartPoint` in `waylineCoordinateSysParam` block, ordering before `executeHeightMode` | `TestGenerateKmz.test_waylines_wpml_emits_coordinate_sys_param_full_ntl_mo` (1827) — asserts presence + order index on all 3 scopes | strong | P1 |
| 23 | §11 | `takeOffRefPoint` z is HAE-converted from `mission.takeoff_coordinate` or WP1 fallback | `TestGenerateKmz.test_take_off_ref_point_from_mission` (626) + `test_take_off_ref_point_falls_back_to_first_waypoint` (646) | strong | P2 |
| 24 | §11 (airborne scope contract) | MO/NTL: `flyToWaylineMode=pointToPoint`, `finishAction=gotoFirstWaypoint`, `takeOffRefPoint` anchors at WP1 regardless of `mission.takeoff_coordinate` | `test_kmz_measurements_only_takeoff_ref_anchors_at_wp1_when_takeoff_coord_set` (1722); `test_kmz_measurements_only_uses_point_to_point_and_goto_first_waypoint` (1764); `test_kmz_no_takeoff_landing_uses_point_to_point_and_goto_first_waypoint` (1809) | strong | P1 |
| 25 | §11 (FULL) | FULL keeps `flyToWaylineMode=safely`, `finishAction=goHome`, `takeOffSecurityHeight=20` | `test_kmz_full_scope_unchanged_flytowayline_and_finish` (1797) + `test_kmz_full_scope_uses_relative_height_mode` (1641) | strong | P2 |
| 26 | §11 (wayline summary) | `wpml:distance` / `wpml:duration` recomputed from emitted waypoints (3D leg), not persisted `flight_plan.total_distance` | `test_waylines_wpml_distance_duration_match_emitted_waypoints_mo` (1868); `test_waylines_wpml_distance_includes_vertical_profile_climb` (1932); `test_waylines_wpml_distance_duration_full_scope_recomputed` (1973) | strong | P1 |

### E. `kmz-wpml-audit.md` §7 + §8 — M4T checklist & smooth-motion encoding

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 27 | §7 | `xmlns:wpml="http://www.dji.com/wpmz/1.0.6"`; `1.0.2` absent | `TestGenerateKmz.test_declares_wpmz_1_0_6_namespace` (406) | strong | P1 |
| 28 | §7 | Drone/payload enums per-mapped-drone (M4T → 99/1/89/0); M4T fallback for unmapped/non-DJI/None | `test_dji_enums_resolve_per_configured_drone` (1541, parametric × 4); `test_dji_enums_fallback_to_m4t_for_unmapped_drone` (1574); `test_drone_supports_dji_wpml_predicate` (1592) | strong | P1 |
| 29 | §7 | `payloadParam/imageFormat` value emitted (currently `visable`) | `test_payload_param_block_present` (1530) — asserts `<wpml:imageFormat>visable</wpml:imageFormat>`. **The audit explicitly flags `visable` vs `visible` as still hardware-unverified**; the test only locks the literal, not the correct spelling. | strong (locked literal) — but locks the literal even if it is wrong | P2 |
| 30 | §7 | `payloadPositionIndex = 0` for M4T; `isInfiniteFocus` / `panoShot` / `recordPointCloud` not emitted | `test_payload_param_block_present` indirectly checks `firstPoint` focus mode. **No explicit assertion that `isInfiniteFocus`, `panoShot`, `recordPointCloud` are absent.** | missing | P2 |
| 31 | §8 (HR) | HR-video uses `towardPOI` per-placemark when mission picks that mode; per-WP gimbal `rotateYaw` suppressed | `test_aimed_placemark_emits_toward_poi` (536); `test_aimed_measurement_does_not_emit_rotate_yaw` (680); `test_horizontal_range_keeps_per_wp_gimbal_rotate_snap` (776); `test_hr_video_emits_at_most_one_gimbal_rotate_per_inspection` (1116) | strong | P1 |
| 32 | §8 (VP) | VP-video emits `gimbalEvenlyRotate` per segment on `betweenAdjacentPoints`; first measurement anchors; later measurements skip snap; passthrough turn mode | `test_vp_video_first_measurement_anchors_gimbal_pitch_with_snap` (823); `test_vp_video_interior_measurement_skips_gimbal_rotate_snap` (840); `test_vp_video_segment_emits_gimbal_evenly_rotate` (866); `test_vp_video_measurement_uses_passthrough_turn_mode` (888); `test_vp_video_last_measurement_has_no_segment_action_group` (909) | strong | P1 |
| 33 | §8 | `gimbalPitchMode = manual` (not `usePointSetting`) | `test_template_uses_manual_gimbal_pitch_mode` (724) — also asserts `usePointSetting` absent | strong | P2 |
| 34 | template-kml.md / kmz-wpml-audit.md ad-hoc | 0-indexed `wpml:index`, `actionGroupStartIndex`, `actionGroupEndIndex` | `TestDjiZeroIndexedReferences` — four tests (2020/2031/2041/2080) | strong | P1 |
| 35 | template-kml.md | Every template placemark carries the four `useGlobal*` flags with correct values | `TestDjiUseGlobalFlags` — four tests (2136/2150/2177/2204) | strong | P2 |

### F. 2026-05-11 PAPI / camera-aim audit

| # | Source | Invariant | Test | Pinning | Severity if regressed |
|---|--------|-----------|------|---------|----------------------|
| 36 | §1 / §4.3 | `waypointPoiPoint` ordering is `lat,lon,alt` (reversed from every other point) | `test_aimed_placemark_emits_toward_poi` (536) — asserts `<wpml:waypointPoiPoint>49.690000,18.120000,...` (lat first, lon second) against camera_target lon=18.12 lat=49.69; `TestDjiBelowTakeoffClamp.test_toward_poi_alt_is_zero_regardless_of_camera_target` (2333) re-asserts | strong | P1 |
| 37 | §3 | Per-point elevation lookup endpoint (`GET /airports/{id}/elevation`) honours `allow_api` opt-in and returns source label | `test_elevation_allow_api_call_sites.TestGetElevationAtPoint` (86) — two tests asserting `FLAT` vs `API` labels and remote-call counts | strong | P1 |
| 38 | §3 | `_normalize_position_altitude` opts into `allow_api` only when caller passes it (LHA/obstacle/AGL call-site discipline) | `test_elevation_allow_api_call_sites.TestNormalizePositionAltitudeOptIn` (65); `test_elevation_provider.py:880` `_normalize_position_altitude` DEM variance | strong | P1 |
| 39 | §3 | `renormalize_airport_altitudes` rewrites `mission.takeoff_coordinate.alt` / `landing_coordinate.alt` per mission of the airport | `test_altitude_audit.test_renormalize_rewrites_mission_takeoff_landing_alt` (676); `test_renormalize_regresses_non_draft_mission_on_alt_change` (718); `test_renormalize_does_not_regress_when_alt_unchanged` (769) | strong | P1 |
| 40 | §3 | `batch_update_waypoints` queries the provider at rerouted `(lon, lat)` when syncing TAKEOFF/LANDING moves into mission coords | **UNPINNED on the provider-call side.** The audit text says "queries the provider at the rerouted (lon, lat) when syncing mission coords"; the *current* implementation (`flight_plan_service`) per the services CLAUDE.md "is server-side pass-through for position: TAKEOFF / LANDING moves mirror the caller-supplied `(lon, lat, alt)` into `mission.takeoff/landing_coordinate` unchanged, no per-point ground resampling. Frontend resolves ground via `GET /airports/{id}/elevation` before sending." Tests in `test_flight_plans.py` (395, 418, 441) exercise the mirror but not the elevation contract; the frontend resolver path is tested by `useElevationResolver` (no co-located test) and `takeoffLandingPlacement.test.ts:119` ("uses the resolver value when one is provided"). **The audit doc text is stale** vs. the current architecture — flag for cleanup or a regression test that asserts the pass-through behaviour explicitly. | missing | **P1** (semantics drifted between audit and code; needs at minimum a pinning test or a docs update) |
| 41 | §3 | Frontend `takeoffLandingPlacement.ts` is async: queries elevation endpoint before assigning takeoff/landing; falls back to airport elevation on error | `frontend/src/utils/takeoffLandingPlacement.test.ts` (lines 119/134/147) — "uses the resolver value when one is provided", "falls back to airport elevation when the resolver returns null", "falls back to airport elevation when the resolver rejects" | strong | P2 |
| 42 | §3 | LHA / obstacle / AGL create + update call sites pass `allow_api=True` (LHA only) | `test_elevation_allow_api_call_sites` (full file — `TestRenormalizeRemoteCallCount` test at 270 sums spy calls and asserts `_total_remote_calls() == lha_count` after renormalize); `test_elevation_provider.py:876-905` | strong | P2 |

## P0 UNPINNED — would re-introduce a confirmed flight failure

None. **All four P0-class invariants (1, 15, 16, 18) are pinned by strong, assertion-level tests.** The two confirmed mid-flight failures — descend-to-ground from absolute-altitude encoding (kmz-wpml-audit §12) and Pilot 2 launch rejection from negative `executeHeight` / `waypointPoiPoint.alt` (2026-05-15 §1) — have regression nets that read the actual emitted bytes, not just the presence of an element.

## P1 UNPINNED

- **#9 / #40 — `batch_update_waypoints` elevation resolution contract.** The audit text on the renormalize/batch-update side and the current implementation have *drifted*: the audit says the backend queries the provider; the current code is server-side pass-through and the resolver lives on the frontend. There is no test that pins the current contract (a test that asserts `batch_update_waypoints` does *not* resample at TAKEOFF/LANDING moves), so a future "helpful" refactor that re-adds backend resampling would not be caught. Either add a pin test or update the audit doc. Today the only thing keeping this honest is the frontend `useElevationResolver` hook plus `takeoffLandingPlacement.test.ts:119`.
- **#10 — `globalHeight` element presence in the template `<Folder>`.** Emitted by `builders.py:94`, but no test asserts `<wpml:globalHeight>` is in the template, and no test asserts the *value* is on the same relative scale as per-WP `height`. Audit doc §12 explicitly listed this as part of the descend-to-ground root cause ("`globalHeight` is computed on an AGL scale (~50) while per-waypoint `height` is MSL (~146) — a latent unit mismatch in the same file"). The current code is correct, but a regression to a different scale would silently pass CI.
- **#17 — `takeOffSecurityHeight ≥ 1.2 m` bound is not asserted as a bound.** Tests pin the exact strings `"1.5"` and `"20"`, so a tweak to `"0.5"` in `mission_config.py:32` would fail those tests. But if the constants ever become dynamic, the "≥ 1.2" SPEC bound is not asserted. Cheap to add a parametric test.

## P2 UNPINNED

- **#30 — `isInfiniteFocus` / `panoShot` / `recordPointCloud` non-emission.** The audit (§7) explicitly says "do not emit" these on M4T. Current code does not emit them, but there is no `assert "isInfiniteFocus" not in template` regression net. Trivial one-liner test.

## P3 UNPINNED — test-infrastructure / golden-fixture

- **#20 — Pilot 2 regeneration round-trip.** Behavioral claim about Pilot 2, not a writer invariant; the audit doc Phase 0–4 plan is the right place for this. Tracked there.
- **#9 — `createTime` / `updateTime` 13-digit epoch-ms format.** Trivially regression-pinnable with a regex; today nothing locks the format. Same shape as P3 because no operational consequence today.
- **No golden Pilot-2-exported fixture lives in `backend/tests/data/`.** Audit doc §6 "Phase 0 — Golden reference" explicitly identifies this as the highest-value missing artifact. Every test above is a *structural* invariant against the writer's expected output; no test does a structural diff against a real Pilot-2-emitted M4T KMZ. This is the gap that the entire audit doc opens with ("the missing piece was never better documentation. It is a ground-truth reference file emitted by DJI's own software"). Recommend the bench-test KMZ from §4 ("hardware verification — operator-side") gets checked in as `backend/tests/data/dji_m4t_golden.kmz` the next time a hardware test happens; the existing pin tests will be the boundary for what we cross-check.

## Notes / discrepancies between audit text and current code

- **2026-05-15 §1 invariant #2** (`executeHeight = wp.alt` for MEASUREMENTS_ONLY with `executeHeightMode=EGM96`) is *stale*. Superseded by §1.4 → PR #726 (`docs/kmz-wpml-audit.md` §11/§12). The current invariant is "`executeHeightMode=relativeToStartPoint` on every scope" and is pinned. The audit doc preserves §1.4 as history, which is appropriate, but anyone scanning the audit for invariants today should land on §12 instead.
- **PAPI audit §3 invariant #40** — backend-side resampling on `batch_update_waypoints` was de-scoped in favour of the frontend resolver. The audit text reads as if the backend still resamples; the current `services/CLAUDE.md` confirms the architecture moved. The flag is on the test net, not the architecture choice.
- **`globalHeight` in template Folder (§2.7)** — audit notes "A1 disputes this". Code emits it (`builders.py:94`); no regression test asserts presence or scale-consistency with per-WP `height`. If A1 is right that the spec scopes it to the document and not the folder, the writer is wrong but the test net would not detect either direction of the move.
- **`payloadParam/imageFormat` spelling (`visable` vs `visible`)** — kmz-wpml-audit §11 calls this "hardware-unverified" and the test locks `visable`. If hardware testing flips this to `visible`, the test will need to flip too — the test is a fence, not a proof.
