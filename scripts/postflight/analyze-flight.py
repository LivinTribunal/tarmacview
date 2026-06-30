#!/usr/bin/env python3
"""analyze-flight.py - one-shot post-flight capture of a test flight.

points at a folder of test-flight artifacts (DJI videos, reference photos,
exported / dispatched KMZs) and saves everything we need to reason about the
flight later: per-video telemetry csv + summary, photo metadata, KMZ altitude
summaries, and - when a target point is given - the camera-aim report per
video. writes one manifest.json tying it together.

run this once after a flight so the analysis survives even after the media is
archived off the laptop.

Usage:
    python scripts/postflight/analyze-flight.py ~/Downloads/flight-2026-06-30 -o out/
    python scripts/postflight/analyze-flight.py FLIGHT.MP4 REF.jpeg mission.kmz \
        --target 48.123162,17.1386555 --target-alt 134 -o out/
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _postflight as pf  # noqa: E402

_VIDEO = (".mp4", ".mov")
_PHOTO = (".jpg", ".jpeg")
_WAYLINE = (".kmz", ".wpml")


def _gather(paths: list[str]) -> list[str]:
    """expand directories into their contained files, keep plain files."""
    out = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                out.append(os.path.join(p, name))
        else:
            out.append(p)
    return out


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(description="capture a full post-flight artifact set")
    ap.add_argument(
        "inputs", nargs="+", help="files and/or a directory of flight artifacts"
    )
    ap.add_argument("--target", help="camera target as LAT,LON (enables aim analysis)")
    ap.add_argument(
        "--target-alt", type=float, default=None, help="target MSL altitude"
    )
    ap.add_argument(
        "-o", "--out-dir", default="postflight-out", help="output directory"
    )
    args = ap.parse_args()

    target = None
    if args.target:
        lat_s, lon_s = args.target.split(",")
        target = (float(lat_s), float(lon_s))

    os.makedirs(args.out_dir, exist_ok=True)
    manifest = {"videos": [], "photos": [], "waylines": [], "skipped": []}

    for path in _gather(args.inputs):
        low = path.lower()
        stem = os.path.splitext(os.path.basename(path))[0]
        if low.endswith(_VIDEO):
            try:
                rows, source = pf.telemetry_rows(path)
            except Exception as exc:  # noqa: BLE001
                manifest["skipped"].append({"file": path, "reason": str(exc)})
                continue
            pf.write_telemetry_csv(
                os.path.join(args.out_dir, f"{stem}.telemetry.csv"), rows
            )
            summary = pf.telemetry_summary(rows)
            summary["source"] = source
            entry = {"file": os.path.basename(path), "telemetry": summary}
            if target:
                entry["aim"] = pf.camera_aim_report(
                    rows, target[0], target[1], args.target_alt
                )
            pf.write_json(os.path.join(args.out_dir, f"{stem}.summary.json"), entry)
            manifest["videos"].append(entry)
            aim_note = ""
            if target:
                aim_note = f", lateral aim {entry['aim']['lateral_aim_error_m']:+.2f} m"
            print(
                f"video {os.path.basename(path)}: {summary['frames']} frames{aim_note}"
            )
        elif low.endswith(_PHOTO):
            meta = pf.extract_photo_xmp(path)
            manifest["photos"].append({"file": os.path.basename(path), "xmp": meta})
            print(
                f"photo {os.path.basename(path)}: "
                + (
                    f"{meta.get('GpsLatitude')},{meta.get('GpsLongitude')}"
                    if meta
                    else "no XMP"
                )
            )
        elif low.endswith(_WAYLINE):
            try:
                s = pf.summarize_wpml(path)
            except Exception as exc:  # noqa: BLE001
                manifest["skipped"].append({"file": path, "reason": str(exc)})
                continue
            manifest["waylines"].append(s)
            print(
                f"wayline {os.path.basename(path)}: {s['executeHeightMode']} "
                f"exec {s['executeHeight_range_m']} RTH {s['globalRTHHeight']}"
            )
        else:
            manifest["skipped"].append({"file": path, "reason": "unrecognised type"})

    pf.write_json(os.path.join(args.out_dir, "manifest.json"), manifest)
    print(f"\nmanifest + artifacts -> {args.out_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
