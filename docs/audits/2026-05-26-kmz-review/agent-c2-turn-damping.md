# Agent C2 — Turn modes & damping (smoothness)

Scope: `backend/app/services/export/dji/placemark.py` (`_append_turn_param`,
`_nearest_leg_lengths`, `_append_placemark` turn branch), `builders.py`
(folder-level `globalWaypointTurnMode` / `globalUseStraightLine` and the
`nearest_leg` plumb), `video.py` (`_video_smooth_emit_plan`), `heading.py`,
plus the per-WP `useStraightLine`. Target: DJI M4T (exported as M30T enums),
WPML 1.0.6.

Spec quoted verbatim from `dji-sdk/Cloud-API-Doc` (commit master, retrieved
2026-05-26):
- `waypointTurnDampingDist` range: `(0, the maximum length of wayline segment]`
  with the note "The wayline segment between two waypoints should be greater
  than the sum of the turn intercepts of two waypoints". Required when
  `waypointTurnMode` is `coordinateTurn`, OR `waypointTurnMode` is
  `toPointAndPassWithContinuityCurvature` AND `useStraightLine=1`.
- `useStraightLine` (per-placemark): bool. Required if and only if
  `waypointTurnMode` in `waypointTurnParam` is set to
  `toPointAndStopWithContinuityCurvature` or
  `toPointAndPassWithContinuityCurvature`.
- `globalUseStraightLine` (folder): bool. Required if and only if
  `globalWaypointTurnMode` is set to `toPointAndStopWithContinuityCurvature`
  or `toPointAndPassWithContinuityCurvature`.

## Summary
- P0 blockers: 0
- P1 high (smoothness): 2
- P2 conformance: 3
- P3 upgrades: 4

No file-shape blocker for Pilot 2 today. The 2026-05-15 audit §5.2 clamp
(`min(0.2, 0.5 * nearest_leg)`) and the existing video gating are working as
documented. The remaining risks are: (a) a degenerate-geometry corner case
where the stop-path literal `0.2` can be emitted when the local segment is
`0`, (b) two unconditional-emission sites (`useStraightLine`,
`globalUseStraightLine`) that violate the "Required if and only if" clause
in the spec and may be rejected by strict validators or DJI's
`IWPMZManager.checkValidation()`. The biggest smoothness lever left is the
hard-coded `0.2` ceiling, which is conservative enough to make every smooth
turn essentially imperceptible on widely-spaced measurements where a larger
damping would actually let the firmware build a useful arc.

## Findings

### [P1-1] Continuity-curvature placemarks can emit `damping=0.2` when every adjacent leg is zero

- **Severity**: P1 (smoothness + range-violation corner case)
- **Location**: `backend/app/services/export/dji/placemark.py:206-211` and
  `_nearest_leg_lengths:65-88`
- **Spec**: `waypointTurnDampingDist ∈ (0, max segment length]`; the range
  is exclusive of `0` on both sides — a damping of `0.2` on a segment of
  length `0` violates the upper bound.
- **Current behavior**: `_nearest_leg_lengths` excludes zero-length legs
  from the per-WP minimum and **omits the key entirely** when a waypoint has
  no positive adjacent leg. The placemark then sees `nearest_leg=None`. In
  `_append_placemark`:
  ```python
  damping_dist = 0.2
  if is_passthrough and nearest_leg is not None:
      damping_dist = min(0.2, 0.5 * nearest_leg)
  _append_turn_param(placemark, turn_mode=turn_mode, damping_dist=damping_dist)
  ```
  When the WP is a VP / HR video measurement (`is_passthrough=True`) AND
  every adjacent leg is zero, `nearest_leg` is `None` and the code falls
  through to the literal `0.2` while still emitting
  `waypointTurnMode=toPointAndPassWithContinuityCurvature`. Both the
  upper-bound (`0.2 > 0 = max segment length`) and the spec's "sum of turn
  intercepts ≤ segment length" rule are violated on this placemark.
