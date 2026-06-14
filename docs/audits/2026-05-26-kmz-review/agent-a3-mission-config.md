# Agent A3 - <wpml:missionConfig> block

Scope: every child of `<wpml:missionConfig>` emitted by
`backend/app/services/export/dji/mission_config.py::_append_mission_config`,
in both `template.kml` and `waylines.wpml`. Audited against the WPML 1.0.6
spec (`template-kml.md`, `waylines-wpml.md`, `common-element.md` - fetched
2026-05-26). Verifies the §2 fixes from `docs/audits/2026-05-15-dji-wpml-spec-audit.md`
remain in place AND looks for anything new.

Sibling agents own neighbouring scopes:
- B1: drone enum domain. B5: payload enum domain. C2: turn modes / damping.
- B2: altitude encoding. B3: heading. B4: gimbal.

Where this report touches `droneInfo` / `payloadInfo`, it audits the **block
shape and ordering only** (per the brief); the enum *values* themselves are
B1/B5's call. One enum-domain crossover finding is recorded as P1-1 because
it impacts how the missionConfig block validates, not just the drone/payload
identity.

## Canonical child order (from `template-kml.md`)

```
flyToWaylineMode
finishAction
exitOnRCLost
executeRCLostAction
takeOffSecurityHeight
takeOffRefPoint           (template.kml only)
takeOffRefPointAGLHeight  (template.kml only)
globalTransitionalSpeed
globalRTHHeight           (waylines.wpml only)
droneInfo
payloadInfo
```

Exporter emits the surviving children in this exact sequence
(`_append_mission_config` lines 196-230). `waylineAvoidLimitAreaMode` is
absent (audit §2.1 stays clean). `globalRTHHeight` is gated on
`in_waylines=True` (audit §2.2 stays clean). `takeOffRefPoint` and
`takeOffRefPointAGLHeight` are gated on `not in_waylines` (template only) -
spec-conformant.

## Summary
- P0 blockers: 0
- P1 high: 2
- P2 conformance: 3
- P3 upgrades: 2

## Verified - §2 fixes still applied

- **§2.1 `waylineAvoidLimitAreaMode` drop**: not emitted anywhere in
  `mission_config.py` or `builders.py`. Clean.
- **§2.2 `globalRTHHeight` waylines-only scoping**: `mission_config.py:215-221`
  branches on `in_waylines` and emits the element only in the waylines mirror.
  The template config block stops at `globalTransitionalSpeed`. Clean.
- **§2.3 child ordering**: matches the canonical sample byte-for-byte (the
  inline comment at `mission_config.py:187-191` is the contract).

## Findings

### [P1-1] `payloadSubEnumValue` is not a documented child of `wpml:payloadInfo`

- **Severity**: high (strict-validator rejection risk; not yet observed in
  Pilot 2)
- **Location**: `backend/app/services/export/dji/mission_config.py:227-230`
  (`_append_mission_config`).
- **Spec**: `common-element.md` documents `wpml:payloadInfo` with exactly two
  children: `wpml:payloadEnumValue` and `wpml:payloadPositionIndex`. The
  template.kml and waylines.wpml canonical samples both emit only those two,
  in that order, with NO `payloadSubEnumValue`:

  ```xml
  <wpml:payloadInfo>
    <wpml:payloadEnumValue>52</wpml:payloadEnumValue>
    <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
  </wpml:payloadInfo>
  ```

  `payloadSubEnumValue` does not appear anywhere in the WPML doc set for the
  payload block. The only "sub enum" the spec documents is
  `droneSubEnumValue` on `droneInfo` (M30/M30T disambiguation etc.).
- **Current behavior**: `_append_mission_config` emits a three-child block in
  the order `payloadEnumValue, payloadSubEnumValue, payloadPositionIndex`.
  The middle child uses `DJI_WPML_ENUMS[<model>][3]` (the fourth tuple slot,
  `"0"` for every mapped drone). The order also injects `payloadSubEnumValue`
  BETWEEN the two documented children, breaking the canonical
  `payloadEnumValue -> payloadPositionIndex` adjacency.
- **Why it's a P1 not P0**: Pilot 2 v10.x has tolerated this (the operator's
  past flights imported), so it isn't a launch-blocker today. But strict
  validators (`com.dji:wpmz` library, `IWPMZManager.checkValidation`) will
  flag an undocumented child, and the audit §2.1 / §2.4 precedent already
  shows DJI tooling rejecting elements the canonical sample omits. The
  out-of-order insertion is the second risk - `_append_mission_config` is
  otherwise canonical-order-strict, so a strict reader that recovers from the
  unknown child could still trip on the ordering.
