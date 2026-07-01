#!/usr/bin/env python3
"""dji-telemetry.py - extract DJI per-frame flight telemetry to csv + json.

DJI M4-era footage embeds the per-frame rtk gps + gimbal attitude in a
subtitle stream inside the mp4 (no .srt sidecar). this demuxes it and saves a
flat csv plus a compact summary, so a test flight's telemetry survives past
the day it was flown.

Usage:
    python scripts/postflight/dji-telemetry.py FLIGHT.MP4
    python scripts/postflight/dji-telemetry.py FLIGHT.MP4 -o out/
    python scripts/postflight/dji-telemetry.py FLIGHT.srt -o out/
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _postflight as pf  # noqa: E402


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(description="extract DJI per-frame telemetry")
    ap.add_argument("media", help="DJI video (.mp4/.mov) or .srt sidecar")
    ap.add_argument("-o", "--out-dir", default=".", help="output directory")
    args = ap.parse_args()

    rows, source = pf.telemetry_rows(args.media)
    summary = pf.telemetry_summary(rows)
    summary["source"] = source
    summary["media"] = os.path.basename(args.media)

    os.makedirs(args.out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.media))[0]
    csv_path = os.path.join(args.out_dir, f"{stem}.telemetry.csv")
    json_path = os.path.join(args.out_dir, f"{stem}.telemetry.json")
    pf.write_telemetry_csv(csv_path, rows)
    pf.write_json(json_path, summary)

    print(f"{summary['frames']} frames ({source}) -> {csv_path}")
    if summary["frames"]:
        s, e = summary["start"], summary["end"]
        print(f"  start {s['lat']:.6f},{s['lon']:.6f} abs_alt {s['abs_alt']:.1f}")
        print(f"  end   {e['lat']:.6f},{e['lon']:.6f} abs_alt {e['abs_alt']:.1f}")
        print(
            f"  rel_alt {summary['rel_alt_range']}  gimbal_pitch {summary['gimbal_pitch_range']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
