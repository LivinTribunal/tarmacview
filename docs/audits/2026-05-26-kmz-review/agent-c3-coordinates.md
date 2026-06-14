# Agent C3 — Coordinate ordering, precision, and units audit

Scope: every coordinate triple emitted from the KMZ/WPML pipeline plus the
peer format generators that share `_iter_waypoints_agl`. Verifies the
write-site reversal at `wpml:waypointPoiPoint` (per `2026-05-11-papi-altitude-camera-aim.md`
§4.3 — preserve, do not unify), KML default `lon,lat,alt`, sign conventions,
unit conventions, and float precision.

Target: DJI Matrice 4T, WPML 1.0.6.

Code under audit:
- `backend/app/services/export/dji/placemark.py`
- `backend/app/services/export/dji/heading.py`
- `backend/app/services/export/dji/mission_config.py`
- `backend/app/services/export/dji/builders.py`
- `backend/app/services/export/formats/kml.py`
- `backend/app/services/export/formats/wpml.py`
- `backend/app/services/export/formats/kmz.py`
- `backend/app/services/export/formats/json.py`
- `backend/app/services/export/formats/mavlink.py`
- `backend/app/services/export/formats/litchi.py`
- `backend/app/services/export/formats/gpx.py`
- `backend/app/services/export/formats/csv.py`
- `backend/app/services/export/formats/ugcs.py`
- `backend/app/services/export/formats/dronedeploy.py`
- `backend/app/services/export/shared.py`
- `backend/app/core/geometry.py` (ingest contract)

Spec sources (WebFetched / cross-read):
- `dji-sdk/Cloud-API-Doc/.../common-element.md` — WPML element scoping,
  `waypointPoiPoint` written `lat,lon,alt`; `takeOffRefPoint` written
  `lat,lon,alt` per the FH2 schema.
- KML 2.2 OGC — `<coordinates>` is `lon,lat[,alt]`.
- `point_lonlatalt(wkt)` in `app.core.geometry` — strict parser, returns
  `(lon, lat, alt)`. Confirmed via the underlying `wkt_to_geojson` which
  reads WKT `POINT Z (x y z)` as `[x, y, z]` and never swaps.

Existing audits cross-read:
- `docs/audits/2026-05-11-papi-altitude-camera-aim.md` §4.3 — POI is the
  ONE site with reversed `lat,lon,alt` ordering; reversal happens at write
  site, not at input.
- A4-P0-1 — `<Point><coordinates>` strips altitude. Flagged here only as
  cross-reference; A4 owns the fix.

---

## Severity counts

- P0 (BLOCKER): **0**
- P1 (HIGH): **1**
- P2 (conformance): **3**
- P3 (upgrade): **3**

No coordinate-ordering swap, no sign-convention bug, no wrong-axis emission.
The write-site reversal at `waypointPoiPoint` is intact and well-tested
with lat=49.x lon=18.x fixtures that would fail loudly on a swap. Every
other site emits the spec-correct ordering for its target format.

---

## Coordinate-ordering audit table

Every (file, line) site that emits a coordinate string or component into
the output. "Order" is the order on the wire. "Precision" is the literal
format-spec digits. "Swap-safe?" is whether a lat=49.x ≠ lon=18.x test
fixture pins the exact site (would fail on a coordinate swap).

