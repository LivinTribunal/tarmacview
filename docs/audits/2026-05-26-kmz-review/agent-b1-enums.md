# Agent B1 — Drone & payload enums for M4T

Scope: the four `<wpml:*EnumValue>` integers the exporter writes into the
`<wpml:droneInfo>` and `<wpml:payloadInfo>` blocks of `template.kml` and
`waylines.wpml`. Audited against `backend/app/services/export/dji/mission_config.py`,
`backend/app/core/constants.py::DJI_WPML_ENUMS`, the WPML 1.0.6
`common-element.md` (DJI Cloud-API-Doc), and the DJI Payload SDK header
`dji-sdk/Payload-SDK/psdk_lib/include/dji_typedef.h` (commit
`e8041ad6ea468db3346379f771f78c0636994aa8`, fetched 2026-05-26).

The big surprise in this audit is that the M4T enum tuple `(99, 1, 89, 0)`
is **not** an "M30T collapse" the way `docs/audits/2026-05-15-dji-wpml-spec-audit.md`
§3.1 records. The PSDK header is authoritative for DJI's internal
aircraft/camera identifiers, and it lists `DJI_AIRCRAFT_TYPE_M4T = 99` plus
`DJI_CAMERA_TYPE_M4T = 89` verbatim. The WPML spec doc is simply stale - it
hasn't been updated past the M3 generation, but the same numbering scheme
is used by both files (M300=60, M30=67, M3E=77, M350=89-as-aircraft, etc).
So `99` and `89` are M4T-native PSDK identifiers, not M30T values. That
shifts the priority order: the four hardcoded numbers are well-sourced and
unlikely to be rejected by Pilot 2. The remaining audit surface is the
sub-enums (`droneSubEnumValue=1`, `payloadSubEnumValue=0`) and the fallback
strategy.

## Summary
- P0 blockers: 0
- P1 high: 2
- P2 conformance: 3
- P3 upgrades: 3

## Research log

Public sources consulted (everything below is open-web; nothing was
pulled from a Pilot 2 export — that artifact is still missing and is the
top P3 below):

- `https://github.com/dji-sdk/Payload-SDK/blob/e8041ad6ea468db3346379f771f78c0636994aa8/psdk_lib/include/dji_typedef.h`
  — **the authoritative source.** The PSDK header defines:
  ```
  E_DjiAircraftType:
      DJI_AIRCRAFT_TYPE_M300_RTK = 60
      DJI_AIRCRAFT_TYPE_M30      = 67
      DJI_AIRCRAFT_TYPE_M30T     = 68   /* NOTE: not 67-with-sub=1 */
      DJI_AIRCRAFT_TYPE_M3E      = 77
      DJI_AIRCRAFT_TYPE_M3T      = 79
      DJI_AIRCRAFT_TYPE_M3TA     = 80
      DJI_AIRCRAFT_TYPE_M350_RTK = 89
      DJI_AIRCRAFT_TYPE_M3D      = 91
      DJI_AIRCRAFT_TYPE_M3TD     = 93
      DJI_AIRCRAFT_TYPE_M4T      = 99
      DJI_AIRCRAFT_TYPE_M4TD     = 100
      DJI_AIRCRAFT_TYPE_M400     = 103
      DJI_AIRCRAFT_TYPE_M4E      = 990
      DJI_AIRCRAFT_TYPE_M4D      = 1000

  E_DjiCameraType:
      DJI_CAMERA_TYPE_M30        = 52
      DJI_CAMERA_TYPE_M30T       = 53
      DJI_CAMERA_TYPE_M3E        = 66
      DJI_CAMERA_TYPE_M3T        = 67
      DJI_CAMERA_TYPE_H30        = 82
      DJI_CAMERA_TYPE_H30T       = 83
      DJI_CAMERA_TYPE_M4T        = 89
      DJI_CAMERA_TYPE_M4TD       = 90
      DJI_CAMERA_TYPE_M4D        = 91
      DJI_CAMERA_TYPE_M4E        = 891
  ```
  Bottom line: M4T aircraft = 99, M4T integrated payload = 89, both lifted
  straight from a DJI-authored header. These match
  `DJI_WPML_ENUMS["Matrice 4T"] = ("99", "1", "89", "0")` for the primary
  enums.

