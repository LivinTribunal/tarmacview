# REL measurement integration - porting spec

Goal: give the video-measurement pipeline a real **runway-edge-light (REL)** path, so an
operator can measure flown REL footage the same way they measure PAPI footage today. The
reference implementation is the vendored experiment `analyze_runway_lights.py` (see
`VENDORED.md`); this spec maps it onto the wired engine and slices the work.

This is a backend-only spec. Frontend rendering of REL results (charts, sections) is a
follow-on once the results payload exists, and rides on the results-page work separately.

## Why REL is not just a flag on the PAPI engine

The wired engine (`backend/app/services/video_processing/`) is PAPI-only and the
measurement runners never branch on inspection type - `measurement_service.run_processing`
unconditionally runs the two-pass PAPI engine and reads `papi_*` keys. A REL measurement
today is a legal plan (the method/AGL compatibility table allows `FLY_OVER` and
`PARALLEL_SIDE_SWEEP` against `RUNWAY_EDGE_LIGHTS`) that, when measured, silently runs the
wrong algorithm. The two paths differ on every axis:

| Axis | PAPI engine (wired) | REL experiment (reference) |
|------|---------------------|----------------------------|
| Light identity | fixed 4: `PAPI_A..D` (`backend/app/domain/measurement/entities.py::PAPI_LIGHT_NAMES`) | arbitrary N, auto-tracked, ordered by first-seen frame |
| Core measurement | red/white **transition angle**, glide-path angle | **beam intensity / colour / shape** vs distance + angle |
| Pass/fail basis | measured angle vs `setting_angle +/- tolerance` | relative z-scores + a 0-100 health score (no absolute spec) |
| Per-frame GPS | `extract_gps_data` (DJI `.SRT` sidecar or demuxed embedded telemetry) | `exiftool -ee` shelled out |
| Output | gzipped per-frame blob -> `MeasurementResultsResponse` (`build_results_data`) | interactive HTML report + annotated mp4 |
| Integration | `measurement_service` runners + Celery + object storage | `__main__` script, file caches next to the script |

## What the experiment computes (reference data flow)

`analyze_runway_lights.py::process_video` is the orchestration. The shape worth porting:

1. **Telemetry** - `extract_gps_from_video` (exiftool) -> `GPSFrame` per frame (lat, lon,
   `rel_alt`, `abs_alt`, gimbal yaw/pitch/roll, exposure fields). `deduplicate_gps` +
   `interpolate_gps` give a position at any frame. **Port note: replace exiftool with the
   engine's existing `extract_gps_data`** - do not add an exiftool dependency.
2. **Detection** - `detect_lights_in_frame` downsamples, thresholds to a bright mask,
   finds contours, filters by area / circularity / horizontal margin, and per blob records
   centroid, max brightness, mean RGB, total intensity, circularity, bright-core / halo
   areas, edge sharpness (`LightDetection`). Returns the 10 brightest per frame.
3. **Tracking** - `track_lights` greedy nearest-neighbour links detections across frames
   into `LightTrack`s (gap <= `TRACKING_MAX_GAP`, step <= `TRACKING_MAX_DIST_PX`), keeping
   tracks with >= `MIN_TRACK_FRAMES` frames.
4. **Geometry** - per track, an intensity-weighted frame picks the track's GPS-estimated
   ground position (`est_lat/est_lon`); per detection it derives ground distance
   (`haversine_distance`), signed along-track distance (`signed_distance_along_track`,
   relative to the flight bearing), and viewing angles (`v_ang` elevation,
   `h_ang` along-track) from the drone's `rel_alt`. Assembled into a per-track `chart_data`
   dict of parallel arrays (distances, signed_distances, intensities, r/g/b, areas,
   circularities, halo, edge, h_angles, v_angles, ...).
5. **Metrics** - `compute_advanced_metrics` adds 30+ scalars per track: intensity at
   reference distances (5/10/15/20 m), intensity integral, FWHM, beam elevation angle,
   rise/fall rate, beam asymmetry, Gaussian beam fit, CIE chromaticity + CCT, colour
   ratios / consistency, temporal jitter, centroid jitter, circularity / halo ratio /
   edge sharpness, inter-light spacing + alignment deviation, neighbour-relative
   intensity, per-metric z-scores, and a weighted **health_score** (0-100). It also
   surfaces `missing_lights` (gaps in the row) and `median_spacing`.

## Target seams in the wired engine

- **Dispatch:** `measurement_service.run_first_frame` and `run_processing` are the only
  branch points. The inspection method and its target AGL type are reachable from the
  measurement's inspection (the run already snapshots the inspection + its target LHAs into
  reference points at `create_measurement`). REL = target AGL type `RUNWAY_EDGE_LIGHTS`
  (equivalently method in `{FLY_OVER, PARALLEL_SIDE_SWEEP}` per
  `backend/app/core/enums.py::METHOD_AGL_COMPAT`). PAPI stays the default.
- **Engine home:** new REL modules live beside the PAPI engine under
  `backend/app/services/video_processing/` and are **lazy-imported** through the same
  `measurement_service` seams (the service must stay numpy/cv2-import-free at module top -
  `app.main` boots on `requirements.txt` alone).
