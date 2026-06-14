# Agent A2 - `waylines.wpml` root structure

Scope: the top-level shape of `wpmz/waylines.wpml` emitted by
`backend/app/services/export/dji/builders.py::_build_dji_waylines_wpml` -
KML root + namespaces, `<Document>` children, `<wpml:missionConfig>`
placement (NOT contents, owned by A3), `<Folder>` wrapper + child
ordering, and the wayline-level execution parameters (`templateId`,
`executeHeightMode`, `waylineId`, `autoFlightSpeed`,
`waylineCoordinateSysParam`, `distance`, `duration`,
`realTimeFollowSurfaceByFov`).

Out of scope and deferred to sibling agents:
- A3: `<wpml:missionConfig>` children + ordering + values.
- A4: `<Placemark>` envelope, child ordering, `useGlobal*` flags.
- A5: `<wpml:actionGroup>` content + the four `actionGroupId` rules.
- B1: drone enum domain. B5: payload enum / `payloadParam`.
- B2: altitude encoding inside the placemark (`executeHeight`).
- B3: heading param. B4: gimbal. C2: turn modes / damping clamp.

Spec sources (fetched 2026-05-26):
- `dji-sdk/Cloud-API-Doc/.../30.waylines-wpml.md` - canonical sample.
- `dji-sdk/Cloud-API-Doc/.../40.common-element.md` - element domain.

Existing audits cross-read:
- `docs/kmz-wpml-audit.md` §11 (current state), §12 (descend root cause).
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §1.4 (executeHeightMode
  history, now superseded by relativeToStartPoint), §2.2 (globalRTHHeight
  waylines-only scoping), §2.3 (canonical missionConfig child order),
  §2.5 (uppercase UTF-8 header).

---

## Canonical reference (from `30.waylines-wpml.md`, the official sample)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig> ... </wpml:missionConfig>
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>WGS84</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>10</wpml:autoFlightSpeed>
      <Placemark> ... </Placemark>
    </Folder>
  </Document>
