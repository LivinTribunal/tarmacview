# Agent A1 — `template.kml` root structure

Scope: KML root + namespaces, Document children, Folder envelope, top-level
WPML elements emitted by `_build_dji_template_kml` in
`backend/app/services/export/dji/builders.py`. Per the brief, scoped to the
**file's top-level shape** — sibling agents own Placemark internals (A4),
missionConfig children (A3), action groups (A5), altitude values (B2),
heading values (B3), gimbal (B4), turn/damping (C2), payload (B5), enums
(B1), KMZ container/XML decl (A6).

Spec quoted from `dji-sdk/Cloud-API-Doc` (WebFetched 2026-05-26):
- `template-kml.md` — canonical sample tree.
- `common-element.md` — element scoping / range / required-when rules.

Existing audits cross-read:
- `docs/kmz-wpml-audit.md` §11 (current state) + §12 (descend-to-ground RC).
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.5–§2.7 (XML encoding,
  timestamp format, globalHeight at folder level "already emitted").

---

## Canonical sample structure (template-kml.md)

```
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
<Document>
  <wpml:author>...</wpml:author>
  <wpml:createTime>1637600807044</wpml:createTime>
  <wpml:updateTime>1637600875837</wpml:updateTime>
  <wpml:missionConfig>...</wpml:missionConfig>
  <Folder>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>EGM96</wpml:heightMode>
      <wpml:globalShootHeight>50</wpml:globalShootHeight>
      <wpml:positioningType>GPS</wpml:positioningType>
      ...
    </wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>
    <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam>...</wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>...</wpml:globalWaypointTurnMode>
    <wpml:globalUseStraightLine>0</wpml:globalUseStraightLine>
    <Placemark>...</Placemark>
  </Folder>
</Document>
</kml>
```

**Canonical Folder ordering (waypoint template):**
`templateType → templateId → waylineCoordinateSysParam → autoFlightSpeed →
gimbalPitchMode → globalWaypointHeadingParam → globalWaypointTurnMode →
globalUseStraightLine → Placemark…`

The canonical sample contains **no** `globalHeight`, **no** `caliFlightEnable`,
**no** folder-level `payloadParam` for the waypoint template type.

## Current emission order (builders.py:69–132)

```
kml
  Document
    wpml:author "TarmacView"          # builders.py:71
    wpml:createTime                   # builders.py:72  (13-digit ms; conformant per §2.6)
    wpml:updateTime                   # builders.py:73
    wpml:missionConfig …              # delegated to A3
    Folder
      wpml:templateType "waypoint"    # builders.py:86
      wpml:templateId "0"             # builders.py:87
      wpml:waylineCoordinateSysParam  # builders.py:89-91
        wpml:coordinateMode "WGS84"
        wpml:heightMode "relativeToStartPoint"
      wpml:autoFlightSpeed            # builders.py:93
      wpml:globalHeight               # builders.py:94   *** out-of-spec slot
      wpml:caliFlightEnable "0"       # builders.py:95   *** mapping-only element
      wpml:gimbalPitchMode "manual"   # builders.py:104
      wpml:globalWaypointHeadingParam # builders.py:106-110
      wpml:globalWaypointTurnMode     # builders.py:112
      wpml:globalUseStraightLine "1"  # builders.py:113  (see A4-P0-2 / C2 — folder-level emission)
      Placemark[]                     # builders.py:119-130
      wpml:payloadParam               # builders.py:132  *** post-Placemark, out of order
    [keep-out Folder, optional]       # builders.py:134-135
```

---

## Severity summary

- P0 (BLOCKER): **0**
- P1 (high — affects regeneration): **3**
- P2 (conformance): **4**
- P3 (upgrade): **2**

No top-level shape issue is blocking Pilot 2 v10.x today (the operator's past
imports went through). The P1 set is concentrated on **out-of-spec folder
children** and **child ordering inside Folder** — both of which feed Pilot 2's
template→waylines regeneration path called out in `docs/kmz-wpml-audit.md`
§12 as the layer that propagated the descend-to-ground bug.

---

## Verified — clean

