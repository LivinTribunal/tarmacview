"""_postflight.py - shared helpers for the post-flight analysis toolkit.

pure-stdlib reconstruction of what a DJI drone actually did on a test flight,
from the artifacts it leaves behind: the per-frame telemetry embedded in DJI
video (RTK gps + gimbal yaw/pitch), the XMP packet in a DJI photo, and the
WPML inside an exported / dispatched KMZ.

no third-party deps for parsing or geometry (ffmpeg is shelled out to demux
the video subtitle track; boto3 is only needed by the wayline puller and is
imported lazily there). every CLI script in this folder is a thin wrapper
around these functions.
"""

import json
import math
import re
import subprocess
import zipfile

# meters per degree of latitude (wgs84 mean); longitude scales by cos(lat)
_M_PER_DEG = 111_320.0


# ------------------------------------------------------------------ telemetry

# matches one DJI M4-era subtitle block: the bracketed inline telemetry the
# matrice 4t writes per frame (no .srt sidecar - it lives in the mp4).
_SRT_BLOCK_RE = re.compile(r"FrameCnt:.*?gb_roll: [-\d.]+\]", re.S)


def _f(pattern: str, block: str):
    """pull the first float captured by `pattern` from `block`, or None."""
    m = re.search(pattern, block)
    return float(m.group(1)) if m else None


def parse_dji_srt(text: str) -> list[dict]:
    """parse DJI per-frame telemetry text into a list of row dicts.

    handles the matrice 4-era inline format
    `[latitude: ..] [longitude: ..] [rel_alt: .. abs_alt: ..]
     [gb_yaw: .. gb_pitch: .. gb_roll: ..]`. rows missing a required field
    are skipped so a truncated capture still parses.
    """
    rows = []
    for blk in _SRT_BLOCK_RE.findall(text):
        frame = _f(r"FrameCnt: (\d+)", blk)
        row = {
            "frame": int(frame) if frame is not None else None,
            "lat": _f(r"latitude: ([-\d.]+)", blk),
            "lon": _f(r"longitude: ([-\d.]+)", blk),
            "rel_alt": _f(r"rel_alt: ([-\d.]+)", blk),
            "abs_alt": _f(r"abs_alt: ([-\d.]+)", blk),
            "gb_yaw": _f(r"gb_yaw: ([-\d.]+)", blk),
            "gb_pitch": _f(r"gb_pitch: ([-\d.]+)", blk),
            "gb_roll": _f(r"gb_roll: ([-\d.]+)", blk),
            "focal_len": _f(r"focal_len: ([-\d.]+)", blk),
        }
        if None in (
            row["lat"],
            row["lon"],
            row["abs_alt"],
            row["gb_yaw"],
            row["gb_pitch"],
        ):
            continue
        rows.append(row)
    return rows


def extract_subtitle_text(video_path: str) -> str:
    """demux the embedded subtitle (telemetry) track of a DJI video via ffmpeg.

    DJI M4-era footage carries no .srt sidecar - the per-frame telemetry rides
    in a mov_text subtitle stream inside the mp4. returns the srt text.
    """
    proc = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-v",
            "error",
            "-i",
            video_path,
            "-map",
            "0:s:0",
            "-f",
            "srt",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout


def telemetry_rows(path: str) -> tuple[list[dict], str]:
    """load telemetry rows from a DJI video (.mp4/.mov) or a .srt sidecar.

    returns (rows, source-label). raises if a video carries no subtitle track.
    """
    low = path.lower()
    if low.endswith((".srt", ".txt")):
        with open(path, encoding="utf-8", errors="replace") as fh:
            return parse_dji_srt(fh.read()), "srt-sidecar"
    text = extract_subtitle_text(path)
    rows = parse_dji_srt(text)
    if not rows:
        raise ValueError(f"no DJI telemetry subtitle found in {path}")
    return rows, "embedded-subtitle"


def telemetry_summary(rows: list[dict]) -> dict:
    """compact start/end/range summary of a telemetry row list."""
    if not rows:
        return {"frames": 0}
    first, last = rows[0], rows[-1]
    abs_alts = [r["abs_alt"] for r in rows]
    rel_alts = [r["rel_alt"] for r in rows if r["rel_alt"] is not None]
    yaws = [r["gb_yaw"] for r in rows]
    pitches = [r["gb_pitch"] for r in rows]
    return {
        "frames": len(rows),
        "start": {
            "lat": first["lat"],
            "lon": first["lon"],
            "abs_alt": first["abs_alt"],
        },
        "end": {"lat": last["lat"], "lon": last["lon"], "abs_alt": last["abs_alt"]},
        "abs_alt_range": [min(abs_alts), max(abs_alts)],
        "rel_alt_range": [min(rel_alts), max(rel_alts)] if rel_alts else None,
        "gimbal_yaw_range": [min(yaws), max(yaws)],
        "gimbal_pitch_range": [min(pitches), max(pitches)],
        "focal_len": first.get("focal_len"),
    }


