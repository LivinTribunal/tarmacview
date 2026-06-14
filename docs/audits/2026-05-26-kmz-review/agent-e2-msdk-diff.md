# Agent E2 - Structural cross-reference against Pilot 2 + DJI MSDK references

Scope: side-by-side structural diff of TarmacView's emitted `template.kml` /
`waylines.wpml` against two DJI-emitted ground-truth references:

1. **Pilot 2 M4T 1.0.6 export** at `docs/specs/PAPI 22.kmz` (this is the
   reference cited by A6; the airport metadata makes it appear to be a M4T
   PAPI mission - 2 measurement waypoints, namespace `wpmz/1.0.6`,
   `droneEnumValue=99/1` matching the M4T fallback enum in the exporter).
2. **DJI MSDK sample** `waypointsample.kmz` at
   `https://raw.githubusercontent.com/dji-sdk/Mobile-SDK-Android-V5/master/SampleCode-V5/android-sdk-v5-sample/src/main/assets/waypointsample.kmz`
   - DJI-emitted, namespace `wpmz/1.0.0`, `droneEnumValue=67/0`
   (M30/M30T). Older than M4T 1.0.6, so structural shape only - DO NOT
   reuse values verbatim.

`fcsonline/droneroute` was deferred: the two DJI-emitted references give
authoritative structural ordering, and droneroute is a third-party
reproduction. If a future agent wants to diff against droneroute, the
template / wayline emitters live in
`https://github.com/fcsonline/droneroute/tree/main/src/wpmz`.

