# KMZ export 20-agent review

Date: 2026-05-26
Branch: `feat/kmz-export-review`
Target: DJI Matrice 4T, WPML 1.0.6
Reference KMZ: `docs/specs/PAPI 22.kmz` (real Pilot 2 1.0.6 M4T export)

20 read-only agents in 5 waves of 4. This file is the consolidated
audit; per-agent reports + evidence live in
`docs/audits/2026-05-26-kmz-review/agent-<id>-<slug>.md`. The audit is
organised by the two operator priorities:

1. **Drone must fly** — no Pilot 2 rejection, no descent-to-ground, no
   mid-flight failure.
2. **Smooth drone + camera motion** during measurements.

Findings below are deduped across agents and **filtered against the
Pilot 2 1.0.6 M4T reference** (per agent E2 — six sibling-audit
findings were rejected by that ground truth).

---

## Recent context — PR #741 landed (2026-05-26)

`fix: replace placeholder drone specs with manufacturer-verified
values (#741)` landed on `main` mid-review. Two effects on this audit:

1. **DJI Matrice 4T is now a real `DroneProfile`** in
   `backend/app/seed.py` with manufacturer-verified specs
   (`max_speed=21.0`, `max_climb_rate=10.0`, `max_altitude=6000.0`,
   `camera_frame_rate=30`, `sensor_fov=82.0`, `sensor_base_focal_length=5.33`,
   etc.). The `model` field is `"Matrice 4T"`, matching the key in
   `app.core.constants.DJI_WPML_ENUMS` — the exporter can now look the
   M4T up directly.
2. **Two prior findings resolved at the seed level**:
   - **C1-P3** (M4T missing from seed) — done.
   - **B1-P1-2** (fallback labels every unmapped drone as M4T
     silently) — the fallback hack is now removable; the M4T lookup
     finds the real profile.

This creates a NEW work item: thread the seeded M4T profile values
through the exporter so it stops using hardcoded defaults. See
**Issue #8** in the triage section.

---

## Operator decisions (2026-05-26 review session)

- **P0-3 fix direction**: **DELETE FULL scope entirely**. Promote
  `NO_TAKEOFF_LANDING` to be the new default scope; keep
  `MEASUREMENTS_ONLY`. The descent-to-ground bug lives in
  FULL-specific code paths (TAKEOFF/LANDING placemark generation +
  the auto-takeoff-vs-wayline-WP1 collision); deleting those paths
  removes the bug. Side effect: deletes B2-P0-2 finding entirely.
  Migration: existing FULL missions either migrate to the new scope
  or get invalidated (operator call based on production data). The
  "drone must be airborne" precondition note STAYS — it now applies
  to both remaining scopes and IS the contract that lets the wayline
  omit takeoff/landing placemarks.
