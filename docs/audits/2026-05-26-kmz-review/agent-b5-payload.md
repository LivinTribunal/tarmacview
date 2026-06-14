# Agent B5 — Payload / camera config (imageFormat, lens index, focus, photo/video actions)

Scope: DJI Matrice 4T (H30T thermal+wide+zoom payload), WPML 1.0.6. Read-only
audit of every camera/payload field emitted by `backend/app/services/export/dji/`
against the WPML spec (`40.common-element.md`), the prior audits
(`docs/kmz-wpml-audit.md` §3 / §7 / §11, `docs/audits/2026-05-15-dji-wpml-spec-audit.md`
§2.9), and the M4T MSDK thermal-lens issue
(`dji-sdk/Mobile-SDK-Android-V5#635`).

## Summary
- P0 blockers: 0
- P1 high (autofocus / camera framing): 2
- P2 conformance: 4
- P3 upgrades: 3

The payload path is **structurally close to spec** but has several spec-noncomformities and one operationally important hole:

- `accurateShoot` is correctly absent (regression net `test_no_accurate_shoot_emitted_across_modes` at `backend/tests/test_export_service.py:2396-2412` still pins this across all three heading modes — audit §2.9 invariant holds).
- `panoShot` / `recordPointCloud` are correctly NOT emitted by the M4T path (`panoShot` is M30/M30T/M3D-only; `recordPointCloud` is LiDAR-only). The `_DJI_CAMERA_ACTIONS` map only carries `takePhoto`, `startRecord`, `stopRecord`.
- `isInfiniteFocus` is correctly NOT emitted anywhere — `focus` action is not in the action set at all (audit §7 invariant holds).
- `payloadPositionIndex=0` on every payload site (M4T integrated main gimbal — audit §7).
- `imageFormat` is emitted as `visable` (the spec misspelling) — but **only one lens**, IR is never added (see P1-1).
- The `actionGroup` order is `rotateYaw → gimbalRotate → hover → camera → zoom`. The audit table §3 prescription ("`takePhoto` last in the action group") is violated **only** by the trailing `zoom` action — and that ordering bug is the dominant autofocus-hunting risk on the H30T (P1-2 below).
- `takePhoto`, `startRecord`, `stopRecord` are missing several spec-required sub-elements that DJI's table-3 (§6 above) marks as `Required: Yes` — Pilot 2 has historically tolerated the omissions but strict validators / a future firmware may not (P2-1, P2-2, P2-3).

## Findings

### [P1-1] Thermal lens (IR) is never emitted in `imageFormat` or `payloadLensIndex` — operator cannot capture thermal frames on PAPI inspections

