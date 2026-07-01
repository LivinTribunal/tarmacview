---
name: postflight-analysis
description: Analyse a real DJI test flight against what TarmacView planned - extract per-frame telemetry (rtk gps + gimbal) from DJI videos, pull the dispatched wayline KMZ from object storage, reconstruct where the camera actually aimed, and compare flown vs planned. Use when the user shares test-flight media (DJI .MP4 / photos / KMZ) or asks to investigate a flight: "analyze the test flight", "why did the camera point off / shift right", "pull the telemetry", "what did the drone actually fly", "compare planned vs flown", "which KMZ did the field hub send", "why did it climb too high", or any post-flight / sent-to-drone debugging.
---

# postflight-analysis

Turn a DJI test flight into reproducible evidence. The drone leaves three kinds
of artifact behind - extract all of them and reconcile against the database.

The toolkit lives in `scripts/postflight/` (run `analyze-flight.py` to capture
everything at once; see its `README.md`). This skill is the runbook + the domain
facts you need to interpret the output correctly.

## the three artifacts

1. **DJI video telemetry.** M4-era footage embeds per-frame rtk gps + gimbal
   yaw/pitch in a `mov_text` subtitle stream *inside the mp4* (no `.srt`
   sidecar). `dji-telemetry.py` demuxes it. This is the flown ground truth.
2. **DJI photo XMP.** Position, gimbal, and rtk quality live in the `drone-dji`
   XMP packet, not EXIF. `dji-photo-metadata.py` scrapes it - use a reference
   photo (e.g. shot beside the PAPI) to anchor the target point.
3. **The KMZ.** What was planned. For a download it is in `~/Downloads`; for a
   sent-to-drone flight the exact dispatched file is in object storage keyed by
   wayline id - `pull-wayline-kmz.py`. `inspect-kmz.py` summarises altitude
   encoding + heading mode.

## standard workflow

```bash
# 1. capture everything the flight produced
python scripts/postflight/analyze-flight.py <media-dir> --target <LAT,LON> -o out/

# 2. ground truth for a sent-to-drone flight: the actually-dispatched KMZ
docker exec tarmacview-db psql -U tarmacview -d tarmacview -At -c \
  "select mission_id, wayline_id, dispatched_at from wayline_dispatch order by dispatched_at;"
docker exec -i tarmacview-worker python3 - <WAYLINE_ID> --endpoint http://minio:9000 \
    -o /tmp/pulled < scripts/postflight/pull-wayline-kmz.py

# 3. planned trajectory from the db (positions, camera_target, gimbal_pitch)
docker exec tarmacview-db psql -U tarmacview -d tarmacview -c \
  "select w.sequence_order, i.method, w.waypoint_type, w.position, w.camera_target, w.gimbal_pitch \
   from waypoint w join flight_plan fp on fp.id=w.flight_plan_id \
   left join inspection i on i.id=w.inspection_id where fp.mission_id='<MISSION_ID>' \
   order by w.sequence_order;"
```

The target point for `camera-aim.py` is the inspection's `camera_target` (the
LHA centroid). Get it from the waypoints above, or compute it as the centroid of
the selected LHA `position`s.

## domain facts you must apply

- **DJI `abs_alt` (and photo `AbsoluteAltitude`) is ELLIPSOIDAL (HAE).**
  TarmacView altitudes (`airport.elevation`, waypoint `alt`) are orthometric
  **MSL**. They differ by the geoid undulation (~+44 m in Slovakia). A ~43-45 m
  gap between DJI absolute altitude and a TarmacView MSL value is the geoid, not
  a bug. The camera-aim *lateral* error is datum-robust; the convergence `Up` is
  not (omit `--target-alt` to auto-estimate ground from the telemetry).

- **Correct execution encoding is `executeHeightMode=relativeToStartPoint`**
  (geoid-free, height above takeoff). If `inspect-kmz.py` reports `WGS84` or
  `EGM96`, it is a **legacy export**, not what the current engine produces -
  likely a stale file grabbed from `~/Downloads`. Download and sent-to-drone
  share one export engine, so a dispatched KMZ is byte-for-byte a download.

- **Camera aim is body-follow yaw.** The gimbal yaw follows the aircraft body
  (`gimbalYawRotateEnable=0`). A stationary pass (vertical profile) aims
  accurately; a translating arc (horizontal range) makes the body yaw
  continuously, and the gimbal-follow loop lags it by a near-constant ~1°, which
  is a few meters of lateral (cross-track) miss at inspection range. A constant
  yaw residual that does *not* grow across the pass is this follow-lag, not a
  trajectory error - the planned `camera_target` and the KMZ POI can both be
  correct while the executed aim is off.

- **`globalRTHHeight` is floored at 100 m** (`_MIN_RTH_HEIGHT_M`). If the
  aircraft's Max Flight Altitude is at/below that, the M4T rejects the wayline
  with an altitude-limit error (e.g. 513). This is config-meets-export, not a
  bad file.

## interpreting results

- Camera "shifted right/left" but `camera_target` and KMZ POI are correct →
  body-follow yaw lag on a translating pass; lever is arc speed (lower yaw rate)
  or a heading pre-bias. Not a trajectory bug; measurement validity is intact
  (the engine measures from position + light colour, not framing).
- Drone "flew the wrong altitude" → `inspect-kmz.py` the *dispatched* file. If
  `relativeToStartPoint` with sane executeHeight, the file is fine and the cause
  is execution-path (mid-air start reference, RTH climb, or a stale file was
  loaded). If `WGS84`/`EGM96`, a legacy export was flown.
- "Mission won't start" with an altitude/limit error → check `globalRTHHeight`
  vs the aircraft Max Flight Altitude setting.

Verify every claim against the artifact (telemetry numbers, the pulled KMZ, the
db rows). Don't infer a flown file from a filename - pull it.