- `https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/40.common-element.md`
  — the WPML 1.0.6 spec. `droneEnumValue` documented set:
  `89 (M350 RTK), 60 (M300 RTK), 67 (M30/M30T), 77 (M3E/M3T/M3M), 91 (M3D/M3TD)`.
  M4 series is **not listed**. `droneSubEnumValue` is scoped:
  `when 67 (M30/M30T): 0 (M30), 1 (M30T); when 77 (M3E/M3T/M3M): 0 (M3E)
  1 (M3T) 2 (M3M); when 91 (M3D/M3TD): 0 (M3D) 1 (M3TD) 2 (M3M)`. The spec
  is silent on `droneSubEnumValue` when `droneEnumValue=99` — that's the
  audit gap §3.1 was right about. `payloadEnumValue` set:
  `42 (H20), 43 (H20T), 52 (M30), 53 (M30T), 61 (H20N), 66 (Mavic 3E Camera),
  67 (Mavic 3T Camera), 68 (Mavic 3M Camera), 80 (Matrice 3D Camera),
  81 (Matrice 3TD Camera), 82 (H30), 83 (H30T), 65534 (PSDK Payload Device)`.
  Again no M4T integrated camera listed.

- `https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/10.overview/30.product-support.md`
  — the WPML product-support matrix. Lists M350 RTK / M300 RTK / M30/M30T /
  M3E/M3T/M3M / M3D/M3TD. **M4 series is absent.** The Cloud API has not
  formally added M4-series WPML support; the M4T runs WPML files in Pilot 2
  but DJI hasn't published a spec for the enum.

- `https://github.com/fcsonline/droneroute` — supported-drone list in the
  README mentions "DJI M300 RTK, M350 RTK, M30/M30T, Mavic 3E/3T/3M/3D/3TD,
  Mini 4 Pro". No M4T enum table in the surface README.
- `https://github.com/Merpyzf/WPML` — Kotlin DSL. Example builds against
  `droneEnumValue(67)` / `payloadEnumValue(52)` (M30). No M4T entry.
- `https://github.com/AndreasLabs/format-wpmz` — TypeScript WPML parser.
  Example value `droneEnumValue: 68` in a sample (M30T cross-reference).
  No M4T constant.
- `https://github.com/dji-sdk/Mobile-SDK-Android-V5/issues/103` (Mini 3 Pro
  enum question) — community ack that DJI publishes per-model enums
  irregularly; the answer points to the PSDK header. Same pattern as M4T.
- `https://github.com/dji-sdk/Mobile-SDK-Android-V5/issues/635` (M4T thermal
  lens quirk) — confirms the M4T runs the Cloud-API waypoint stack with
  its own integrated camera, not the H30T Zenmuse payload.
- `https://matricepilots.com/threads/matrice-4t-waypoint-woes.25992` — 403
  on fetch (Cloudflare); search snippet only. No publicly-readable enum
  value reported there.
- The DJI MSDK sample `waypointsample.kmz` referenced at
  `dji-sdk/Mobile-SDK-Android-V5/SampleCode-V5/android-sdk-v5-sample/src/main/assets/waypointsample.kmz`
  uses namespace `1.0.0` (older than M4T) — not fetched (binary), known
  M30T-era.

Cross-references inside the repo:

- `docs/kmz-wpml-audit.md` §7 (M4T-specific checklist) and §11 (current
  exporter state, "drone/payload enums are an unverified assumption").
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §3.1 (the "M30T collapse"
  inline comment).
- `backend/tests/test_export_service.py:1543-1590` — pins
  `("Matrice 4T", "99", "1", "89", "0")` and `_M4T_FALLBACK_ENUM ==
  ("99", "1", "89", "0")` as regression-tested values.

Bottom-line research output:
- Two of the four numbers (`99` and `89`) are confirmed against the DJI
  PSDK header verbatim.
- One number (`payloadSubEnumValue=0`) is consistent with single-gimbal
  M4T hardware (see §F-P2-1 below).
- One number (`droneSubEnumValue=1`) has **no public provenance** — neither
  the WPML spec nor the PSDK header documents a sub-enum scoped to
  `droneEnumValue=99`. This is the only "guess" surface remaining in the
  tuple.

## Findings

### [P1-1] `droneSubEnumValue=1` for M4T has no documented source

- **Severity**: high (silent feature-drop risk, not rejection)
- **Location**: `backend/app/core/constants.py:92` —
  `"Matrice 4T": ("99", "1", "89", "0")`. Read by
  `backend/app/services/export/dji/mission_config.py:55-66` (`_dji_enums_for`).
