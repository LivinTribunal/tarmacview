# Agent A4 — `<Placemark>` element shape audit

Scope: per-waypoint Placemark envelope structure in `template.kml` and
`waylines.wpml`. Other agents own narrow children (B2 altitude, B3 heading,
B4 gimbal, C2 turn/damping, A5 action groups). This audit covers the
envelope, child ordering, and any child not claimed elsewhere.

Code under audit:
- `backend/app/services/export/dji/placemark.py` — `_append_placemark`,
  `_append_turn_param`, `_nearest_leg_lengths`, `_zoom_factor_for`.
- `backend/app/services/export/dji/builders.py` — `_build_dji_template_kml`,
  `_build_dji_waylines_wpml`, the keep-out folder.
- `backend/app/services/export/dji/heading.py` — `_append_heading_param`
  (read-only cross-reference).

Spec sources (WebFetched 2026-05-26):
- `template-kml.md` — canonical child ordering inside a template Placemark.
- `waylines-wpml.md` — wayline-side Placemark shape.
- `common-element.md` — every `wpml:*` element's range / default / scoping.

Existing audits cross-read:
- `docs/kmz-wpml-audit.md` §11 (current exporter state) + §12 (descend
  root cause).
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.4 (waypointPoiPoint
  scoping fix), §5.1 (actionGroupId range), §5.2 (damping clamp).

---

## Severity counts

- P0 (BLOCKER): **2**
- P1 (HIGH): **3**
- P2 (conformance): **3**
- P3 (upgrade): **2**

---

## P0 — BLOCKER

### A4-P0-1 — Template Placemark `<Point><coordinates>` strips altitude (silent partial loss)

**Location**: `placemark.py:184`

```python
ET.SubElement(point, _kml_tag("coordinates")).text = f"{lon:.8f},{lat:.8f}"
```

The KML `<coordinates>` element omits the altitude axis on every placemark
in both files. WPML samples in `template-kml.md` show `lon,lat` is
formally permitted (the authoritative altitude lives in `wpml:height` /
`wpml:executeHeight`), so Pilot 2 will not reject the file outright on
this — but pairing a 2-D coordinate with an `<altitudeMode>`-free Point
inside a third-party generic KML viewer (Google Earth, QGIS, every
non-Pilot KML consumer the operator uses for visual QA) renders the
placemarks at ground level, masking altitude bugs that the WPML pass
would otherwise catch in eye-balled visual inspection.

This is not a Pilot 2 rejection. Listed at P0 because the audit brief
explicitly calls out coordinate-order verification for the Placemark
geometry and because the missing altitude axis is the same shape that
hid the underground-template bug (§12 of the existing audit) until
hardware fired. Recommend emitting `f"{lon:.8f},{lat:.8f},{alt:.6f}"`
where `alt` is the raw MSL — this is consistent with the FH2 reference
exports and keeps `<Point>` self-describing.

**Risk**: invisible-to-Pilot bugs that only surface on hardware. P0
because a KMZ that looks correct in QGIS and rejects on M4T is exactly
the failure mode the May 24 descend-to-ground incident produced.

---

### A4-P0-2 — Missing `wpml:globalUseStraightLine` is at folder level only; spec scopes `useStraightLine` to per-Placemark

**Location**: `builders.py:113` and `placemark.py:239`

```python
# builders.py — folder-level
_sub_text(folder, "globalUseStraightLine", "1")
# placemark.py — per-placemark, every placemark
_sub_text(placemark, "useStraightLine", "1")
```

Per `common-element.md`, `wpml:useStraightLine` is documented as
"per-waypoint only (not at folder level)" and is conditionally required
only when `waypointTurnMode = toPointAndPassWithContinuityCurvature`.

Two issues compound:

1. `globalUseStraightLine` is not in the documented element set. It is
   emitted unconditionally at the folder level. Pilot 2 has tolerated it
   (no field reports of rejection), but strict downstream validators
   (Cloud API uploads, Flight Hub 2 schema checks) flag unknown elements.