</kml>
```

The official sample namespace is `wpmz/1.0.2`; the M4T file is tagged
`wpmz/1.0.6` (audit §11). Spec-documented Folder children are exactly:
`templateId`, `executeHeightMode`, `waylineId`, `autoFlightSpeed`,
`Placemark`. The official sample shows no `globalRTHHeight`, no
`waylineCoordinateSysParam`, no `distance` / `duration`, no
`realTimeFollowSurfaceByFov`, and no `startWaylineExecution`.

## Current exporter emission (waylines.wpml)

`<Document>` children, in order:
1. `<wpml:missionConfig>` (content owned by A3; verified ordering against
   `template-kml.md` canonical sample - clean per audit §2.3).
2. `<Folder>`.

`<Folder>` children, in order (`builders.py:214-262`):
1. `wpml:templateId`
2. `wpml:waylineCoordinateSysParam` (block: `coordinateMode`,
   `heightMode`) - **NOT in spec**
3. `wpml:executeHeightMode`
4. `wpml:waylineId`
5. `wpml:distance` - **NOT in spec**
6. `wpml:duration` - **NOT in spec**
7. `wpml:autoFlightSpeed`
8. `wpml:realTimeFollowSurfaceByFov` - **NOT in spec**
9. `Placemark` (one per waypoint).

## Summary

- P0 BLOCKER: 1
- P1 HIGH: 3
- P2 conformance: 4
- P3 upgrade: 2

Severity-aware: nothing here is a confirmed Pilot 2 reject today, but
two findings (P0-1, P1-1) put the wayline-level shape outside what the
M4T golden fixture is likely to contain, and several P2 elements are
spec-undocumented additions that strict validators
(`com.dji:wpmz`, `IWPMZManager.checkValidation`, Cloud API ingestion)
will flag.

---

## P0 - BLOCKER

### A2-P0-1 - Folder child order diverges from the canonical sample on every emit

**Location**: `builders.py:214-244`.

**Spec**: `30.waylines-wpml.md` canonical sample fixes the order
`templateId -> executeHeightMode -> waylineId -> autoFlightSpeed ->
Placemark`. `common-element.md` lists no alternative ordering.

**Current behaviour**: the exporter emits
`templateId -> waylineCoordinateSysParam -> executeHeightMode ->
waylineId -> distance -> duration -> autoFlightSpeed ->
realTimeFollowSurfaceByFov -> Placemark`. Four extras are spliced into
the middle of the canonical sequence (P2-1, P2-2, P2-3, P2-4), and
`executeHeightMode` is bumped from spec position 2 to position 3 by
`waylineCoordinateSysParam`.

**Why P0**: this is the same class of bug as audit §2.3 (`missionConfig`
child ordering) - documented, structural, and previously assumed to be
"Pilot 2 tolerated so we left it". The §2.3 fix was landed in PR #508
specifically because strict downstream validators flag out-of-order
children even when Pilot 2 silently accepts. The audit precedent says:
fix ordering proactively because the cost is one line of code and the
benefit is dropping a real rejection risk against `com.dji:wpmz` /
`IWPMZManager.checkValidation` / Cloud API. The current waylines Folder
shape violates the same contract that §2.3 was raised to enforce -
making this a P0 by audit-history consistency, not by hardware-observed
rejection.

**Proposed fix**: reorder the `_sub_text` calls inside
`_build_dji_waylines_wpml` so the spec-documented elements appear in
canonical order. If the extras are kept (see P2-* findings below), put
them strictly AFTER `autoFlightSpeed` and BEFORE the first `Placemark`,
so a strict parser scanning the canonical prefix sees the expected
sequence first. Pin with a regression test asserting child-tag sequence
matches `[templateId, executeHeightMode, waylineId, autoFlightSpeed, ...]`
on every supported scope (FULL / NTL / MO) and every heading mode.

**HW verify**: low-risk - import the reordered KMZ on M4T + Pilot 2 RC,
confirm the wayline imports and the mission summary still populates.
The reorder is byte-shuffle, not semantic, so Pilot 2 should be
unaffected.

**Overlaps**: A3's audit (`agent-a3-mission-config.md`) records
`missionConfig` child ordering is clean per §2.3 - waylines folder
ordering is the parallel layer and is broken in the same way the §2.3
fix already addressed for `missionConfig`.

---

## P1 - HIGH

### A2-P1-1 - `<wpml:waylineCoordinateSysParam>` is emitted in waylines but the spec scopes it to `template.kml`

**Location**: `builders.py:221-223`.

**Spec**: `template-kml.md` documents `waylineCoordinateSysParam` as a
template-folder child (template.kml). `waylines-wpml.md` does NOT list
it; the canonical waylines sample has no such element. `common-element.md`
likewise documents it without any "valid in waylines" note.

**Current behaviour**: the waylines folder emits a full
`waylineCoordinateSysParam` block (`coordinateMode=WGS84`,
`heightMode=relativeToStartPoint`) before `executeHeightMode`. The
inline comment at `builders.py:217-220` justifies it as:

> mirror the template.kml block - pilot rc rejects waylines whose
> folder does not declare how per-placemark coordinates and heights
> should be interpreted. without it the controller renders placemark
> labels but refuses to draw the connecting polyline or populate the
> mission summary.

This is a hardware-observed claim, not a spec-derived requirement.

**Why P1**: two competing risks:
1. If the Pilot RC observation is real and reproducible on M4T, dropping
   the block reintroduces a polyline / summary regression - operationally
   surprising, even if the drone executes correctly.
2. If a strict validator (Cloud API, `com.dji:wpmz`) rejects
   spec-undocumented children, the current shape blocks Cloud API
   ingestion forever - and the operator never sees the cause because the
   M4T flight path itself never tested through Cloud API.

The exporter is taking on a spec-conformance debt to dodge an
empirical Pilot RC quirk. The right resolution depends on the M4T
golden fixture (audit §6): if DJI Pilot 2 itself emits
`waylineCoordinateSysParam` in waylines, the block is "undocumented but
DJI-blessed" and stays; if it does not, the block is a workaround for a
bug that may have been fixed in firmware, and should be removed.

**Evidence**: the comment cites no flight test number / Pilot RC build /
firmware version. The 2026-05-15 audit `2.1` already removed
`waylineAvoidLimitAreaMode` for being undocumented, even though Pilot 2
tolerated it - this is precedent for the conservative drop direction.

**Proposed fix**: deferred to the M4T golden fixture (Phase 0 of audit
`docs/kmz-wpml-audit.md` §9). Two-step:
1. Acquire a Pilot 2 M4T golden export. Diff its `waylines.wpml`
   against the current exporter.
2. If golden contains `waylineCoordinateSysParam`: pin a test citing
   the fixture and remove the "spec-undocumented" caveat from the
   inline comment (it's DJI-emitted, just undocumented).
3. If golden omits it: drop the block from the writer. Pair the drop
   with a flight test on the same hardware that motivated the original
   addition; if the polyline regression returns, escalate to a P0 and
   investigate which firmware-build dependency the Pilot RC issue
   tracks.

**HW verify**: A4's `agent-a4-placemark.md` lists no equivalent
finding because A4's scope ends at the Placemark envelope. This is
A2's territory. The golden-fixture diff settles it definitively.

**Overlap**: B2's `agent-b2-altitude.md` P2-1 records the same
finding from the altitude-encoding angle; both audits converge on
"need golden fixture to settle". Defer to whichever issue lands the
golden first.

---

### A2-P1-2 - `<wpml:realTimeFollowSurfaceByFov>` is emitted at the wayline level but is not in the documented common-element set

**Location**: `builders.py:244`.

**Spec**: `common-element.md` (fetched 2026-05-26) does not document
`realTimeFollowSurfaceByFov`. `waylines-wpml.md` does not list it.
Related elements `realTimeFollowSurface` and the
`executeHeightMode=realTimeFollowSurface` option exist (the latter
M3E/M3T/M3M only, per the WebFetched canonical), but
`realTimeFollowSurfaceByFov` as a wayline-folder child appears in no
spec document.

**Current behaviour**: emitted unconditionally as `"0"`. No comment, no
gating, no scope branching. The literal string is fixed at the
`_build_dji_waylines_wpml` call site.

**Why P1**: this looks like a relict from an older M3-series export path
or a forward-looking M4T flag that DJI may not have documented yet.
Either way:
- if M4T firmware reads it as a heightMode-related toggle, hardcoding
  `0` is fine because we already use `executeHeightMode=relativeToStartPoint`
  (terrain-follow off);
- if M4T firmware does not read it, strict validators (Cloud API,
  `com.dji:wpmz`) will reject the file at upload time on an unknown
  child.

The value is benign; the *emission* is the spec-conformance risk.

**Evidence**: `_build_dji_waylines_wpml:244` writes the literal `"0"`
with no comment. No code path consults this value, no test asserts on
it, no spec entry justifies it.

**Proposed fix**: drop the emission entirely. If the M4T golden fixture
contains it, restore at the *spec-correct position* (after `autoFlightSpeed`,
per A2-P0-1) and pin a regression test citing the fixture. If the
fixture does not contain it, remove and add an inline comment
recording the deletion so a future audit knows it was a deliberate
drop, not an oversight.

**Overlap**: B2's P2-2 records the same finding for the
`realTimeFollowSurfaceByFov` element. Resolution shares B2's; either
audit's issue can carry the fix.

---

### A2-P1-3 - `<wpml:distance>` and `<wpml:duration>` are emitted at the wayline level but are not in the documented element set

**Location**: `builders.py:240-242`.

**Spec**: `common-element.md` (fetched 2026-05-26) does not document
`distance` or `duration` as wayline-folder children. The canonical
sample omits them. The mission summary panel in Pilot 2 is documented
to compute these at parse time, not consume them from the WPML.

**Current behaviour**: the exporter computes
`_emitted_distance_duration(waypoints, auto_speed)` (3D haversine + alt
delta per leg, fall-back per-leg speed) and writes both as
`f"{value:g}"` decimal strings. The inline comment at lines 238-239
justifies it as:

> pilot rc populates the mission summary panel from these wayline-level
> fields, so they must reflect the actual placemark stream rather than
> flight_plan.total_distance / estimated_duration.

Same empirical-vs-spec gap as A2-P1-1: claim is hardware-observed, no
flight test reference, no firmware version pin.

**Why P1**: two failure modes:
1. If Pilot 2 *does* read these (the operational claim), the values are
   currently a 3D approximation - the *true* flight length includes
   curve-radius arcs at every `toPointAndPassWithContinuityCurvature`
   waypoint (continuous-pass turns travel further than the straight-line
   3D segment). The error is small (centimetres per turn at 0.2 m
   damping) but compounds across long VP video passes. A summary panel
   that under-reports duration by ~5 % is a minor operator confusion;
   under-reporting by ~30 % on a long mission could trigger a "battery
   insufficient" pre-flight check.
2. If Pilot 2 does *not* read them (the spec claim), strict validators
   reject the file on the spec-undocumented children. Same risk class
   as A2-P1-1 / A2-P1-2.

`_emitted_distance_duration` itself is solid - the 3D-with-alt-delta
math is correct, the per-leg speed fallback is correct, the
`flight_plan.total_distance` mismatch reasoning is correct. The
question is just whether to emit at all and at what position.

**Evidence**: code at `builders.py:240-242`; computation at
`mission_config.py:265-304`; no spec entry; no flight log.

**Proposed fix**: defer to the M4T golden fixture diff (audit §6).
Best-case: golden contains both fields and DJI just under-documents -
keep, but reorder per A2-P0-1, and pin a regression test against the
fixture's values. Worst-case: golden omits both fields - drop both
emissions; the summary panel computes from placemark count regardless.

**HW verify**: with the operator on Pilot RC, open the mission summary
panel after import with `<wpml:distance>` and `<wpml:duration>`
emitted and again with both omitted. Confirm panel renders identically;
if yes, drop. If the second case renders blank, keep but pin the
fixture-comparison test.

**Overlap**: B2's `agent-b2-altitude.md` P2-2 covers the same elements
from the altitude / spec-conformance angle. A2 records the spec-shape
risk; B2 records the same elements but the resolutions converge.

---

## P2 - Conformance

### A2-P2-1 - `<wpml:waylineCoordinateSysParam>` heightMode `relativeToStartPoint` is spec-tolerant but only in the template per common-element.md

**Location**: `builders.py:221-223`.

**Spec**: `common-element.md` documents `waylineCoordinateSysParam`'s
`heightMode` as `{EGM96, WGS84, relativeToStartPoint}` - but the
audit `2026-05-15` §1.4 specifically calls out `relativeToStartPoint`
as a valid `heightMode` value in the template's
`waylineCoordinateSysParam`, and the current exporter exploits that.

**Current behaviour**: the waylines `waylineCoordinateSysParam` block
emits `heightMode=relativeToStartPoint` (matching the template's same
block). The post-#726 fix made these two files agree byte-for-byte on
heightMode so Pilot 2's wayline-regeneration-from-template flow can't
disagree with the bundled waylines. Operationally correct.

**Why P2**: rolls up under A2-P1-1. If `waylineCoordinateSysParam` is
kept in waylines (golden-fixture confirms), the `relativeToStartPoint`
value is the right choice for spec-mirroring; if it's dropped, this
finding is moot. No standalone issue.

**Proposed fix**: subsumed by A2-P1-1's golden-fixture resolution.

---

### A2-P2-2 - `<wpml:executeHeightMode>` value range matches spec, but the post-#726 choice is documented sparsely

**Location**: `builders.py:232`.

**Spec**: `common-element.md` documents `executeHeightMode` value set
as `{WGS84, relativeToStartPoint, realTimeFollowSurface}`. The
`realTimeFollowSurface` value is M3E/M3T/M3M-only per audit. The exporter
uses `relativeToStartPoint` unconditionally on every scope.

**Current behaviour**: emit `<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>`.
Inline comment (`builders.py:225-231`) is thorough: explains the
`relativeToStartPoint` choice, why the absolute-WGS84 shape was
abandoned, why the `waylineCoordinateSysParam` mirrors, and why the
template's `heightMode` agrees with this value. Operationally clean.

**Why P2**: the value is spec-correct. The audit history is the
authoritative reasoning (audit §1.4 superseded note, audit §12 root
cause). The only conformance gap is that the inline comment doesn't
cite the audit document name - so a future reader stumbling on this
line would need to grep for "descend-to-ground" to find the rationale.
A one-line citation would close the loop.

**Proposed fix**: append `(see docs/kmz-wpml-audit.md §12)` to the
inline comment.

---

### A2-P2-3 - `<wpml:templateId>` value `"0"` is a literal, fine for single-wayline files; multi-wayline is out of scope

**Location**: `builders.py:215`.

**Spec**: `common-element.md` documents `templateId` as `[0, 65535]`,
must match a `templateId` in `template.kml`. The spec supports multiple
waylines per KMZ (one Folder per wayline), each with its own
`templateId` referencing different templates in the template.kml file.

**Current behaviour**: both `template.kml`'s template-folder
`<wpml:templateId>0</wpml:templateId>` (`builders.py:87`) and the
waylines folder's `<wpml:templateId>0</wpml:templateId>`
(`builders.py:215`) are hardcoded to `0`. This is consistent (the
waylines references a real templateId in the template), but it pins the
exporter to single-wayline KMZs forever.

**Why P2**: today every mission produces a single-wayline KMZ, so
hardcoding `0` is correct and matches the canonical sample. The risk
is the same hardcoded literal pattern that's been a footgun in other
audits (no named constant, no comment about the multi-wayline
extension path). If a future requirement asks for multi-wayline
export, this single-template assumption is the seam to revisit.

**Proposed fix**: optional - extract to a module-level constant
`_DJI_WAYLINE_TEMPLATE_ID = "0"` so the value is reviewable. No
behavioural change.

---

### A2-P2-4 - `<wpml:waylineId>` is hardcoded `"0"` for the same single-wayline reason

**Location**: `builders.py:233`.

**Spec**: `common-element.md` documents `waylineId` as `[0, 65535]`,
unique within the KMZ file. A single-wayline KMZ trivially uses `0`.

**Current behaviour**: literal `"0"`.

**Why P2**: same shape as A2-P2-3 - correct for the single-wayline case,
extends naturally to multi-wayline (sequential ids) when needed.

**Proposed fix**: same as A2-P2-3 - optional named constant.

---

## P3 - Upgrades

### A2-P3-1 - `<wpml:startWaylineExecution>` is not emitted; spec marks it optional and most missions don't need it

**Location**: would belong in `_build_dji_waylines_wpml` if emitted.

**Spec**: `common-element.md` documents `startWaylineExecution` as an
optional wayline-folder child. When set, the wayline auto-starts at
import time without operator intervention. Default is operator
gestures the "start" button after import.

**Current behaviour**: not emitted. The operator always presses start
on Pilot 2 after importing the KMZ - this is the safer default for
airport inspections (operator confirms the mission is what was planned
before commit).

**Why P3**: this is an opt-in UX feature, not a correctness item. For
the thesis pipeline the manual-start contract is the right safety
posture. The upgrade direction is: expose
`mission.start_wayline_execution_on_import` as a per-mission column,
default off, and emit the element only when the operator explicitly
opts in.

**Proposed fix**: deferred until an operator requests auto-start.

---

### A2-P3-2 - The `_build_dji_waylines_wpml` function emits at the document level without any namespace re-registration; a top-of-file XML declaration with `standalone="no"` would mirror the FH2 reference exports

**Location**: `builders.py:264`.

**Spec**: KML 2.2 allows `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`.
The audit `2.5` fix landed uppercase `UTF-8`. FH2 reference exports
include `standalone="no"`.

**Current behaviour**: `ET.tostring(kml, encoding="UTF-8", xml_declaration=True)`
emits `<?xml version='1.0' encoding='UTF-8'?>` (no `standalone`,
single-quoted). Pilot 2 accepts both forms.

**Why P3**: cosmetic. The XML 1.0 spec defines `standalone="no"` as the
default when absent, so the emission is semantically identical to the
FH2 reference. The only delta a strict comparison would catch is
quote style (`'` vs `"`) and the omitted `standalone` token.

