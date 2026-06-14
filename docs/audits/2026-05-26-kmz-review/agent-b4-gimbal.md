# Agent B4 — Gimbal control / pitch smoothness

Scope: DJI Matrice 4T, WPML 1.0.6. Read-only audit of the gimbal emission path
in `backend/app/services/export/dji/` against the WPML common-element spec
(`40.common-element.md`), the prior audits (`docs/kmz-wpml-audit.md` §3 / §8 /
§11, `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.8, and
`docs/audits/2026-05-11-papi-altitude-camera-aim.md` §2.3 / §4.2), and the M4T
public spec page.

## Summary
- P0 blockers: 0
- P1 high (smoothness): 1
- P2 conformance: 2
- P3 upgrades: 4

The gimbal control path is **structurally correct against spec**:

- VP video emits `gimbalEvenlyRotate` inside an `actionGroup` whose
  `actionTriggerType=betweenAdjacentPoints` (the spec's hard pairing rule for
  `gimbalEvenlyRotate`, mirrored in audit §2.8). The `gimbalRotate` snap on
  every measurement after the first VP measurement is suppressed via the
  `skip_gimbal_snap` plumbing, so the per-segment sweep is not stomped by a
  reachPoint snap.
- HR video anchors the gimbal once with a single `gimbalRotate` on the first
  measurement and holds it through the arc - matches the audit §8 prescription.
  No `gimbalEvenlyRotate` is emitted on HR (pitch barely varies across a
  constant-altitude arc).
- HR / VP photo, fly-over, parallel-side-sweep, hover-point-lock, and
  meht-check all stay on the per-WP `gimbalRotate(reachPoint)` snap pattern
  (correct - photo mode stops at every waypoint by design).
- `payloadPositionIndex=0` on every gimbal action (M4T integrated main gimbal,
  audit §7).
- `gimbalRollRotateEnable=0`, `gimbalYawRotateEnable=0` on `gimbalRotate`
  (M4T compliance; gimbal stays in body-follow mode).
- `actionGroupId` lanes don't collide (odd=reachPoint, even=segment) and stay
  inside `[0, 65535]`.
- Pitch values produced by the trajectory (VP angles 1.0°-16.5°, HR small
  positive/near-zero) sit well inside M4T's published soft limit of
  -90°/+35°.

The remaining findings are smoothness improvements (P1), spec-conformance
hardening (P2), and upgrades worth recording for later (P3).

## Findings

### [P1-1] HR video heading drift in `smoothTransition` mode is the dominant on-screen smoothness symptom for the arc

- **Severity**: P1 (high; smoothness only, no safety impact)
- **Location**: `backend/app/services/export/dji/heading.py:120-162`,
  `backend/app/services/export/dji/video.py:82-106`,
  `backend/app/services/export/dji/builders.py:104-116`
- **Spec**: `40.common-element.md` — `waypointHeadingMode=smoothTransition`
  interpolates body yaw *linearly* between per-WP `waypointHeadingAngle`
  values. `waypointHeadingMode=towardPOI` makes firmware *continuously* track
  the POI across the segment.
- **Current behavior**: HR video emits one anchor `gimbalRotate` on the first
  measurement and holds gimbal pitch. Body yaw drives camera framing across
  the arc, and `_dji_heading_mode` defaults to `"smoothTransition"`. On a
  curved (sideways) HR path the true bearing-to-PAPI is non-linear in
  arc-position, but `smoothTransition` interpolates yaw *linearly* between
  per-WP angles, so the camera centring drifts mid-segment and the yaw rate
  changes step-wise at every waypoint. This is the framing residual called out
  in `docs/audits/2026-05-11-papi-altitude-camera-aim.md` §2.3 and §4.2.
- **Why it's wrong (or rather: suboptimal for smoothness)**: matches exactly
  the audit's "abrupt correction" symptom on HR. The gimbal itself is steady
  (it's anchored), but the body yaw is stepwise, so the *camera framing* is
  jerky.
- **Evidence**: `heading.py:69-84` (`_dji_heading_mode` default is
  `"smoothTransition"`); `heading.py:120-162` (`_append_heading_param`
  smoothTransition branch emits per-WP `waypointHeadingAngle` and lets firmware
  interpolate); `kmz-wpml-audit.md` §11 "Horizontal Range — Default
  smoothTransition emits a per-waypoint waypointHeadingAngle and lets firmware
  interpolate linearly between those angles… this is the 'abrupt correction'
  the operator sees".
- **Proposed fix**: this is already a per-export operator choice via
  `ExportPanel`'s heading-mode picker and the persisted `mission.dji_heading_mode`
  column - `towardPOI` exists today. The fix is to make `"towardPOI"` the
  default for **HR + VIDEO_CAPTURE** missions (and only those), not to ship a
  net-new mechanism. HR video has a clear POI (the PAPI's `camera_target`) and
  the only reason `smoothTransition` is the global default is M4T firmware
  compatibility risk across all method × capture-mode combinations. A targeted
  default would route the smoothness-critical case to `towardPOI` without
  exposing the experimental mode to methods that don't benefit.
  Implementation sketch: in `_dji_heading_mode` (or in `export_mission` before
  the override resolution), if no operator override is set AND
  `mission.dji_heading_mode` is null AND the mission contains an HR +
  VIDEO_CAPTURE inspection, default to `"towardPOI"` instead of
  `"smoothTransition"`. Keep the explicit `mission.dji_heading_mode` value
  authoritative when set.
- **HW verify**: re-fly a single HR + VIDEO_CAPTURE inspection at 7× zoom in
  `towardPOI`; confirm PAPI stays centred across the full arc. Compare against
  the same mission in `smoothTransition` to validate the framing-drift
  improvement.

### [P2-1] Gimbal pitch is emitted without defensive clamping against M4T soft limits

- **Severity**: P2 (conformance / robustness)
- **Location**: `backend/app/services/export/dji/actions.py:189-211` (per-WP
  snap), `backend/app/services/export/dji/actions.py:267-272` (segment ramp)
- **Spec**: `40.common-element.md` — `gimbalPitchRotateAngle`: "Different
  gimbals can be turned in different ranges." DJI Matrice 4T public spec page
  documents the *soft* tilt range as `-90° to +35°` (mechanical range is wider:
  -140° to +113°).
- **Current behavior**: `_append_action_group` writes
  `gimbalPitchRotateAngle = f"{wp.gimbal_pitch:g}"` directly. Same in
  `_append_segment_action_group`. There is no clamp and no fallback if a
  configured altitude offset / glide slope / inspection LHA produces a value
  outside `[-90, +35]`.
- **Why it's wrong**: the trajectory generator today emits values inside the
  range for every method we ship (VP 1.0°-16.5°, HR ~0° ±a few degrees, FO
  default `-70°`, etc.), so this is not a live blocker. But there is no
  guard between the trajectory and the export: a future method, a misconfigured
  `altitude_offset`, or a very steep gimbal configured by the operator can
  produce a value the M4T's soft-limited gimbal will not honour. The drone
  silently clamps to the soft limit instead, so the snap target and the
  segment-end target drift away from the planner's geometry.
- **Evidence**: no clamp / no validator anywhere in the gimbal write path.
  `backend/app/services/trajectory/methods/vertical_profile.py:64` computes
  `pitch = elevation_angle(...)` with no clamp; same in `horizontal_range.py`.
  M4T spec page is the soft-range source.
- **Proposed fix**: clamp at the write site with a logged warning when clamping
  fires (mirror the relative-height-below-takeoff clamp in `placemark.py:169-180`):
  define `M4T_GIMBAL_PITCH_MIN_DEG = -90.0`, `M4T_GIMBAL_PITCH_MAX_DEG = 35.0`
  in `app.core.constants`, clamp in both `_append_action_group` and
  `_append_segment_action_group`, and warn once per WP when clamping fires.
  Defensive only - production missions never trip it today. Don't push the
  clamp into the trajectory layer; the trajectory is drone-agnostic, and the
  export is where M4T-specific limits belong.
- **HW verify**: deliberately configure a mission with `altitude_offset` that
  drives gimbal pitch outside `[-90, +35]`, export with the clamp in place,
  confirm Pilot 2 accepts the file and the drone flies the clamped pitch.

### [P2-2] `gimbalRotateTimeEnable=0` makes the anchor snap visibly abrupt on the first VP / HR video measurement

- **Severity**: P2 (conformance OK; smoothness adjacent)
- **Location**: `backend/app/services/export/dji/actions.py:208-209`
- **Spec**: `40.common-element.md` — `gimbalRotateTime` (float, seconds) is
  emitted when `gimbalRotateTimeEnable=1`; controls the duration of the
  rotation. With `gimbalRotateTimeEnable=0` the rotation is instant.
- **Current behavior**: `_append_action_group` hardcodes
  `gimbalRotateTimeEnable=0` and `gimbalRotateTime=0` on every per-WP gimbal
  snap. For the **first** measurement of a VP / HR video pass (the anchor
  snap), the gimbal slews instantly from whatever pitch it inherited from the
  transit / takeoff phase to the anchor pitch. If the inherited pitch is far
  from the anchor (e.g. transit at -10° down vs HR anchor at -3°), the snap is
  visible in the recording.
- **Why it's wrong**: not a spec violation - this is the documented "instant
  rotation" shape. But it works against the smooth-sweep goal: the very first
  frame of the recorded inspection captures a fast gimbal slew. The audit's
  §11 ("first-measurement anchor snap") calls this out as a smoothness risk.
- **Evidence**: every per-WP `gimbalRotate` action emits the time-enable=0 +
  time=0 pair byte-stable; the audit identifies the anchor snap as smoothness
  risk if not handled.
- **Proposed fix**: on the first video measurement only (i.e. `is_first=True`
  in `_video_smooth_emit_plan`), emit `gimbalRotateTimeEnable=1` plus a small
  positive `gimbalRotateTime` (e.g. 2.0 s) so the anchor slew is smoothed in
  the video. Pre-condition: the H-start RECORDING_START hover has finished
  setting up recording (hover duration ≥ rotation time), so the gimbal slew
  starts after the recording begins and is visible / smooth in the captured
  video. Cap to `min(hover_duration, 2.0)` to avoid running past the
  hover-into-measurement transition. Subsequent measurements stay on time=0
  (their snaps are suppressed anyway).
- **HW verify**: re-fly a VP + VIDEO_CAPTURE mission with the time-enabled
  anchor snap. Confirm the first frames of the recording show a smooth gimbal
  pitch ramp into the anchor pitch instead of a step.

## Upgrades (P3)

### [P3-1] Denser VP waypoints would refine the smooth-sweep granularity

The VP smooth sweep is segment-wise: `gimbalEvenlyRotate(target=next_wp.pitch)`
ramps linearly between adjacent measurement pitches. With the default
measurement density the angular step between measurements can be 1°-3°, so
the sweep is a piecewise-linear approximation of the true bearing-to-LHA
curve. Higher density → finer-grained pitch interpolation. This is a
trajectory-side change (`config.measurement_density`), not an export change,
and is acknowledged in `kmz-wpml-audit.md` §11 ("too few waypoints (each
gimbalEvenlyRotate segment spans waypoint-to-waypoint, so sparse waypoints =
coarse sweep)"). Worth surfacing as an operator-facing hint when the operator
chooses VP + VIDEO_CAPTURE with a low density.

### [P3-2] Per-WP `gimbalRotate` re-anchor on HR is the documented escalation if `towardPOI` still drifts

`docs/audits/2026-05-11-papi-altitude-camera-aim.md` §4.2 lists three drift
levers. The third is re-anchoring the gimbal pitch at every HR measurement
(turn off `skip_gimbal_snap` for HR video). This would re-introduce a per-WP
gimbal snap on the arc but corrects per-WP altitude wobble that the firmware
otherwise can't see (the gimbal is anchored once and held). Only fire this if
[P1-1] (default to `towardPOI` for HR video) is shipped and a hardware test
shows residual drift; otherwise it adds the per-WP snap noise we deliberately
removed.

### [P3-3] HR video could emit a `gimbalEvenlyRotate` per arc segment too (mirror VP)

HR video today is anchor-only because pitch *barely* varies across an arc.
But "barely" is not "zero" - a 5° altitude wobble on a 50 m horizontal
distance produces ~5° of pitch difference between the arc's endpoints. The
audit §8 explicitly prescribes "Gimbal pitch — one `gimbalRotate` action at
the start/hover waypoint, then leave it" for HR, so this is a deliberate
choice, not a bug. Worth recording as an option to revisit if HR framing
shows pitch drift on a real-flight recording after [P1-1] / [P3-2] have
landed.

### [P3-4] Investigate `gimbalRotateTimeEnable=1` for every gimbal snap (not just the anchor)

Tied to [P2-2]. Snap-mode (time=0) is the right default for photo capture
(stops at each WP, instant snap to the new pitch is fine). For video bookend
hovers (RECORDING_START / RECORDING_STOP) and any future video method that
fires per-WP snaps mid-flight, time-enabled snaps would smooth the visible
gimbal motion. Out of scope for the current VP / HR video paths because those
snaps are already suppressed on every measurement after the first.

## What was checked and found conformant (no finding)

- **`gimbalEvenlyRotate` trigger pairing** (audit §2.8): `_append_segment_action_group`
  emits `actionTriggerType=betweenAdjacentPoints` unconditionally inside the
  same `actionGroup` as the `gimbalEvenlyRotate` action. Spec-correct.
- **`gimbalRotate` required params**: `gimbalHeadingYawBase=north`,
  `gimbalRotateMode=absoluteAngle`, `gimbalPitchRotateEnable=1`,
  `gimbalPitchRotateAngle=<value>`, `gimbalRollRotateEnable=0`,
  `gimbalRollRotateAngle=0`, `gimbalYawRotateEnable=0`,
  `gimbalYawRotateAngle=0`, `gimbalRotateTimeEnable=0`, `gimbalRotateTime=0`,
  `payloadPositionIndex=0`. All spec-required fields are present.
- **`gimbalEvenlyRotate` required params**: `gimbalPitchRotateAngle=<value>`,
  `payloadPositionIndex=0`. Spec only requires these two; emission is exact.
- **HR vs VP branching**: `_is_vp_video_measurement` and
  `_is_hr_video_measurement` discriminate on `method` + `capture_mode`.
  VP video gets segment ramps; HR video stays anchor-only. PHOTO_CAPTURE
  legitimately falls through to per-WP snap. `capture_mode=None` is treated
  as `VIDEO_CAPTURE` to mirror the trajectory default - matches.
- **First-WP anchor snap**: `_video_smooth_emit_plan` marks the first VP / HR
  video measurement of each inspection as `is_first=True`, which leaves
  `skip_snap=False` so the anchor `gimbalRotate` fires. Subsequent measurements
  get `skip_snap=True` so the smooth sweep is not stomped. RECORDING_START
  HOVER bookend is collocated with the first measurement and emits its own
  per-WP `gimbalRotate` to the same pitch (no visible double-snap because
  the drone hasn't moved).
- **Yaw / roll axes**: `gimbalYawRotateEnable=0` and `gimbalRollRotateEnable=0`
  on every per-WP snap. Body yaw drives camera framing via the per-placemark
  heading mode (`smoothTransition` / `towardPOI` / `followWayline`); gimbal
  follows body. Matches audit §11.
- **`payloadPositionIndex=0`**: M4T is a single integrated main-gimbal payload
  (audit §7). Every gimbal action emits `payloadPositionIndex=0`.
- **Pitch range conformance against M4T soft limits**: trajectory output is
  within `[-90, +35]` for every method we ship today. Defensive clamp is
  recorded as [P2-1] not as a live blocker.
- **`actionGroupId` collision invariants**: reachPoint groups take the odd
  lane (`2*index - 1`), segment groups take the even lane (`2*sequence_order`).
  Both fit inside `[0, 65535]` past the 500-WP performance ceiling.
- **`actionGroupStartIndex` / `actionGroupEndIndex` are 0-indexed**: reachPoint
  groups subtract 1 from `index`; segment groups subtract 1 from
  `wp.sequence_order` (start) and `next_index` (end). Matches the WPML 0-index
  convention.
