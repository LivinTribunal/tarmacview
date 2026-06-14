# Map Symbology

## Airport Boundary

The airport boundary defines the operational perimeter of the airport. The drone
must remain inside this polygon. Visually it renders as the **inverse** of a
safety zone: the region outside the polygon is shaded, the inside is transparent.

### Data model

- Stored in the `safety_zone` table with `type = 'AIRPORT_BOUNDARY'`.
- One boundary per airport. The `Airport` aggregate-root invariant rejects a
  second boundary with HTTP 409.
- `altitude_floor` / `altitude_ceiling` are ignored for this type.

### MapLibre rendering

Use a `Polygon` feature whose outer ring covers the whole world and whose inner
ring (reversed winding) is the airport boundary, producing a "donut" where the
boundary is a hole:

```ts
{
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]], // outer
      reverseRing(boundaryOuterRing)                         // hole
    ]
  }
}
```

Two map layers are stacked on the resulting source:

| Layer                         | Type | Paint                                                          |
|-------------------------------|------|----------------------------------------------------------------|
| `airport-boundary-fill`       | fill | `fill-color: #000`, `fill-opacity: 0.4`, `fill-antialias: false` |
| `airport-boundary-line`       | line | `line-color: #fff`, `line-width: 2`, `line-dasharray: [4, 4]`    |

The fill layer filters on `role == "mask"` (the inverted polygon feature). The
line layer filters on `role == "outline"` (the original boundary geometry, no
hole), so the dashed border tracks the boundary edges only.

### 3D view (CesiumJS)

Mirrors the MapLibre approach. `CesiumInfrastructure` renders a polygon whose
outer ring covers the world and whose inner hole is the boundary polygon, with
`ClassificationType.TERRAIN` so the dark shade drapes over the ground outside
the boundary. A `PolylineDashMaterialProperty` draws the dashed white outline
on the boundary edge. Regular safety zones are filtered to skip
`AIRPORT_BOUNDARY` so they do not double-render.

### Layer panel / legend

The LayerPanel exposes "Safety Zones" (`layers.safetyZones`) and "Airport
Boundary" (`layers.airportBoundary`) as two independent toggles. The
`MapLayerConfig.safetyZones` flag drives the four `SAFETY_ZONE_*` MapLibre
layers; `MapLayerConfig.airportBoundary` drives the `AIRPORT_BOUNDARY_LINE_LAYER`
and the `buildAirportBoundaryEntities` gate in the 3D viewer. Both default to
`true`; saved configs that predate the split hydrate `airportBoundary` to `true`
via `buildInitialLayerConfig` so reloads do not silently lose the boundary.

The legend's combined "Safety Zones & Boundary" section
(`layers.safetyZonesAndBoundary`) renders when either flag is on - it includes
the dashed-rectangle swatch with the "Airport Boundary" label. The
`SafetyZonesPanel` mirrors the split: the boundary row grays out when
`airportBoundary` is off and the per-zone rows gray out when `safetyZones` is
off, so users can deselect/select each side independently.

### Validation

`GeofenceConstraint` / `_batch_check_zones` treat `AIRPORT_BOUNDARY` with
inverted Shapely `contains` semantics - a waypoint **not** contained in the
boundary polygon is a hard `geofence` violation. Regular safety zones keep
their existing containment-is-violation behaviour.