**Proposed fix**: when the M4T golden fixture lands, byte-diff the
header line and align if FH2 emits a different form.

---

## Cross-cutting verification - existing audits remain clean

- **§2.1** (`waylineAvoidLimitAreaMode` removal): not emitted anywhere
  in `_build_dji_waylines_wpml` or downstream. Clean.
- **§2.2** (`globalRTHHeight` waylines-only): `mission_config.py:215-221`
  gates on `in_waylines=True`. The waylines mirror correctly includes
  `globalRTHHeight`, the template mirror correctly omits it. A3 audits
  the `_global_rth_height` math.
- **§2.5** (uppercase UTF-8 header): `builders.py:264` uses
  `encoding="UTF-8"`. Clean.
- **`<Document>` children**: only `<wpml:missionConfig>` and `<Folder>`
  in that order. Matches the canonical sample. Header `author` /
  `createTime` / `updateTime` from the template are correctly omitted
  in waylines (the waylines is a flight file, not authoring metadata).
- **KML namespace**: `http://www.opengis.net/kml/2.2` registered in
  `shared.py:18`. Matches spec.
- **WPML namespace**: `http://www.dji.com/wpmz/1.0.6` registered in
  `shared.py:19`. Matches the M4T requirement per
  `docs/kmz-wpml-audit.md` §2.