- **Spec / Source**: WPML 1.0.6 `common-element.md` scopes
  `droneSubEnumValue` only for `droneEnumValue ∈ {67, 77, 91}`. The
  documented sub-enums distinguish thermal/lidar variants within an
  aircraft family (e.g. `67/0` M30 vs `67/1` M30T). The PSDK header
  doesn't model a sub-enum at all — it gives each M4 variant a distinct
  aircraft type (`M4T=99`, `M4TD=100`, `M4E=990`, `M4D=1000`).
- **Current behavior**: every M4T export carries `droneSubEnumValue=1`.
  The value originated in the operator's FH2 round-trip exports and was
  copied across without independent verification.
- **Why it's wrong (or risky)**: Two failure modes are plausible:
  1. **Pilot 2 silently ignores the sub-enum** under `droneEnumValue=99`
     because the WPML spec doesn't document any. This is the most likely
     case — Pilot 2 v10.1.8.18 has not rejected the file in operator
     testing, and the inline comment in `_dji_enums_for` documents that
     the sub-enum "just labels the file". In this case `1` is a no-op and
     the audit is purely documentation.
  2. **Pilot 2 (or a future FH2 build) routes M4T variants by sub-enum**
     — e.g. `99/0` = M4T base, `99/1` = M4T with a specific firmware/RC
     pairing, `99/2` = something else. If the hardware-side classifier
     keys on the sub-enum to load a model-specific flight envelope (turn
     rate, max speed, thermal pipeline), shipping `1` to a base M4T might
     load the wrong envelope and silently disable a feature (e.g.
     `gimbalEvenlyRotate` smooth-pitch could regress to discrete snaps,
     which is exactly the "erratic camera" symptom in
     `kmz-wpml-audit.md` §1).
- **Evidence**: PSDK header has no sub-enum field on `E_DjiAircraftType`.
  WPML spec `common-element.md` lists exactly three valid `droneEnumValue`
  values that take a sub-enum, and `99` is not one. The FH2 source
  observation is single-sample and undated. `_dji_enums_for`'s comment
  block (`mission_config.py:55-66`) describes the fallback as "the
  firmware drives flight, the enum just labels the file" — that's true
  if Pilot 2 dispatches purely on the primary enum, but unverified if it
  dispatches on the pair.
- **Proposed fix**: Two-part, ordered by safety:
  1. Short-term: change `droneSubEnumValue` from `"1"` to `"0"`. Rationale:
     `0` is the documented default in every other family (`67/0`=M30,
     `77/0`=M3E, `91/0`=M3D). If Pilot 2 ignores the sub-enum under `99`
     the file is byte-equivalent in behaviour; if it dispatches on it,
     `0` is the safer "base model" guess than `1`. Update
     `DJI_WPML_ENUMS["Matrice 4T"]` to `("99", "0", "89", "0")` and
     update the `("Matrice 4T", "99", "1", "89", "0")` row in
     `test_export_service.py:1544` plus the `_M4T_FALLBACK_ENUM == ("99",
     "1", "89", "0")` assertion at line 1590. Add a unit comment recording
     the rationale.
  2. Long-term: capture a real Pilot 2 M4T export (see P3-1 below) and
     pin the actual tuple. Only this resolves the ambiguity.
- **HW verify**: Generate two identical missions, one with sub-enum `0`,
  one with `1`. Fly both on the M4T. If telemetry / behaviour is
  identical, sub-enum is ignored and the choice is cosmetic. If they
  differ (turn dynamics, camera smoothness, max-speed cap), the sub-enum
  is dispatched on and the correct value is whichever flies cleanly.

### [P1-2] Fallback strategy mislabels unmapped drones as M4T silently

- **Severity**: high (silent misimport on operator drone swap)
- **Location**: `backend/app/services/export/dji/mission_config.py:55-66`
  (`_dji_enums_for`), `backend/app/core/constants.py:97`
  (`_M4T_FALLBACK_ENUM = DJI_WPML_ENUMS["Matrice 4T"]`).
- **Spec / Source**: WPML doesn't define a "default" drone enum — every
  KMZ ships an exact aircraft identifier and Pilot 2 cross-checks it
  against the connected aircraft (the `WaylineCheckError` enum in
  `dji-sdk/Mobile-SDK-Android-V5/issues/586` includes a model-mismatch
  error code).
- **Current behavior**: when `drone_profile.model` is missing from the
  table (e.g. Mavic 2 Pro, custom non-DJI drone, or `drone_profile` is
  `None`), the export returns `(99, 1, 89, 0)` — i.e. labels the file as
  an M4T. The frontend surfaces a confirm modal. The inline comment
  documents the intent as "firmware drives flight, the enum just labels
  the file".