- **Proposed fix**: stop emitting `payloadSubEnumValue`. Drop the fourth slot
  from `DJI_WPML_ENUMS` (or keep it for future use but don't write it). Pin
  with a regression test in `test_export_service.py` asserting
  `payloadInfo`'s child sequence is exactly `[payloadEnumValue,
  payloadPositionIndex]`.
- **HW verify**: post-fix, re-export mission `7ca4a234` and confirm Pilot 2
  still launches; FH2 still renders the payload correctly. No flight needed -
  this is a file-shape change, the executed wayline is unaffected.

### [P1-2] `globalTransitionalSpeed=15` hardcoded ignores drone profile + mission speed

- **Severity**: high (mission-level fail-safe behaviour)
- **Location**: `backend/app/services/export/dji/mission_config.py:213`.
- **Spec**: `common-element.md`: `globalTransitionalSpeed` is "> 0 m/s" and
  documented as "Speed to first waypoint and recovery speed" (the canonical
  samples show 8 m/s and 10 m/s). It is the speed the drone uses to fly to
  WP1 (template `safely` mode) AND the speed it uses after returning from
  an RTH or RC-loss event before re-engaging the wayline.
- **Current behavior**: literal string `"15"` for every export, every
  drone, every mission. No clamp against drone profile max, no fallback to
  `mission.default_speed` or the resolved `auto_speed`.
- **Why it's a P1 not P0**: M4T's max cruise is ~23 m/s so 15 is in range
  and won't cause Pilot 2 rejection. The risk is operational: for a
  conservative mission whose `default_speed` is 5-8 m/s, the recovery /
  fly-to-WP1 phase will run at nearly 2x cruise, which is surprising to the
  operator and can stress the framing budget on tight LHAs. For an
  imaginable future low-speed drone (sub-15 m/s max), the value goes
  out-of-range and Pilot 2 will reject the file.
- **Proposed fix**: derive `globalTransitionalSpeed` from
  `mission.default_speed` (clamped to `[1, drone_profile.max_speed or 15]`).
  Falls back to 15 for the no-mission / no-default-speed branch. The
  resolver already exists pattern-wise in `_resolve_auto_speed`.
- **HW verify**: pick a mission with `default_speed=5 m/s`, export, confirm
  the wayline transition phase runs at 5 m/s in Pilot 2 telemetry rather than
  15.

### [P2-1] `executeRCLostAction=goBack` is functionally inert with `exitOnRCLost=goContinue`

- **Severity**: medium (conformance / clarity)
- **Location**: `backend/app/services/export/dji/mission_config.py:200-201`.
- **Spec**: `common-element.md`: `executeRCLostAction` is "Required when
  `exitOnRCLost` = `executeLostAction`". Enum domain `{goBack, landing,
  hover}`. The canonical sample emits it unconditionally even with
  `exitOnRCLost=goContinue` (sample shows `goContinue` + `hover`), so
  emission is fine - the value is just dead.
- **Current behavior**: `exitOnRCLost=goContinue` (the wayline continues on
  RC loss; `executeRCLostAction` is inert) paired with `executeRCLostAction=
  goBack`. The pair is internally consistent ("when the wayline ends or
  fails, return to home"), but the dead-value choice still warrants a comment
  pinning the intent.
- **Why P2**: spec-conformant, both samples emit the same shape, no rejection
  risk. The value is operationally inert because `goContinue` short-circuits
  ever reaching the `executeRCLostAction` branch. If a future change flips
  `exitOnRCLost` to `executeLostAction`, the operator gets `goBack` (RTH) on
  RC loss - safe, but the choice should be deliberate.
- **Proposed fix**: leave the value at `goBack` but add an inline comment
  explaining it's inert under `goContinue` and what flipping `exitOnRCLost`
  would do.

### [P2-2] `takeOffRefPointAGLHeight=0` is a hardcoded sentinel

- **Severity**: medium (conformance / spec semantics)
- **Location**: `backend/app/services/export/dji/mission_config.py:212`.
- **Spec**: `template-kml.md` sample shows `takeOffRefPointAGLHeight=35`;
  `common-element.md` describes it as "Corresponds to ellipsoid height
  reference", units meters. The spec is sparse on the meaning - it's the
  AGL height of the `takeOffRefPoint`'s position above local ground. Pilot 2
  uses it to validate the takeoff-point alt math.
- **Current behavior**: literal `"0"` on every export. This is internally
  consistent with the post-#508 stance that `takeOffRefPoint` is informational
  only and the firmware uses live ground at takeoff, but it doesn't match
  what FH2 / Pilot 2 emit (real authoring exports the surveyed AGL).
- **Why P2**: tolerated by Pilot 2 today (mission imports), but a strict
  validator could flag the mismatch with the spec sample. More importantly,
  for the airborne scopes the value should semantically equal the operator's
  hand-launch AGL above local ground (the height they're holding the drone
  before triggering the wayline) - emitting `0` mis-labels the operator
  reference frame.
- **Proposed fix**: emit `takeOffRefPointAGLHeight` as `0` for the airborne
  scopes (matches "takeoff is collocated with WP1 at airport ground"), and
  the difference between operator takeoff alt and airport ground for FULL
  (clamped to 0 when negative). Document the choice with an inline comment.

### [P2-3] `globalTransitionalSpeed` emitted in both files but not consulted by the wayline

- **Severity**: medium (conformance)
- **Location**: `backend/app/services/export/dji/mission_config.py:213`.
- **Spec**: `common-element.md` does not scope `globalTransitionalSpeed` to
  one file. Both canonical samples emit it (template `8`, waylines `10` in
  the spec sample - the values can differ between the two files in the
  spec's own examples, suggesting the template's is for planning preview and
  waylines' is what Pilot RC honours during recovery).
- **Current behavior**: same literal `"15"` in both. No drift between files,
  no per-file semantics.
- **Why P2**: spec-conformant; same value in both is permitted. Calling out
  for awareness during the P1-2 fix - the template value can be the
  cruise-speed default, the waylines value can be the recovery speed (a
  conservative 5-8 m/s), if the operator wants to separate them. Not a bug
  today.

### [P3-1] `globalRTHHeight` floor `_MIN_RTH_HEIGHT_M = 100` is generous

- **Severity**: low (operationally over-conservative)
- **Location**: `backend/app/services/export/dji/mission_config.py:46-47, 157`.
- **Spec**: `common-element.md`: `globalRTHHeight` valid range, in the
  current scoping (relative-to-takeoff under `executeHeightMode=
  relativeToStartPoint`), is bounded by the WPML range
  `[2, 1500]` documented for RTH-related height fields. The 100 m floor is
  a chosen safety margin.
- **Current behavior**: `_global_rth_height` returns
  `max(100, min(ceil(max_wp_alt_rel + 20), 1500))`. On a typical PAPI
  mission with measurements 8-24 m above takeoff ground, the ceiling resolves
  to exactly 100 m even though `max_wp + 20 = 44`.
- **Why P3**: 100 m above takeoff is safe but conspicuous - on a runway with
  obstacle clutter under 50 m, the RTH ascent could be unnecessarily tall
  and waste battery during an actual RC-loss event. The fix is to lower the
  floor to match the spec's `[2, 1500]` minimum side, e.g. `_MIN_RTH_HEIGHT_M
  = max(30, max_obstacle_height_in_airport + 20)`, computed from the
  airport's obstacle table. Defer until the obstacle-aware floor is wanted
  operationally.

### [P3-2] `gotoFirstWaypoint` for airborne scopes leaves the drone at the last MH waypoint

- **Severity**: low (operational, not safety)
- **Location**: `backend/app/services/export/dji/mission_config.py:197`.
- **Spec**: `common-element.md`: `finishAction` enum
  `{goHome, noAction, autoLand, gotoFirstWaypoint}`. `gotoFirstWaypoint`
  means "fly back to WP1 after finishing the wayline, then hover until the
  operator takes over".
- **Current behavior**: For `MEASUREMENTS_ONLY` / `NO_TAKEOFF_LANDING` the
  exporter picks `gotoFirstWaypoint` so the drone doesn't auto-land or
  auto-RTH (the operator hand-launched and must hand-land). The drone hovers
  at WP1 after the final measurement.
- **Why P3**: `gotoFirstWaypoint` IS the right choice given the airborne
  scope contract - `goHome` would RTH to airport reference and `autoLand`
  would auto-land which the operator explicitly rejected. The alternative
  `noAction` would also work and saves the return-to-WP1 transit; the
  difference is whether the operator wants the drone to land/hover near WP1
  or at the last MH. Mention to the operator during HW verification so they
  pick the post-mission hover position deliberately. No code change.

## Cross-cutting notes

- The 4-tuple in `DJI_WPML_ENUMS` (`(drone_enum, drone_sub, payload_enum,
  payload_sub)`) is consumed by `_dji_enums_for` and unpacked into 4 separate
  `_sub_text` writes inside `_append_mission_config`. P1-1's "drop
  `payloadSubEnumValue`" would shrink the tuple to a 3-tuple; the function
  signature change ripples through `_dji_enums_for` and the call site, plus
  the M4T-fallback constant. Behaviour-preserving for the payload, but a
  table-shape change that needs migrating in lockstep.
- `_append_mission_config` is the canonical seam for missionConfig. No other
  emitter writes any child of `<wpml:missionConfig>`, so this report covers
  the full surface. `builders.py` is purely the document-assembly site.
- All findings are spec-conformance / range / scoping issues; none of the
  airborne-scope branching (`flyToWaylineMode=pointToPoint`,
  `finishAction=gotoFirstWaypoint`, `takeOffSecurityHeight=1.5`,
  `_takeoff_ref_point` collocation) is wrong - the audit §2 + the hot-area
  brief notes all check out.