---

## Items deferred to other agents (sanity-checked, not owned)

- **A3 - `missionConfig` content**: child order and values audited
  cleanly in `agent-a3-mission-config.md` against audit §2.3. A2 only
  verifies the *placement* of the missionConfig block as Document's
  first child (correct, matches canonical sample).
- **A4 - Placemark envelope**: per-Placemark structure audited in
  `agent-a4-placemark.md`. A2 does not duplicate.
- **A5 - actionGroup**: audited in A5's report.
- **B1/B5 - drone + payload enums**: A2 does not look at the enum
  *values*, only the block placement (no issue at the wayline level -
  enum blocks live inside `missionConfig`).
- **B2 - altitude encoding**: A2 verifies `executeHeightMode` value
  and emit-position; per-Placemark `executeHeight` math is B2's. The
  P1-1 / P1-2 / P1-3 findings here overlap structurally with B2's
  P2-1 / P2-2 but the resolution is shared (golden fixture diff).
- **B3 - heading**: heading param is per-Placemark (A4 scope), not
  wayline-folder; A2 has nothing to audit. The folder-level
  `globalWaypointHeadingParam` lives in `template.kml` only
  (`builders.py:106-110`), not in waylines.
- **B4 - gimbal**: gimbal param is per-Placemark and per-Action.
  Folder-level `gimbalPitchMode` lives in `template.kml` only
  (`builders.py:104`). A2 has nothing to audit.