- **Why it's wrong**: The clamp's intent is "never let damping exceed the
  local leg". The `None` branch reverts to the unclamped literal, which is
  the exact regression #638 was filed to prevent. The branch fires only on
  pathological inputs (two collocated measurements with no other neighbours
  in the inspection), but `resolve_inspection_collisions` can pack rerouted
  measurements arbitrarily close and the in-place dedup pass that Litchi has
  (`_LITCHI_MIN_3D_DIST = 0.6`) has no DJI counterpart.
- **Evidence**: `_nearest_leg_lengths` returns `{}` for the candidates list
  empty branch (lines 86-88). `_append_placemark` line 209's
  `if is_passthrough and nearest_leg is not None` then short-circuits and
  emits `0.2`. The existing test `TestDjiTurnDampingClamp` covers the
  positive-leg case only.
- **Proposed fix**: When `is_passthrough` and the leg is unresolvable,
  either (a) drop the placemark out of continuity-curvature mode (fall back
  to stop-discontinuity for that single measurement) or (b) emit a small
  positive damping such as `1e-3` so the range is satisfied. Option (a)
  preserves spec conformance without depending on an arbitrary epsilon and
  matches what the firmware would do anyway (it cannot smooth a zero-length
  arc). Mirror the predicate into a unit test that builds two collocated
  MEASUREMENTs.
- **HW verify**: not flight-critical until two video measurements actually
  collocate; reproducer would be density-bumped HR arc on a small LHA where
  `resolve_inspection_collisions` collapses adjacent points.

### [P1-2] Hard-coded `0.2 m` ceiling is conservative enough to neuter smoothness on widely-spaced measurements

- **Severity**: P1 (smoothness)
- **Location**: `backend/app/services/export/dji/placemark.py:208-211`
  (`damping_dist = 0.2; ... min(0.2, 0.5 * nearest_leg)`)
- **Spec**: damping is the early-turn intercept — how far before the
  waypoint the drone starts curving. Pilot 2's own UI exposes values up to
  the full segment length; the spec only bounds it at `(0, max segment]`.
  At `0.2 m`, the arc through a waypoint is essentially a corner.
- **Current behavior**: Every VP / HR video continuity-curvature placemark
  emits at most `0.2 m` damping. For a VP climb with 4 m vertical spacing,
  that means 95% of each segment is a straight line and the drone only
  starts curving 0.2 m before the waypoint — well below the firmware's
  curvature-continuity threshold on the M4T. Subjectively this reads as
  "the drone flies straight, then pivots, then flies straight again" — i.e.
  the jerk the smooth-turn mode was supposed to eliminate.
- **Why it's wrong**: `0.2` is a worst-case ceiling for the
  `step_m=0.3, num_measurements=5` test fixture. Real missions space
  measurements at `0.5-5 m` (VP) or `5-15 m` (HR arc). The `0.5 * nearest_leg`
  clamp can already handle those; the `min(0.2, ...)` ceiling on top is what
  caps it.
- **Evidence**: `TestDjiTurnDampingClamp::test_tight_video_pass_damping_below_min_measurement_leg`
  pins damping `< 0.2` on the tight fixture, so removing the ceiling would
  break the test as written — but the test's assertion `< 0.2` is a
  by-product of the constant, not a contract from the spec. The audit log
  in §5.2 says "the literal 0.2 byte-for-byte" is kept "for the
  default-stop path" — that's a separate goal (preserve the historical
  default-stop emission for diffability).
- **Proposed fix**: Decouple the ceiling from the constant. Either (a) drop
  the upper bound entirely on the continuity-curvature branch and rely on
  `0.5 * nearest_leg`, or (b) raise the ceiling to a smoothness-meaningful
  value such as `2.0 m` (well below typical 5 m HR arc spacing, and the
  clamp still bites on tight VP). The default-stop path keeps `0.2` and the
  byte-stable regression net survives. Pin the new behaviour with a fixture
  at `step_m=5.0` that asserts the damping is now ~2.5 m (half-leg), not
  capped at 0.2.
