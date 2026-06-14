# 2026-05-03 — Geozone bundling in mission exports

## Context

Mission exports (`POST /api/v1/missions/{id}/export`) historically emit
waypoints only. The trajectory is validated against the airport's keep-out
polygons (obstacles, safety zones, runway/taxiway buffers) server-side, but
none of that context travels with the export — so a drone receiving only
measurement waypoints has no idea about the airport's geofence.

Issue [#311](https://github.com/LivinTribunal/drone-mission-planning-module/issues/311)
adds an opt-in `include_geozones` flag (with a nested `include_runway_buffers`
sub-flag for MAVLink) that bundles the airport's keep-outs into the export in
the format-native representation.

Not all formats can carry keep-outs; not every drone can consume them. This
ADR records the format-by-format decisions so the matrix stays explicit.

## Decisions

### MAVLink — native, switches output format

When `include_geozones=True` is requested for the MAVLink export, the
generator switches from QGC WPL 110 plain-text waypoints to a QGC `.plan`
JSON document with `mission`, `geoFence`, and `rallyPoints` sections.

- Safety zones (excluding `AIRPORT_BOUNDARY`) and obstacles emit `inclusion:
  false` polygons in `geoFence.polygons[]`.
- Runway/taxiway buffers (when `include_runway_buffers=True`) emit
  `inclusion: true` polygons in the same array.
- `_EXPORT_CONTENT_TYPES["MAVLINK"]` branches on the flag — the file extension
  switches from `.waypoints` to `.plan` and the content type from `text/plain`
  to `application/json`. Plain WPL 110 stays the default for backwards
  compatibility.

### JSON — native, additive

The TarmacView JSON schema gains a top-level `geozones` key:

```json
{
  "geozones": {
    "safety_zones": [{ "id": "…", "name": "…", "type": "RESTRICTED", "geometry": { "type": "Polygon", … } }],
    "obstacles":    [{ "id": "…", "name": "…", "type": "TOWER",      "geometry": { … } }],
    "runway_buffers": []
  }
}
```

When `include_geozones=False` the key is omitted entirely so existing
consumers parsing the JSON output remain byte-identical.

### UgCS — native (separate import side-channel)

The UgCS route schema (`docs/exported_routes_schema.json`) carries a
`route.checkCustomNfz: bool` toggle but does NOT embed NFZ polygons inline —
operators import polygons through UgCS's separate NFZ import path.

We emit a sibling top-level `customNfzList` array with each polygon entry in
UgCS's `{name, type, polygon: { points: [{latitude, longitude}] }}` shape
(coordinates in radians). When `include_geozones=True` we also flip
`route.checkCustomNfz=true` so UgCS honors the polygons at flight time.

### KML / KMZ — advisory only

DJI Pilot 2 renders `<Placemark><Polygon>` elements but does NOT enforce
them as a fence at flight time. We emit a `<Folder name="Keep-out zones">`
with one styled placemark per zone/obstacle/buffer; every placemark carries
a `<description>` that calls out the advisory-only nature.

The KMZ archive extends the in-archive `wpmz/template.kml` rather than
emitting WPML fence tags — DJI WPML has no fence schema (see below). The
runtime-executed `wpmz/waylines.wpml` is left untouched; advisory keep-outs
belong in the preview/template doc.

### WPML — not supported

DJI WPML is execution-only. Geofencing for DJI enterprise fleets is a
server-side concern (FlySafe / FlightHub 2 "Custom Flight Area"), not
embedded in the mission file. The `include_geozones` flag is rejected with
HTTP 400 when WPML is the only requested format and stays disabled in the
UI tooltip.

### GPX, LITCHI, CSV, DRONEDEPLOY — not supported

Pure waypoint formats with no fence concept. Same gate, same UI tooltip.

### FlightHub 2 OpenAPI — out of scope

Pushing Custom Flight Areas into DJI FlightHub 2 programmatically is a
separate cross-cutting integration with its own auth and lifecycle. Tracked
out of band.

## Consequences

- **Backwards compatibility.** `include_geozones=False` is the default;
  every per-format generator's output is byte-identical to today when the
  flag is off. The new `geoFence`/`customNfzList`/`Keep-out zones` blocks
  only appear when the flag is on.
- **Capability flag on DroneProfile.** A new `supports_geozone_upload`
  column is the gate at the drone level. The migration seeds `True` only
  for ArduPilot/PX4/Holybro/Cubepilot airframes; consumer DJI rows stay
  `False` so they don't accidentally produce a `.plan` they can't honor.
- **Frontend tooltip uses i18n keys.** `frontend/src/constants/exportCapabilities.ts`
  centralizes the matrix so the UI tooltip text and the backend gate stay in
  sync — the helper returns a `reasonKey` that maps to the right disabled
  message without re-implementing the matrix in JSX.
- **i18n key placement.** Geozone strings live under
  `mission.validationExportPage.geozones.*` rather than a top-level
  `export.geozones.*` namespace. This follows the project-wide
  "nest keys by page/component" convention documented in `CLAUDE.md` —
  every existing export-panel string already sits beneath
  `mission.validationExportPage.*`, so geozone strings stay co-located with
  their owning page. The `ExportPanel` is the sole consumer; if a second
  surface ever needs the same strings, that's the trigger to promote them to
  a shared namespace.