# ------------------------------------------------------------------- geometry


def enu(lat, lon, alt, lat0, lon0, alt0):
    """equirectangular local east/north/up (meters) of a point vs an origin."""
    m_lon = _M_PER_DEG * math.cos(math.radians(lat0))
    return ((lon - lon0) * m_lon, (lat - lat0) * _M_PER_DEG, alt - alt0)


def ray_direction(yaw_deg, pitch_deg):
    """unit east/north/up vector of a camera ray from compass yaw + pitch.

    yaw is a compass bearing (north=0, east=90); pitch is negative looking down.
    """
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    cp = math.cos(p)
    return (cp * math.sin(y), cp * math.cos(y), math.sin(p))


def bearing_to(lat, lon, tlat, tlon):
    """initial compass bearing (deg, 0..360) from (lat,lon) toward a target."""
    dlon = math.radians(tlon - lon)
    y = math.sin(dlon) * math.cos(math.radians(tlat))
    x = math.cos(math.radians(lat)) * math.sin(math.radians(tlat)) - math.sin(
        math.radians(lat)
    ) * math.cos(math.radians(tlat)) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def norm180(angle):
    """wrap an angle to (-180, 180]."""
    return (angle + 180) % 360 - 180


def _solve3(a, b):
    """solve the 3x3 system a x = b by gaussian elimination (numpy-free)."""
    m = [a[i][:] + [b[i]] for i in range(3)]
    for c in range(3):
        piv = max(range(c, 3), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        pv = m[c][c]
        m[c] = [v / pv for v in m[c]]
        for r in range(3):
            if r != c:
                f = m[r][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return (m[0][3], m[1][3], m[2][3])


def ray_convergence(rows, origin):
    """least-squares 3d point closest to every camera ray (in enu vs origin).

    each frame contributes a ray (camera position, look direction). the point
    minimising the summed squared perpendicular distance to all rays is where
    the camera was actually pointing - the executed point-of-interest. robust
    when the platform translates (horizontal-range arc), ill-conditioned when
    it does not (vertical-profile climb), so read the result with that caveat.
    """
    lat0, lon0, alt0 = origin
    acc = [[0.0] * 3 for _ in range(3)]
    rhs = [0.0] * 3
    for r in rows:
        p = enu(r["lat"], r["lon"], r["abs_alt"], lat0, lon0, alt0)
        d = ray_direction(r["gb_yaw"], r["gb_pitch"])
        for i in range(3):
            for j in range(3):
                w = (1.0 if i == j else 0.0) - d[i] * d[j]
                acc[i][j] += w
                rhs[i] += w * p[j]
    return _solve3(acc, rhs)


def camera_aim_report(rows, target_lat, target_lon, target_alt=None):
    """quantify where the camera aimed vs an intended target point.

    returns gimbal-yaw-minus-true-bearing residual stats (the cross-track
    aiming error: positive = camera points right of the target), the
    ray-convergence point in enu relative to the target, and the median
    horizontal range. target_alt defaults to the median abs_alt minus the
    median relative alt (a ground estimate) when omitted.
    """
    if target_alt is None:
        rel = [r["rel_alt"] for r in rows if r["rel_alt"] is not None]
        abs_ = sorted(r["abs_alt"] for r in rows)
        med_abs = abs_[len(abs_) // 2]
        med_rel = sorted(rel)[len(rel) // 2] if rel else 0.0
        target_alt = med_abs - med_rel

    residuals, ranges = [], []
    for r in rows:
        b = bearing_to(r["lat"], r["lon"], target_lat, target_lon)
        residuals.append(norm180(r["gb_yaw"] - b))
        e, n, _ = enu(
            r["lat"], r["lon"], r["abs_alt"], target_lat, target_lon, target_alt
        )
        ranges.append(math.hypot(e, n))
    residuals.sort()
    ranges.sort()
    n = len(residuals)
    med_res = residuals[n // 2]
    med_rng = ranges[n // 2]
    conv = ray_convergence(rows, (target_lat, target_lon, target_alt))
    return {
        "frames": n,
        "target": {"lat": target_lat, "lon": target_lon, "alt": target_alt},
        "yaw_residual_deg": {
            "mean": sum(residuals) / n,
            "median": med_res,
            "p10": residuals[n // 10],
            "p90": residuals[9 * n // 10],
        },
        "median_horizontal_range_m": med_rng,
        "lateral_aim_error_m": math.radians(med_res) * med_rng,
        "lateral_aim_error_note": "positive = camera aimed to the right of target",
        "ray_convergence_enu_m": {"east": conv[0], "north": conv[1], "up": conv[2]},
        "ray_convergence_horiz_offset_m": math.hypot(conv[0], conv[1]),
    }


# ------------------------------------------------------------------ dji photo

_XMP_RE = re.compile(rb"<x:xmpmeta.*?</x:xmpmeta>", re.S)


def extract_photo_xmp(path: str) -> dict:
    """extract DJI drone-dji XMP fields (gps + gimbal + rtk) from a photo.

    DJI keeps the high-precision position, gimbal angles, and rtk quality in
    the XMP packet, not in EXIF, so a stdlib XMP scrape beats EXIF here. flat
    dict of every `drone-dji:*` attribute, with the gps/altitude/gimbal values
    coerced to float when present.
    """
    with open(path, "rb") as fh:
        data = fh.read()
    m = _XMP_RE.search(data)
    if not m:
        return {}
    xmp = m.group(0).decode("utf-8", "replace")
    out = {}
    for key, val in re.findall(r'drone-dji:(\w+)="([^"]*)"', xmp):
        out[key] = val
    for key, val in re.findall(r"<drone-dji:(\w+)>([^<]*)</", xmp):
        out[key] = val
    numeric = (
        "GpsLatitude",
        "GpsLongitude",
        "AbsoluteAltitude",
        "RelativeAltitude",
        "GimbalYawDegree",
        "GimbalPitchDegree",
        "GimbalRollDegree",
        "FlightYawDegree",
        "FlightPitchDegree",
        "FlightRollDegree",
    )
    for key in numeric:
        if key in out:
            try:
                out[key] = float(out[key])
            except ValueError:
                pass
    return out


# ------------------------------------------------------------------- wpml/kmz


def _wpml_text(path: str) -> str:
    """read the waylines.wpml text from a .kmz archive or a raw .wpml/.kml."""
    if path.lower().endswith(".kmz"):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.endswith("waylines.wpml")]
            if not names:
                names = [
                    n for n in z.namelist() if n.endswith(".wpml") or n.endswith(".kml")
                ]
            return z.read(names[0]).decode("utf-8", "replace")
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def _tag(name: str, text: str) -> list[str]:
    """all values of a `<wpml:name>...</wpml:name>` element in `text`."""
    return re.findall(r"<wpml:%s>([^<]*)</wpml:%s>" % (name, name), text)


def summarize_wpml(path: str) -> dict:
    """summarise the altitude encoding + mission config of a KMZ/WPML.

    the altitude story lives here: executeHeightMode (one of relativeToStartPoint
    / WGS84 / EGM96), the per-waypoint executeHeight range, globalRTHHeight, the
    takeoff security height, and the per-waypoint heading modes + POI points.
    """
    x = _wpml_text(path)
    eh = [float(v) for v in _tag("executeHeight", x)]
    return {
        "file": path,
        "executeHeightMode": sorted(set(_tag("executeHeightMode", x))),
        "coordinateMode": sorted(set(_tag("coordinateMode", x))),
        "executeHeight_count": len(eh),
        "executeHeight_range_m": [min(eh), max(eh)] if eh else None,
        "globalRTHHeight": _tag("globalRTHHeight", x),
        "takeOffSecurityHeight": _tag("takeOffSecurityHeight", x),
        "flyToWaylineMode": _tag("flyToWaylineMode", x),
        "finishAction": _tag("finishAction", x),
        "autoFlightSpeed": _tag("autoFlightSpeed", x),
        "globalTransitionalSpeed": _tag("globalTransitionalSpeed", x),
        "headingModes": sorted(set(_tag("waypointHeadingMode", x))),
        "poiPoints": sorted(set(_tag("waypointPoiPoint", x))),
    }


# ------------------------------------------------------------------ io helper


def write_json(path: str, obj) -> None:
    """dump `obj` to `path` as pretty json."""
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, default=float)


def write_telemetry_csv(path: str, rows: list[dict]) -> None:
    """write telemetry rows to csv (stable column order)."""
    import csv

    cols = [
        "frame",
        "lat",
        "lon",
        "rel_alt",
        "abs_alt",
        "gb_yaw",
        "gb_pitch",
        "gb_roll",
        "focal_len",
    ]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c) for c in cols})
