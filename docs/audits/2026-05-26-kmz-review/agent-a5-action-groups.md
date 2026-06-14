# Agent A5 - `<wpml:actionGroup>` envelope and per-`actionActuatorFunc` shape

Scope: DJI Matrice 4T, WPML 1.0.6. Read-only audit of the action-group envelope
emission and the per-action structural shape across
`backend/app/services/export/dji/actions.py`,
`backend/app/services/export/dji/placemark.py`, and
`backend/app/services/export/dji/video.py`, against
`docs/en/60.api-reference/00.dji-wpml/40.common-element.md` (WebFetched
2026-05-26), `docs/kmz-wpml-audit.md` §11, and
`docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.8 / §2.9 / §5.1 / §5.2.

Action SEMANTICS (heading angle, gimbal pitch, payload lens, turn mode) are
owned by sister agents B3/B4/B5/C2 and not duplicated here - this audit covers
only the envelope (`actionGroup`, `actionTrigger`, `actionActuatorFuncParam`
shape) plus a few ordering/conformance points specific to the envelope.

## Summary

- P0 blockers: 0
- P1 high (mid-flight sequencing / firmware misinterpretation): 1
- P2 conformance (strict-spec violations Pilot 2 tolerates today): 4
- P3 upgrades / latent: 1

The action-group envelope itself is structurally correct: every `actionGroup`
emits the four required children (`actionGroupId`, `actionGroupStartIndex`,
`actionGroupEndIndex`, `actionGroupMode`) in the canonical order, followed by
`actionTrigger` and one or more `action` blocks. Index translation 1-indexed
→ 0-indexed is honoured at the write site (`_append_action_group` and
`_append_segment_action_group` both subtract 1 from `wp.sequence_order` /
`index`). The `actionGroupId` interleaved odd/even-lane allocation pinned by
`TestDjiActionGroupIdRange` (#638) still holds and keeps both streams inside
`[0, 65535]` with no collisions past the 500-WP performance ceiling. The
`gimbalEvenlyRotate` ↔ `betweenAdjacentPoints` invariant (audit §2.8) holds
- the action is emitted only inside `_append_segment_action_group`, which
unconditionally sets the trigger type to `betweenAdjacentPoints`.
`accurateShoot` is correctly absent (audit §2.9 regression net still pins
it). `panoShot`, `recordPointCloud`, `focus`, `customDirName`,
`orientedShoot` are correctly absent.

The conformance gaps that remain are: (1) missing `actionTriggerParam` on
every group - the spec marks the element optional but every reference KMZ
emits it as `0` on `reachPoint` / `betweenAdjacentPoints` groups; (2)
`gimbalEvenlyRotate` segment groups never emit a closing
`actionTrigger`/`actionActuatorFuncParam` shape consistent with the WPML
samples around the param block; (3) the per-action `actionActuatorFuncParam`
shape gaps on `stopRecord` / `startRecord` flagged by B5 (P2-1 / P2-2 / P2-3)
which the envelope audit confirms; (4) the multi-action emit ordering inside
the reach-point group - `zoom` after `takePhoto` flagged by B5 as P1-2 is
also an envelope-level concern (action sequencing inside `actionGroupMode=
sequence`); A5 confirms but does not duplicate.

## Findings

### [P1-1] Reach-point `actionGroup` emits `zoom` AFTER `takePhoto` - envelope-level ordering bug

- **Severity**: P1 (mid-flight sequencing; the photo is taken before the
  configured zoom is applied).
- **Location**: `backend/app/services/export/dji/actions.py:172-235`
  (`_append_action_group`).
- **Spec**: `common-element.md` defines `actionGroupMode=sequence` as
  "actions within the action group are executed sequentially" - there is no
  envelope-level rule that forbids `zoom` after `takePhoto`, but the practical
  invariant for `sequence` mode is that every action whose effect must be
  visible in a media file must precede the capture action. Documented in
  `docs/kmz-wpml-audit.md` §3 table: "Set focus once, keep focalLength
  constant; ... `takePhoto` last in the action group".
- **Current behavior**: action_id 0..N inside the group is fixed as
  `rotateYaw → gimbalRotate → hover → camera → zoom`. `zoom` is appended
  unconditionally after `takePhoto` / `startRecord` / `stopRecord`.
- **Why it's wrong (envelope view)**: `sequence` mode means the actuator
  is reprogrammed in this order; a `zoom` action emitted at `actionId=4`
  changes the optical zoom AFTER the photo was already written at
  `actionId=3`. For the per-inspection anchor frame (the first MEASUREMENT
  in each inspection - the only WP that emits `zoom`, per
  `_first_zoom_emission_waypoints`) the photo is captured at whatever zoom
  was inherited from the previous waypoint, then the zoom is set, then
  subsequent measurements (which do not re-emit `zoom`) inherit the
  configured value.
- **Cross-ref**: this is the exact issue B5 flags as P1-2 in
  `agent-b5-payload.md` ("[P1-2] `zoom` action emitted AFTER `takePhoto` in
  the same actionGroup"). A5 confirms from the envelope angle: action
  ordering inside a sequence-mode group is part of the envelope contract,
  and the WPML spec assumes the emitter knows which actions must precede
  the capture. Fix lives in `_append_action_group` - emit the `if emit_zoom:`
  block before the `if camera_func:` block. Behaviour-preserving for every
  WP that does not carry a `zoom_factor`.
- **Proposed fix**: see B5 P1-2 - move `_append_zoom_action(...)` above the
  `if camera_func:` block in `_append_action_group`. A5 adds: when the WP
  carries video bookend `startRecord` / `stopRecord` action (HOVER bookends
  inserted by `_insert_video_hover_waypoints`), the same ordering rule
  applies - zoom must precede `startRecord` so the recording is framed
  from frame 0.
- **HW verify**: photograph a known PAPI at configured 7×. Today's KMZ
  yields the first frame at 1× and subsequent frames at 7×; the fix yields
  every frame at 7×.

### [P2-1] Every `actionGroup` omits the documented-default `actionTriggerParam`

- **Severity**: P2 (conformance; the element is marked optional in the
  spec, but every DJI MSDK reference KMZ and every Pilot 2 export emits it
  unconditionally as `0` on `reachPoint` / `betweenAdjacentPoints` groups -
  strict validators may reject a group without it).
- **Location**:
  - `backend/app/services/export/dji/actions.py:169-170` (reach-point group
    `actionTrigger`)
  - `backend/app/services/export/dji/actions.py:264-265` (segment group
    `actionTrigger`)
- **Spec**: `common-element.md` `actionTrigger` block:
  ```
  actionTriggerType   Yes  enum
  actionTriggerParam  No   > 0 (seconds if multipleTiming, meters if multipleDistance)
  ```
  The element is documented as required only for the `multipleTiming` and
  `multipleDistance` trigger types (parameter is the time / distance
  interval). On `reachPoint` / `betweenAdjacentPoints` the parameter is
  meaningless, so the spec marks it optional - but DJI's MSDK sample KMZ
  (`SampleCode-V5/android-sdk-v5-sample/src/main/assets/waypointsample.kmz`)
  still emits `<wpml:actionTriggerParam>0</wpml:actionTriggerParam>` after
  the trigger type to keep the block shape uniform across all trigger types.
  Pilot 2 has tolerated the omission across every test flight; a strict
  validator following the MSDK reference shape will not.
- **Current behavior**: both emit sites write only
  `<wpml:actionTrigger><wpml:actionTriggerType>...</wpml:actionTriggerType></wpml:actionTrigger>`.
- **Proposed fix**: append `_sub_text(trigger, "actionTriggerParam", "0")`
  in both `_append_action_group` and `_append_segment_action_group`
  immediately after writing `actionTriggerType`. Byte-additive; pinned by
  a regression assert that `actionTrigger` has exactly two children on
  every emitted group.

### [P2-2] `gimbalEvenlyRotate` segment group writes `actionId` out of the `[0, 65535]` integer band as `"0"` but the surrounding numeric writes use `str()` - consistency check

- **Severity**: P2 (conformance; the value `"0"` is in range, but the
  inconsistency between the two emit sites is a latent footgun for any
  future segment-group action that needs a non-zero id).
- **Location**: `backend/app/services/export/dji/actions.py:268`.
- **Spec**: `common-element.md` `actionId` - `Required: Yes`, range `[0,
  65535]`, integer. Unique within the action group.
- **Current behavior**: `_append_segment_action_group` writes
  `_sub_text(action, "actionId", "0")` as a literal `"0"`. The
  reach-point path uses `_sub_text(action, "actionId", str(action_id))`
  with `action_id` incrementing.
- **Why it's worth flagging**: the segment group today emits exactly one
  action (`gimbalEvenlyRotate`), so a hardcoded `"0"` is safe. But the
  shape is misleading - if a future fix adds a sibling action inside the
  same segment group (e.g. a leading focus reset, a trailing zoom), the
  literal `"0"` becomes a uniqueness violation. Should mirror the
  reach-point pattern: maintain a local `action_id` counter and pass
  `str(action_id)` so the structure scales.
- **Proposed fix**: replace the literal with `action_id = 0` /
  `str(action_id)` even though only one action is emitted today.
  Byte-identical; future-proofs the segment-group emit site.

### [P2-3] `stopRecord` / `startRecord` action shape is incomplete - missing `payloadLensIndex` + `fileSuffix` (cross-ref B5)

- **Severity**: P2 (conformance; the WPML spec marks the omitted children
  as `Required: Yes`).
- **Location**: `backend/app/services/export/dji/actions.py:221-232`.
- **Spec**: per the WebFetch above, the `actionActuatorFuncParam` block
  for these three actions is:
  | Action | `payloadPositionIndex` | `fileSuffix` | `payloadLensIndex` | `useGlobalPayloadLensIndex` |
  |---|---|---|---|---|
  | takePhoto | Yes | Yes | Yes | Yes |
  | startRecord | Yes | Yes | Yes | Yes |
  | stopRecord | Yes | (no) | Yes | (no) |

  (The spec marks `fileSuffix` / `useGlobalPayloadLensIndex` as
  `stopRecord`-omittable - they refer to the recording the action stops,
  which was already keyed by the matching `startRecord`.)

- **Current behavior**:
  - `takePhoto` emits `payloadPositionIndex`, `fileSuffix`,
    `useGlobalPayloadLensIndex` - missing `payloadLensIndex`.
  - `startRecord` emits `payloadPositionIndex`,
    `useGlobalPayloadLensIndex` - missing `fileSuffix` and
    `payloadLensIndex`.
  - `stopRecord` emits ONLY `payloadPositionIndex` - missing
    `payloadLensIndex`.

- **Cross-ref**: B5 flags this as P2-1 / P2-2 / P2-3. A5 confirms from the
  envelope angle: every action emitted inside a sequence-mode group MUST
  satisfy the spec's per-`actionActuatorFunc` required-children list, and
  the three camera actions miss it. The fix is exactly what B5 proposes -
  collapse the `if/elif` into a shared block that emits all four (or
  three, for `stopRecord`) sub-elements unconditionally.

### [P2-4] `gimbalRotate` action emits `gimbalRotateTimeEnable=0` / `gimbalRotateTime=0` - spec requires `gimbalRotateTime > 0` when emitted (cross-ref B4)

- **Severity**: P2 (conformance; the field is required by spec but is
  documented with `> 0 seconds` only when `gimbalRotateTimeEnable=1`. With
  enable=0 the value is ignored, but emitting `"0"` is technically outside
  the documented range).
- **Location**: `backend/app/services/export/dji/actions.py:208-209`.
- **Spec**: per the WebFetch, `gimbalRotateTime` is `Yes, > 0 seconds`.
- **Current behavior**: emits `gimbalRotateTimeEnable=0` +
  `gimbalRotateTime=0` on every per-WP `gimbalRotate` snap. Pilot 2
  ignores the value when enable=0, so the emit is operationally inert -
  but the literal `"0"` is technically out of the documented range
  `> 0 seconds` and a strict validator that walks the range column will
  flag it.
- **Cross-ref**: B4 flags this as P2-2 ("`gimbalRotateTimeEnable=0` makes
  the anchor snap visibly abrupt"). A5 adds the envelope conformance angle:
  emit a placeholder `> 0` value (e.g. `0.1`) when enable=0, OR drop the
  `gimbalRotateTime` element entirely when enable=0 (since the spec marks
  the value as gated on the enable flag in practice, the documented
  required-Yes is conditional on `gimbalRotateTimeEnable=1`). The cleaner
  shape is to flip enable=1 with a small (e.g. 0.2 s) duration on the
  anchor snap, which also addresses B4's "abrupt slew" cosmetic.

### [P3-1] No `actionTrigger` shape coverage for `multipleTiming` / `multipleDistance` - future-extensibility note

- **Severity**: P3 (upgrade; the code today never emits these trigger
  types, but if a future inspection method needs interval-triggered
  photography - e.g. a long-axis runway sweep at fixed time / distance -
  the param shape and trigger type must be plumbed end-to-end).
- **Location**: trigger type is hardcoded in two places:
  - `actions.py:170` - `reachPoint`
  - `actions.py:265` - `betweenAdjacentPoints`
- **Spec**: per the WebFetch, the trigger-type enum is
  `{reachPoint, betweenAdjacentPoints, multipleTiming, multipleDistance}`.
  `multipleTiming` requires `actionTriggerParam > 0` (seconds);
  `multipleDistance` requires `actionTriggerParam > 0` (meters).
- **Note**: no action needed today. Recorded so a future reader knows that
  adding interval-triggered photo capture (e.g. `PARALLEL_SIDE_SWEEP`
  density via timing rather than per-waypoint) means a third emit site
  with the param block, not just a new trigger-type literal.

## Per-action shape conformance (full inventory)

The table below summarises every `actionActuatorFunc` value the codebase
emits, the required-children set per the spec, and whether the emit site is
spec-conformant. Cross-references to sister-agent findings are noted; A5
does not duplicate them.

| `actionActuatorFunc` | Emit site | Required sub-elements per spec | Current emit | Conformance |
|---|---|---|---|---|
| `rotateYaw` | `actions.py:177-187` | `aircraftHeading` [-180,180]°, `aircraftPathMode` enum | both emitted, `_normalize_heading` clamps to [-180,180], `path_mode` matches sign | OK (cross-ref B3) |
| `gimbalRotate` | `actions.py:190-211` | `payloadPositionIndex`, `gimbalHeadingYawBase`, `gimbalRotateMode`, `gimbalPitchRotateEnable`, `gimbalPitchRotateAngle`, `gimbalRollRotateEnable`, `gimbalRollRotateAngle`, `gimbalYawRotateEnable`, `gimbalYawRotateAngle`, `gimbalRotateTimeEnable`, `gimbalRotateTime` | all 11 emitted | conformance OK except P2-4 (`gimbalRotateTime=0` out of `>0` range) |
| `gimbalEvenlyRotate` | `actions.py:269-272` | `payloadPositionIndex`, `gimbalPitchRotateAngle` | both emitted; `payloadPositionIndex=0`; pitch as `f"{target_pitch:g}"` | OK (cross-ref B4 P0/P1 for clamp range) |
| `hover` | `actions.py:213-219` | `hoverTime > 0` | emitted as `f"{hover_secs:g}"` gated on `hover_secs > 0` | OK |
| `takePhoto` | `actions.py:222-229` | `payloadPositionIndex`, `fileSuffix`, `payloadLensIndex`, `useGlobalPayloadLensIndex` | 3 of 4 emitted - `payloadLensIndex` missing | P2-3 / cross-ref B5 P2-1 |
| `startRecord` | `actions.py:230-231` | `payloadPositionIndex`, `fileSuffix`, `payloadLensIndex`, `useGlobalPayloadLensIndex` | 2 of 4 emitted - `fileSuffix` and `payloadLensIndex` missing | P2-3 / cross-ref B5 P2-2 |
| `stopRecord` | `actions.py:222-226` (fall-through) | `payloadPositionIndex`, `payloadLensIndex` | 1 of 2 emitted - `payloadLensIndex` missing | P2-3 / cross-ref B5 P2-3 |
| `zoom` | `actions.py:67-78` | `payloadPositionIndex`, `focalLength > 0` | `payloadPositionIndex=0`; `focalLength=zoomFactor*base` when profile has base, else falls back to `zoomFactor` (NOT in spec) | OK on the focalLength branch; P3 latent on the `zoomFactor` fallback (cross-ref B5 P3-3) |
| `focus` | (absent) | n/a (deprecated `isInfiniteFocus` is M4T-unsupported) | not emitted | OK; audit §7 invariant holds |
| `accurateShoot` | (absent) | n/a | not emitted | OK; audit §2.9 regression net pinned |
| `panoShot` | (absent) | n/a (M30 family only) | not emitted | OK |
| `recordPointCloud` | (absent) | n/a (LiDAR only) | not emitted | OK |
| `orientedShoot` | (absent) | n/a (M30T-specific oriented photo, not used by the exporter) | not emitted | OK |
| `customDirName` | (absent) | n/a | not emitted | OK |

## Envelope cross-cutting observations

- **`actionGroupId` interleaved lanes still hold** (#638). `_append_action_group` emits `2*index - 1` (odd lane); `_append_segment_action_group` emits `2*sequence_order` (even lane). At the 500-WP performance ceiling the max id is ~1000, well under the 65535 cap. `TestDjiActionGroupIdRange` pins both range and uniqueness. No regression.
- **`actionGroupStartIndex` / `actionGroupEndIndex` are 0-indexed** at the write site, matching `wpml:index`. Reach-point groups emit `(ref_index, ref_index)` (single-WP fire); segment groups emit `(wp.sequence_order - 1, next_index - 1)` (across the adjacent-points segment). `TestReachPointActionGroupsMatchParentPlacemarkIndex` pins the reach-point shape; `TestVpVideoSegmentActionGroupUsesZeroIndexedBounds` pins the segment shape.
- **`actionGroupMode=sequence`** unconditionally. The spec defines `sequence` as the only valid value (despite mentions of a `parallel` mode in older revisions - the current WPML 1.0.6 spec lists only `sequence`), so this is correct. Do not change.
- **Multiple action groups per Placemark.** The emitter currently emits at most 2 groups per Placemark: one reach-point group for the per-WP snap (rotateYaw / gimbalRotate / hover / camera / zoom) and one segment group for the VP-video pitch sweep. Both carry unique `actionGroupId` (odd vs even lane), distinct `actionTriggerType` (`reachPoint` vs `betweenAdjacentPoints`), and `start/EndIndex` that bracket different segment ranges. The two groups appear as sibling children of the Placemark, in that order (reach-point first, segment second) - matches DJI's sample KMZ shape. Confirmed at `placemark.py:241-257`.
- **`gimbalEvenlyRotate` ↔ `betweenAdjacentPoints` invariant** (audit §2.8): `gimbalEvenlyRotate` is emitted only inside `_append_segment_action_group` (`actions.py:267`), which hardcodes `actionTriggerType=betweenAdjacentPoints` (`actions.py:265`). The two are co-located in the same function and cannot drift. The audit's PR-#508 regression assertion still holds.
- **Empty action-group early return**: `_append_action_group` short-circuits when no action would be emitted (no camera_func, no hover, no gimbal pitch, no zoom, no rotateYaw - `actions.py:143-150`), so transit / takeoff / landing Placemarks never carry an empty `actionGroup`. The spec does not forbid an empty `actionGroup` (a group with no `action` children would still be valid per the schema) but the early return is the right behaviour: an empty group is noise that strict validators may flag and Pilot 2 has no use for. Keep the early return.
- **`actionGroupId` for the segment group uses `2*wp.sequence_order`**; for the reach-point group `2*index - 1`. The reach-point caller passes `wp.sequence_order` as `index` (`placemark.py:244`), so the two formulas resolve to `2*N - 1` (reach) and `2*N` (segment) for the same sequence_order N. Concurrent emission on the same WP cannot collide; the lanes are tight by construction.
- **Action ordering inside the reach-point group** is `rotateYaw → gimbalRotate → hover → camera → zoom` (actions.py:174-235). All correct except `zoom` placement (P1-1 above / cross-ref B5 P1-2). gimbal-rotate-before-takePhoto is correct so the gimbal settles before the shutter.

## Spec-domain notes (no code change, recorded for the audit trail)

- `actionTriggerParam` is documented as `No`-required in the spec but every reference KMZ emits it on `reachPoint` / `betweenAdjacentPoints` as `0`. Recorded as P2-1.
- The WPML spec's `actionId` documentation says "[0, 65535]" but does not explicitly require uniqueness within an `actionGroup`. In practice Pilot 2 dispatches actions by id, so duplicates would be ambiguous. The reach-point emitter maintains a local `action_id` counter that increments after every emit (`actions.py:172, 187, 211, 219, 232`), guaranteeing per-group uniqueness. Segment-group emits one action with id `"0"` (P2-2 future-proofing).
- `actionActuatorFunc` enum strings (per WebFetch above) include `customDirName` and `orientedShoot` that the codebase does not emit. No action; recorded.
- The `customDirName` action (would let the exporter prefix the captured media directory with the inspection / LHA designator) is a P3 upgrade opportunity for future work - the current exporter relies on the operator's manual file sorting post-flight.

## File references

- `backend/app/services/export/dji/actions.py:163-167` - reach-point group envelope.
- `backend/app/services/export/dji/actions.py:169-170` - reach-point `actionTrigger` (P2-1 missing `actionTriggerParam`).
- `backend/app/services/export/dji/actions.py:172-235` - per-action emit sequence inside reach-point group (P1-1 ordering, P2-3 incomplete shapes, P2-4 `gimbalRotateTime=0`).
- `backend/app/services/export/dji/actions.py:257-262` - segment group envelope.
- `backend/app/services/export/dji/actions.py:264-265` - segment `actionTrigger` (P2-1 missing `actionTriggerParam`).
- `backend/app/services/export/dji/actions.py:267-272` - `gimbalEvenlyRotate` action shape (P2-2 actionId literal).
- `backend/app/services/export/dji/placemark.py:241-257` - dual-group emission per Placemark.
- `backend/app/services/export/dji/video.py:109-169` - `_video_smooth_emit_plan` (determines which Placemarks get a segment group).
- `backend/tests/test_export_service.py:2041-...` - `TestReachPointActionGroupsMatchParentPlacemarkIndex` (regression net for index-offset).
- `backend/tests/test_export_service.py:2080-...` - `TestVpVideoSegmentActionGroupUsesZeroIndexedBounds` (regression net for segment-group bounds).
- `backend/tests/test_export_service.py:2665-...` - `TestDjiActionGroupIdRange` (regression net for #638 lane allocation + uniqueness).
- `docs/kmz-wpml-audit.md` §11 - exporter state snapshot (action-group emission is "structurally close to spec").
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.8 - `gimbalEvenlyRotate` ↔ `betweenAdjacentPoints` invariant.
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §2.9 - `accurateShoot` regression net.
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §5.1 - `actionGroupId` `[0, 65535]` lane allocation.
- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §5.2 - `waypointTurnDampingDist` clamp (not an action concern, but co-located in `_append_placemark`).
- `docs/audits/2026-05-26-kmz-review/agent-b3-heading.md` - rotateYaw / heading-angle semantics (sister agent).
- `docs/audits/2026-05-26-kmz-review/agent-b4-gimbal.md` - gimbalRotate / gimbalEvenlyRotate semantics (sister agent).
- `docs/audits/2026-05-26-kmz-review/agent-b5-payload.md` - takePhoto / startRecord / stopRecord / zoom semantics (sister agent).
- `docs/audits/2026-05-26-kmz-review/agent-c2-turn-damping.md` - waypointTurnMode / damping semantics on the Placemark (sister agent).
