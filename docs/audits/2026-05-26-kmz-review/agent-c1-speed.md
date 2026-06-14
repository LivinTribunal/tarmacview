# Agent C1 - speed / acceleration / frame-rate compatibility

Scope: every numeric speed value emitted by the DJI KMZ/WPML exporter and its
compatibility with WPML 1.0.6 spec ranges AND the DJI Matrice 4T airframe
limits AND capture-mode frame-rate requirements.

Code under audit:
- `backend/app/services/export/dji/mission_config.py` -
  `_append_mission_config` (globalTransitionalSpeed), `_resolve_auto_speed`,
  `_emitted_distance_duration`.
- `backend/app/services/export/dji/builders.py` - folder-level
  `autoFlightSpeed`.
- `backend/app/services/export/dji/placemark.py` - per-WP `waypointSpeed` +
  `useGlobalSpeed`.
- `backend/app/services/trajectory/config_resolver.py` - `compute_optimal_speed`,
  `resolve_speed`, `check_speed_framerate` (frame-rate ceiling logic).
- `backend/app/services/trajectory/safety_validator/_constraints.py` -
  `check_drone_constraints` (`wp.speed > drone.max_speed` hard violation).
- `backend/app/models/inspection.py` - `Inspection.is_speed_compatible_with_frame_rate`.

Spec sources (WebFetched 2026-05-26):
- `template-kml.md` - per-Folder / per-Placemark speed semantics.
- `waylines-wpml.md` - executable wayline speed semantics, ranges.
- `common-element.md` - per-element ranges (sparse on speed; the two file specs
  carry the binding ranges).

WPML 1.0.6 speed-related elements (consolidated from the two file specs):

| Element | Location | Range | Required | Zero allowed | Acceleration |
|---|---|---|---|---|---|
| `autoFlightSpeed` (template) | Folder | `(0, max_drone_speed]` | yes | NO | none |
| `autoFlightSpeed` (waylines) | Folder | `(0, max_drone_speed]` | yes | NO | none |
| `globalTransitionalSpeed` (template) | missionConfig | `> 0` | yes | NO | none |
| `globalTransitionalSpeed` (waylines) | missionConfig | **`[0, 15]`** | yes | yes | none |
| `waypointSpeed` | Placemark | `(0, max_drone_speed]` | when `useGlobalSpeed=0` | NO | none |
| `inclinedFlightSpeed` | Placemark (oblique) | `(0, max_drone_speed]` | conditional | NO | not emitted by exporter |
| `useGlobalSpeed` | Placemark | `{0,1}` | yes | n/a | n/a |

**The WPML spec exposes NO acceleration / deceleration / jerk fields.** The
M4T's airframe acceleration (~2 m/s^2 multirotor multiplier) is firmware-side
only - no exporter knob, no audit finding possible.

DJI Matrice 4T airframe spec (confirmed 2026-05-26):
- Max horizontal speed: **21 m/s forward, 19 m/s sideways, 18 m/s backward**
- Max ascent rate: 10 m/s
- Max descent rate: 8 m/s
- Max wind resistance: 12 m/s (takeoff/landing)

---

## Severity counts

- P0 (BLOCKER): **1**
- P1 (HIGH): **3**
- P2 (conformance): **3**
- P3 (upgrade): **3**

---

## P0 - BLOCKER

### C1-P0-1 - `globalTransitionalSpeed=15` is at the HARD UPPER BOUND of the waylines spec range

**Location**: `backend/app/services/export/dji/mission_config.py:213`

```python
_sub_text(config, "globalTransitionalSpeed", "15")
```

The waylines.wpml spec **explicitly bounds `globalTransitionalSpeed` to
`[0, 15]` m/s** (inclusive). Hardcoding the literal `"15"` sits **exactly at
the ceiling** with zero margin: a future Pilot 2 firmware that tightens the
range to `[0, 15)` exclusive (the template-side spec already says `> 0`
without an upper-bound annotation, so DJI's own copy is internally
inconsistent), or any strict validator that rejects `>= 15` as
"out-of-range" because of floating-point rounding inside `IWPMZManager.checkValidation`,
will reject every KMZ this module produces.