- **Severity**: P1 (high; the M4T has a thermal sensor and the user explicitly listed "thermal + wide + zoom" lenses, but the export hardcodes a single visible-light lens)
- **Location**: `backend/app/services/export/dji/placemark.py:91-105` (`_append_payload_param`), `backend/app/services/export/dji/actions.py:221-232` (`takePhoto` / `startRecord` / `stopRecord` action params)
- **Spec**:
  - `common-element.md` `payloadParam/imageFormat`: enum-string list, valid tokens `wide, zoom, ir, narrow_band, visible` (yes — `visible`, NOT `visable`, in this element per the spec's own table); multi-lens format is comma-separated, e.g. `<wpml:imageFormat>wide,ir</wpml:imageFormat>`.
  - `common-element.md` `takePhoto/payloadLensIndex` (and same on `startRecord`/`stopRecord`/`orientedShoot`): enum-string list, valid tokens `wide, zoom, ir, narrow_band, visable` (the spec **does** use the misspelling `visable` on `payloadLensIndex` — see MSDK #635 OP, "questioned whether 'visable' (in payloadLensIndex) is a typo versus 'visible' (in imageFormat)"). Multi-lens format is comma-separated, e.g. `<wpml:payloadLensIndex>wide,ir,narrow_band</wpml:payloadLensIndex>`.
- **Current behavior**:
  - `_append_payload_param` hardcodes `<wpml:imageFormat>visable</wpml:imageFormat>` (placemark.py:104).
  - No `<wpml:payloadLensIndex>` is ever emitted on any action — instead `takePhoto` / `startRecord` emit `useGlobalPayloadLensIndex=1` (actions.py:229, 231) which is supposed to inherit from a folder-global `<wpml:payloadLensIndex>` — but no such global element is ever written either (`grep -rn "payloadLensIndex" export/dji/` shows only the two `useGlobalPayloadLensIndex=1` sites).
- **Why it's wrong**: every PAPI inspection captures only visible-light frames. The H30T's IR sensor is unused. For PAPI obstruction analysis the thermal channel is exactly what discriminates active filament from cold reflection — losing it defeats half the M4T's value. Worse, `useGlobalPayloadLensIndex=1` with NO global `payloadLensIndex` element is an unanchored reference; per MSDK #635 the M4T's behaviour in this case is to fall back to "whichever lens is shown in the FPV view" at flight time, so the captured lens is non-deterministic.
- **Evidence**:
  - placemark.py:104 — `_sub_text(payload, "imageFormat", "visable")` — single-lens, no comma-separated list.
  - actions.py:229 — `_sub_text(params, "useGlobalPayloadLensIndex", "1")` on `takePhoto` with no global anchor.
  - MSDK #635 OP, quoted by WebFetch above: "the Mavic 3T ignores [`payloadLensIndex`] settings. Instead, the drone captures photos based on whichever lens is displayed in the mobile app's FPV view, rather than the requested lens configuration."
  - The user's project context explicitly names "M4T (H30T camera, thermal + wide + zoom lenses)" as the target rig.
- **Proposed fix**: thread an operator-selectable lens set (default `wide,zoom,ir` for M4T, or `wide,ir` for IR-essential PAPI inspections) through `_resolve_inspection_camera_settings` → both `_append_payload_param/imageFormat` AND a per-action `<wpml:payloadLensIndex>`. Keep the `visable` spelling on `payloadLensIndex` per spec, and use `visible` (or `wide`) inside `imageFormat`. Or — if the operator wants a single global setting — emit one `<wpml:payloadLensIndex>wide,ir</wpml:payloadLensIndex>` at folder scope and keep `useGlobalPayloadLensIndex=1` on each action. The current "global=1 with no global" shape is the worst of both: not deterministic, not strict-spec.
- **HW verify**: confirm thermal frames are present in the captured media after a real PAPI flight, and the captured lens set matches the configured `payloadLensIndex` (not the FPV display).

### [P1-2] `zoom` action emitted AFTER `takePhoto` in the same actionGroup — the photo is taken at the previous waypoint's zoom, not the configured one

- **Severity**: P1 (high; this is the user's #2 priority — "autofocus hunting / blurred PAPI images during measurements")
- **Location**: `backend/app/services/export/dji/actions.py:221-235` (`_append_action_group`)
- **Spec**: `common-element.md` `actionGroupMode=sequence` — "actions within the action group are executed sequentially". No explicit ordering rule for `zoom` vs `takePhoto`, but the audit table §3 captures the operational reality ("`takePhoto` last in the action group") because every action *before* `takePhoto` reaches steady state before the shutter fires; an action *after* `takePhoto` runs after the photo has already been written. Zoom is the slowest mechanical actuator on a tri-lens H30T — emitting it after the photo means the photo is captured at whatever zoom the gimbal held coming into the waypoint.
- **Current behavior** (actions.py:172-235):
  ```
  rotateYaw      (action_id 0)
  gimbalRotate   (action_id 1)
  hover          (action_id 2)
  takePhoto      (action_id 3)   <-- photo fires here
  zoom           (action_id 4)   <-- zoom changes AFTER the photo
  ```
- **Why it's wrong**: on the **first** measurement waypoint of each inspection (the only waypoint where `_first_zoom_emission_waypoints` adds the zoom action — actions.py:17-58), the photo is taken at the drone's default 1x / previous-inspection zoom, then the zoom is set for *subsequent* photos in the same inspection. So the photo at the most-important-framing waypoint (the first measurement, where the operator wants the PAPI at 7× per the audit comments) is the one shot at the *wrong* zoom. Subsequent measurements within the same inspection use `useGlobalPayloadLensIndex=1` and inherit, so they're at the right zoom — but the per-inspection anchor frame is the one that misses.
- **Evidence**:
  - actions.py:234-235 — `if emit_zoom: action_id = _append_zoom_action(group, ...)` runs after the `if camera_func:` block (actions.py:221-232) that emits `takePhoto`.
  - actions.py:122-126 — the docstring even says "zoom appended last since it is a post-arrival framing adjustment" — but it's the photo that is post-arrival, the zoom needs to precede it.
  - `_first_zoom_emission_waypoints` (actions.py:17-58) confirms zoom fires on the first MEASUREMENT waypoint of each inspection — exactly the anchor frame.
- **Proposed fix**: emit `zoom` BEFORE `takePhoto` (and before `startRecord` on video bookends). Re-order the two `if` blocks in `_append_action_group`: move `if emit_zoom: ...` above `if camera_func: ...`. Behaviour-preserving for every waypoint that doesn't carry a `zoom_factor` (most of them). For HR video, the zoom + anchor `gimbalRotate` should both fire before `startRecord` so the recording is framed and zoomed from frame 0.
- **HW verify**: photograph a known PAPI at configured zoom (e.g. 7×). Today's export should yield frame-0 at 1× and subsequent frames at 7×; the fix should yield every frame at 7×.

### [P2-1] `takePhoto` missing required `payloadLensIndex` sub-element

- **Severity**: P2 (conformance; Pilot 2 tolerates, strict validators reject)
- **Location**: `backend/app/services/export/dji/actions.py:221-232`
- **Spec**: `common-element.md` `takePhoto` parameter list — `wpml:payloadLensIndex` is `Required: Yes`. `useGlobalPayloadLensIndex` is also `Required: Yes` and gates whether the local `payloadLensIndex` or a folder-global element wins. The element must be present in either case; only its source-of-truth flips.
- **Current behavior**: actions.py:227-229 emits exactly `payloadPositionIndex`, `fileSuffix`, `useGlobalPayloadLensIndex=1`. No `payloadLensIndex` is emitted on the action and no `payloadLensIndex` is emitted at folder scope either (P1-1).
- **Why it's wrong**: with `useGlobalPayloadLensIndex=1` the action defers to a non-existent global element. A strict validator that walks the spec's "Required" column will flag this as a missing required child.
- **Evidence**: actions.py:226-229; `grep -rn "payloadLensIndex" export/dji/` shows no emission site.
- **Proposed fix**: emit `<wpml:payloadLensIndex>` on every `takePhoto`/`startRecord`/`stopRecord` action (defaulting to e.g. `wide,ir` for M4T thermal capture; keep `useGlobalPayloadLensIndex=1` only if a folder-level `payloadLensIndex` is also added). This collapses into P1-1's fix.

### [P2-2] `startRecord` missing required `fileSuffix` sub-element

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/actions.py:230-231`
- **Spec**: `common-element.md` `startRecord` parameter list — `wpml:fileSuffix` is `Required: Yes` ("Appended to generated media file name"). Same rule as `takePhoto`, which the code already complies with (actions.py:228 emits `fileSuffix=""`).
- **Current behavior**: actions.py:230-231 emits only `payloadPositionIndex` + `useGlobalPayloadLensIndex=1`. No `fileSuffix`.
- **Why it's wrong**: misses a spec-required child. Behaviourally the drone uses its default filename, so flight succeeds — but a strict validator rejects the file.
- **Evidence**: actions.py:230-231 vs. actions.py:227-229 (the `takePhoto` branch does emit it).
- **Proposed fix**: add `_sub_text(params, "fileSuffix", "")` to the `startRecord` branch (and ideally `stopRecord` too — P2-3).

### [P2-3] `stopRecord` missing required `payloadLensIndex`, `useGlobalPayloadLensIndex`, AND `fileSuffix`

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/actions.py:221-232`
- **Spec**: `common-element.md` `stopRecord` parameter list — has the SAME 4 required parameters as `startRecord` (`payloadPositionIndex`, `fileSuffix`, `payloadLensIndex`, `useGlobalPayloadLensIndex`).
- **Current behavior**: the `if camera_func == "startRecord"` branch on actions.py:230 only fires for `RECORDING_START`. For `RECORDING_STOP` (camera_func == "stopRecord"), the code falls through and emits **only** `<wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>` — no `fileSuffix`, no `payloadLensIndex`, no `useGlobalPayloadLensIndex`. This is the most spec-noncompliant action in the file.
- **Why it's wrong**: misses three required children. Pilot 2 has tolerated this so far (the M4T defaults the missing fields), but strict validators will reject.
- **Evidence**: actions.py:221-232 — only the `takePhoto` and `startRecord` branches emit the extra sub-elements; `stopRecord` falls off the end.
- **Proposed fix**: collapse the `if/elif` into a shared block. For every `camera_func ∈ {takePhoto, startRecord, stopRecord}` emit `payloadPositionIndex` + `fileSuffix` + `payloadLensIndex` + `useGlobalPayloadLensIndex` (the lens index defaults gate on P1-1).

### [P2-4] `payloadEnumValue=89` for M4T is not in the spec's documented enum domain

- **Severity**: P2 (conformance; documented as intentional in audit 2026-05-15 §3.1 but worth re-flagging in case Pilot 2 strict-rejects on a future firmware)
- **Location**: `backend/app/core/constants.py:91-96` (`DJI_WPML_ENUMS`), `backend/app/services/export/dji/mission_config.py:225-230`
- **Spec**: `common-element.md` `payloadEnumValue` documented domain — `42 (H20), 43 (H20T), 52 (M30), 53 (M30T), 61 (H20N), 66 (Mavic 3E), 67 (Mavic 3T), 68 (Mavic 3M), 80 (M3D), 81 (M3TD), 82 (H30), 83 (H30T), 65534 (PSDK Payload)`. The M4T's actual payload is the H30T (= **83** per spec), but the code emits **89** — which is NOT in the spec's enum domain at all.
- **Current behavior**: `DJI_WPML_ENUMS["Matrice 4T"] = ("99", "1", "89", "0")` — drone `99/1`, payload `89/0`. The drone enum `99` is also not in the spec's documented domain (spec stops at `91 (M3D/M3TD)`).
- **Why it's documented as intentional**: audit 2026-05-15 §3.1 records the provenance: "community-observed value (and the FH2 export shape) collapses every M4T mission onto the M30T enum so FH2's preview renderer follows the gimbal correctly". The audit explicitly says "do not 'fix' it back to a guessed M4T value" — fair.
- **Why it's still worth flagging**: the comment in `constants.py:84-90` claims the M4T pair is "litchi-confirmed" but litchi confirmation is not the same as DJI Pilot 2 strict-spec acceptance, and a future Pilot 2 firmware that ships the documented M4T enum could reject the file. **Action**: if the operator can author one mission in Pilot 2 on the real M4T and export, the resulting KMZ's `droneEnumValue`/`payloadEnumValue` is the ground truth (audit §6 acquisition recipe). Until that file lands, the current `99/1/89/0` is a defensible guess but not provable.
- **Evidence**: constants.py:91-97; mission_config.py:223-230; spec enum list above.
- **Proposed fix**: no code change — acquire the golden reference file per `kmz-wpml-audit.md` §6 and confirm the enum tuple. If the reference disagrees with `89/0`, update the table.

### [P3-1] `payloadParam` carries M300/M350-only LiDAR fields that mean nothing on M4T

- **Severity**: P3 (cosmetic conformance; ignored by H30T firmware but a strict validator may flag them)
- **Location**: `backend/app/services/export/dji/placemark.py:91-106` (`_append_payload_param`)
- **Spec**: `common-element.md` `payloadParam` sub-element table — `returnMode`, `samplingRate`, `scanningMode` are explicitly scoped "M300/M350 only" (LiDAR payload params). `focusMode` and `meteringMode` are also marked "M300/M350 only" in the spec's table; only `payloadPositionIndex` and `imageFormat` are universal.
- **Current behavior**: placemark.py:96-105 unconditionally emits the full M300/M350 set on every M4T export — `focusMode=firstPoint`, `meteringMode=average`, `returnMode=singleReturnStrongest`, `samplingRate=240000`, `scanningMode=repetitive`. The docstring (placemark.py:91-95) says "values mirror the dji pilot 2 defaults for an h20t-class inspection payload; flight hub 2 rejects the file if this block is missing" — true that the block must be present; the question is whether the M300/M350-only children should be filtered out for M4T.
- **Why it's wrong (mildly)**: the M4T payload is the H30T which is NOT a LiDAR. The `returnMode`/`samplingRate`/`scanningMode` fields are pure noise. Pilot 2 has been observed to tolerate them (the operator's FH2 round-trips preserve them) — but a future strict validator could flag them as "not in supported model".
- **Proposed fix**: gate the LiDAR/M300-specific children behind a drone-model check. For M4T emit only `payloadPositionIndex` + `imageFormat`. For M300/M350 keep the full block. Behaviour-preserving on the M4T flight path.

### [P3-2] No `payloadParam` mirror in `waylines.wpml` — only `template.kml`

- **Severity**: P3 (cosmetic; spec is silent on this and Pilot 2 tolerates the omission)
- **Location**: `backend/app/services/export/dji/builders.py:132` (template.kml only)
- **Spec**: `common-element.md` documents `payloadParam` without a `template-only` annotation, but the canonical sample in `template-kml.md` places it in the Folder of the template, and the `waylines.wpml` sample omits it. The current code matches the sample — the spec's "place this in template.kml" convention is followed.
- **Note**: no action needed; just recording the asymmetry so a future reader doesn't add it to `waylines.wpml` thinking the omission was an oversight.

### [P3-3] `optical_zoom` falls back to `zoomFactor` when no `sensor_base_focal_length` on the drone profile — the M4T seed has no profile at all (and the fallback element is not in the WPML spec)

- **Severity**: P3 (latent — the M4T isn't in the drone profile seed today, but if a future seed adds it without setting `sensor_base_focal_length`, the zoom action will emit a `zoomFactor` element that the spec doesn't list)
- **Location**: `backend/app/services/export/dji/actions.py:61-80` (`_append_zoom_action`)
- **Spec**: `common-element.md` `zoom` action — only documents `wpml:payloadPositionIndex` (Required) and `wpml:focalLength` (Required, float, > 0, mm). **`zoomFactor` is NOT in the spec.** A strict validator would reject a `zoom` action whose body is `<wpml:zoomFactor>7</wpml:zoomFactor>`.
- **Current behavior**: actions.py:73-78 — if `drone_profile.sensor_base_focal_length > 0`, emit `focalLength = zoomFactor * base`; otherwise fall back to `<wpml:zoomFactor>{zoom_factor:g}</wpml:zoomFactor>` (the non-spec element).
- **Why it's latent**: the seed currently has no `Matrice 4T` row at all (`backend/app/seed.py:23-128`) — every M4T mission today uses the `_M4T_FALLBACK_ENUM` path with no drone profile, so `drone_profile` is `None` in `_append_zoom_action` and the function early-returns without emitting any zoom (the upstream emission gate `_first_zoom_emission_waypoints` short-circuits on a None profile via the `getattr(drone_profile, ...)` chain). But if a future seed adds an M4T profile without populating `sensor_base_focal_length` (e.g. 6.83 mm for the H30T wide, matching `Matrice 350 RTK`), the spec-noncompliant `zoomFactor` branch fires.
- **Evidence**: actions.py:78 — `_sub_text(params, "zoomFactor", f"{zoom_factor:g}")`; `seed.py:23-128` — no `Matrice 4T` entry.
- **Proposed fix**: either (a) drop the `zoomFactor` fallback entirely and require `sensor_base_focal_length` to be populated on any DJI drone profile that emits zoom, or (b) keep the fallback but make `_append_zoom_action` log a warning when it fires. Also: add a `Matrice 4T` seed row with `sensor_base_focal_length` set to the H30T wide lens (~6.83 mm matching M350 + H30T, or 4.4 mm if the H30T is treated as its own focal-length base — needs spec/Pilot 2 confirmation).

## Cross-cutting observations

- `accurateShoot` regression net at `backend/tests/test_export_service.py:2396-2412` still pins audit §2.9 across all three heading modes — verified still passing in the repo at HEAD (`grep -n "accurateShoot" backend/app/services/export/dji/` returns no matches).
- `panoShot` and `recordPointCloud` are correctly not in `_DJI_CAMERA_ACTIONS` (actions.py:10-14). No regression net pins this; a one-liner asserting these strings are absent from the emitted XML would be cheap insurance.
- `isInfiniteFocus` is correctly absent from the emitted XML. No `focus` action is emitted at all (the action set is `{takePhoto, startRecord, stopRecord}` plus `gimbalRotate`/`gimbalEvenlyRotate`/`rotateYaw`/`hover`/`zoom`). Audit §7 invariant holds. The implication: the M4T uses whatever focus mode the gimbal carries into the waypoint — no per-WP focus snap. This is the *correct* design for steady framing (audit §3 table: "Set focus once, keep focalLength constant"), as long as `payloadParam/focusMode=firstPoint` (placemark.py:99) is honoured by the H30T. **Worth verifying on hardware** that the H30T does honour `focusMode=firstPoint` and doesn't continuously AF-hunt — the spec table marks `focusMode` as M300/M350-only (P3-1 above), so the M4T may ignore it and revert to continuous AF.
- The `actionGroup` action ordering `rotateYaw → gimbalRotate → hover → camera → zoom` is **otherwise** correct (gimbal settles before the photo); only the trailing `zoom` is misplaced (P1-2).

## File references

- `backend/app/services/export/dji/actions.py` — `_DJI_CAMERA_ACTIONS`, `_first_zoom_emission_waypoints`, `_append_zoom_action`, `_append_action_group`, `_append_segment_action_group`.
- `backend/app/services/export/dji/placemark.py:91-106` — `_append_payload_param`.
- `backend/app/services/export/dji/mission_config.py:164-230` — `_append_mission_config` (drone/payload enums via `_dji_enums_for`).
- `backend/app/services/export/dji/video.py` — capture-mode resolution (informs lens choice via `inspection_camera`).
- `backend/app/core/constants.py:91-97` — `DJI_WPML_ENUMS`, `DJI_WPML_M4T_FALLBACK_ENUM`.
- `backend/app/seed.py:23-128` — drone profile seed (no M4T row today).
- `backend/tests/test_export_service.py:1538` — `<wpml:imageFormat>visable</wpml:imageFormat>` assertion.
- `backend/tests/test_export_service.py:2396-2412` — `test_no_accurate_shoot_emitted_across_modes`.
- `docs/kmz-wpml-audit.md` §3 / §7 / §11 — M4T payload checklist.
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.9 / §3.1 — accurateShoot regression net + M4T enum provenance.