This audit's primary purpose is to **verify or refute** the structural and
ordering findings raised by sibling agents A1, A3, A4, A5, B5 (the only
audits that referenced the WPML doc set against TarmacView's emitter). The
docs set is `wpmz/1.0.2` whereas Pilot 2 / M4T runs `wpmz/1.0.6` - audits
that defended against the 1.0.2 doc samples now need a 1.0.6 ground-truth
cross-check.

The findings below also feed `docs/kmz-wpml-audit.md` Phase 1 / Phase 4
(diff harness + round-trip).

---

## Severity tally

- P0 (BLOCKER): 0
- P1 (HIGH - sibling-audit refutation, has launch implications): 4
- P2 (conformance): 3
- P3 (upgrade / process): 3

---

## Side-by-side structural diff

### Document children order

| Pilot 2 PAPI 22 (1.0.6, M4T)            | DJI MSDK (1.0.0, M30T)                  | TarmacView (1.0.6)                      |
|------------------------------------------|------------------------------------------|------------------------------------------|
| `wpml:author`                            | -                                        | `wpml:author` (literal "TarmacView")    |
| `wpml:createTime`                        | `wpml:createTime`                        | `wpml:createTime`                       |
| `wpml:updateTime`                        | `wpml:updateTime`                        | `wpml:updateTime`                       |
| `wpml:missionConfig`                     | `wpml:missionConfig`                     | `wpml:missionConfig`                    |
| `Folder` (waypoint template)             | `Folder` (waypoint template)             | `Folder` (waypoint template)            |

**Verdict**: TarmacView matches Pilot 2 exactly. The MSDK sample's missing
`wpml:author` is non-blocking (template-kml.md marks it optional).

### `<wpml:missionConfig>` children order

| # | Pilot 2 (1.0.6)                       | MSDK (1.0.0)                          | TarmacView                              | Status                          |
|---|----------------------------------------|----------------------------------------|------------------------------------------|----------------------------------|
| 1 | flyToWaylineMode                       | flyToWaylineMode                       | flyToWaylineMode                         | Match                            |
| 2 | finishAction                           | finishAction                           | finishAction                             | Match                            |
| 3 | exitOnRCLost                           | exitOnRCLost                           | exitOnRCLost                             | Match                            |
| 4 | executeRCLostAction                    | -                                      | executeRCLostAction                      | Match Pilot 2                    |
| 5 | takeOffSecurityHeight                  | takeOffSecurityHeight                  | takeOffSecurityHeight                    | Match                            |
| 6 | takeOffRefPoint (template only)        | -                                      | takeOffRefPoint (template only)          | Match Pilot 2                    |
| 7 | takeOffRefPointAGLHeight               | -                                      | takeOffRefPointAGLHeight (=0)            | Match - **but value differs**    |
| 8 | globalTransitionalSpeed                | globalTransitionalSpeed                | globalTransitionalSpeed                  | Match                            |
| 9 | globalRTHHeight (waylines only? PAPI22 emits in **template** too) | -                                      | globalRTHHeight (waylines only)          | **P2 finding** (slot mismatch)   |
| 10 | droneInfo                              | droneInfo                              | droneInfo                                | Match                            |
| 11 | **waylineAvoidLimitAreaMode=0**        | -                                      | **NOT EMITTED**                          | **P1 finding** (missing element) |
| 12 | payloadInfo                            | payloadInfo                            | payloadInfo                              | Match                            |

PAPI 22 emits `globalRTHHeight=100` in **template.kml** (line 16) AND in
waylines.wpml (also line 11). TarmacView emits it only in waylines (gated
on `in_waylines`). A3's audit confirmed §2.2 of the prior audit still
applies (the doc samples scope it to waylines), but the **real Pilot 2
output emits it in both** - a 1.0.6 quirk the 1.0.2 docs don't show.

### `<wpml:payloadInfo>` children order

| Pilot 2 (1.0.6, M4T)                   | MSDK (1.0.0, M30T)                     | TarmacView                              |
|-----------------------------------------|----------------------------------------|------------------------------------------|
| payloadEnumValue (89)                   | payloadEnumValue (52)                  | payloadEnumValue                         |
| **payloadSubEnumValue (0)**             | -                                      | payloadSubEnumValue                      |
| payloadPositionIndex (0)                | payloadPositionIndex (0)               | payloadPositionIndex                     |

**Pilot 2 1.0.6 DOES emit `payloadSubEnumValue`**, even though the 1.0.0
MSDK sample and the spec doc set do not. This directly **refutes
A3-P1-1** ("payloadSubEnumValue is not a documented child of
payloadInfo"). See finding E2-R-1 below.

### Template `<Folder>` children order

| # | Pilot 2 PAPI 22 (1.0.6)              | MSDK (1.0.0)                          | TarmacView                              | Status                              |
|---|---------------------------------------|----------------------------------------|------------------------------------------|--------------------------------------|
| 1 | templateType (waypoint)                | templateType                           | templateType                             | Match                                |
| 2 | templateId (0)                         | useGlobalTransitionalSpeed             | templateId                               | Match Pilot 2                        |
| 3 | waylineCoordinateSysParam              | templateId                             | waylineCoordinateSysParam                | Match Pilot 2                        |
| 4 | autoFlightSpeed                        | waylineCoordinateSysParam              | autoFlightSpeed                          | Match Pilot 2                        |
| 5 | **globalHeight (=145)**                | autoFlightSpeed                        | **globalHeight**                         | **Match** - refutes A1-P1-1          |
| 6 | **caliFlightEnable (=0)**              | transitionalSpeed                      | **caliFlightEnable (=0)**                | **Match** - refutes A1-P1-2          |
| 7 | gimbalPitchMode (manual)               | caliFlightEnable                       | gimbalPitchMode (manual)                 | Match Pilot 2                        |
| 8 | globalWaypointHeadingParam             | gimbalPitchMode (manual)               | globalWaypointHeadingParam               | Match                                |
| 9 | globalWaypointTurnMode                 | globalWaypointHeadingParam             | globalWaypointTurnMode                   | Match                                |
| 10 | **globalUseStraightLine (=1)**         | globalWaypointTurnMode                  | **globalUseStraightLine (=1)**           | **Match** - refutes A4-P0-2 / A1-P2-1 |
| 11 | Placemark[]                            | Placemark[]                            | Placemark[]                              | Match                                |
| 12 | **payloadParam (AT END, after Placemarks)** | -                                | **payloadParam (AT END)**                | **Match** - refutes A1-P1-3 / B5     |

**Critical finding**: Pilot 2's real 1.0.6 export DOES emit
`globalHeight`, `caliFlightEnable`, `globalUseStraightLine`, and places
`payloadParam` AT THE END after every Placemark. These are precisely the
elements sibling audits A1 / A4 / B5 flagged as "out of spec" /
"out of order" using the 1.0.2 doc samples. The 1.0.6 Pilot 2 runtime
emits all of them in the exact slots TarmacView already uses.

### Waylines `<Folder>` children order

| # | Pilot 2 PAPI 22 (1.0.6)                | MSDK (1.0.0)                          | TarmacView                              | Status                          |
|---|------------------------------------------|----------------------------------------|------------------------------------------|----------------------------------|
| 1 | templateId                               | templateId                             | templateId                               | Match                            |
| 2 | executeHeightMode                        | executeHeightMode                      | **waylineCoordinateSysParam**            | **P1** (PAPI 22 omits)           |
| 3 | waylineId                                | waylineId                              | executeHeightMode                        | Order mismatch                   |
| 4 | distance                                 | distance                               | waylineId                                | Order mismatch                   |
| 5 | duration                                 | duration                               | distance                                 | Order mismatch                   |
| 6 | autoFlightSpeed                          | autoFlightSpeed                        | duration                                 | Order mismatch                   |
| 7 | **realTimeFollowSurfaceByFov (=0)**      | -                                      | autoFlightSpeed                          | **P1** - element missing         |
| 8 | Placemark[]                              | Placemark[]                            | realTimeFollowSurfaceByFov               | Match (last after re-ordering)   |
| - | -                                        | -                                      | Placemark[]                              | -                                |

**TarmacView emits `waylineCoordinateSysParam` in waylines.wpml** (per
`builders.py:221-223`, with the inline comment claiming "pilot rc rejects
waylines whose folder does not declare how per-placemark coordinates and
heights should be interpreted"). **Pilot 2's real 1.0.6 waylines export
does NOT emit this block** - the coordinate frame is declared once in
`template.kml` and the executable wayline relies on `executeHeightMode`
plus per-placemark `executeHeight`. See finding E2-1 below.

### Template Placemark children order

| # | Pilot 2 PAPI 22 (1.0.6)                | MSDK (1.0.0)                          | TarmacView                              | Status                              |
|---|------------------------------------------|----------------------------------------|------------------------------------------|--------------------------------------|
| 1 | Point/coordinates (lon,lat, **no alt**)  | Point/coordinates (lon,lat, no alt)    | Point/coordinates (lon,lat, no alt)      | Match - **refutes A4-P0-1**          |
| 2 | index (0-based)                          | index (0-based)                        | index (0-based)                          | Match                                |
| 3 | ellipsoidHeight                          | ellipsoidHeight                        | ellipsoidHeight                          | Match                                |
| 4 | height                                   | height                                 | height                                   | Match                                |
| 5 | waypointSpeed                            | -                                      | waypointSpeed                            | Match Pilot 2                        |
| 6 | waypointHeadingParam                     | -                                      | waypointHeadingParam                     | Match Pilot 2                        |
| 7 | waypointTurnParam                        | -                                      | waypointTurnParam                        | Match Pilot 2                        |
| 8 | **useGlobalSpeed (Placemark 0 only)**    | useGlobalSpeed                         | useGlobalSpeed (every placemark)         | **P2** - drift                       |
| 9 | useGlobalHeadingParam (every)            | useGlobalHeight (every)                | useGlobalHeight (every) **=0**           | **P2** - PAPI 22 OMITS               |
| 10 | useGlobalTurnParam (every)              | useGlobalHeadingParam                  | useGlobalHeadingParam (every)            | Match                                |
| 11 | useStraightLine (every)                 | useGlobalTurnParam                     | useGlobalTurnParam (every)               | Match                                |
| 12 | actionGroup                             | -                                      | useStraightLine (every)                  | Match                                |
| 13 | isRisky (=0)                            | -                                      | actionGroup                              | -                                    |
| -  | -                                        | -                                      | isRisky (=0)                             | -                                    |

**Big finding**: PAPI 22's real Pilot 2 export emits `useGlobalSpeed=1`
**only on Placemark 0**, omits it on Placemark 1. PAPI 22 also
**completely omits** `useGlobalHeight`. TarmacView emits both
unconditionally on every template Placemark, citing
services/CLAUDE.md's `DJI wayline drone + payload enums` section as the
proof that the four-flag quartet is required. The Pilot 2 reference
shows the runtime tolerates a subset.

### Waylines Placemark children order

| Pilot 2 PAPI 22 (1.0.6)                | MSDK (1.0.0)                          | TarmacView                              | Status                          |
|------------------------------------------|----------------------------------------|------------------------------------------|----------------------------------|
| Point/coordinates                        | Point/coordinates                      | Point/coordinates                        | Match                            |
| index                                    | index                                  | index                                    | Match                            |
| executeHeight                            | executeHeight                          | executeHeight                            | Match                            |
| waypointSpeed                            | waypointSpeed                          | waypointSpeed                            | Match                            |
| waypointHeadingParam                     | waypointHeadingParam                   | waypointHeadingParam                     | Match                            |
| waypointTurnParam                        | waypointTurnParam                      | waypointTurnParam                        | Match                            |
| useStraightLine                          | useStraightLine                        | useStraightLine                          | Match                            |
| actionGroup                              | -                                      | actionGroup                              | Match Pilot 2                    |
| **waypointGimbalHeadingParam**           | -                                      | waypointGimbalHeadingParam               | Match Pilot 2 (1.0.6 specific)   |
| isRisky                                  | -                                      | isRisky                                  | Match Pilot 2                    |
| **waypointWorkType (=0)**                | -                                      | waypointWorkType (=0)                    | Match Pilot 2                    |

**TarmacView's waylines placemark shape matches PAPI 22 exactly.** Both
`waypointGimbalHeadingParam` and `waypointWorkType` are 1.0.6-specific
elements emitted by Pilot 2's runtime that the spec docs (1.0.2) don't
mention.

### `<wpml:waypointHeadingParam>` children order

| Pilot 2 PAPI 22 template (followWayline) | Pilot 2 PAPI 22 waylines (followWayline) | TarmacView (followWayline mode)         |
|-------------------------------------------|-------------------------------------------|------------------------------------------|
| waypointHeadingMode                       | waypointHeadingMode                       | waypointHeadingMode                      |
| waypointHeadingAngle                      | waypointHeadingAngle                      | waypointHeadingAngle                     |
| **waypointPoiPoint (=0,0,0)**             | waypointPoiPoint (=0,0,0)                 | **NOT EMITTED** (audit §2.4)             |
| -                                         | waypointHeadingAngleEnable (=0)           | waypointHeadingAngleEnable (=0)          |
| waypointHeadingPathMode                   | waypointHeadingPathMode                   | waypointHeadingPathMode                  |
| waypointHeadingPoiIndex                   | waypointHeadingPoiIndex                   | waypointHeadingPoiIndex                  |

**The 2026-05-15 audit §2.4 (drop `waypointPoiPoint=0,0,0` sentinel)
fixed a real strict-validator finding, but Pilot 2's own 1.0.6 export
emits the exact sentinel** even in `followWayline` mode. The fix is
correct against strict validators but TarmacView's `followWayline`
emission is now structurally narrower than what Pilot 2 itself produces.
Cosmetic, but worth pinning so a future operator does not "fix" it back.

### `<wpml:actionActuatorFuncParam>` for `startRecord` action

| Pilot 2 PAPI 22 template                | Pilot 2 PAPI 22 waylines                 | TarmacView                              |
|------------------------------------------|-------------------------------------------|------------------------------------------|
| payloadPositionIndex (=0)                | payloadPositionIndex (=0)                 | payloadPositionIndex (=0)                |
| useGlobalPayloadLensIndex (=1)           | useGlobalPayloadLensIndex (=1)            | useGlobalPayloadLensIndex (=1)           |
| -                                        | **payloadLensIndex (=visable)**           | NOT EMITTED                              |

Pilot 2 emits `payloadLensIndex=visable` in the **waylines** copy of the
`startRecord` action, even though `useGlobalPayloadLensIndex=1` says
"use the global". TarmacView omits it (defaulting to the global). Per
spec this is redundant when the global flag is 1, so the omission is
correct - but the real Pilot 2 export is belt-and-braces.

### `<wpml:actionActuatorFuncParam>` for `takePhoto` action

PAPI 22 has no `takePhoto` action (it uses `startRecord`/`stopRecord` for
this mission), so cannot verify against this reference. TarmacView's
`takePhoto` emits `payloadPositionIndex`, `fileSuffix=""`,
`useGlobalPayloadLensIndex=1` per `actions.py:227-229`. The empty
`fileSuffix=""` and the no-lens-index pattern match the 1.0.2 doc
sample. Recommend authoring a Pilot 2 photo mission to confirm.

### Custom DJI-specific actions in PAPI 22 not in TarmacView

PAPI 22 emits these actuator functions:

- `rotateYaw` - TarmacView **does** emit (actions.py:176-186)
- `gimbalRotate` - TarmacView **does** emit
- `zoom` (with `focalLength`/`isUseFocalFactor`) - TarmacView **does** emit
- `hover` - TarmacView **does** emit
- **`customDirName`** (sets the file-on-card directory name) - TarmacView **does NOT emit**
- `startRecord` / `stopRecord` - TarmacView **does** emit

Pilot 2 emits a `customDirName` action with
`directoryName="PAPI 22"` (the mission name) at every actionGroup. Its
purpose is to organise media files on the SD card by mission name -
operationally useful but not a flight-time element. See finding E2-2.

---

## Findings

### E2-R-1 [P1] - Sibling-audit refutation: `payloadSubEnumValue` IS emitted by Pilot 2 1.0.6

**Refutes**: A3-P1-1 ("payloadSubEnumValue is not a documented child of
wpml:payloadInfo, recommend dropping").

**Evidence**: `docs/specs/PAPI 22.kmz` -> `wpmz/template.kml` lines 22-26
and `wpmz/waylines.wpml` lines 17-21 both emit a three-child
`<wpml:payloadInfo>` block in the order `payloadEnumValue,
payloadSubEnumValue, payloadPositionIndex`. The order is
**identical** to TarmacView's emission. Pilot 2 1.0.6 emits this
element even though the publicly-available 1.0.2 docs do not document
it.

**Recommendation**: A3's recommendation to drop `payloadSubEnumValue`
should be **rejected**. Keep emitting it; the 1.0.2 doc set is stale,
and the 1.0.6 runtime expects the same three children. Mark A3-P1-1
as a false positive in the audit consolidation, and add an inline
comment in `mission_config.py:227-230` citing the PAPI 22 reference.

**HW verify**: not needed - dropping the element risks the M4T
rejecting the file; keeping it is the proven Pilot 2 1.0.6 shape.

### E2-R-2 [P1] - Sibling-audit refutation: `globalHeight` / `caliFlightEnable` / `globalUseStraightLine` ARE emitted by Pilot 2 1.0.6

**Refutes**: A1-P1-1 ("globalHeight not in canonical waypoint
template, recommend dropping"), A1-P1-2 ("caliFlightEnable is a
mapping/oblique element"), A1-P2-1 / A4-P0-2 ("globalUseStraightLine
required-when clause violation").

**Evidence**:
- `docs/specs/PAPI 22.kmz` template.kml line 36:
  `<wpml:globalHeight>145</wpml:globalHeight>` - emitted inside
  `<Folder>`, between `autoFlightSpeed` and `caliFlightEnable`.
- Same file line 37: `<wpml:caliFlightEnable>0</wpml:caliFlightEnable>`
  on a waypoint template (`templateType=waypoint`).
- Same file line 47: `<wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>`
  emitted at folder level even though the global turn mode is
  `toPointAndStopWithDiscontinuityCurvature` (which the 1.0.2 spec
  says scopes `globalUseStraightLine` to the continuity-curvature
  modes only).

All three elements are emitted by Pilot 2 1.0.6 in the **exact same
slots** TarmacView uses. The 1.0.2 doc set is stale.

**Recommendation**: A1's P1-1 / P1-2 and A1-P2-1 / A4-P0-2 should be
**rejected**. The TarmacView emission is structurally correct against
the real Pilot 2 1.0.6 export. Add inline comments at `builders.py:94,
95, 113` citing the PAPI 22 reference so a future reader does not
remove them.

**HW verify**: not needed - removing the elements would diverge from
Pilot 2's own emission.

### E2-R-3 [P1] - Sibling-audit refutation: `payloadParam` slot is AFTER Placemarks, not before

**Refutes**: A1-P1-3 ("payloadParam emitted AFTER Placemarks - canonical
slot is before the first Placemark"). B5 (cross-referenced) flagged the
same.

**Evidence**: `docs/specs/PAPI 22.kmz` template.kml lines 217-226 - the
`<wpml:payloadParam>` block sits AT THE END of the `<Folder>`, after both
`<Placemark>` elements (lines 48-216). TarmacView emits payloadParam in
the same post-Placemark slot (`builders.py:132`, called after the
placemark loop at lines 119-130).

**Recommendation**: A1-P1-3 / B5's "move payloadParam before Placemarks"
recommendations should be **rejected**. The 1.0.6 Pilot 2 reference puts
it after Placemarks; TarmacView is already in the right slot. Add an
inline comment naming the reference so this is not re-flagged.

### E2-R-4 [P1] - Sibling-audit refutation: 2-D `<Point><coordinates>` (no altitude) is the real Pilot 2 shape

**Refutes**: A4-P0-1 ("template Placemark `<Point><coordinates>` strips
altitude; recommend emitting `lon,lat,alt`").

**Evidence**: `docs/specs/PAPI 22.kmz` template.kml lines 49-53 and 142-146:

```xml
<Point>
  <coordinates>
    17.227196098,48.179272861
  </coordinates>
</Point>
```

Pilot 2 1.0.6 emits 2-D `<coordinates>` text in **both** template.kml
and waylines.wpml. Altitude is carried by the sibling
`<wpml:ellipsoidHeight>` / `<wpml:height>` / `<wpml:executeHeight>`
elements. TarmacView's `placemark.py:184` emits `f"{lon:.8f},{lat:.8f}"`
- structurally identical to Pilot 2.

**Recommendation**: A4-P0-1's recommendation to add the altitude axis
should be **rejected**. The Pilot 2 reference confirms 2-D
`<coordinates>` is intentional. The motivation A4 raised (better
QGIS/Google Earth preview) has merit but should be tracked as a
separate "diagnostic export" feature, not a Pilot-2-conformance bug.

### E2-1 [P1] - TarmacView emits `waylineCoordinateSysParam` in waylines.wpml; Pilot 2 1.0.6 does NOT

**Severity**: P1 - structural divergence from real Pilot 2 output;
potential strict-validator rejection.

**Location**: `backend/app/services/export/dji/builders.py:221-223`

```python
coord_sys = ET.SubElement(folder, _wpml_tag("waylineCoordinateSysParam"))
_sub_text(coord_sys, "coordinateMode", "WGS84")
_sub_text(coord_sys, "heightMode", "relativeToStartPoint")
```

**Evidence**: `docs/specs/PAPI 22.kmz` waylines.wpml lines 23-30 - the
`<Folder>` declares only `templateId`, `executeHeightMode`, `waylineId`,
`distance`, `duration`, `autoFlightSpeed`, `realTimeFollowSurfaceByFov`,
then jumps to `<Placemark>`. The waylines block does **not** declare
`waylineCoordinateSysParam` - the coordinate frame is set in
`template.kml` and the executable wayline inherits it. The MSDK 1.0.0
sample also omits it from waylines (line 20-26).

The inline comment at `builders.py:217-220` claims "pilot rc rejects
waylines whose folder does not declare how per-placemark coordinates and
heights should be interpreted" - but the Pilot 2 1.0.6 reference
contradicts this. The block was added in a previous fix attempt and may
not be needed now that the relativeToStartPoint encoding is in place.

**Why P1 not P0**: Pilot 2 has been tolerating the extra block in field
flights, but strict validators (`IWPMZManager.checkValidation`,
`com.dji:wpmz` library) flag undocumented elements; the audit's own
§2 history (kmz-wpml-audit.md) records repeated cases of Pilot 2
silently dropping elements outside its expected slot.

**Proposed fix**: drop the `waylineCoordinateSysParam` emission in
`_build_dji_waylines_wpml`. The waylines should declare only
`executeHeightMode` (which TarmacView already does).

**HW verify**: re-export the reference mission, import to Pilot 2 on the
M4T, fly. The wayline should still execute - the coordinate frame is
already declared in template.kml.

### E2-2 [P2] - `customDirName` action absent; mission media filed under default directory on SD card

**Severity**: P2 - operational, no flight impact, organisational
ergonomics on the SD card after the mission.

**Location**: `backend/app/services/export/dji/actions.py:127` -
`_DJI_CAMERA_ACTIONS` dict and `_append_action_group` do not emit a
`customDirName` actuator function.

**Evidence**: `docs/specs/PAPI 22.kmz` template.kml lines 122-129
(repeated at lines 130-137):

```xml
<wpml:action>
  <wpml:actionId>4</wpml:actionId>
  <wpml:actionActuatorFunc>customDirName</wpml:actionActuatorFunc>
  <wpml:actionActuatorFuncParam>
    <wpml:directoryName>PAPI 22</wpml:directoryName>
    <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
  </wpml:actionActuatorFuncParam>
</wpml:action>
```

Pilot 2 emits `customDirName` at every actionGroup of the mission, with
`directoryName` set to the mission name. The action sets the SD-card
directory where the M4T writes captured media; without it the media
lands in the default `DCIM/100MEDIA/` and the operator has to manually
sort by timestamp.

**Why P2 not P3**: operationally important because the mission-report
PDF / coordinator-center photo review workflow relies on being able to
re-find media after the flight. A 4-LHA PAPI inspection produces 80+
files; sifting them out of `DCIM/100MEDIA/` by timestamp is a
significant operator pain point.

**Proposed fix**: extend `_append_action_group` to optionally emit a
`customDirName` action with the mission name when the wayline is on a
DJI drone. The action takes `<directoryName>` (string) and
`<payloadPositionIndex>=0` only. Naming convention should match the
mission's `Mission.name` column, sanitised for SD-card filesystem
constraints (no `/`, max 31 chars, ASCII).

**HW verify**: export a mission with `name="Test PAPI 09L"`, import to
Pilot 2, fly, confirm captures land in `DCIM/Test PAPI 09L/` instead of
the default folder.

### E2-3 [P2] - Template `useGlobalSpeed=1` is emitted on every placemark; Pilot 2 only emits it on Placemark 0

**Severity**: P2 - conformance / structural drift.

**Location**: `backend/app/services/export/dji/placemark.py:232`

```python
if not in_waylines:
    _sub_text(placemark, "useGlobalSpeed", "1")
    _sub_text(placemark, "useGlobalHeight", "0")
    ...
```

**Evidence**: `docs/specs/PAPI 22.kmz` template.kml lines 69 and 162.
Placemark 0 emits `useGlobalSpeed=1` (line 69). Placemark 1 omits the
element entirely. The Placemark 0 emission carries `waypointSpeed=10`
which matches `autoFlightSpeed=10` (so `useGlobalSpeed=1` is consistent
with the per-WP speed); Placemark 1 carries `waypointSpeed=1` (slower,
not matching the global) and omits the flag.

The 2026-05-15 audit's reading of the spec held that the four
`useGlobal*` flags are "required on every template Placemark". The
Pilot 2 1.0.6 reference shows the runtime only emits them when they
materially apply.

**Why P2 not P1**: TarmacView's unconditional emission is more
conservative than Pilot 2; strict validators may or may not flag it.
The behaviour is unchanged either way (Pilot 2 has been importing the
file). Worth pinning a regression test against the Pilot 2 reference
once that fixture lands.

**Proposed fix**: defer until a Pilot 2 round-trip confirms which
behaviour matches the M4T's strict-validator path. If Pilot 2 emits
`useGlobalSpeed=1` only on placemarks whose `waypointSpeed` matches
the folder `autoFlightSpeed`, TarmacView should mirror that. Track in
kmz-wpml-audit.md Phase 1.

### E2-4 [P2] - Template `useGlobalHeight=0` is emitted on every placemark; Pilot 2 1.0.6 OMITS it

**Severity**: P2 - conformance / structural drift.

**Location**: `backend/app/services/export/dji/placemark.py:233`

```python
_sub_text(placemark, "useGlobalHeight", "0")
```

**Evidence**: `docs/specs/PAPI 22.kmz` template.kml - neither Placemark
emits `useGlobalHeight`. The element is **completely absent** from
both Placemark 0 (lines 48-140) and Placemark 1 (lines 141-216). Yet
TarmacView emits `useGlobalHeight=0` on every template placemark
(`placemark.py:233`), citing the WPML doc as proof that all four
`useGlobal*` flags are required.

`services/CLAUDE.md` explicitly documents this as a fixed invariant:
"Every template Placemark must emit four useGlobal* flags. ... Pilot 2
v10.1.8.18 tolerated the missing tags; strict validators reject the
file." The "strict validators reject the file" claim is based on
spec-reading; the actual Pilot 2 1.0.6 output **omits the element**,
so either (a) the strict validators in question are not Pilot 2 itself
and TarmacView is over-conformance, or (b) the Pilot 2 export was
emitted before the strict-validator path was tightened.

**Why P2 not P1**: emitting an extra element that says "ignore the
global" is conservative; structurally narrower than Pilot 2 but the
behavioural difference is zero.

**Proposed fix**: defer until a Pilot 2 round-trip confirms behaviour.
If the M4T strict-validator path tolerates the extra emission (which
field flights suggest), keep it; if not, drop. Track in
kmz-wpml-audit.md Phase 1 alongside E2-3.

### E2-5 [P3] - Mission attribution: `wpml:author` literal "TarmacView" vs PAPI 22's user email

**Severity**: P3 - provenance / audit trail.

**Evidence**: PAPI 22 emits `<wpml:author>novotnyd@stablecam.com</wpml:author>`
(line 4 of template.kml) - the operator's email at export time.
TarmacView always emits `"TarmacView"`. A1-P2-4 raised this; this
audit confirms the Pilot 2 1.0.6 behaviour is to emit the user's email
identifier.

**Proposed fix**: parameterise `_build_dji_template_kml` with the
exporting user's email or name, threaded through the export
orchestrator's `current_user` context (already used by the mission
report PDF for `operator_label`). Output format
`"TarmacView - <user>"` or just `<user>` matches Pilot 2's pattern.

### E2-6 [P3] - Golden-fixture CI gate from PAPI 22 reference

**Severity**: P3 - process / regression prevention.

**Observation**: `docs/specs/PAPI 22.kmz` is a real Pilot 2 1.0.6 export
of a 2-waypoint M4T inspection mission. It is the only ground-truth
fixture in the repo for the M4T 1.0.6 namespace. The PAPI 22 file
exercises:
- 2-Placemark structure with per-Placemark `waypointGimbalHeadingParam`
- `rotateYaw` + `gimbalRotate` + `zoom` (focalLength=168) + `hover` +
  `customDirName` + `startRecord` / `stopRecord` action sequences
- Both reachPoint-trigger actionGroups
- `wpmz/1.0.6` namespace with `droneEnumValue=99/1` (M4T)

It does **not** exercise:
- VP video / HR video smooth-turn passes (no betweenAdjacentPoints
  triggers, no gimbalEvenlyRotate)
- `towardPOI` heading mode (PAPI 22 uses `followWayline`)
- 4-LHA bulk PAPI mission shape
- Geozone (`res/` folder) emission
- M4T-specific thermal `<imageFormat>ir</imageFormat>` setting

**Proposed fix**: add a CI test that parses
`docs/specs/PAPI 22.kmz` and asserts the **exact** element ordering
inside `<Document>` / `<Folder>` / `<Placemark>` / `<actionGroup>` /
`<actionActuatorFuncParam>` matches TarmacView's emission for a
structurally-equivalent mission. The test would have caught every one
of the sibling-audit false positives raised in E2-R-1 through E2-R-4.
Until the operator authors a Phase-0 golden fixture (a richer mission
exercising VP video / towardPOI / 4-LHA / geozone / IR), PAPI 22 is
the closest ground truth we have.

Skeleton (pytest):

```python
def test_emission_matches_pilot_2_1_0_6_reference():
    # parse the reference
    with zipfile.ZipFile("docs/specs/PAPI 22.kmz") as zf:
        ref_template = ET.fromstring(zf.read("wpmz/template.kml"))
    # build a fixture mission that mirrors PAPI 22's structural shape:
    # 2 measurement waypoints, followWayline mode, rotateYaw + gimbalRotate
    # + hover + startRecord/stopRecord actions
    mission, flight_plan, airport = _build_papi_22_mirror_fixture()
    out_kmz = generate_dji_kmz(mission, flight_plan, airport)
    with zipfile.ZipFile(io.BytesIO(out_kmz)) as zf:
        our_template = ET.fromstring(zf.read("wpmz/template.kml"))
    # walk both trees in DFS, compare tag sequences only (not text)
    assert _tag_sequence(our_template) == _tag_sequence(ref_template)
```

The byte-comparison is too strict (timestamps, coordinates, mission
name differ) - tag-sequence comparison catches the structural drift
the sibling audits raised.

### E2-7 [P3] - Author a Phase-0 golden-fixture in Pilot 2 on the real M4T

**Severity**: P3 - process; documented in `kmz-wpml-audit.md` §6.

The repo lacks the §6 "reference mission" - a Pilot-2-authored mission
on the real M4T that exercises every WPML construct
(4-5 waypoints, per-waypoint gimbal pitch, takePhoto + startRecord
pair, hover, non-default turn mode, non-default heading mode, thermal
capture, explicit finish action). PAPI 22 covers a subset; the golden
fixture is the single highest-value artifact for closing the WPML
loop (per §6 of the audit).

This audit cross-references the request - no code change. Schedule a
30-minute Pilot 2 session on the M4T, export, check the resulting KMZ
into `backend/tests/data/golden_m4t_reference.kmz`, and wire E2-6's
golden-fixture CI gate against it.

---

## Cross-reference of every sibling-audit finding against this E2's evidence

| Sibling finding                                    | E2 verdict      | Reason                                                                                       |
|----------------------------------------------------|------------------|----------------------------------------------------------------------------------------------|
| A1-P1-1 (drop globalHeight)                        | **REJECTED**     | Pilot 2 1.0.6 emits `globalHeight=145` in exact slot (PAPI 22 template.kml:36)               |
| A1-P1-2 (drop caliFlightEnable)                    | **REJECTED**     | Pilot 2 1.0.6 emits `caliFlightEnable=0` on a waypoint template (PAPI 22 template.kml:37)    |
| A1-P1-3 (move payloadParam before Placemarks)      | **REJECTED**     | Pilot 2 1.0.6 puts payloadParam AFTER Placemarks (PAPI 22 template.kml:217-226)              |
| A1-P2-1 (gate globalUseStraightLine on turn mode)  | **REJECTED**     | Pilot 2 1.0.6 emits unconditionally with stop-mode turn (PAPI 22 template.kml:47)            |
| A1-P2-2 (followBadArc spelling)                    | Confirmed clean  | Spec enum value; sample confirms (PAPI 22 template.kml:43)                                   |
| A1-P2-3 (drop unscoped globalWaypointHeadingParam children) | Defer    | PAPI 22 emits all 5 children including waypointPoiPoint=0,0,0; the §2.4 fix is conservative  |
| A1-P2-4 (parameterise author)                      | Confirmed        | PAPI 22 emits user email (template.kml:4)                                                    |
| A3-P1-1 (drop payloadSubEnumValue)                 | **REJECTED**     | Pilot 2 1.0.6 emits payloadSubEnumValue between EnumValue and PositionIndex (PAPI 22:23)     |
| A3-P1-2 (parameterise globalTransitionalSpeed)     | Confirmed        | PAPI 22 emits 15 (literal); fix is sound but no Pilot 2 evidence against current value       |
| A3-P2-2 (set takeOffRefPointAGLHeight properly)    | Confirmed        | PAPI 22 emits =0 (template.kml:14); current TarmacView matches                               |
| A4-P0-1 (3-D coordinates with altitude)            | **REJECTED**     | Pilot 2 1.0.6 emits 2-D `<coordinates>` (PAPI 22 template.kml:51, 144)                       |
| A4-P0-2 (drop useStraightLine on stop placemarks)  | **REJECTED**     | Pilot 2 1.0.6 emits useStraightLine=1 on every Placemark with stop turn (PAPI 22 lines 72, 164) |
| B5 (payloadParam slot)                             | **REJECTED**     | Same evidence as A1-P1-3                                                                     |

Findings flagged "REJECTED" should be marked as such in the audit
consolidation and not landed as fixes. The remaining findings stand on
their own merits.

---

## Verdict

The single highest-value insight from this cross-reference is that the
publicly-available WPML doc set (`wpmz/1.0.2`) is **structurally stale**
relative to what Pilot 2 1.0.6 / M4T actually emits. Six of the
sibling-audit P0 / P1 findings were derived from the 1.0.2 docs and are
contradicted by the real Pilot 2 1.0.6 export at
`docs/specs/PAPI 22.kmz`. TarmacView's emission is closer to Pilot 2's
1.0.6 reality than the doc-derived audits suggested.

The only **new** divergence E2 found that has launch implications is
`waylineCoordinateSysParam` emitted in waylines.wpml (E2-1) - the block
is not in Pilot 2's 1.0.6 output and the inline comment defending it
cites a Pilot RC behaviour that the reference contradicts. A round-trip
test to confirm Pilot 2 still accepts the file without that block is the
cheapest next step.

The `customDirName` action (E2-2) is an operational miss but not a
flight blocker - it controls SD-card directory naming, which the
operator currently handles by manual file sort.

The two `useGlobal*` flag drifts (E2-3, E2-4) are conservative
over-conformance, structurally narrower than Pilot 2's emission but
behaviourally equivalent.

The strongest process recommendation is to land E2-6 (parse PAPI 22 in
a CI test) and E2-7 (author the §6 golden fixture in Pilot 2 on the
real M4T) before any of the sibling-audit fixes are merged - several of
those fixes would diverge TarmacView **further** from the real Pilot 2
output.