| # | Site | File:line | Order on wire | Precision (lat/lon, alt) | Units | Swap-safe? |
|---|------|-----------|----------------|---------------------------|-------|-----------|
| 1 | `<Point><coordinates>` (KMZ template + waylines) | `dji/placemark.py:184` | `lon,lat` (no alt) | 8 dp / 8 dp / — | deg | YES (`test_aimed_placemark_omits_use_global_heading_param` etc. produce 8-dp `49.690000,18.110000`-shape strings; A4-P0-1 already flags missing alt) |
| 2 | `wpml:takeOffRefPoint` (template) | `dji/mission_config.py:96,102,106` | `lat,lon,alt` (reversed) | 6 dp / 6 dp / 6 dp (HAE) | deg, m | YES (`test_take_off_ref_point_from_mission` pins `48.987654,17.123456`; `test_take_off_ref_point_falls_back_to_first_waypoint` pins `49.690000,18.110000`) |
| 3 | `wpml:waypointPoiPoint` (heading param, towardPOI only) | `dji/heading.py:174` | `lat,lon,alt` (reversed) | 6 dp / 6 dp / 6 dp (literal `0.000000`) | deg, m | YES (`test_aimed_placemark_emits_towardPOI_with_poi_point` pins `49.690000,18.120000,0.000000`) |
| 4 | `wpml:ellipsoidHeight` (template per-WP) | `dji/placemark.py:201` | scalar | 6 dp | m (HAE) | N/A |
| 5 | `wpml:height` (template per-WP) | `dji/placemark.py:202` | scalar | 6 dp | m (relative) | N/A |
| 6 | `wpml:executeHeight` (waylines per-WP) | `dji/placemark.py:193` | scalar | 6 dp | m (relative) | N/A |
| 7 | KMZ keepout `<coordinates>` (template) | `dji/builders.py:171` | `lon,lat` (no alt) | 8 dp / 8 dp / — | deg | partial (lon/lat distinct in test fixtures, but no explicit single-coord assertion) |
| 8 | Generic KML `<Point>` via simplekml | `formats/kml.py:30` | `(lon, lat, agl)` tuple passed to simplekml | simplekml default (~10 dp) | deg, m | N/A (library handles serialization, KML 2.2 lon,lat,alt) |
| 9 | Generic KML LineString | `formats/kml.py:45` | `(lon, lat, agl)` tuple | simplekml default | deg, m | N/A |
| 10 | Generic KML keep-out polygons | `formats/kml.py:73-100` via `_ring_xy` | `(lon, lat)` pairs | simplekml default | deg | N/A |
| 11 | GPX `<wpt lat lon>` + `<trkpt lat lon>` | `formats/gpx.py:34,45` | named attrs (`lat=…`, `lon=…`) | 8 dp / 8 dp / 2 dp ele | deg, m MSL | YES (named kwargs prevent positional swap) |
| 12 | CSV `latitude,longitude,...` | `formats/csv.py:37-38` | `lat, lon` | 8 dp / 8 dp / 2 dp alt | deg, m MSL+AGL | YES (header column ordering) |
| 13 | JSON `{latitude, longitude, altitude_msl, altitude_agl}` | `formats/json.py:42-45` | named keys | float (Python repr) | deg, m | YES (named keys, distinct dict entries) |
| 14 | JSON camera_target nested object | `formats/json.py:33-37` | named keys | float (Python repr) | deg, m | YES |
| 15 | MAVLink WPL row (tab-separated) | `formats/mavlink.py:72` | `lat \t lon \t agl` (positional) | float (Python repr) | deg, m AGL | partial (positional but pinned by test_export_service patterns) |
| 16 | MAVLink `.plan` params array | `formats/mavlink.py:101-108` | `params[4]=lat, params[5]=lon, params[6]=agl` (positional) | float (Python repr) | deg, m AGL | partial (positional indices) |
| 17 | MAVLink plannedHomePosition | `formats/mavlink.py:181` | `[lat, lon, alt]` | float (Python repr) | deg, m MSL | partial (positional list) |
| 18 | MAVLink geofence polygon `[lat, lon]` pairs | `formats/mavlink.py:211-213` | `[c[1], c[0]]` (swap from ring `[lon,lat,alt]`) | float (Python repr) | deg | partial (positional pair) |
| 19 | UgCS waypoint `point` block | `formats/ugcs.py:96-99` | named `latitude`/`longitude` in **radians** | float (Python repr) | rad, m AGL | YES (named keys + radian conversion via `_deg_to_rad`) |
| 20 | UgCS NFZ polygon points | `formats/ugcs.py:178-184` | named keys, radians | float | rad | YES |
| 21 | Litchi CSV `latitude,longitude` columns | `formats/litchi.py:272-273` | `lat, lon` | 8 dp / 8 dp / 2 dp agl | deg, m AGL | YES (header column ordering + dedicated `_dist_3d` collocation merge keeps coords) |
| 22 | Litchi POI columns `poi_latitude,poi_longitude` | `formats/litchi.py:283-284` | `lat, lon, agl-relative` | 8 dp / 8 dp / 2 dp | deg, m | YES |
| 23 | DroneDeploy `{lat, lng, alt}` | `formats/dronedeploy.py:30-33` | named keys (`lng`, not `lon`) | float | deg, m AGL | YES (named keys) |