- **HW verify**: required — re-fly a VP video pass on the M4T at typical
  measurement spacing (1-5 m), compare videos visually for jerk vs. arc.
  This is the single smoothness lever most likely to make the user-visible
  difference the brief calls out.

### [P2-1] `useStraightLine=1` emitted on every placemark, including stop-discontinuity ones

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/placemark.py:239`
- **Spec**: `wpml:useStraightLine` is "Required if and only if 'waypointTurnMode'
  in 'wpml:waypointTurnParam' is set to 'toPointAndStopWithContinuityCurvature'
  or 'toPointAndPassWithContinuityCurvature'." (`common-element.md` line 279
  on master).
- **Current behavior**: every placemark — stop-discontinuity (the global
  default) AND pass-continuity (video measurements) — emits
  `<wpml:useStraightLine>1</wpml:useStraightLine>` unconditionally. For the
  90%+ of placemarks that ride the global stop-discontinuity mode, the
  element is outside its spec-declared scope.
- **Why it's wrong**: "Required if and only if" means the element should not
  be present otherwise. Pilot 2 tolerates the extra element today; strict
  validators (DJI's `IWPMZManager.checkValidation()` per `kmz-wpml-audit.md`
  §10) may reject it. Same shape as the 2026-05-15 audit §2.1
  (`waylineAvoidLimitAreaMode`) finding that was dropped.
- **Evidence**: `placemark.py:239` emits the tag unconditionally, after
  the `useGlobal*` quartet, inside the `not in_waylines` block — wait,
  actually the line sits *outside* the `if not in_waylines:` guard, so it
  fires on waylines placemarks too. The template emission is also
  unconditional. There is no branch on `turn_mode`.
- **Proposed fix**: Gate the emission on
  `mode in {"toPointAndStopWithContinuityCurvature",
  "toPointAndPassWithContinuityCurvature"}`. The current code never emits
  `toPointAndStopWithContinuityCurvature`, so in practice the gate is
  equivalent to `if is_passthrough:`. Move the line into the
  passthrough branch in `_append_placemark`, or extend `_append_turn_param`
  to emit `useStraightLine` itself when the mode requires it.
- **HW verify**: not required for Pilot 2 launch (tolerated). Required only
  if we adopt `IWPMZManager.checkValidation()` as a CI gate.

### [P2-2] `globalUseStraightLine=1` emitted under non-continuity-curvature global turn mode

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/builders.py:112-113`
  ```python
  _sub_text(folder, "globalWaypointTurnMode", "toPointAndStopWithDiscontinuityCurvature")
  _sub_text(folder, "globalUseStraightLine", "1")
  ```
- **Spec**: `wpml:globalUseStraightLine` "Required if and only if
  'wpml:globalWaypointTurnMode' is set to 'toPointAndStopWithContinuityCurvature'
  or 'toPointAndPassWithContinuityCurvature'." (`template-kml.md` line 203).
- **Current behavior**: emitted unconditionally with `=1` under
  `globalWaypointTurnMode=toPointAndStopWithDiscontinuityCurvature` — the
  exact case the spec scopes the element OUT of.
- **Why it's wrong**: Same "required if and only if" violation as P2-1.
  Strict validators may reject; Pilot 2 tolerates today.
- **Evidence**: builders.py:112-113 read verbatim; no conditional guard.
- **Proposed fix**: Drop the `globalUseStraightLine` line under the current
  stop-discontinuity global. Re-add it conditionally if/when the global
  ever moves to a continuity-curvature mode.
- **HW verify**: not required for Pilot 2.

### [P2-3] Every template placemark emits `useGlobalTurnParam=1` AND its own `waypointTurnParam` block

- **Severity**: P2 (cosmetic conformance)
- **Location**: `backend/app/services/export/dji/placemark.py:238` plus the
  unconditional `_append_turn_param` call on line 211