2. `useStraightLine=1` is emitted on **every** Placemark, including
   placemarks whose `waypointTurnMode` is the default
   `toPointAndStopWithDiscontinuityCurvature` (every non-video-pass
   placemark — that's the majority of a PAPI mission). The spec scopes
   this element to continuity-curvature placemarks; on stop-mode
   placemarks it is undefined behaviour. In practice this lands the
   element on TAKEOFF, LANDING, HOVER bookends, transits, and every
   photo-mode MEASUREMENT/HOVER.

The conservative fix is: drop `globalUseStraightLine` entirely; emit
`useStraightLine` per-Placemark only when `turn_mode` resolves to
`toPointAndPassWithContinuityCurvature` (i.e. only on video-pass
passthrough measurements, gated by `is_passthrough` already present in
`_append_placemark`).

**Risk**: schema rejection at upload time on Cloud API; "wrongly placed
point"–class Pilot 2 pre-flight error if a future M4T firmware version
tightens validation. P0 because it's structural and easy to hit in
production once a non-Pilot consumer enters the pipeline.

---

## P1 — HIGH

### A4-P1-1 — Child ordering inside Placemark partially diverges from canonical sample

**Location**: `placemark.py:182-271`

Spec canonical order (template.kml Placemark, per `template-kml.md`):

```
Point
wpml:index
wpml:ellipsoidHeight
wpml:height
wpml:useGlobalHeight
wpml:useGlobalSpeed
wpml:waypointSpeed         (conditional)
wpml:useGlobalHeadingParam
wpml:waypointHeadingParam  (conditional)
wpml:useGlobalTurnParam
wpml:waypointTurnParam     (conditional)
wpml:useStraightLine       (conditional)
wpml:gimbalPitchAngle      (conditional)
wpml:actionGroup           (optional)
wpml:isRisky               (optional)
```

The exporter emits, for a template Placemark:

```
Point
wpml:index
wpml:ellipsoidHeight
wpml:height
wpml:waypointSpeed          # ← before the useGlobal* quartet
wpml:waypointHeadingParam   # ← before useGlobalHeadingParam
wpml:waypointTurnParam      # ← before useGlobalTurnParam
wpml:useGlobalSpeed
wpml:useGlobalHeight
wpml:useGlobalHeadingParam
wpml:useGlobalTurnParam
wpml:useStraightLine
wpml:actionGroup
[wpml:segment_action_group]
wpml:isRisky
```

The `useGlobal*` quartet is emitted **after** the conditional override
blocks instead of **before** as a gate-then-override pattern. Pilot 2
v10.1.8.18 tolerates the inversion (confirmed empirically by the file
that passed pre-flight in §1.4 of the May-15 audit), but the WPML schema
documents `useGlobalSpeed` / `useGlobalHeight` / `useGlobalHeadingParam`
/ `useGlobalTurnParam` as the *gates* that determine whether the
following `waypoint*` element should be read. Some parsers read this as
a state-machine and consume the `useGlobal*` flag before deciding
whether to read the `waypoint*` override.

The waylines Placemark also inverts: the spec wants
`waypointSpeed → waypointHeadingParam → waypointTurnParam` followed by
optionals; the exporter emits speed → heading → turn → useStraightLine →
actionGroup → waypointGimbalHeadingParam → isRisky →
waypointWorkType. `waypointWorkType` is documented but its required
ordering is unclear; safe placement is between `actionGroup` and
`isRisky` per FH2 reference exports.

**Risk**: works on current Pilot 2 / FH2; could break on a future
firmware revision or a stricter Cloud API ingestion path. Easy reorder
in `_append_placemark`.

---

### A4-P1-2 — Special placemarks (TAKEOFF / LANDING / recording bookends) emit the same envelope as MEASUREMENT

**Location**: `placemark.py:182-271` (no branching on `wp.waypoint_type`)

`_append_placemark` does NOT branch on `wp.waypoint_type`. TAKEOFF,
LANDING, TRANSIT, MEASUREMENT, and HOVER (recording-start / recording-
stop bookends, since RECORDING_START / RECORDING_STOP are
`camera_action` values on HOVER waypoints — `actions.py:12-13`) all flow
through the same code path and emit:

- `wpml:waypointSpeed = wp.speed or 0` — on a TAKEOFF with `speed=None`
  this emits `0`, which `common-element.md` scopes to `(0, max)` (i.e.
  zero is invalid). The `useGlobalSpeed=1` flag in the template
  fortunately gates this on the template side, but the waylines side
  has no `useGlobalSpeed` gate and emits the raw `0`. Hardware behaviour
  on a `waypointSpeed=0` in waylines.wpml is undefined per spec; on M4T
  firmware this has been tolerated but is technically a range
  violation.
- `wpml:waypointTurnParam` with the default stop-mode — fine for
  TAKEOFF/LANDING but emits redundantly when `useGlobalTurnParam=1`
  would have inherited the same.
- `wpml:actionGroup` is suppressed correctly because
  `_append_action_group` (A5's scope) checks `wp.camera_action`.

Recommend either (a) branching `_append_placemark` on `wp.waypoint_type`
to skip per-WP overrides where the global block already supplies the
correct value, or (b) clamping `wp.speed or auto_speed` so the waylines
side never emits `0`.

**Risk**: spec range violation on TAKEOFF / LANDING / hover-bookend
waylines placemarks. Field-tested OK on M4T; one firmware bump from
becoming a rejection.

---

### A4-P1-3 — `wpml:waypointGimbalHeadingParam` is emitted unconditionally on every waylines Placemark with zeros

**Location**: `placemark.py:259-266`

```python
if in_waylines:
    gimbal_param = ET.SubElement(placemark, _wpml_tag("waypointGimbalHeadingParam"))
    _sub_text(gimbal_param, "waypointGimbalPitchAngle", "0")
    _sub_text(gimbal_param, "waypointGimbalYawAngle", "0")
```

`common-element.md` documents `waypointGimbalHeadingParam` as the
per-Placemark gimbal override that fires under
`gimbalPitchMode=usePointSetting`. The folder declares
`gimbalPitchMode=manual` (builders.py:104), under which this block is
**informational only** — the per-WP `gimbalRotate` action drives the
gimbal. The comment in `_append_placemark` acknowledges this.

Two problems:

1. The block is emitted on every waylines Placemark including
   TAKEOFF, LANDING, and TRANSIT — which never aim a gimbal. The zeros
   are inert under `manual` but mean nothing under
   `usePointSetting`, so if `gimbalPitchMode` is ever switched, every
   transit Placemark suddenly forces a 0° pitch + 0° yaw mid-flight.
   This is a footgun; a code reader changing the folder-level mode
   would not realize the Placemark-level zeros become live.
2. Emitting the block on a Placemark whose `waypointHeadingParam` is
   `towardPOI` is a documented spec conflict — `usePointSetting`
   requires absolute yaw under the block's own `waypointGimbalYawAngle`,
   and a `towardPOI` heading mode commands continuous yaw tracking. The
   two would fight on hardware. Inert today because of `manual`, but
   the conflict is latent.

Recommend gating: emit only on MEASUREMENT / HOVER aimed placemarks
where the operator might one day want a real `usePointSetting`
override; OR drop entirely and rely on the per-WP `gimbalRotate` action
under `manual`.

**Risk**: latent. Becomes an active hardware bug the moment
`gimbalPitchMode` toggles or a stricter parser flags the conflict.

---

## P2 — Conformance

### A4-P2-1 — `wpml:index` is correctly 0-indexed; no bug, but the comment understates a regression

**Location**: `placemark.py:190`

The 0-index conversion (`wp.sequence_order - 1`) is **correct** per
`common-element.md` (range `[0, 65535]`, monotonic from 0). The
in-code comment correctly notes that emitting 1-indexed values fired
every `reachPoint` actionGroup on the wrong waypoint. This audit
confirms the fix. No P0/P1 issue.

Verify: `_append_action_group` (A5's scope) and
`_append_segment_action_group` apply the same `-1` offset on every
`actionGroupStartIndex` / `actionGroupEndIndex` reference — this is
A5's responsibility to confirm.

---

### A4-P2-2 — `wpml:isRisky` emission is correct; M30/M30T/M3D/M3TD-only support undocumented in code

**Location**: `placemark.py:268`

`isRisky=0` is emitted on every Placemark in both files. Per
`waylines-wpml.md`, this element is **supported only on M30/M30T,
M3D/M3TD** — the M4T is not in the supported set. On M4T firmware the
element is silently ignored (no field reports of rejection), and the
exporter pins it to `0` (the safe default), so this is harmless today.

Inline comment recommended: note the M30/M3D scope and that the
emission is M4T-tolerated, so a future reader knows it's deliberately
emitted as belt-and-braces.

---

### A4-P2-3 — `wpml:waypointWorkType` emitted with literal "0" on every waylines Placemark; semantic intent undocumented in code

**Location**: `placemark.py:270-271`

```python
if in_waylines:
    _sub_text(placemark, "waypointWorkType", "0")
```

Per `common-element.md`, `waypointWorkType` is an enum identifying the
primary activity at the waypoint. The exporter unconditionally emits
`0` (the default "no special work type"). No bug — the value is in
range and Pilot 2 accepts it on every waypoint. But the spec defines
non-zero values for activities like photogrammetry / mapping; pinning
to `0` on a `MEASUREMENT` waypoint with a `camera_action=PHOTO_CAPTURE`
arguably mislabels the waypoint to a strict downstream consumer.

Today this is conformance noise. Recommend a code comment naming the
spec's enum values and explaining the deliberate choice, or, if the
M4T responds differently for `waypointWorkType=1`, surface that as a
trajectory-pipeline decision.

---

## P3 — Upgrade opportunities

### A4-P3-1 — `_append_placemark` is monolithic; per-waypoint-type seams would simplify A4's responsibilities

The function has no branching on `wp.waypoint_type`. Every Placemark
gets the same shape with the same per-WP overrides. Splitting into
`_append_aimed_placemark` / `_append_transit_placemark` /
`_append_ground_placemark` (with the latter covering TAKEOFF/LANDING)
would:

- let `_append_transit_placemark` and `_append_ground_placemark` skip
  the `waypointHeadingParam` block entirely and inherit `followWayline`
  via `useGlobalHeadingParam=1`, halving the per-file XML on a typical
  PAPI mission;
- localize the `waypointSpeed=0` footgun (P1-2) to the ground path,
  where it can be replaced with the global auto-speed;
- make the special-bookend placemarks (HOVER + RECORDING_START/STOP)
  visually distinct in code, easing future hardware-driven fixes.

This is upgrade work, not a fix — no behavioural change required
today.

---

### A4-P3-2 — `<Point>` should carry `altitudeMode` for KML consumers outside the WPML toolchain

KML defines `<altitudeMode>` as a child of `<Point>` (values:
`clampToGround`, `relativeToGround`, `absolute`). The exporter omits
it. Generic KML viewers fall back to `clampToGround`, which collapses
the visualisation. Adding
`<altitudeMode>absolute</altitudeMode>` (paired with the 3-axis
coordinate fix in A4-P0-1) would let Google Earth / QGIS render the
true flight path. Pilot 2 / FH2 read WPML elements for the truth and
ignore the KML altitude axis, so this is a no-op for the M4T pipeline
and a strict improvement for visual QA.

---

## Items deferred to other agents (sanity-checked, not owned)

- **B2 — altitude (executeHeight / ellipsoidHeight / height)**: the
  exporter splits correctly per spec — waylines emit `executeHeight`
  takeoff-relative, template emits `ellipsoidHeight` (HAE) +
  `height` (relative). The §12 underground bug is fixed. The
  per-Placemark clamp at `placemark.py:169-180` is correct; logged
  only on the `in_waylines` pass to avoid duplicate warnings.
- **B3 — heading**: `_append_heading_param` branches on `mode` and
  `_aims_at_target(wp)`. `waypointPoiPoint` carries `lat,lon,0.000000`
  per `common-element.md`. The earlier `0,0,0` sentinel (West African
  coast) was fixed in §2.4 of the May-15 audit.
- **B4 — gimbal**: `gimbalRotate` is the per-WP aim under
  `gimbalPitchMode=manual`. The folder-level mode is documented; the
  per-Placemark `waypointGimbalHeadingParam` zero block is flagged
  here under A4-P1-3 because the *placement* is A4's call.
- **C2 — turn / damping**: `_append_turn_param` and
  `_nearest_leg_lengths` enforce the `(0, segment length]` clamp from
  §5.2 of the May-15 audit.
- **A5 — action groups**: `actionGroup` placement at end of Placemark
  is correct per spec. `actionGroupId` collision-free streams per §5.1
  of the May-15 audit. `_append_segment_action_group` follows the
  same Placemark.

---

## Verdict

- **Two P0 issues** that are not currently launch-blocking on M4T +
  Pilot 2 but are real spec violations / footguns:
  - `<coordinates>` missing the altitude axis (A4-P0-1).
  - `globalUseStraightLine` at folder level + `useStraightLine=1` on
    every placemark regardless of turn mode (A4-P0-2).
- **Three P1 issues** affecting motion smoothness, child ordering, and
  the special-Placemark envelope (TAKEOFF / LANDING / bookend speed
  range).
- **Three P2 conformance notes** for code comments / future-proofing.
- **Two P3 upgrade opportunities** if the exporter ever needs to
  produce visually-correct KML for non-WPML consumers.

The Placemark envelope is **operationally correct on M4T** today.
The structural fixes above harden against firmware / parser drift and
prevent the next descend-to-ground class of regression.