All sites verified spec-correct for their target format. The single reversed
site (`wpml:waypointPoiPoint`) is paired with explicit per-write tests that
would fail if `lat`/`lon` were swapped.

---

## P0 — BLOCKER

None. The single high-risk site (POI reversal) is correctly implemented at
the write boundary and well-tested.

A4-P0-1 (KML `<Point><coordinates>` strips altitude) is already flagged by
A4 — cross-reference only. The dropped `alt` is a precision-loss / KML-
visual issue, not an ordering bug; the truth lives in `wpml:executeHeight` /
`wpml:height` / `wpml:ellipsoidHeight`. Pilot 2 / FH2 read the WPML side.

---

## P1 — HIGH

### C3-P1-1 — `wpml:waypointPoiPoint` precision is 6 dp; lat/lon ~11 cm at the equator, ~7 cm at 49°

**Location**: `dji/heading.py:174`

```python
_sub_text(heading_param, "waypointPoiPoint", f"{lat:.6f},{lon:.6f},0.000000")
```

6 decimal places gives ~11 cm resolution at the equator and tightens to
~7 cm at the LZIB latitude (49°). Compare to the KML `<Point><coordinates>`
which uses 8 dp at `placemark.py:184` (~1.1 mm at the equator).

For a typical PAPI inspection the LHA→camera bearing geometry is dominated
by the 50–200 m range, so the 11 cm rounding error contributes at most
~0.03° of pointing error at 200 m. Within tolerance for the 7× zoom field
of view. But:

1. It is **inconsistent** with the other dji-side coordinate sites — the
   Placemark `<Point>` uses 8 dp, the WP `executeHeight` uses 6 dp scalar,
   the takeoff ref point uses 6 dp. The mismatch is a code-smell that
   suggests an oversight rather than a calibrated choice.
2. A future tighter inspection method (close-range obstacle photometry,
   sub-50 m camera distance) could see the ±5.5 cm rounding inflate to a
   visible aim shift.
3. The pinning literal `0.000000` for alt is good (6 dp matches the spec
   sample), but the lat/lon could trivially go to 8 dp to match every
   other emission site without spec implication (the DJI spec gives no
   precision floor).

**Recommendation**: bump `{lat:.6f},{lon:.6f}` to `{lat:.8f},{lon:.8f}` for
consistency with the KML side. Tests pin `49.690000,18.120000,0.000000`;
adjust to `49.69000000,18.12000000,0.000000` (or use a regex match).

**Risk**: low. Cosmetic + future-proofing. No current bug. P1 because the
audit brief explicitly listed precision as a P1 candidate when it could
"meaningfully degrade navigation"; this site does not today but the
mismatch is the only outlier among the dji-side coordinate writers.

---

## P2 — Conformance

### C3-P2-1 — `wpml:takeOffRefPoint` lat/lon precision is 6 dp; consistent with POI but inconsistent with `<Point>` 8 dp

**Location**: `dji/mission_config.py:96, 102, 106`

```python
return f"{lat:.6f},{lon:.6f},{hae:.6f}"
```

Same as C3-P1-1: 6 dp lat/lon when the rest of the dji namespace uses 8 dp
for `<Point>`. The metadata role of `takeOffRefPoint` (route-planning anchor
that the firmware ignores at flight time) means rounding error is even less
consequential here, so this is P2 rather than P1.

**Recommendation**: bump to 8 dp alongside C3-P1-1 for consistency.

---

### C3-P2-2 — MAVLink positional list for `[lat, lon, alt]` and tab-separated row easy to swap silently

**Location**: `formats/mavlink.py:72, 101-108, 181`

The MAVLink WPL row writes `… {lat}\t{lon}\t{agl}` positionally:

```python
f"{lat}\t{lon}\t{agl}\t1"
```

And the `.plan` params list is also positional:

