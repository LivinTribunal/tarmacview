# post-flight analysis toolkit

Reconstruct what a DJI drone actually did on a test flight, from the artifacts
it leaves behind, and compare it against what TarmacView planned. Built after
the first real PAPI test flights to make those flights reproducible evidence
instead of one-off shell commands.

Everything here is pure stdlib + `ffmpeg` (already a dependency for the video
engine); only `pull-wayline-kmz.py` needs `boto3`, and it can run inside the
worker container which already has it.

## what each script does

| script | input | output |
|---|---|---|
| `dji-telemetry.py` | DJI video (`.mp4`) or `.srt` | per-frame `*.telemetry.csv` + `*.telemetry.json` summary (rtk gps + gimbal yaw/pitch) |
| `dji-photo-metadata.py` | DJI photo | `drone-dji` XMP fields (gps, gimbal, rtk quality) as json |
| `inspect-kmz.py` | `.kmz` / `.wpml` | altitude encoding summary: `executeHeightMode`, executeHeight range, `globalRTHHeight`, heading modes, POI |
| `camera-aim.py` | telemetry + a target point | cross-track aim error (gimbal-yaw-vs-bearing residual) + ray-convergence point |
| `pull-wayline-kmz.py` | wayline id | the exact dispatched KMZ from object storage (the only ground truth for a sent-to-drone flight) |
| `analyze-flight.py` | a folder of media + KMZs | runs all of the above, saves a `manifest.json` + per-file artifacts |

## quick start

```bash
# capture an entire flight folder in one shot (videos + photos + KMZs)
python scripts/postflight/analyze-flight.py ~/Downloads/flight-2026-06-30 \
    --target 48.123162,17.1386555 -o postflight-out/

# or step by step:
python scripts/postflight/dji-telemetry.py FLIGHT.MP4 -o out/
python scripts/postflight/camera-aim.py out/FLIGHT.telemetry.csv --target 48.123162,17.1386555
python scripts/postflight/inspect-kmz.py ~/Downloads/*.kmz
python scripts/postflight/dji-photo-metadata.py REF.jpeg
```

## reading the camera-aim output

`--target` is the point the inspection was meant to frame - the LHA centroid
(`camera_target` on the waypoints), i.e. the PAPI position. The headline metric
is **lateral aim error**: positive means the camera pointed to the *right* of
the target. It is derived from the gimbal-yaw-minus-true-bearing residual and is
**datum-robust** (horizontal geometry only).

The ray-convergence `Up` component is *not* datum-robust: DJI `abs_alt` is
**ellipsoidal (HAE)**, while a TarmacView target altitude is **orthometric
(MSL)** - they differ by the geoid undulation (~+44 m in Slovakia). So either
omit `--target-alt` (it auto-estimates ground from the telemetry, self-consistent
with `abs_alt`), or pass a target altitude in the same ellipsoidal frame. The
lateral error and horizontal convergence offset are unaffected either way.

## finding the dispatched wayline (sent-to-drone flights)

`pull-wayline-kmz.py` needs the wayline id. Get it from the dispatch table:

```bash
docker exec tarmacview-db psql -U tarmacview -d tarmacview -At -c \
  "select mission_id, wayline_id, dispatched_at from wayline_dispatch order by dispatched_at;"
```

Then pull and inspect:

```bash
docker exec -i tarmacview-worker python3 - <WAYLINE_ID> --endpoint http://minio:9000 \
    -o /tmp/pulled < scripts/postflight/pull-wayline-kmz.py
docker exec tarmacview-worker sh -lc 'cat /tmp/pulled/<WAYLINE_ID>.kmz' > pulled.kmz
python scripts/postflight/inspect-kmz.py pulled.kmz
```

## altitude encoding note

A correct current-code KMZ uses `executeHeightMode=relativeToStartPoint`
(geoid-free, height above the takeoff point). `WGS84` or `EGM96` modes are the
legacy absolute schemes - if `inspect-kmz.py` reports either, the file is an old
export, not something the current engine produces.