- **C2 - turn / damping**: per-Placemark and folder-level
  `globalWaypointTurnMode` lives in `template.kml` only
  (`builders.py:112`). A2 has nothing to audit.

---

## Verdict

The waylines.wpml root structure is **operationally correct on M4T +
Pilot 2 RC today**. Every emitted element has a reasoned justification.
The structural gap is that the exporter inflates the wayline-folder
shape with four undocumented children
(`waylineCoordinateSysParam`, `distance`, `duration`,
`realTimeFollowSurfaceByFov`) AND emits the spec-documented children
out of canonical order (`executeHeightMode` in position 3 instead of 2,
because `waylineCoordinateSysParam` is spliced in between).

The single P0 (folder child ordering) is a one-line reorder that
mirrors the §2.3 fix already landed for `missionConfig`. The three P1
findings (the three undocumented children) all converge on the same
resolution: acquire the M4T golden fixture (Phase 0 of audit §9), diff
the waylines.wpml block-by-block, and drop / pin each undocumented
element per the diff. Until that fixture lands, the conservative path
is to (a) land the reorder, (b) keep all four extras inline-commented
with the audit-history rationale and a `# TODO: confirm against golden`
marker, and (c) treat any strict-validator rejection in production as
the trigger to drop the extras.

The Cross-cutting verification confirms the §2 fixes from
`2026-05-15-dji-wpml-spec-audit.md` remain intact in the post-#726
post-#638 codebase.