```python
params = [
    wp.hover_duration or 0,
    0,
    0,
    wp.heading or 0,
    lat,
    lon,
    agl,
]
```

A refactor that swaps the two adjacent locals would compile, run, pass
unit tests that only check structure, and fly the drone to the wrong place
on a positional protocol. The `plannedHomePosition` (line 181) is similar:
`return [lat, lon, airport_elevation]`.

Today's ordering is correct per QGC `.plan` v2 schema (`params[4]=lat`,
`params[5]=lon`, `params[6]=alt`). The risk is purely a future refactor.

**Recommendation**: extract a small helper like
`_mavlink_position_params(lat, lon, alt, hover, heading)` returning the
ordered list with a docstring naming each slot. Strong typing would help
more, but the cost is minimal and the assurance is high.

---

### C3-P2-3 — MAVLink geofence polygon ring reversal is positional and untested per-coord

**Location**: `formats/mavlink.py:211-213`

```python
def _mavlink_polygon_entry(ring: list, *, inclusion: bool) -> dict:
    coords = [[c[1], c[0]] for c in ring]
```

QGC expects `[lat, lon]` per vertex; the WKT-side ring is `[lon, lat, alt]`.
The swap is positional and silently wrong if a future change reorders the
GeoJSON-style ring tuple shape. No per-coordinate test pins the lat/lon
swap (only structural tests pin shape).

**Recommendation**: keep behavior; add a comment naming each axis or use
named indexing (`lon, lat = c[0], c[1]; coords.append([lat, lon])`).

---

## P3 — Upgrade

### C3-P3-1 — `waypointPoiPoint` literal `0.000000` alt is a write-site magic number

**Location**: `dji/heading.py:174`

The literal `0.000000` for the alt component is documented in the inline
comment (spec allows alt=0; pinning decouples POI alt from `camera_target.alt`
to avoid the below-takeoff POI launch bug). Consider extracting as a named
constant `_WPML_POI_ALT_LITERAL = "0.000000"` so the rationale (and the
exact precision) is one find-and-replace away from a future change.

---

### C3-P3-2 — `_iter_waypoints_agl` is the choke point; consider adding a `(lat, lon, alt, agl)` typed dataclass

**Location**: `shared.py:52-61`

```python
def _iter_waypoints_agl(flight_plan, airport_elevation: float):
    for wp in sorted(flight_plan.waypoints, key=_waypoint_sort_key):
        lon, lat, alt = point_lonlatalt(wp.position)
        yield wp, lon, lat, alt, alt - airport_elevation
```

Every byte-identical format generator (KML, CSV, GPX, JSON via UgCS, etc.)
consumes a 5-tuple unpacked positionally as `wp, lon, lat, alt, agl`. A
single typo in any consumer (`for wp, lat, lon, alt, agl in …`) would
silently swap every coord in that format.

A `WaypointCoords` namedtuple/dataclass would let consumers use named
attribute access (`row.lat`, `row.lon`) and make accidental swaps a static
error rather than a runtime fact.

---

### C3-P3-3 — No test pins the `lat,lon,alt` reversal at `takeOffRefPoint` for the **falls-back-to-first-waypoint** branch when lon < lat

**Location**: `dji/mission_config.py:96, 102, 106`

`test_take_off_ref_point_from_mission` pins `48.987654,17.123456` — lat
(48.x) > lon (17.x). `test_take_off_ref_point_falls_back_to_first_waypoint`
pins `49.690000,18.110000` — same property.

Both tests pin the lat > lon property (LZIB-region geography). A future
fixture for an airport in the Pacific (lat < lon, e.g. lat=-15.x lon=170.x)
would catch a swap that today's tests cannot. The current shape works
because the literal "lat,lon" comes first in the format string and the
function destructures `lon, lat, alt = point_lonlatalt(...)` correctly —
but the regression net is geographic-coincidence-bound.

**Recommendation**: add one test fixture with `(lat=-15.x, lon=170.x)` for
the takeOffRefPoint reversal pinning. Cheap insurance against a refactor
that subtly swaps the destructure target.

---

## Bug-hunt findings

Per the brief's "specific bug-hunt" checklist:

- **lat/lon swap in kwarg or positional arg order**: none found. Every
  call site routes lat/lon through `point_lonlatalt(wkt) -> (lon, lat, alt)`
  (return order: lon first). All consumers destructure as
  `lon, lat, alt = point_lonlatalt(...)` — no inversion seen.

- **POI reversal correctly at write site, not input**: confirmed.
  `dji/heading.py:165` reads `lon, lat, _ = point_lonlatalt(wp.camera_target)`
  (lon-first per the strict parser), then writes `f"{lat:.6f},{lon:.6f},0.000000"`
  at line 174 — reversal lives at the write site only. Same shape at
  `mission_config.py:94-106` for `takeOffRefPoint`.

- **lat=lon test fixture masking swaps?** No. Every test fixture in
  `test_export_service.py` uses `lat ≈ 49.69, lon ≈ 18.11` (LZIB) — a
  reversal would change the emitted string from `49.690000,18.120000` to
  `18.120000,49.690000` and the literal-match assertions would fail.
  Verified across:
    - `test_aimed_placemark_emits_towardPOI_with_poi_point` (POI)
    - `test_take_off_ref_point_from_mission` (takeoff ref, lat=48.x lon=17.x)
    - `test_take_off_ref_point_falls_back_to_first_waypoint`
    - `test_waypoint_poi_point_alt_pinned_below_takeoff_target`

- **`_takeoff_ref_msl` and per-WP altitude lat/lon arg order**: verified.
  Both functions destructure `lon, lat, alt = point_lonlatalt(...)` and pass
  `(lat, lon, alt)` to `msl_to_hae(lat, lon, alt)` — confirmed `msl_to_hae`
  in `app.utils.geo` accepts `(lat, lon, alt)` positionally. Cross-checked
  every call site (`mission_config.py:95, 101, 105`; `placemark.py:201`).
  No inversion.

- **Sign convention**: trusted to `point_lonlatalt` and `wkt_to_geojson`,
  which return signed floats as-is from the WKT. South latitude → negative
  float passes through. West longitude → negative float passes through.
  No site re-applies `abs(...)` or sign-strips. Verified by reading every
  consumer in the export package.

- **Units**: degrees everywhere except UgCS (radians via `_deg_to_rad`).
  Altitudes are metres everywhere — m MSL in some sites (GPX `<ele>`, JSON
  `altitude_msl`, MAVLink plannedHomePosition), m AGL in others (KML
  `relativetoground`, MAVLink WPL `agl`, Litchi `altitude(m)`, UgCS
  `altitudeType=AGL`, DroneDeploy `alt`). The MSL/AGL split is documented
  per format and matches each format's spec. No feet, no nautical miles.

- **`agl = alt - airport_elevation` semantic**: `airport_elevation` is the
  airfield-published MSL (a single scalar). For airports with terrain
  variation this under-resolves real AGL, but the per-WP `wp.agl` /
  `wp.camera_target_agl` columns (persisted via `_compute_waypoint_agl_values`)
  carry the per-point ground delta now. The export formats that consume
  `agl = alt - airport_elevation` (every byte-identical format via
  `_iter_waypoints_agl`) are using the legacy uniform-airfield approximation,
  not the per-point persisted column. Out of scope for C3 (this is a
  semantic precision issue, not a coordinate ordering one), but worth a
  follow-up note for B2's altitude review.

---

## Verdict

The coordinate plumbing is solid. The single launch-blocker class
(POI lat,lon reversal) is implemented at the write site as required by
the May-11 audit, with explicit literal-match tests using `lat=49.x ≠ lon=18.x`
fixtures that would fail on a swap. No P0 issues.

The one P1 (POI precision mismatch with the rest of the dji namespace) is
a code-consistency issue, not a navigation defect. The three P2s are
defensive recommendations around MAVLink positional list shapes and
takeoff-ref precision consistency. The P3s are upgrade ideas — named
constant for the POI alt literal, a typed `WaypointCoords` dataclass to
eliminate the unpacking-typo class entirely, and a southern-hemisphere
fixture.

The reversal at `waypointPoiPoint` is correct, intentional, single-site,
and explicitly documented. Do not unify per the May-11 audit's standing
instruction.