- **Namespaces** (`builders.py:69` + `shared.py:13–19`): KML
  `http://www.opengis.net/kml/2.2` and WPML
  `http://www.dji.com/wpmz/1.0.6` registered, prefix lowercase `wpml`. URIs
  exact, prefix case correct. The `1.0.6` version diverges from the canonical
  sample (`1.0.2`) deliberately — see `kmz-wpml-audit.md` §11 (M4T-era namespace
  observed in Pilot 2 round-trips). Confirmed appropriate.
- **`<Document>` wraps everything** (`builders.py:70`): single Document child
  of `<kml>`; every WPML element + Folder is a descendant. Clean.
- **`wpml:author` / `wpml:createTime` / `wpml:updateTime`** emitted as the
  first three Document children before `<wpml:missionConfig>` — matches the
  canonical ordering. Timestamps are 13-digit Unix epoch ms (audit §2.6
  re-verified). The author literal `"TarmacView"` is fine (spec is silent on
  format).
- **`wpml:missionConfig` placement** sits inside `<Document>` immediately
  after the three header elements — correct (A3 owns the children).
- **`<Folder>` wraps the Placemarks** — correct shape; one Folder per
  waypoint template.
- **`wpml:templateType="waypoint"`** (`builders.py:86`): in the documented
  enum `{waypoint, mapping2d, mappingStrip, mapping3d, oblique}`.
- **`wpml:templateId="0"`** (`builders.py:87`): the canonical sample uses
  exactly `"0"`. Unique per file (only one Folder), conformant.
- **`waylineCoordinateSysParam/coordinateMode=WGS84`** (`builders.py:90`):
  spec-valid.
- **`waylineCoordinateSysParam/heightMode=relativeToStartPoint`**
  (`builders.py:91`): matches the post-#726 stance documented in
  `kmz-wpml-audit.md` §11 + audit §1.4 (superseded). Mirrors the
  waylines folder. Clean from a top-level shape perspective — value
  decision is B2's call.
- **`autoFlightSpeed` emitted at folder level** (`builders.py:93`): correct
  slot per canonical sample. (Value resolution is B2/cross-cutting.)
- **`gimbalPitchMode=manual` emitted at folder level** (`builders.py:104`):
  emission slot is correct. The `manual` vs `usePointSetting` choice is
  load-bearing — B4 owns the value defense; the canonical sample uses
  `usePointSetting`, but the gotcha note in `services/CLAUDE.md` explicitly
  warns against `usePointSetting` (locks gimbal yaw to absolute north on
  M4T). Emission slot itself is conformant.
- **`globalWaypointHeadingParam` emitted at folder level** in correct slot
  (`builders.py:106`).
- **`globalWaypointTurnMode` emitted** in correct slot (`builders.py:112`).

---

## Findings

### [P1-1] `wpml:globalHeight` emitted INSIDE Folder is not in the canonical waypoint template