- **Why it's wrong (or risky)**: The confirm modal is a UI guardrail, but
  the file is still well-formed M4T-labeled WPML. Two real failure modes:
  1. **Operator imports into Pilot 2 on a non-M4T DJI aircraft** (e.g.
     an M30T with a misconfigured drone profile). Pilot 2 sees an M4T
     file on an M30T → rejects with a model-mismatch error. The user
     sees a generic Pilot 2 popup, not the actual root cause (their
     drone profile in TarmacView is wrong).
  2. **Operator imports into Pilot 2 on an actual M4T but the planner
     used non-M4T performance limits**. The KMZ ships M4T enums and M4T
     gets the file; the flight executes. But the speed/altitude/battery
     limits in the plan were sized for the operator's other drone
     profile (e.g. an M300 RTK with 55-minute endurance vs the M4T's
     ~49-minute). Battery-reserve is the failure dimension.
- **Evidence**: `_dji_enums_for` returns the fallback for any
  `drone_supports_dji_wpml(drone_profile)==False`, which is every drone
  outside the four-entry table. `tests/test_export_service.py:1543-1565`
  covers the table itself but doesn't exercise the unmapped-drone path
  for behavior (only asserts the fallback tuple value).
- **Proposed fix**: Two parts:
  1. **Refuse to export DJI KMZ/WPML for unmapped drones** in the
     orchestrator gate. The current shape (`drone_profile is None or not
     drone_profile.supports_geozone_upload → 400`) only fires when
     `include_geozones=True`. Extend the gate to fire whenever the
     selected format is `KMZ` or `WPML` and `drone_supports_dji_wpml()`
     is False. Return a 400 with a clear "drone model not supported for
     DJI KMZ export" message naming the model. This is the same pattern
     the geozone gate already uses.
  2. Alternatively (less strict), keep the fallback but log it as a
     `violation_kind="drone_enum_fallback"` validation suggestion on the
     export response so the operator's plan summary records that the
     file is mislabeled. The confirm modal currently relies on the
     frontend to remember a pre-export click, with no server-side audit.
- **HW verify**: Configure a mission with a Mavic 2 Pro profile (not in
  `DJI_WPML_ENUMS`). Export KMZ. Import into Pilot 2 on an M4T. Confirm:
  with the current code, Pilot 2 accepts the file as M4T and flies it on
  M4T performance limits. With the fix, the export returns 400 at the API
  layer before the file is generated.

### [P2-1] `payloadPositionIndex=0` is correct for M4T but not documented as M4T-specific

- **Severity**: conformance
- **Location**: `backend/app/services/export/dji/mission_config.py:230`
  (`_sub_text(payload_info, "payloadPositionIndex", "0")` — hardcoded).
- **Spec / Source**: WPML 1.0.6 `common-element.md`
  `payloadPositionIndex`: `0` = no.1 gimbal mount, `1` = no.2 mount, etc.
  Multi-gimbal aircraft (M300/M350) accept `0`-`2`. PSDK
  `E_DjiMountPosition`: M4T-class single-gimbal aircraft have only
  `DJI_MOUNT_POSITION_PAYLOAD_PORT_NO1 = 1` exposed via PSDK (which maps
  to WPML's `0` because PSDK is 1-indexed and WPML is 0-indexed for this
  field).
- **Current behavior**: every export emits `payloadPositionIndex=0`.
- **Why it's wrong (or risky)**: For the M4T this is **correct** — the
  M4T has one integrated multi-sensor turret on a single gimbal (the
  on-aircraft "main gimbal", not an H30T or Zenmuse payload). Confirmed
  by `enterprise.dji.com/matrice-4-series` and the
  `globaldronehq.com/blogs/news/dji-matrice-400-vs-matrice-4e-vs-matrice-4t-enterprise-comparison-2026`
  comparison: "the Matrice 4T carries a four-camera array plus thermal
  sensor and laser rangefinder on a single 3-axis stabilized gimbal".
  So no behavioural risk, but for M300 RTK / M350 RTK / non-M4T drones
  in the table the hardcoded `0` may be wrong if the operator mounts the
  camera on the second gimbal port (uncommon for inspection but possible
  for dual-payload missions). The audit document
  `docs/kmz-wpml-audit.md` §7 already records this constraint as M4T-
  specific.
- **Evidence**: `mission_config.py:230` — `"0"` is a literal, not
  pulled from `drone_profile`. There is no `drone_profile.payload_position`
  field today. M4T spec confirms single-gimbal hardware.