- **P1-2 (thermal lens)**: **deferred — hardcode visible-light-only**.
  Add an inline comment in `actions.py` / `mission_config.py` at the
  `imageFormat="visable"` emission site documenting (a) thermal is
  intentionally disabled, (b) how to enable when needed
  (multi-token `wide,ir` in imageFormat + per-action `payloadLensIndex`
  matching the MSDK #635 token list).
- **P1-3 (HR towardPOI)**: **operator-choice, no default change**.
  ExportPanel picker already exposes heading mode per-export. Confirm
  the picker is discoverable in the UI.
- **P1-6 (speed × framerate at export)**: **accepted as-is, won't fix**.
  Validation already enforces it.
- **General triage rule (2026-05-26)**: **don't fix anything that
  isn't actively breaking**. "Breaking" = causes Pilot 2 rejection,
  mid-flight failure, or operator-visible degraded behaviour. Things
  Pilot 2 currently tolerates stay as-is, regardless of strict-
  validator risk. The "future firmware tightening" argument is
  insufficient on its own. See "Deferred (not actively breaking)"
  section near the bottom for the list.
- **Golden fixture (E2-6 / E2-7)**: **not feasible** — no application
  can emit a KMZ with the full set of settings TarmacView produces.
  PAPI 22 covers a subset; the §6 "full golden mission" cannot be
  obtained from any DJI tool. The partial PAPI-22 tag-sequence test
  (E2-6) is also dropped under the "don't fix what isn't breaking"
  rule — its purpose was to prevent doc-derived false-positive fixes,
  but the operator decisions already filter those.

---

## Headline

Exporter is in better shape than the doc-derived audits suggested.
The publicly-available WPML doc set is namespace 1.0.2; Pilot 2 / M4T
runs 1.0.6 and emits elements the 1.0.2 docs don't show. Most A-group
"out of spec" findings were false positives once measured against the
real Pilot 2 export.

Real risks that remain:

- **5 P0 blockers** that can either (a) cause Pilot 2 to reject the
  file under a stricter validator firmware, or (b) put the drone at
  the wrong altitude for at least one waypoint. None has been observed
  to fire today; all are within one firmware-tightening or one
  edge-case mission from firing.
- **10 P1 smoothness / camera-quality issues**, most concretely
  testable. The single highest-impact one is **B5-P1-2** — the `zoom`
  action emits AFTER `takePhoto` in the action group, so the FIRST
  PAPI photo of each inspection is captured at the previous WP's zoom
  (typically 1×) instead of the configured 7×. That likely explains
  the operator's blurred-anchor symptom.
- **The audits themselves are stale on three points** — see "Audit
  corrections" at the end.

---

## P0 — Drone must fly (blockers)

Ordered by impact. All five fixes are small (1–20 line changes); the
test work is bigger than the code work.

### P0-1 — `waypointSpeed=0` emitted on TAKEOFF / LANDING / HOVER bookends

- Consensus from **A4-P1-2 / C1-P1-1 / C4-P0-1 / E1 (-6)**.
- `backend/app/services/export/dji/placemark.py:204` —
  `f"{wp.speed or 0:g}"` writes raw `0` whenever `wp.speed` is None or
  falsy.
- WPML range is `(0, max]` — zero is excluded. Trips
  `WaylineCheckError -6 WaypointSpeedOutOfRange` on
  `IWPMZManager.checkValidation()`.
- Currently Pilot 2 tolerates; Litchi exporter already has the
  canonical fallback chain (`wp.speed > mission.default_speed > min
  floor`).
- Fix: clamp at the writer; pin with a `default_speed=None` fixture
  that proves no `0` reaches the XML.

### P0-2 — Airborne scopes ignore per-point elevation provider

- **B2-P0-1**. `_takeoff_ref_msl` returns `airport.elevation` (a
  single constant) for `MEASUREMENTS_ONLY` / `NO_TAKEOFF_LANDING`.
- The PAPI-altitude audit (2026-05-11) added a per-point provider for
  takeoff/landing placement, but it's not threaded into the export.
- On airports with terrain variation across the operating area, every
  commanded altitude is offset by ΔH between `airport.elevation` and
  the actual ground at WP1 — potentially below intended AGL.
- Fix: thread the active `ElevationProvider` into `_takeoff_ref_msl`
  so the airborne-scope anchor matches the ground at the actual
  takeoff/handover point.

### P0-3 — FULL-scope first placemark emits `executeHeight=0` → FIX: delete FULL scope

- **B2-P0-2**. The TAKEOFF placemark sits at the anchor (relative
  height 0). After Pilot 2's auto-takeoff to `takeOffSecurityHeight`,
  `flyToWaylineMode=safely` positions the drone above WP1's lat/lon
  and descends to WP1's `executeHeight=0`. Because TAKEOFF placemark
  = WP1 = takeoff lat/lon AND `executeHeight=0`, the descent step
  lands the drone right back on the ground at the same spot — the
  exact "lands at start" symptom from `kmz-wpml-audit.md` §3.
- **Fix (operator-confirmed 2026-05-26)**: **delete FULL scope
  entirely**. Promote `NO_TAKEOFF_LANDING` to be the new default
  scope (rename to `FULL` or keep the NTL name — operator
  preference); keep `MEASUREMENTS_ONLY`. The bug lives in FULL-
  specific code paths; deleting them removes the bug. This also
  matches PAPI 22's shape (no ground bookends in the wayline).
- Migration: existing missions with `scope=FULL` either migrate to
  the new scope or get invalidated. Operator decides based on
  production data.
- The "drone must be airborne" precondition note STAYS — it now
  applies to both remaining scopes, and IS the contract that lets
  the wayline omit takeoff/landing placemarks. Operator hand-
  launches and gets the drone airborne before triggering the
  mission.
- **Side effect**: this fix also deletes B2-P0-2 (FULL-scope
  airport.elevation anchor problem) — no longer reachable.

### P0-4 — Below-takeoff measurements silently clamp to 0

- **B2-P0-3**. `placemark.py:167-180` logs a warning to a module
  logger, but nothing surfaces in the export response, validation
  panel, PDF, or audit row. The drone executes `executeHeight=0`
  literally — flies at takeoff-ground level for that WP regardless of
  the operator's intended `wp.alt`.
- Operator never learns the file was modified.
- Fix: raise to operator-visible warning at export time; refuse to
  export if any measurement clamps unless the operator explicitly
  acknowledges.

### P0-5 — `globalTransitionalSpeed=15` at exact spec ceiling

- **C1-P0-1**. `mission_config.py:213` hardcodes `"15"`, the
  inclusive maximum of the WPML range `[0, 15]`. Zero margin for any
  future Pilot 2 tightening to exclusive bounds, or for floating
  point inside `IWPMZManager.checkValidation`.
- DJI's own canonical samples emit `8` / `10`.
- Fix: clamp to `min(mission.default_speed or 8, drone.max_speed,
  14)` so the value is strictly below 15.

### Demoted from candidate-P0

- **A2's** waylines `<Folder>` child ordering finding is real but
  E2's diff against PAPI 22 shows Pilot 2 tolerates it today —
  demoted to **P1-7** below.

---

## P1 — Smoothness + camera quality (user priority #2)

### P1-1 — `zoom` emits AFTER `takePhoto` in `actionGroup`

- **B5-P1-2 / A5-P1-1**. `actions.py:221-235` order is
  `rotateYaw → gimbalRotate → hover → takePhoto → zoom`.
- `actionGroupMode=sequence`, so actions execute in emit order. The
  FIRST measurement of each inspection (the only WP
  `_first_zoom_emission_waypoints` adds zoom to) captures at the
  inherited / previous-WP zoom (typically 1×). The configured 7×
  only applies to SUBSEQUENT shots.
- This is the most plausible single cause of the operator's
  blurred / wrong-framing PAPI anchor frames.
- Fix: swap the two `if` blocks at `actions.py:221-235` so `zoom`
  emits before the camera-func actions. Trivial.

### P1-2 — Thermal lens (IR sensor) never used — DEFERRED (operator decision)

- **B5-P1-1**. `imageFormat` hardcoded `visable`. No
  `payloadLensIndex` emitted on any action.
  `useGlobalPayloadLensIndex=1` references a non-existent global.
- Per MSDK issue #635 the M4T falls back to "whichever lens is in
  the FPV view" when the global anchor is missing — non-deterministic.
- **Operator decision (2026-05-26)**: keep visible-light-only for
  now; PAPI inspections don't need thermal. The visible-only
  hardcode IS the intended behaviour. Action: add an inline comment
  at the emission site (`actions.py` + `mission_config.py` where
  `imageFormat="visable"` is written) documenting:
  - (a) thermal is intentionally disabled today;
  - (b) to enable: switch `imageFormat` to a multi-token value
    (e.g. `visable,ir` or `wide,ir`), thread a per-action
    `payloadLensIndex` matching MSDK #635's token list, and drop
    the `useGlobalPayloadLensIndex=1` (or define the global it
    references).
- For any future thermal-inspection method this becomes a blocker —
  the comment is the warning beacon.

### P1-3 — HR default `smoothTransition` causes yaw drift — OPERATOR-CHOICE

- **B3-P1-1 + B4-P1-1**. `_dji_heading_mode` defaults to
  `smoothTransition` (heading.py:84). For HR's non-linear bearing
  arc, linear yaw interpolation between per-WP angles drifts off-PAPI
  mid-segment and snaps back on arrival.
- `kmz-wpml-audit.md` §8 explicitly names `towardPOI` as "the
  correct mode" for HR.
- **Operator decision (2026-05-26)**: do NOT change the column-level
  default. The ExportPanel picker already exposes heading mode
  per-export; operator selects `towardPOI` per mission when needed.
  Confirm the picker is discoverable in the UI (verify label /
  positioning / help text are clear). No code change needed in the
  exporter.

### P1-4 — `0.2 m` turn-damping ceiling neuters passthrough smoothness

- **C2-P1-2**. `waypointTurnDampingDist` is the radius of the smooth
  arc the drone draws when "passing through" a waypoint in
  `toPointAndPassWithContinuityCurvature` mode. Spec scopes it to
  `(0, segment_length]`. Bigger arc = smoother transition + the
  drone keeps speed. Smaller arc = tighter turn + the drone has to
  decelerate hard to make the geometry work.
- Today the writer emits `min(0.2 m, 0.5 × nearest_leg)` on every
  continuity-curvature placemark. The `0.2 m` literal came from the
  default-stop path (where it's correct — stop-mode doesn't really
  arc, it just smooths a discontinuity).
- On a VP video inspection with measurements ~4 m apart, the math
  allows up to 2 m of damping but we emit 0.2 m. At 5 m/s forward
  speed a 20 cm arc demands roughly a 90° course change in ~40 ms,
  which the M4T autopilot cannot do smoothly — so it brakes before
  the WP, threads the 20 cm arc, and re-accelerates. That's the
  "stop-start jerk" the operator sees, even though the turn mode
  says "pass through".
- "Single biggest jerky-motion lever."
- Fix: split the literal. Keep `0.2 m` on the default-stop path.
  Bump the passthrough ceiling to ~`2.0 m` (or higher, hardware-
  tuned), then `min(2.0, 0.5 × nearest_leg)` keeps it under short
  legs. Principle: **let the arc match the geometry that's
  available**, don't cap it at the tiny stop-mode value.

### P1-5 — Zero-length-leg passthrough emits unclamped `0.2 m`

- **C2-P1-1 / C4-P1-2**. Tightly coupled to P1-4 and P1-8.
- Code shape today:

  ```
  nearest_leg = nearest_leg_lengths(...)   # may be None
  if is_passthrough and nearest_leg is not None:
      damping = min(0.2, 0.5 * nearest_leg)
  else:
      damping = 0.2     # unclamped fallback - the bug
  ```

- Two paths produce `nearest_leg=None`:
  1. RECORDING_START/STOP collocated bookends (P1-8) — adjacent legs
     are both 0 m.
  2. `resolve_inspection_collisions` reroute snapping two video
     measurements together (sub-metre or zero gap).
- When this hits a passthrough placemark, we emit `0.2 m` damping on
  a 0 m segment — spec range `(0, segment_length]` violated.
  `TestDjiTurnDampingClamp` only covers the positive-leg branch, so
  the regression net misses this.
- Pilot 2 tolerates the violation today; stricter
  `IWPMZManager.checkValidation()` would flag it. The drone behaves
  unpredictably trying to round a corner that doesn't exist —
  contributes to the jerky-motion symptom.
- Fix: when `nearest_leg=None`, drop the placemark to stop-mode (no
  arc needed on a degenerate segment), and skip the
  `waypointTurnDampingDist` emit entirely. Cleaner than emitting an
  out-of-range value.

### P1-6 — `is_speed_compatible_with_frame_rate` never called at export — ACCEPTED, WON'T FIX

- **C1-P1-3**. The model method exists on `Inspection` but only fires
  in `check_speed_framerate` at validation.
- **Operator decision (2026-05-26)**: accepted as-is. Mission
  validation already enforces speed/framerate compatibility — a
  validated mission cannot reach export with an incompatible speed.
  No export-boundary wire-up needed. The C1 agent's concern about
  post-VALIDATE edits is real in principle but doesn't fire in the
  current mission-status state machine (any post-VALIDATE trajectory
  edit regresses status to DRAFT and forces re-validation).

### P1-7 — `waylineCoordinateSysParam` emitted in waylines.wpml → DEFERRED (not breaking)

- **E2-1 + A2-P1-1**. The block:

  ```xml
  <wpml:waylineCoordinateSysParam>
    <wpml:coordinateMode>WGS84</wpml:coordinateMode>
    <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
  </wpml:waylineCoordinateSysParam>
  ```

  is emitted in BOTH `template.kml` AND `waylines.wpml` by
  `builders.py:221-223`. The Pilot 2 1.0.6 reference at
  `docs/specs/PAPI 22.kmz` emits it only in `template.kml` —
  `waylines.wpml` declares just `executeHeightMode` and INHERITS the
  coordinate frame from the template.
- The inline comment at `builders.py:217-220` claims "Pilot RC
  rejects waylines that don't declare how coordinates and heights
  are interpreted". That claim is contradicted by the reference
  file — Pilot 2 itself produces a wayline without the block, and
  obviously accepts what it produces.
- Two plausible histories: (a) an earlier RC fix added the block to
  placate a now-fixed Pilot 2 bug and was never removed;
  (b) the comment is reasoning from the 1.0.2 spec docs (which
  describe `waylineCoordinateSysParam` as a wayline param without
  scoping it to template), and Pilot 2 1.0.6 tightened scope to
  template-only.
- Pilot 2 tolerates the extra block today. Undocumented elements
  are a strict-validator risk; the 2026-05-15 audit's history
  (§2.1, §2.4) records repeated cases of Pilot 2 silently dropping
  elements outside their expected slot.
- **Operator decision (2026-05-26): DEFER. Pilot 2 tolerates it,
  nothing is breaking.** Fix when next touching `builders.py` for
  another reason. Strict-validator risk alone is not sufficient to
  justify a change. If/when Pilot 2 starts rejecting the block,
  promote to active and drop it from `_build_dji_waylines_wpml`.

### P1-8 — RECORDING_START/STOP bookends byte-collocated with measurement

- **C4-P1-2**. The trajectory generator emits HOVER waypoints before
  and after each video measurement to mark "start recording" and
  "stop recording". These HOVER waypoints share the EXACT same
  `(lat, lon, alt)` as the measurement they wrap.
- Result: three placemarks at the same physical point:

  ```
  Placemark N-1   HOVER (RECORDING_START)   pos = (lat, lon, alt)
  Placemark N     MEASURE                   pos = (lat, lon, alt) (same)
  Placemark N+1   HOVER (RECORDING_STOP)    pos = (lat, lon, alt) (same)
  ```

  The legs N-1→N and N→N+1 are both 0 m.
- This 0-m leg cascades into three independent failure modes:
  1. **Turn damping (P1-5)** — `nearest_leg=0` triggers the
     unclamped fallthrough.
  2. **`gimbalEvenlyRotate` over a 0-m segment** — undefined rotation
     rate; firmware likely treats as instant snap, defeating the
     smooth-sweep mechanism that VP video relies on.
  3. **`_body_tracks_target` bearing** — for `towardPOI` /
     `smoothTransition`, per-WP heading is computed from direction
     of travel; on a 0-m leg there is no direction of travel, so
     the bearing falls back to whatever the previous segment held
     (often visible yaw jitter on entry/exit).
- Litchi's exporter sidesteps all three by **merging bookends at
  the export boundary**: instead of three placemarks, emit one
  placemark at the measurement position with the `startRecord`
  action at the front of its actionGroup and the `stopRecord`
  action at the end (or with a `hover` action of the right
  duration between them). This is also closer to PAPI 22's shape —
  its `startRecord`/`stopRecord` are inside the actionGroup of the
  measurement placemark, not on separate bookend placemarks.
- Fix shape (deeper than the others): at the writer boundary
  (`placemark.py` / `video.py`), detect the collocated bookend
  pattern and merge actions into the measurement's actionGroup.
  Removes the 0-m legs entirely, restores well-defined geometry
  for damping, gives `gimbalEvenlyRotate` real segments, restores
  bearing computation on segment entry/exit.
- Risk: test churn — most tests assume the three-placemark shape.
  Worth pinning the merged shape against PAPI 22's actionGroup
  structure before refactoring.

### P1-9 — No gimbal pitch clamp against M4T soft limits → DEFERRED (not breaking)

- **B4-P2-1 / E1 (-30)**. Trajectory output is in-band today.
- **Operator decision: defer**. Purely defensive; nothing breaks.
  If a future inspection method or `altitude_offset` configuration
  produces out-of-band pitch, the clamp becomes necessary — add it
  then.

### P1-10 — Exported `<wpml:distance>` / `<wpml:duration>` diverge from orchestrator totals → DEFERRED (not breaking)

- **C4-P1-1**. ETA gap 10-20% on a typical mission.
- **Operator decision: defer**. ETA is operator-visible but doesn't
  affect flight. Fix when next touching the totals computation.

---

## P2 — Conformance hardening → ALL DEFERRED (none actively breaking)

**Operator decision 2026-05-26**: defer everything in this category.
Pilot 2 tolerates all of them. Listed here as a backlog — if any
single one starts manifesting as a real Pilot 2 rejection or
mid-flight issue, promote and fix.

- **A5-P2-1** — `actionGroup` omits `actionTriggerParam`. Spec
  optional; PAPI 22 emits it. Strict-validator risk only.
- **B5 P2-1/2/3** + **A5-P2-3** — missing `payloadLensIndex` /
  `fileSuffix` on photo/record actions. Spec-tolerant when
  `useGlobalPayloadLensIndex=1` is set.
- **D1-P1** — `globalHeight` template-folder consistency unpinned.
  Defensive test only.
- **D1-P1** — `takeOffSecurityHeight ≥ 1.2 m` bound unpinned.
  Defensive test only.
- **D1-P1** — `batch_update_waypoints` elevation contract drift —
  pin or update the audit, but no current bug.
- **E2-3 / E2-4** — `useGlobalSpeed=1` / `useGlobalHeight=0`
  unconditional emission. Over-conformance.
- ~~**B1-P1-2** — fallback path labels unmapped drones as M4T~~ —
  the silent-fallback hack is removable now that M4T is a real
  profile (PR #741). Bundled into Issue #7 below.
- **C3-P1-1** — POI precision drift (7 cm). Within tolerance.

---

## P3 — Upgrades

- **E2-7** ~~author Phase-0 golden fixture~~ — **NOT FEASIBLE
  (operator confirmed)**. No application can emit a KMZ with the
  full set of settings TarmacView needs: Pilot 2 authors a subset
  (no VP video / HR video / towardPOI / 4-LHA / IR combinations),
  and PAPI 22 covers only basic placemark + actions. The codebase
  remains the source of truth for multi-construct cases. The
  audit's §6 "full golden mission" assumption was wrong — leaving
  this here as a record so future readers don't try again.
- **E2-6** (partial) — a structural-tag-sequence test that compares
  against PAPI 22 IS doable for the elements it covers (template
  Document/Folder/Placemark/actionGroup ordering for a simple
  followWayline mission). It would have caught the six E2-rejected
  sibling findings. It will NOT catch divergences in the
  construct combinations PAPI 22 doesn't exercise.
- **E2-2 (`customDirName`)** — Pilot 2 emits `customDirName` at
  every actionGroup with `directoryName=<mission name>`, controlling
  the SD-card folder. Without it, media lands in `DCIM/100MEDIA/` and
  the operator manually sorts by timestamp. A 4-LHA PAPI inspection
  produces 80+ files.
- **E2-5** — parameterise `wpml:author` from `current_user` instead
  of the literal `"TarmacView"`.
- ~~**B1-P3** — M4T as a real `DroneProfile` in `seed.py`~~ —
  **RESOLVED by PR #741** (2026-05-26). `Matrice 4T` is now in
  `DRONE_PROFILES` with manufacturer-verified values. Exporter
  consumption of those values is a separate issue — see Issue #7
  in the triage section.
- **D2-P3** — write tests for the entirely-untested inspection
  methods: `HOVER_POINT_LOCK`, `APPROACH_DESCENT` (the recently-landed
  ZEPHYR procedure e, #718). Coverage of the cross-product
  `heading_mode × scope × capture_mode × inspection_method` sits at
  6–13 % of cells.
- **B4-P2-2** — set `gimbalRotateTimeEnable=1` + a small
  `gimbalRotateTime` on the FIRST measurement's gimbal anchor only —
  smooths the recorded gimbal slew without affecting subsequent
  suppressed snaps.
- **C1-P3** — auto-tune `waypointSpeed` to frame-rate compatibility
  rather than only checking it.
- **B2 P3** — swap the closed-form `egm96_undulation` for
  `geographiclib`'s 16 MB egm96-15.pgm grid (~10 m → ~1 m global
  accuracy). Needs `backend/requirements.txt` (protected) change.

---

## Audit-doc corrections

Several claims in the existing audit docs are stale or wrong; they
should be updated as part of the doc-gardening pass that follows the
fixes.

- **B1**: `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §3.1 frames
  `99/89` as an "M30T collapse / FH2 normalises every export to M30T".
  The DJI PSDK header `psdk_lib/include/dji_typedef.h` defines
  `DJI_AIRCRAFT_TYPE_M4T = 99` and `DJI_CAMERA_TYPE_M4T = 89` —
  these ARE the correct M4T values, not an M30T collapse. M30T is
  PSDK aircraft `68`. The "FH2 collapse" theory is wrong.
- **E2**: `kmz-wpml-audit.md` and the 2026-05-15 audit derive
  multiple structural rules from the public WPML 1.0.2 doc set.
  Pilot 2's real 1.0.6 export (`docs/specs/PAPI 22.kmz`) emits
  `globalHeight`, `caliFlightEnable`, `globalUseStraightLine`,
  `payloadSubEnumValue`, and places `payloadParam` AFTER Placemarks.
  All of these were flagged as "not in spec" by sibling agents using
  the 1.0.2 docs — and all were rejected once measured against
  ground truth. The doc-derived claims should be qualified.
- **B2-P1-2**: 2026-05-15 audit §1.4 says the closed-form
  `egm96_undulation` is "~10 m global accuracy". Cross-checks at
  Tokyo (~69 m off, wrong sign) and Mumbai (~28 m off) show it is
  worse globally. Calibrated only at LZIB / Jaro Luka (~1.7 m off
  there). Not load-bearing today (the fix is the relative
  encoding) but the claim is wrong.

---

## False positives (E2 rejections — DO NOT land these as fixes)

These would diverge TarmacView further from Pilot 2's own output.
Listed here so future readers can see why they were filed and not
acted on:

| Filed by | Filing | Why rejected |
|----------|--------|--------------|
| A1-P1-1 | drop `globalHeight` from template Folder | PAPI 22 line 36 emits `globalHeight=145` in the exact slot |
| A1-P1-2 | drop `caliFlightEnable` | PAPI 22 line 37 emits it on a waypoint template |
| A1-P1-3 / B5 | move `payloadParam` before Placemarks | PAPI 22 lines 217-226 — Pilot 2 puts it AFTER Placemarks |
| A1-P2-1 / A4-P0-2 | gate `globalUseStraightLine` on turn mode | PAPI 22 line 47 emits it with a stop-mode turn |
| A3-P1-1 | drop `payloadSubEnumValue` | PAPI 22 lines 22-26 — Pilot 2 emits the three-child block in the same order |
| A4-P0-1 | emit 3-D `<coordinates>` in Placemarks | PAPI 22 emits 2-D coordinates; altitude is in `<wpml:ellipsoidHeight>` / `<height>` / `<executeHeight>` |

After fixes land, add inline comments in `builders.py` /
`mission_config.py` / `placemark.py` at the emission sites citing
`PAPI 22.kmz` so a future reader does not "fix" these back.

---

## Recommended triage (final, 2026-05-26)

Only items that are actively breaking. Operator-confirmed rule: defer
anything Pilot 2 tolerates today.

### Issue #1 — `fix: dji action correctness — zoom order + thermal-lens comment`

Combines **P1-1 + P1-2**.

- Reorder `zoom` before `takePhoto` in the reach-point actionGroup
  (`actions.py:221-235`) — fixes blurred PAPI anchor frame.
- Inline comment at `imageFormat="visable"` emission sites + a short
  block in `backend/app/services/export/dji/CLAUDE.md` documenting
  (a) thermal disabled intentionally, (b) how to enable when needed
  (multi-token `wide,ir` + per-action `payloadLensIndex`).
- **Tier**: T2. **HW verify**: regenerate one PAPI mission, fly at
  7×, confirm first frame is at 7× not 1×.

### Issue #2 — `fix: clamp dji waypointSpeed to spec range (0, max]`

**P0-1**. Writer-level clamp in `placemark.py:204` with fallback
chain `wp.speed > mission.default_speed > min_floor`. One regression
test with `default_speed=None` fixture.
- **Tier**: T2. **HW verify**: not required.

### Issue #3 — `fix: clamp dji globalTransitionalSpeed below spec ceiling`

**P0-5**. `mission_config.py:213` — replace literal `"15"` with
`min(mission.default_speed or 8, drone.max_speed, 14)`. Now that the
M4T profile is seeded (PR #741), `drone.max_speed=21.0` is real.
- **Tier**: T2. **HW verify**: not required.

### Issue #4 — `feat: surface below-takeoff altitude clamp to operator at export`

**P0-4**. Raise the silent log warning to an operator-visible export-
time warning; refuse export unless operator acknowledges. Backend
collects clamped WPs into the export response; ExportPanel surfaces
the warning.
- **Tier**: T2. **HW verify**: not required (UI-only signal).

### Issue #5 — `feat: drop FULL mission scope, promote no-takeoff-landing to default`

**P0-3** (deletes B2-P0-2 by structural removal).

- Remove `FULL` from `MissionScope` enum + DB migration for existing
  `scope=FULL` rows (operator decides migrate vs. invalidate).
- Drop FULL-specific code paths (TAKEOFF/LANDING placemark emission,
  airport.elevation anchor math).
- Frontend `MissionConfigForm` / `ExportPanel`: drop FULL from
  picker; surface "drone must be airborne" precondition note on the
  remaining scopes.
- **Tier**: T3. Manual approval. **HW verify**: hand-launch M4T,
  fly the new default scope, confirm no descent-to-ground.

### Issue #6 — `feat: thread per-point elevation provider through dji export anchor`

**P0-2**. Thread the active `ElevationProvider` into `_takeoff_ref_msl`
for the new default scope (formerly NTL). Pin the unpinned
`globalHeight` consistency invariant (D1) while in the file.
- **Tier**: T3. Manual approval. **HW verify**: regenerate one
  mission at LZIB / Jaro Luka, fly, confirm AGL holds across the
  airfield. Lands after Issue #5 so the provider wires into the
  renamed scope.

### Issue #7 — `feat: consume M4T drone profile values in dji exporter, drop silent fallback`

**NEW**. Created in response to PR #741.

- Replace hardcoded fallback enums `(99, 1, 89, 0)` in
  `mission_config.py::_dji_enums_for` with a lookup from the drone
  profile (or `DJI_WPML_ENUMS` keyed by `drone.model`). M4T resolves
  to its profile-stored values; unmapped drones get a clear refusal,
  not a silent M4T impersonation (B1-P1-2 fix).
- Use `drone.max_speed=21.0` in the Issue #3 speed clamp (closes
  the loop between the seed and the exporter).
- Use `drone.max_climb_rate=10.0` and `drone.max_altitude=6000.0`
  wherever the exporter currently hardcodes safe-default ceilings.
- Use `drone.camera_frame_rate` / `drone.sensor_base_focal_length` /
  `drone.sensor_fov` if the exporter currently emits hardcoded
  values for these (audit pass; surface any sites in this issue's
  body).
- **Tier**: T2 (no trajectory math touched; just plumbing real
  values through the writer). **HW verify**: regenerate one
  M4T mission, confirm emitted `globalTransitionalSpeed`,
  `autoFlightSpeed`, and ceiling guards reflect the profile.

### Issue #8 — `feat: merge recording bookends, rework turn damping, sync duration math`

Combines **P1-4 + P1-5 + P1-8 + P1-10**. Three coupled smoothness
fixes plus the duration math that the bookend merge effectively
requires anyway.

- **P1-8**: detect collocated HOVER+MEASUREMENT in
  `trajectory/helpers.py:443-469`; merge `startRecord` / `stopRecord`
  into the measurement's actionGroup; drop standalone HOVER
  placemarks. Pin merged shape against PAPI 22's actionGroup
  structure.
- **P1-5**: when `nearest_leg=None`, drop to stop-mode rather than
  emitting unclamped `0.2 m` damping.
- **P1-4**: split the `0.2 m` literal — keep on default-stop path;
  raise passthrough ceiling to `~2.0 m`, clamp by
  `min(ceiling, 0.5 × nearest_leg)`.
- **P1-10**: while rewriting `_emitted_distance_duration`, lift
  `_segment_duration_with_accel` into a shared helper so
  `<wpml:distance>` / `<wpml:duration>` match the orchestrator's
  totals.
- **Tier**: T3 (touches `trajectory/`). Manual approval.
  **HW verify**: regenerate a 4-LHA PAPI mission with VP video; fly
  with 7× zoom; confirm gimbal pitch sweeps smoothly across each
  segment, aircraft yaw continuous, ETA matches mission report.

### Land order

| # | Issue | Tier | HW verify |
|---|-------|------|-----------|
| 1 | #1 actions correctness + thermal comment | T2 | yes (7× framing) |
| 2 | #2 waypointSpeed clamp | T2 | no |
| 3 | #3 globalTransitionalSpeed clamp | T2 | no |
| 4 | #4 surface clamp warning | T2 | no |
| 5 | #7 consume M4T profile values | T2 | yes (one M4T regenerate) |
| 6 | #5 delete FULL scope | T3 | yes (hand-launch flight) |
| 7 | #6 per-point elevation provider | T3 | yes (terrain-varying flight) |
| 8 | #8 smoothness + duration bundle | T3 | yes (VP video at 7×) |

Issue #7 can land any time it has Issue #3 to consume; it does not
block downstream scope work.

### Deferred (not actively breaking)

- **P1-7** waylineCoordinateSysParam in waylines.wpml — Pilot 2 OK.
- **P1-9** gimbal pitch clamp — trajectory in-band today.
- **All P2** conformance items — Pilot 2 OK.
- **E2-6** partial structural-tag-sequence test — defensive only.

### Cancelled

- **P1-3** HR towardPOI default flip — operator-choice via picker.
- **P1-6** speed×framerate at export — validation handles it.
- **E2-7** full Phase-0 golden fixture — not obtainable from any
  DJI tool.
- **B2-P0-2** FULL-scope first-placemark descent — deleted by
  Issue #5 (FULL scope removal).

---

## Per-agent index

| Agent | Scope | File | P0 | P1 | P2 | P3 |
|-------|-------|------|----|----|----|----|
| A1 | template.kml root structure | [agent-a1-template-kml.md](2026-05-26-kmz-review/agent-a1-template-kml.md) | 0 | 3* | 4 | 2 |
| A2 | waylines.wpml root structure | [agent-a2-waylines-wpml.md](2026-05-26-kmz-review/agent-a2-waylines-wpml.md) | 1→P1 | 3 | 4 | 2 |
| A3 | `<wpml:missionConfig>` block | [agent-a3-mission-config.md](2026-05-26-kmz-review/agent-a3-mission-config.md) | 0 | 2* | 3 | 2 |
| A4 | `<Placemark>` shape | [agent-a4-placemark.md](2026-05-26-kmz-review/agent-a4-placemark.md) | 2* | 3 | 3 | 2 |
| A5 | Action groups | [agent-a5-action-groups.md](2026-05-26-kmz-review/agent-a5-action-groups.md) | 0 | 1 | 4 | 1 |
| A6 | KMZ container + XML headers | [agent-a6-kmz-container.md](2026-05-26-kmz-review/agent-a6-kmz-container.md) | 0 | 0 | 0 | 4 |
| B1 | Drone / payload enums (M4T) | [agent-b1-enums.md](2026-05-26-kmz-review/agent-b1-enums.md) | 0 | 2 | 3 | 3 |
| B2 | Altitude encoding (descent-to-ground) | [agent-b2-altitude.md](2026-05-26-kmz-review/agent-b2-altitude.md) | 3 | 4 | 3 | 2 |
| B3 | Heading modes (yaw smoothness) | [agent-b3-heading.md](2026-05-26-kmz-review/agent-b3-heading.md) | 0 | 1 | 3 | 4 |
| B4 | Gimbal control (pitch smoothness) | [agent-b4-gimbal.md](2026-05-26-kmz-review/agent-b4-gimbal.md) | 0 | 1 | 2 | 4 |
| B5 | Payload / camera / lens / focus | [agent-b5-payload.md](2026-05-26-kmz-review/agent-b5-payload.md) | 0 | 2 | 4 | 3 |
| C1 | Speed ranges + frame-rate | [agent-c1-speed.md](2026-05-26-kmz-review/agent-c1-speed.md) | 1 | 3 | 3 | 3 |
| C2 | Turn modes + damping | [agent-c2-turn-damping.md](2026-05-26-kmz-review/agent-c2-turn-damping.md) | 0 | 2 | 3 | 4 |
| C3 | Coordinate ordering + precision | [agent-c3-coordinates.md](2026-05-26-kmz-review/agent-c3-coordinates.md) | 0 | 1 | 3 | 3 |
| C4 | Zero-length segments + bookends | [agent-c4-degenerate.md](2026-05-26-kmz-review/agent-c4-degenerate.md) | 1 | 3 | 3 | 2 |
| D1 | Audit invariant → pinned test map | [agent-d1-invariant-test-map.md](2026-05-26-kmz-review/agent-d1-invariant-test-map.md) | 0 | 3 | 1 | 3 |
| D2 | Test matrix coverage gaps | [agent-d2-coverage-matrix.md](2026-05-26-kmz-review/agent-d2-coverage-matrix.md) | 1 | 4 | 2 | 3 |
| D3 | Over-mocked tests | [agent-d3-mocked-tests.md](2026-05-26-kmz-review/agent-d3-mocked-tests.md) | 0 | 0 | 2 | 1 |
| E1 | WaylineCheckError 25-code coverage | [agent-e1-wayline-check-errors.md](2026-05-26-kmz-review/agent-e1-wayline-check-errors.md) | 3 | 6 | 2 | 1 |
| E2 | DJI MSDK + Pilot 2 reference diff | [agent-e2-msdk-diff.md](2026-05-26-kmz-review/agent-e2-msdk-diff.md) | 0 | 4 | 3 | 3 |

`*` = some findings rejected by E2 against the Pilot 2 1.0.6
reference; see "False positives" above.

Raw totals before dedup and E2 filtering: 12 P0, 49 P1, 56 P2, 53 P3.
After dedup and rejection of 6 false-positive entries: **5 P0, 10 P1,
~25 P2, ~30 P3** as listed above.