- **Severity**: P1 — affects Pilot 2's template→waylines regeneration
- **Location**: `backend/app/services/export/dji/builders.py:94`
- **Spec**: The canonical waypoint template sample (`template-kml.md`) does
  not emit `<wpml:globalHeight>` anywhere — neither at Document level nor
  inside the Folder. `common-element.md` does not list `globalHeight` at all
  (WebFetch'd 2026-05-26). The 2026-05-15 audit §2.7 claims `globalHeight`
  is "required for waypoint templates" — re-checking against the live spec
  this **does not appear in the documented element set**. The audit's
  assertion may be a misread; the canonical sample is the authoritative
  reference.
- **Current behaviour**: emitted unconditionally inside Folder between
  `autoFlightSpeed` and `gimbalPitchMode` as
  `<wpml:globalHeight>{global_height}</wpml:globalHeight>` where
  `global_height = max(50, max_relative_height + 5)` (a chosen safety
  ceiling on the takeoff-relative scale).
- **Why this matters for regeneration**: per audit §12 (descend-to-ground RC)
  the prior bug shape was *latent unit mismatch in the same file* — a
  `globalHeight` on AGL scale while per-WP `height` was MSL. Today the unit
  scale matches (both takeoff-relative), but the element is still **outside
  the documented schema for waypoint templates**. Pilot 2's regeneration
  picks the value up because the inline comment at `builders.py:60-63`
  documents intent: keep the global ceiling above the highest waypoint.
  Strict validators (DJI `IWPMZManager.checkValidation`,
  `com.dji:wpmz` library) flag undocumented elements. Worse, every
  Placemark today emits `useGlobalHeight=0` (A4-noted) so the value is
  inert by design — the comment at `builders.py:62-63` even says
  "useGlobalHeight=0 on every placemark keeps it inert".
- **Proposed fix**: drop the emission. The Placemark-level `height` /
  `ellipsoidHeight` already carry the authoritative altitudes; the file is
  internally consistent without `globalHeight`. If a future change wants
  `useGlobalHeight=1`, reintroduce the element AT DOCUMENT LEVEL per the
  WebFetch hint ("Location: Document level") and verify against a real
  Pilot 2 M4T export.
- **HW verify**: re-export the reference mission after the drop and confirm
  Pilot 2 still imports without "Wayline height not consistent" warnings;
  FH2 renders identically.

### [P1-2] `wpml:caliFlightEnable` is a mapping/oblique element on a waypoint template

- **Severity**: P1 — strict validator rejection risk; mislabels mission type
- **Location**: `backend/app/services/export/dji/builders.py:95`
- **Spec**: WebFetch on `template-kml.md` returned: "`wpml:caliFlightEnable`
  appears only in mapping/oblique photography templates, not in waypoint
  templates." The element gates an automatic calibration pre-flight ritual
  used by mapping missions to seed photogrammetry.
- **Current behaviour**: emitted unconditionally inside Folder with value
  `"0"`. Pilot 2 v10.x tolerates this (`0` = disabled, the safe default)
  and the operator's missions have imported. But the emission incorrectly
  labels the file shape as mapping-aware.
- **Why P1**: a future M4T firmware or a stricter Cloud API ingestion path
  could reject `templateType=waypoint` + `caliFlightEnable=anything` as a
  shape contradiction. The element is also unscoped under
  `gimbalPitchMode=manual` (this file's mode), so it has no execution effect.
- **Proposed fix**: drop the line. Pin with a regression test asserting
  `caliFlightEnable` is absent from the Folder when `templateType=waypoint`.
- **HW verify**: drop, re-export, import to Pilot 2. No flight needed —
  removing a documented-as-mapping-only element from a waypoint template is
  behaviour-preserving.

### [P1-3] `wpml:payloadParam` emitted AFTER Placemarks (canonical slot is before the first Placemark)

- **Severity**: P1 — child ordering inside Folder; affects regeneration
- **Location**: `backend/app/services/export/dji/builders.py:132`
  (`_append_payload_param(folder)` runs after the per-WP placemark loop at
  lines 119–130, which adds children before `payloadParam`).
- **Spec**: `template-kml.md` does NOT include `payloadParam` in the
  canonical waypoint template sample at all. `common-element.md` documents
  it as a Folder-level optional with location "Document level" and
  "Configuration object" — when emitted, the consistent slot across the
  WPML element set is **before** the variable-length `Placemark` list,
  immediately after `globalUseStraightLine` (alongside the other
  folder-level config). FH2 reference exports place it before placemarks.
- **Current behaviour**: `_append_payload_param(folder)` is called at
  `builders.py:132`, AFTER the `for wp in waypoints: _append_placemark(...)`
  loop. ElementTree appends `<wpml:payloadParam>` as the last Folder child,
  after every `<Placemark>` and (in the keep-out flow) after the keep-out
  Folder is appended to the Document. So the file shape is:
  `[Placemark]+ payloadParam`, opposite of the spec's pre-Placemark slot.
- **Why this matters for regeneration**: Pilot 2 regenerates the executable
  wayline from `template.kml` (`kmz-wpml-audit.md` §12). The regeneration is
  position-based parsing in places — a folder-level config element appearing
  *after* the placemark stream may be silently dropped or misattached to
  the trailing placemark, depending on the parser state machine. This is
  exactly the shape of failure documented in `kmz-wpml-audit.md` §2
  ("Pilot 2 silently drops elements it does not recognize for the declared
  version"). Strict downstream validators (Cloud API) will reject the
  out-of-order emission outright.
- **Proposed fix**: move the `_append_payload_param(folder)` call to
  immediately after `globalUseStraightLine` (between line 113 and 115).
  Cross-reference B5 for the payloadParam content audit.
- **HW verify**: re-export, diff the file against an FH2 reference export
  and confirm the `payloadParam` block lands before placemarks. Import to
  Pilot 2; confirm camera framing on the first measurement is unchanged
  (no parser drop of the payload config).

### [P2-1] `globalUseStraightLine` and `globalWaypointTurnMode` are emitted unconditionally at folder level — `globalUseStraightLine` is conditional per spec

- **Severity**: P2 (see also A4-P0-2 and C2)
- **Location**: `backend/app/services/export/dji/builders.py:112–113`
- **Spec**: `common-element.md` (WebFetched 2026-05-26): `globalUseStraightLine`
  is "Required if and only if `globalWaypointTurnMode` is set to
  `toPointAndStopWithContinuityCurvature` or
  `toPointAndPassWithContinuityCurvature`." The exporter's value
  (`toPointAndStopWithDiscontinuityCurvature`) is **outside** this
  required-when set, so emitting `globalUseStraightLine` is undefined
  behaviour per the spec.
- **Cross-reference**: A4-P0-2 already raised this from the per-Placemark
  side and recommends dropping the folder-level emission; C2 §P1 raises
  the same from the turn-mode angle. The slot is A1's call — confirming
  here that the emission SLOT (folder level) is conformant when the
  required-when clause holds; the issue is the unconditional emission.
- **Proposed fix**: gate the line on
  `global_turn_mode in {"toPointAndStopWithContinuityCurvature",
  "toPointAndPassWithContinuityCurvature"}`. Today the exporter only ever
  emits `toPointAndStopWithDiscontinuityCurvature`, so this collapses to
  dropping the line.
- **HW verify**: covered by A4-P0-2 / C2.

### [P2-2] `globalWaypointHeadingParam.waypointHeadingPathMode=followBadArc` — verify spelling against the spec table

- **Severity**: P2 (cosmetic / strict validators)
- **Location**: `backend/app/services/export/dji/builders.py:109`
- **Spec**: `common-element.md` documents the enum as `{clockwise,
  counterClockwise, followBadArc}` — `followBadArc` IS a real value in the
  spec (interpreted as "follow shortest arc" per the DJI doc table). Not a
  typo on our side. Documenting here so a future reader does not "fix" the
  spelling.
- **Proposed fix**: inline comment naming the spec enum so this is not
  questioned again.

### [P2-3] `globalWaypointHeadingParam` block emits four children when only two are required for `followWayline`

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/builders.py:106–110`
- **Spec**: under `waypointHeadingMode=followWayline`, the WPML spec
  scopes `waypointHeadingAngle` to `manually` mode only and
  `waypointHeadingPoiIndex` to `towardPOI` mode only (per A4-P1-3's
  cross-reference of `common-element.md`). Emitting them on a
  `followWayline` block is the same "unscoped sentinel" pattern that the
  2026-05-15 audit §2.4 fixed for per-Placemark `waypointPoiPoint`.
- **Current behaviour**: emits
  `waypointHeadingMode=followWayline`,
  `waypointHeadingAngle=0`,
  `waypointHeadingPathMode=followBadArc`,
  `waypointHeadingPoiIndex=0` — four children regardless of mode.
- **Proposed fix**: drop `waypointHeadingAngle` and `waypointHeadingPoiIndex`
  from the global block when the mode is `followWayline`. Keep
  `waypointHeadingPathMode` (documented as universally applicable).
- **HW verify**: re-export, confirm Pilot 2 imports without "Invalid
  heading parameter" hints. Tied to B3 — flag for cross-reference.

### [P2-4] `wpml:author` is hardcoded to a static literal; spec is silent but FH2 exports embed user info

- **Severity**: P2 (provenance / audit trail)
- **Location**: `backend/app/services/export/dji/builders.py:71`
- **Current behaviour**: `_sub_text(doc, "author", "TarmacView")` — every
  export carries the same literal.
- **Why P2**: spec does not require a specific format, and Pilot 2 displays
  the value in the mission summary panel. Hardcoding `"TarmacView"` is
  fine for product attribution but loses the per-export operator
  attribution that the mission-report PDF already captures
  (`mission_report_service.generate_mission_report(..., operator_label=...)`).
- **Proposed fix**: parameterize `author` with the exporting user's
  display name (or `"TarmacView - <user>"`), threaded through the export
  orchestrator. No protocol change to the WPML side; small UX win on the
  Pilot 2 summary view.

---

## P3 — Upgrade opportunities

### [P3-1] Document-level XML comments from the canonical sample are not preserved

The canonical `template-kml.md` sample interleaves `<!-- Step 1: Implement
File Creation Information -->` etc. between Document children. Pilot 2
strips them; FH2 round-trips strip them. Cosmetic — adding them would only
help human diff readers comparing our output against the canonical sample.
Skip.

### [P3-2] Keep-out Folder is appended to `<Document>` as a sibling of the waypoint Folder — confirm spec scoping

- **Location**: `backend/app/services/export/dji/builders.py:134–135` and
  `_append_dji_template_keepouts:140–178`
- **Current behaviour**: when `geozone_payload` is supplied, a second
  `<Folder>` is appended to `<Document>` after the waypoint Folder, holding
  advisory polygon Placemarks. The sibling Folder model is conformant with
  generic KML (`<Folder>` can repeat under `<Document>`), and the placemarks
  use plain KML (`<Placemark><Polygon>…</Polygon></Placemark>`) without WPML
  template semantics, so Pilot 2 renders them as visual overlays.
- **Why P3**: the WPML spec does not document multi-Folder templates; the
  fact that Pilot 2 renders the keep-out Folder is a happy accident, not a
  spec guarantee. The current shape works (`_KML_KEEPOUT_DESCRIPTION`
  documents this as advisory-only). Worth noting for the audit trail:
  re-confirm against a future Pilot 2 firmware that the second Folder still
  renders without affecting the executable wayline regenerated from the
  first Folder.

---

## Cross-cutting notes / deferred

- **Child ordering inside Folder** — A1's slice. The
  `templateType → templateId → waylineCoordinateSysParam → autoFlightSpeed
  → gimbalPitchMode → globalWaypointHeadingParam → globalWaypointTurnMode
  → globalUseStraightLine → Placemark…` order is preserved on every
  documented element; the deviations are the **extra elements**
  (`globalHeight`, `caliFlightEnable`) inserted between `autoFlightSpeed`
  and `gimbalPitchMode` and the **post-Placemark** `payloadParam`.
  Removing the extras (P1-1, P1-2) and moving `payloadParam` before the
  Placemark loop (P1-3) brings the folder shape into canonical lockstep.
- **`waylineCoordinateSysParam` children** — A1 covers the emission slot.
  The current block emits only `coordinateMode` + `heightMode`. The
  canonical sample also includes `globalShootHeight`, `positioningType`,
  `surfaceFollowModeEnable`, `surfaceRelativeHeight`. None are required
  per `common-element.md`, and the brief points to A4 for `positioningType`
  (noted absent). Deferred — confirm with B2 whether
  `globalShootHeight` should be threaded through; it pairs with PAPI
  measurement altitudes if Pilot 2 honours it.
- **Sibling-agent overlap**: `globalUseStraightLine` (A4-P0-2, C2),
  `payloadParam` content (B5), `gimbalPitchMode` value (B4), per-Folder
  `autoFlightSpeed` value (B2 / mission_config), `missionConfig` block
  (A3), Placemark internals (A4) — all flagged here for slot/scoping
  reasons only.

---

## Verdict

- **0 P0 blockers** — file's top-level shape is operationally correct on
  Pilot 2 v10.x today.
- **3 P1 issues** clustered on out-of-spec folder children and a misplaced
  `payloadParam`: dropping `globalHeight` + `caliFlightEnable` and moving
  `payloadParam` before the Placemark loop brings the template shape into
  lockstep with the canonical sample.
- **4 P2 conformance notes** on the heading-param block, author literal,
  and the `globalUseStraightLine` required-when gate.
- **2 P3 upgrades** on cosmetic / multi-Folder concerns.

The recommendation is to land P1-1, P1-2, P1-3 together as a single
behaviour-preserving "template-kml folder-shape conformance" change with
a regression test pinning the new Folder child sequence. After the change
the exporter's Folder shape becomes:

```
templateType
templateId
waylineCoordinateSysParam
autoFlightSpeed
gimbalPitchMode
globalWaypointHeadingParam
globalWaypointTurnMode
payloadParam
Placemark…
```

— byte-identical to the canonical waypoint template ordering modulo the
`globalUseStraightLine` gate (which A4-P0-2 / C2 own).