This is also the first finding that pairs WPML spec data with the M4T airframe
spec and reveals a separate issue: `globalTransitionalSpeed` is the speed the
drone uses to **fly to WP1** in template `safely` mode AND to **recover after
an RC-loss / RTH**. With the M4T's max horizontal speed of 21 m/s, the WPML
ceiling of 15 m/s is in range - so this is **NOT a hardware blocker**, only a
spec-edge blocker.

The reason this is P0 rather than P1: every other agent (A3, A4) flagged
similar "hardcoded at the spec edge" patterns as P1, but the WPML range here is
the strictest of any speed field (the only one with an absolute numeric
ceiling not derived from the drone's max), and `WaylineCheckError` enum in
DJI's MSDK has a dedicated `SPEED_VALUE_OUT_OF_RANGE` code that fires
specifically on this element. The single-value-emission path means there is
no way to recover at runtime.

**Why this is not "just" A3-P1-2's restatement**: A3 flagged the operational
problem (drone-aware clamp, mission default speed propagation). C1-P0-1 flags
the spec-compliance problem (the `[0, 15]` ceiling). The fix is the same code
site but the failure mode is different - A3 fires when an operator has a
sub-15 m/s drone; C1-P0-1 fires when DJI's validator tightens.

**Proposed fix**: derive `globalTransitionalSpeed` from
`min(mission.default_speed or 8, drone.max_speed or 15, 15)` so the value is
always strictly less than 15 m/s, drone-aware, and operationally sensible.
The DJI canonical samples in `common-element.md` emit `8` (template) and `10`
(waylines), suggesting `8-10 m/s` is the recommended operating range.

**Risk**: file-level Pilot 2 rejection on a future firmware revision. Today
this passes (operator's own M4T flights cleared it), so the launch-blocking
window is forward-looking.

---

## P1 - HIGH

### C1-P1-1 - `waypointSpeed = wp.speed or 0` emits the spec-illegal value `0` on TAKEOFF / LANDING / HOVER bookends in waylines.wpml

**Location**: `backend/app/services/export/dji/placemark.py:204`

```python
_sub_text(placemark, "waypointSpeed", f"{wp.speed or 0:g}")
```

Cross-reference: A4-P1-2 flagged the envelope shape but parked the speed-range
violation at "tolerated on M4T firmware". C1 owns the speed numerics
exclusively and escalates this finding because:

1. The waylines.wpml spec **explicitly bounds `waypointSpeed` to
   `(0, max_drone_speed]`** with the parenthesis-bracket notation - **0 is
   excluded by spec, not allowed**. The `[0, 15]` range applies to
   `globalTransitionalSpeed` only.
2. `wp.speed or 0` is the falsy-fallback pattern: any waypoint with
   `speed=None`, `speed=0`, or `speed=0.0` emits `<wpml:waypointSpeed>0</wpml:waypointSpeed>`.
3. The trajectory orchestrator does not protect against zero speed on every
   path. `WaypointData.speed` defaults to `5.0` (`trajectory/types.py:217`),
   but `_ground_takeoff_waypoint` / `_ground_landing_waypoint`
   (`orchestrator/_assembly.py:272,301`) feed `default_speed` which is the
   mission's `default_speed` column - operator can store
   `default_speed=None` (no nullable check in the schema), in which case
   TAKEOFF / LANDING get `speed=None` and the placemark emits `0`.
4. Template placemarks gate the `0` behind `useGlobalSpeed=1`, but **waylines
   placemarks omit `useGlobalSpeed` entirely** (per the CLAUDE.md gotcha
   "Every template Placemark must emit four useGlobal* flags; the waylines
   folder omits all four"). So the waylines side emits a raw `0` that no
   global flag can rescue.

The current firmware tolerance is the only thing preventing rejection. Per
`docs/kmz-wpml-audit.md` §10, the `WaylineCheckError` enum contains 25 codes
covering "speed ranges" explicitly; a tightening firmware revision flips this
from quiet-pass to rejection at launch.

**Proposed fix**: clamp `wp.speed` to a strictly positive floor at the
emission site. Two options:

- Mirror the Litchi generator's `_LITCHI_MIN_SPEED = 0.1` clamp
  (`export/formats/litchi.py`) - the same problem was already solved for
  Litchi.
- Or fall back to `auto_speed` (already in scope at the call site in
  `builders.py`): pass the resolved `auto_speed` into `_append_placemark`
  and emit `f"{wp.speed or auto_speed:g}"`.

The auto_speed fallback is the more conservative choice because it matches
the mission's resolved cruise speed rather than an arbitrary floor.

**Risk**: spec-range violation today, hardware-rejection one firmware bump
away. A4 left this at P1 with the same rationale.

---

### C1-P1-2 - No drone-airframe clamp on `globalTransitionalSpeed`, `autoFlightSpeed`, or `waypointSpeed`

**Location**: `mission_config.py:213` (globalTransitionalSpeed), `mission_config.py:251-262`
(`_resolve_auto_speed`), `placemark.py:204` (waypointSpeed).

The WPML spec scopes every speed field's upper bound to "maximum flight speed
of [the] drone". DJI's `WaylineCheckError` enum has a dedicated
`SPEED_EXCEED_DRONE_LIMIT` code (per `docs/kmz-wpml-audit.md` §10 reference
to the 25-code enum).

The exporter performs **zero airframe clamping**:

- `globalTransitionalSpeed`: hardcoded `15` regardless of
  `drone_profile.max_speed`. For the M4T (21 m/s max), this is fine; for a
  hypothetical sub-15 drone (the seed has no such drone today, but Skydio X10
  is 18 m/s and Freefly Astro is 18 m/s - both already below the wayline
  spec ceiling, so the literal is closer to the bound for those airframes).
- `autoFlightSpeed`: `_resolve_auto_speed` returns
  `mission.default_speed` (no clamp) or `waypoints[0].speed or 5` (no
  clamp). `mission.default_speed` is operator-controlled and not validated
  against `drone.max_speed` at write time (the API schema does not enforce
  it - `backend/app/schemas/mission.py` has no `validate_default_speed` hook).
- `waypointSpeed`: emits `wp.speed` directly. The trajectory pipeline's
  `check_drone_constraints` in `safety_validator/_constraints.py:44` DOES
  validate `wp.speed > drone.max_speed` as a hard violation, but:
  - The check fires at validation time, NOT at export time. A mission that
    has been edited post-VALIDATION (e.g., a coordinator drag bumping speed)
    can export with an over-spec speed if the operator skips re-validation.
  - The check uses the persisted `wp.speed`, so a hand-edited waypoint via
    `batch_update_waypoints` could exceed `drone.max_speed` and still emit.
  - The persisted column-level constraint on `Waypoint.speed` is just
    `Column(Float)` - no DB-level CHECK.

**Cross-cutting with the M4T-fallback enum problem (CLAUDE.md gotcha):**
unmapped drones fall back to the M4T tuple via `_M4T_FALLBACK_ENUM` so KMZ
output succeeds, but `drone_profile.max_speed` may be `None` (Mavic 2 Pro is
20 m/s in the seed; an unmapped drone might have no max_speed). The exporter
has no defensive ceiling.

**Proposed fix**: introduce a single resolved-speed helper in
`mission_config.py`:

```python
def _resolve_speed_with_drone_clamp(
    raw_speed: float | None, drone_profile, *, fallback: float = 5.0
) -> float:
    """clamp a speed value to drone airframe + spec range."""
    base = raw_speed if raw_speed and raw_speed > 0 else fallback
    if drone_profile and drone_profile.max_speed:
        return min(base, drone_profile.max_speed)
    return min(base, 15.0)  # M4T fallback ~21 m/s, conservative
```

Call from every speed emission site. Plus a `_MAX_TRANSITIONAL_SPEED_M_S = 15`
named constant for `globalTransitionalSpeed`.

**Risk**: silent hardware rejection on a non-M4T drone whose `max_speed` is
below 15 m/s (none in the current seed, but the architecture supports
arbitrary drone profiles).

---

### C1-P1-3 - `is_speed_compatible_with_frame_rate` is NOT consulted at export time

**Location**: `backend/app/models/inspection.py:249-275` (definition);
`backend/app/services/trajectory/orchestrator/_inspection_pass.py:247-258`
(call site).

The model method `Inspection.is_speed_compatible_with_frame_rate(drone,
speed, path_distance)` exists and correctly computes:

```
waypoint_spacing = path_distance / (density - 1)
max_compatible_speed = waypoint_spacing * drone.camera_frame_rate
```

But it is **never called from the export module**. The trajectory
orchestrator's `_inspection_pass.py:248` calls `check_speed_framerate(speed,
drone, optimal_speed)` and surfaces the result as a soft warning, not a
hard block. Once the mission reaches EXPORTED status, no speed-vs-frame-rate
check fires.

The user's brief calls this out directly: "frame-rate must support waypoint
dwell time for crisp PAPI photos. Blurred PAPI images during measurement =
direct hit on user's smoothness/quality goal."

Specifically, for VIDEO_CAPTURE missions:
- `_video_smooth_emit_plan` switches `waypointTurnMode` to
  `toPointAndPassWithContinuityCurvature` so the drone flies THROUGH the
  measurement arc/climb continuously - no stop, no per-WP dwell.
- The captured-frame-spacing constraint is `v/f <= waypoint_spacing`. For
  the M4T's 30 fps base camera (per the seed for similar M3 / M3E payloads;
  M4T's H30T spec not yet in the seed), at `v=5 m/s` capture spacing is
  `0.167 m`. For a typical PAPI measurement density of 8 across a 30 m arc,
  waypoint spacing is `4.28 m`, so 5 m/s passes the v/f <= 4.28
  check.
- BUT for a horizontal-range arc at `v=15 m/s`
  (the operator's worst case if `globalTransitionalSpeed=15` leaks into the
  measurement phase, see C1-P2-3), capture spacing becomes `0.5 m` - still
  inside `4.28 m`, so frame-rate is fine.
- The actual frame-rate concern is **per-WP gimbal snap during VIDEO_CAPTURE
  measurement traversal at high speed**. Currently the export skips the
  snap on smooth-turn measurements (anchor only), which is correct - but
  if a frame-rate-incompatible speed slips through, the resulting video has
  motion blur regardless.

**Proposed fix**: at export time, just before `_build_dji_waylines_wpml`,
call `inspection.is_speed_compatible_with_frame_rate(drone, wp.speed,
path_distance)` for every MEASUREMENT waypoint inside a video-capture pass
and emit a Pilot-2-visible warning if any fails. Either via a structural
warning logged at export time (operator sees in the export panel), or via a
hard block on the export endpoint with HTTP 422 and a "rerun validation"
hint.

The model method already exists; this is a wire-up issue, not new logic.

**Risk**: degraded video quality on the actual PAPI inspection footage,
which the operator only discovers after the flight. This is the direct hit
on the user's "smoothness/quality goal" the brief calls out.

---

## P2 - Conformance

### C1-P2-1 - `autoFlightSpeed` is emitted on BOTH `template.kml` AND `waylines.wpml` with the same value, but the spec semantics differ

**Location**: `builders.py:93` (template), `builders.py:243` (waylines).

The template-side `autoFlightSpeed` is the "global flight speed defining
target velocity for routes generated by template" (i.e., planning preview).
The waylines-side `autoFlightSpeed` is the "target flight speed of the
aircraft in the entire wayline" (i.e., executable cruise speed).

Spec-correct semantically: same value in both is permitted (the canonical
sample shows different values), but the **same value pattern** misses an
optimization opportunity. Currently `_resolve_auto_speed` is called twice
(once per builder) and returns the same value because the same waypoints +
mission are passed.

No bug today. Pinning for future operator-tunable separation.

**Proposed fix**: keep current shape. Worth a brief comment in
`_resolve_auto_speed` documenting the dual-emission semantics so a future
edit doesn't silently de-sync the two values.

---

### C1-P2-2 - `_resolve_auto_speed`'s fallback `f"{waypoints[0].speed or 5:g}"` can emit `5` when the operator's mission carries no `default_speed`

**Location**: `mission_config.py:262`

```python
return f"{waypoints[0].speed or 5:g}" if waypoints else "10"
```

The MEASUREMENTS_ONLY branch correctly falls back to `mission.default_speed`
(`mission_config.py:258-261`), but the FULL / NTL branch falls through to
`waypoints[0].speed or 5`. If the first waypoint is a TAKEOFF with
`speed=None` (per C1-P1-1's mission-without-default-speed scenario), the
fallback is the literal `5`. This is in-range and operationally sensible
(matches `WaypointData.speed = 5.0` default), but it's a hidden constant
that the operator can never tune.

**Proposed fix**: replace the literal `5` with a named constant
`_DEFAULT_AUTO_FLIGHT_SPEED_M_S = 5.0` next to the other named constants in
the module. Surface in `_resolve_auto_speed`'s docstring as
"hardcoded last-resort fallback when neither the mission nor WP1 supplies a
speed". Same for `"10"` in the empty-waypoints branch.

---

### C1-P2-3 - No bound checks ensure measurement-pass speed stays at or below `globalTransitionalSpeed`

**Location**: `mission_config.py:213` + every measurement waypoint emission.

`globalTransitionalSpeed` is the speed for the **fly-to-WP1** phase and
**recovery** phase. The wayline body uses `autoFlightSpeed` and per-WP
`waypointSpeed`. Spec-wise these are independent. But operationally, having
the transitional speed (15 m/s, see C1-P0-1) much higher than the cruise
speed (typically 5-8 m/s for measurement passes) is fine in `safely` mode
but can cause "overshoot at WP1" symptoms on `pointToPoint` mode (the
airborne scopes).

The airborne scopes (`MEASUREMENTS_ONLY` / `NO_TAKEOFF_LANDING`) use
`flyToWaylineMode=pointToPoint` - the drone hand-launched mid-air doesn't
ramp through a climb-to-security phase, so the 15 m/s `globalTransitionalSpeed`
applies the instant the operator triggers the wayline. If WP1 is 5-8 m/s
measurement, the drone screams at 15 m/s to WP1 and brakes hard. Hard
braking introduces yaw / gimbal disturbance that takes 1-2 seconds to
settle - a direct hit on the first measurement's frame quality.

**Proposed fix**: for airborne scopes specifically, clamp
`globalTransitionalSpeed = min(15, mission.default_speed * 1.5)` so the
transition is at most 50% above cruise. The 15 m/s ceiling in `safely` mode
(FULL scope) is fine because the drone is climbing through a security height
anyway.

**Risk**: cosmetic / first-measurement quality. Not a launch blocker.

---

## P3 - Upgrade opportunities

### C1-P3-1 - No acceleration field, no acceleration-aware speed planning

WPML 1.0.6 exposes zero acceleration / deceleration / jerk fields per the
spec audit. M4T airframe accel is firmware-side only (~2 m/s^2 multirotor
default per `trajectory/types.py:82`). The trajectory pipeline uses
`DEFAULT_ACCELERATION = 2.0` for duration estimation only - it does NOT
adjust commanded speed based on acceleration limits.

If a future WPML version exposes `globalAcceleration` or similar (DJI's MSDK
v6 hints at this for "smooth waypoint mode"), the exporter would need an
auto-tune step. Track for follow-up.

---

### C1-P3-2 - Auto-tune `waypointSpeed` from frame rate at export time

Builds on C1-P1-3. Today the speed is resolved at validation time
(`resolve_speed`) and frozen onto every measurement waypoint. At export
time, if the operator has changed the camera frame rate or zoom factor (and
re-validation is overdue), the emitted speed could be too fast for the new
frame rate. Auto-tune: at export, recompute `compute_optimal_speed(
path_distance, density, drone)` per-inspection and downclamp `wp.speed` to
that value before emission.

The cost is a write to `wp.speed` mid-export, which the
flush-only invariant in `services/CLAUDE.md` would need to handle - probably
emit a transient, in-memory adjusted speed that does not write back to the
DB.

Worth a follow-up issue once C1-P1-3 lands.

---

### C1-P3-3 - `globalTransitionalSpeed` is shared between template + waylines but the spec example shows distinct values

DJI's canonical `common-element.md` sample emits `8 m/s` in template and
`10 m/s` in waylines. The current exporter emits `"15"` in both. Per
C1-P0-1's fix the value becomes derived; the template can carry the cruise
default (5-8 m/s) while the waylines carries the recovery default (8-10 m/s
conservative). Distinct values are spec-supported and convey clearer
operational intent to a coordinator reviewing the file.

---

## Items cross-cutting with other agents

- **A3-P1-2** (`globalTransitionalSpeed=15` hardcoded ignores drone profile +
  mission speed): C1-P0-1 and C1-P1-2 build on this. A3 focused on the
  operational complaint (no drone clamp, no mission propagation); C1
  escalates to P0 the spec-edge launch-rejection risk.
- **A4-P1-2** (special placemarks emit the same envelope as MEASUREMENT,
  including `waypointSpeed=0` on TAKEOFF/LANDING/HOVER bookends): C1-P1-1
  owns the speed-range numerics exclusively and reframes A4's "tolerated on
  M4T" as a launch-rejection risk plus a spec violation. The fix is the same
  emission site.
- **C2** (turn / damping) owns `waypointTurnDampingDist`. C1 does not touch
  turn fields, but notes that the `min(0.2, 0.5 * nearest_leg)` clamp in
  `placemark.py:209-210` indirectly couples damping to speed (high speed +
  short leg = collision-risk damping); C2's audit covers it.
- **B5** (payload / zoom) owns optical zoom, which couples to the per-WP
  `compute_optimal_speed` (higher zoom = narrower FOV = lower waypoint
  spacing tolerance). Cross-reference if C1-P1-3 fires the auto-tune.

---

## Verdict

- **One P0 blocker** (`globalTransitionalSpeed=15` sits at the WPML waylines
  spec ceiling with no margin) - file-level Pilot 2 rejection risk on a
  future firmware revision; today it passes.
- **Three P1 issues**:
  - `waypointSpeed=0` on TAKEOFF/LANDING/HOVER waylines placemarks (spec
    range violation, hardware-tolerated today).
  - No drone-airframe clamp on `globalTransitionalSpeed`,
    `autoFlightSpeed`, or per-WP `waypointSpeed` (silent
    hardware-rejection risk on sub-15 m/s drones).
  - `is_speed_compatible_with_frame_rate` exists on the model but is never
    consulted at export time (direct hit on the user's video-quality goal
    for PAPI measurement passes).
- **Three P2 conformance notes** for code comments, named constants, and
  airborne-scope cruise/recovery speed coupling.
- **Three P3 upgrade opportunities** for future acceleration support,
  export-time speed auto-tuning, and distinct template/waylines transitional
  speeds.

The speed pipeline is **operationally correct on M4T** today (every emitted
value sits inside the M4T's 21 m/s airframe limit). The findings above
harden against firmware / validator drift and prevent the next degraded-video
class of regression.