- **Reuse, do not re-import:** GPS extraction (`extract_gps_data`), object-storage
  transfer (input video pull, annotated-video / results-blob upload), the gzipped-blob +
  `_json_default` numpy coercion pattern, and the per-light PASS/FAIL rollup shape.
- **Identity from ground truth:** unlike the experiment (which labels tracks `Light 1..N`
  by first frame), the wired path has the planned **LHA reference points** (position,
  `sequence_number`, parent runway heading) on the measurement. Match each detected track
  to its nearest reference LHA by `est_lat/est_lon`, so each measured light is identified
  by its planned LHA / sequence rather than an arbitrary index. `missing_lights` then maps
  to planned LHAs with no matched track.

## Proposed REL result schema (sketch, not final)

The current `MeasurementResultsResponse` (`backend/app/schemas/measurement.py`) is
PAPI-shaped: `LightSeries` / `LightSummary` carry `setting_angle` + `tolerance` and key on
`PAPI_A..D`. REL needs its own shape. Two options - pick during slice 1:

- **(A) Discriminated kind on the existing response** - add `measurement_kind: "PAPI" |
  "REL"` and an optional `rel: RelResults | None`, leaving the PAPI fields untouched. The
  results read path branches on `measurement_kind`.
- **(B) Separate `RelMeasurementResultsResponse`** returned from a parallel
  `build_rel_results_data`, with its own route shape.

Sketch of the REL payload either way:

```
RelLightResult:
  lha_id, sequence_number, label          # identity from matched reference LHA
  est_lat, est_lon                         # GPS-estimated ground position
  num_frames, first_frame, last_frame
  series: { distances[], signed_distances[], intensities[], r[], g[], b[],
            h_angles[], v_angles[], areas[], circularities[], halo_areas[],
            edge_sharpnesses[] }           # per-frame arrays (gzipped blob, like PAPI)
  metrics: { ref_intensities{5,10,15,20}, intensity_integral, fwhm,
             beam_elevation_angle, rise_rate, fall_rate, asymmetry_index,
             gaussian_sigma, cie_x, cie_y, cct, r_ratio, g_ratio, b_ratio,
             intensity_cv, centroid_jitter, mean_circularity, halo_ratio,
             mean_edge_sharpness, spacing_to_prev, alignment_deviation_m,
             neighbor_relative_intensity, health_score }
  passed: bool | null                      # see open question on pass/fail semantics

RelMeasurementResults:
  lights: RelLightResult[]
  median_spacing, missing_lights[]         # row-level rollups
  pass_count, fail_count
```

## Staged slices (one issue each)

### Slice 1 - REL result schema + dispatch seam (correctness net)
- Add the REL result schema (option A or B above).
- Branch `run_first_frame` / `run_processing` on REL vs PAPI (target AGL type /
  inspection method). The REL branch may initially raise a clean `DomainError` ->
  `ERROR` ("REL measurement not yet implemented") so REL footage **stops silently running
  the PAPI pipeline** - this is the immediate correctness win even before the algorithm
  lands.
- Tests: a REL inspection measurement routes to the REL branch (fails cleanly, never
  produces garbage PAPI numbers); PAPI measurements are byte-for-byte unaffected.
- Touches `measurement_service` + `schemas/measurement.py` (no engine algorithm yet).

### Slice 2 - REL detection + tracking + geometry
- Port `detect_lights_in_frame` and `track_lights` into REL engine modules under
  `backend/app/services/video_processing/`, reusing the engine's `extract_gps_data` (no
  exiftool).
- Match tracks to planned LHA reference points by position; emit the per-light per-frame
  series into the gzipped blob (mirror the PAPI blob + numpy-coercion contract).
- Wire the REL `run_processing` branch to produce `lights[].series` (metrics still empty).
- Tests against a small fixture: N planted blobs -> N tracks -> N matched LHAs.

### Slice 3 - REL metrics + rollup + report
- Port `compute_advanced_metrics` (30+ metrics + health score, `missing_lights`,
  `median_spacing`).
- Build the REL results pivot (`build_rel_results_data`) and the per-light PASS/FAIL
  rollup; optional REL section in the mission-report PDF.
- Frontend REL result rendering is a separate follow-on (rides the results page work).

## Open questions to settle before / during slice 1

1. **Pass/fail semantics.** The experiment's health score is purely *relative* (z-scores
   across lights in the same video) - there is no absolute spec like PAPI's
   `setting_angle +/- tolerance`. What makes a REL light FAIL? A health-score threshold? A
   missing/dark light? Per-metric tolerances? This is a product decision, not a code one.
2. **GPS source.** Confirm the engine's `extract_gps_data` exposes everything REL geometry
   needs (`rel_alt` for viewing angle, gimbal angles) - the experiment relied on exiftool's
   full field set.
3. **FLY_OVER vs PARALLEL_SIDE_SWEEP.** Do both REL methods share one analysis path, or
   does the lateral-offset sweep need different geometry?
4. **Threshold tuning.** The experiment's detection constants (`BRIGHTNESS_THRESHOLD`,
   `MIN/MAX_CONTOUR_AREA`, tracking gaps) are tuned to one specific video and will need to
   become config / re-tuned against real REL footage.