- **Proposed fix**: Long-term, surface `payload_position_index` on
  `DroneProfile` (default `0`) so a future dual-payload mission can
  override it. Short-term, leave the literal `"0"` but add a comment
  citing the single-gimbal invariant and reference the WPML spec
  `common-element.md` definition. Today the M4T case is fine.
- **HW verify**: Not required for M4T. For M300/M350 multi-payload
  missions, the operator would discover the issue at flight-time
  (camera doesn't trigger from the mounted port).

### [P2-2] `_dji_enums_for` provenance docstring overstates the M30T-collapse theory

- **Severity**: conformance (documentation hygiene)
- **Location**: `backend/app/core/constants.py:78-97` (the table docblock)
  and `docs/audits/2026-05-15-dji-wpml-spec-audit.md:196-204` (§3.1).
- **Spec / Source**: the PSDK header is the contradicting source —
  `DJI_AIRCRAFT_TYPE_M4T = 99` and `DJI_CAMERA_TYPE_M4T = 89` are
  M4T-native PSDK identifiers, not M30T values. M30T's PSDK aircraft type
  is `68` (not even `67`), and M30T's camera is `53` (not `89`). So the
  "FH2 collapses every M4T export onto the M30T enum" theory does not
  hold for either primary enum.
- **Current behavior**: The doc-string at `constants.py:84` reads:
  > "the m4t pair (99/1/89/0) is empirical - lifted from a real m4t fh2
  > export and litchi-confirmed".

  The 2026-05-15 audit §3.1 reads:
  > "the pair is the M30T enum set. ... the community-observed value
  > (and the FH2 export shape) collapses every M4T mission onto the M30T
  > enum so FH2's preview renderer follows the gimbal correctly."

  And `docs/kmz-wpml-audit.md` §11 reads:
  > "values were observed in the operator's own FH2 round-trip exports,
  > so they are probably closer to right than wrong, but the theory 'FH2
  > normalizes every export to m30t' is an inference, not a fact".
- **Why it's wrong (or risky)**: future readers chasing a bug see the
  "M30T collapse" framing in two of three sources and assume the M4T
  values are a hack. They are not — `99/89` are the M4T's PSDK-documented
  aircraft and camera identifiers, the WPML spec doc is just stale. A
  future "let's fix this back to the right M4T value" PR could
  unknowingly break a working export.
- **Evidence**: PSDK header diff above. The values match exactly.
- **Proposed fix**: Update the docblock in `constants.py:78-97` to cite
  the PSDK header verbatim as the source for `99` (aircraft) and `89`
  (camera). Update `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §3.1
  to retract the "M30T enum set" framing — replace with "M4T-native PSDK
  identifiers; WPML spec doc has not been updated past M3 generation".
  Update `docs/kmz-wpml-audit.md` §11 to note that two of the four
  numbers (`99/89`) are now corroborated by the PSDK header; the
  remaining ambiguity is the `1` sub-enum.
- **HW verify**: Documentation-only.

### [P2-3] No assertion that `droneEnumValue` is the *correct* M4T value at write time

- **Severity**: conformance (defense-in-depth)
- **Location**: `backend/app/services/export/dji/mission_config.py:223-230`
  (`_append_mission_config` write site).
- **Spec / Source**: WPML reserves no validation hook on its side — the
  spec is prose, and the consumer (Pilot 2) is the only checker.
- **Current behavior**: `_append_mission_config` writes whatever
  `_dji_enums_for` returns with no shape check. A future bug that swaps
  the order in the tuple (e.g. `(payload_enum, payload_sub, drone_enum,
  drone_sub)`) would happily ship `(89, 0, 99, 1)` to Pilot 2.
- **Why it's wrong (or risky)**: Existing tests (`test_export_service.py:1544`)
  pin the byte-level outputs and would catch a reorder, so the risk is
  low. But the constant-table → write-site contract has no in-code
  assertion. A drone added to `DJI_WPML_ENUMS` with a typo
  (e.g. `("M2 Enterprise", ("66", "0", "77", "0"))` — swapped) would
  ship.
- **Evidence**: No type-level constraint beyond `tuple[str, str, str, str]`.
- **Proposed fix**: Optional — add a `_validate_drone_enum_tuple(model,
  tup)` shape check at table-define time (in `constants.py`) that
  asserts each element parses as `int` and the drone enum is one of the
  WPML-documented `{60, 67, 77, 89, 91, 99, 100, 990, 1000, 103}` set.
  Trade-off: rejects future unknown values, so it is a brittleness vs.
  safety call.
- **HW verify**: Not required.

## Upgrades (P3)

### [P3-1] Capture a real Pilot 2 M4T export — gold-standard reference fixture

- **Why**: this is the *only* way to settle the `droneSubEnumValue` and
  resolve the audit ambiguity in P1-1, plus surface anything else the
  exporter is silently divergent on (turn-mode emission, focus actions,
  thermal `payloadLensIndex` token spelling, exact `xmlns:wpml` minor
  version).
- **Workflow** (the M4T-bench recipe from `docs/kmz-wpml-audit.md` §6,
  reordered to make this audit's questions answerable in one bench
  session):
  1. Author a 4-waypoint mission in DJI Pilot 2 on the actual M4T:
     - 4 waypoints around a known POI
     - 1 waypoint with `Take Photo` action, 1 with `Start Record` /
       `Stop Record` pair, 1 hover
     - 1 waypoint with non-default turn mode (curve-through)
     - 1 waypoint with non-default heading mode (towardPOI or
       smoothTransition)
     - thermal capture enabled (gives the `ir` token in
       `payloadLensIndex`)
     - explicit `finishAction=goHome` to capture the missionConfig
       envelope
  2. Export to microSD via Pilot 2 → unzip → check
     `template.kml`'s `<wpml:missionConfig>` block.
  3. Record verbatim:
     - `<wpml:droneEnumValue>` (predicted: `99`)
     - `<wpml:droneSubEnumValue>` (the unknown — this is the gold)
     - `<wpml:payloadEnumValue>` (predicted: `89`)
     - `<wpml:payloadSubEnumValue>` (predicted: `0`; could be `1`/`2`
       depending on which integrated lens Pilot 2 keys on)
     - `<wpml:payloadPositionIndex>` (predicted: `0`)
     - `xmlns:wpml="http://www.dji.com/wpmz/X.Y.Z"` namespace minor
       version (the exporter writes `1.0.6`; FH2 may write `1.0.7+`).
  4. Check the file into `backend/tests/data/m4t_pilot2_reference.kmz`
     as the byte-level reference. Add a `test_m4t_enums_match_reference`
     test in `test_export_service.py` that diffs the four enum fields
     against the reference.
- **Cost**: ~30 minutes of bench time on a real M4T + RC2; zero code
  work. The artifact unlocks every future M4T-WPML decision in this
  repo. This is the missing piece `docs/kmz-wpml-audit.md` §6 calls out
  as "the single highest-value artifact".

### [P3-2] Add a `com.dji:wpmz` Maven-Central harness to extract enums from the official generator

- **Why**: the `com.dji:wpmz` library is DJI's first-party Kotlin/Java
  KMZ builder (MIT-licensed, on Maven Central). It models every WPML
  field as a Java enum or sealed class — including the drone and payload
  enums. The library's compiled JAR shipped to Central contains the
  authoritative M4T values *as data*, without needing a physical
  aircraft.
- **Workflow**:
  1. Add a tiny Gradle/Maven harness (one file:
     `scripts/dji-wpmz-extract/build.gradle.kts` +
     `Main.kt`) that depends on `com.dji:wpmz:<latest>`.
  2. Reflect over the `DroneType` / `PayloadType` (or whatever the
     library calls them — JAR inspection would resolve this) and print
     each constant's `name → enumValue` mapping.
  3. Diff against `DJI_WPML_ENUMS`.
- **Cost**: ~1-2 hours of one-off setup; reusable for any future enum
  question. Less authoritative than a Pilot 2 export (the library may
  lag firmware) but more authoritative than the markdown spec.

### [P3-3] Expose a CLI / endpoint to dump the resolved enum tuple for a mission before export

- **Why**: operator-facing diagnostic. Today the operator clicks
  "Export → DJI KMZ" and gets a binary file; they cannot easily check
  what enum tuple was emitted without unzipping it. A
  `GET /api/v1/missions/{id}/export-preview?format=KMZ` endpoint
  returning `{ drone_enum, drone_sub, payload_enum, payload_sub,
  payload_position, namespace_version, fallback_used: bool, model: str }`
  lets the operator confirm the file is labeled correctly without
  going through Pilot 2.
- **Cost**: ~1 hour for a thin read-only route + frontend display in
  `ExportPanel`. Pairs well with the existing "drone fallback" confirm
  modal — instead of asking "are you sure?", show the operator what the
  file *will* be labeled as.
