# dji vendor-helper package

shared dji wpmz 1.0.6 builders consumed by both the kmz and wpml export
formats. peer of `export/shared.py` / `export/geozone.py`, not a registered
format. import dag runs downward only (`shared` <- `dji.heading` <-
`dji.actions`; `dji.video` standalone; `dji.placemark` imports `shared` /
`dji.actions` / `dji.heading`; `dji.mission_config` imports `shared` only;
`dji.builders` imports `shared` / `dji.actions` / `dji.heading` / `dji.video`
/ `dji.mission_config` / `dji.placemark`) so there is no cycle.

## visible-light payload is intentional

`_append_payload_param` in `placemark.py` writes `imageFormat=visable` (sic;
that is the dji wpml token spelling). this is a single-token visible-light
configuration on purpose - papi inspections frame the all-white edge from the
rgb sensor and the technical report is built off the visible imagery. an
operator-toggleable thermal stream is out of scope for the current export
contract.

## enabling thermal later

if a future inspection class needs the matrice 4t / h20t ir lens running
alongside visible:

1. switch `imageFormat` to a multi-token value, e.g. `wide,ir` (wpml supports
   the comma-separated lens list at the folder level).
2. thread a per-action `payloadLensIndex` onto every `takePhoto` /
   `startRecord` action in `actions.py` per the open msdk issue #635 (the
   field is required when more than one lens is active and lens selection
   needs to vary per waypoint).
3. drop the `useGlobalPayloadLensIndex=1` writes in the `takePhoto` /
   `startRecord` branches of `_append_action_group` (currently the
   `if camera_func == "takePhoto":` / `elif camera_func == "startRecord":`
   blocks) - the global default would otherwise win over the per-action lens
   selection.

context for the existing constraints is in
`docs/audits/2026-05-26-kmz-export-review.md` (findings B5-P1-2, A5-P1-1,
B5-P1-1).

## action-group emission order

`_append_action_group` emits `rotateYaw -> gimbalRotate -> hover -> zoom ->
camera`. zoom precedes `takePhoto` / `startRecord` because the actionGroup
runs in `sequence` mode - a zoom action emitted after the camera action would
not take effect until the next waypoint, so the anchor frame on the first
measurement would be captured at the inherited baseline (1x) instead of the
configured optical_zoom (e.g. 7x). regression tests live under
`TestGenerateKmzCameraSettings` in `backend/tests/test_export_service.py`.