- **Spec**: per `template-kml.md` row 278, `wpml:waypointTurnParam` is
  "Required if 'wpml:useGlobalTurnParam' is 0". The converse is not
  asserted, but the canonical example in the spec only emits the local
  block when overriding the global.
- **Current behavior**: Every template placemark emits BOTH
  `useGlobalTurnParam=1` (says "inherit from global") AND a local
  `waypointTurnParam` block. For most placemarks the local block is
  byte-identical to the global default, so it's a benign no-op. For
  video measurements the local block overrides the global — but then
  `useGlobalTurnParam` should be `0`.
- **Why it's wrong**: Internally contradictory. A reader following the
  WPML spec would see "inherit global = stop-discontinuity" and stop reading,
  missing the local pass-continuity override on video measurements. Pilot 2
  reads the local block (the override works in practice), but a different
  consumer might not.
- **Evidence**: `_append_placemark` line 211 calls `_append_turn_param`
  unconditionally; line 238 emits `useGlobalTurnParam=1` unconditionally.
  No branch correlates the two.
- **Proposed fix**: Emit `useGlobalTurnParam=0` whenever the placemark
  overrides the global turn mode (i.e., `is_passthrough=True`). Optionally
  skip the local `waypointTurnParam` block entirely when it would match the
  global default and `useGlobalTurnParam=1`. Mirror the
  `useGlobalHeadingParam=0/1` shape already implemented in lines 234-237.
- **HW verify**: not required.

## Upgrades (P3)

- **P3-1 — Adaptive ceiling per inspection method.** The constant `0.2 m`
  ceiling is the same on every passthrough placemark regardless of method.
  VP video benefits from a larger ceiling (the climb is long and the gimbal
  is already sweeping continuously, so the body can build a smooth arc).
  HR video benefits less (the arc is already curving). Photo paths
  legitimately want stop-mode. Lift the ceiling into a per-method constant
  in `app.core.constants`, e.g. `VP_VIDEO_MAX_DAMPING_M = 3.0`,
  `HR_VIDEO_MAX_DAMPING_M = 1.5`, pass through `_video_smooth_emit_plan` as
  part of the per-WP plan entry.

- **P3-2 — Damping pairing across adjacent waypoints.** Spec says "the
  wayline segment between two waypoints should be greater than the sum of
  the turn intercepts of two waypoints". The current `0.5 * nearest_leg`
  per-WP clamp can violate this if two adjacent WPs both end up at exactly
  half: `0.5 * L + 0.5 * L = L`, which fails the strict-greater-than.
  Tighten to `0.5 * nearest_leg * (1 - ε)` (e.g. `* 0.45`) or do a real
  two-pass solve where each segment's pair-sum is checked. Pin with a
  fixture where two consecutive WPs both have the same `nearest_leg`.

- **P3-3 — Speed-aware damping ceiling.** At higher `waypointSpeed` the M4T
  needs a larger damping for the same physical curvature (centripetal
  acceleration grows with `v²/r`; for a fixed comfortable acceleration
  `a_max`, `r_min ∝ v²`). The current clamp is purely geometric and ignores
  speed. The brief flags this as worth flagging: yes, especially for the
  M4T near its max cruise speed where a 0.2 m damping on a 5 m/s climb
  builds a curvature that the firmware will silently clamp anyway. Worth
  pinning the constant against `mission.default_speed` /
  `mission.measurement_speed_override` so the math at least bounds the
  centripetal accel below ~0.5 g.

- **P3-4 — `coordinateTurn` for FLY_OVER / PARALLEL_SIDE_SWEEP cruise legs.**
  These methods use stop-discontinuity today (default), but they're
  inherently "fly along a line at constant heading" which is the textbook
  use case for `coordinateTurn` (coordinated banked turn at the corner,
  no stop). Worth experimenting per-export. Out of scope until ground-truth
  reference exports from Pilot 2 on the real M4T are checked into
  `backend/tests/data/` (`kmz-wpml-audit.md` Phase 0).
