#!/usr/bin/env python3
"""camera-aim.py - reconstruct where the camera actually aimed vs a target.

given a flight's telemetry (a video, a .srt, or a .telemetry.csv) and the
intended target point (the LHA centroid / PAPI position the inspection was
meant to frame), this computes the real camera aim: the per-frame gimbal-yaw
minus true-bearing residual (the cross-track aiming error) and the
least-squares convergence point of all camera rays. positive lateral error
means the camera pointed to the right of the target.

this is the tool that quantified the horizontal-range "shifted right" finding:
a near-constant +1 deg yaw residual = a few meters of lateral miss at 250 m.

Usage:
    python scripts/postflight/camera-aim.py FLIGHT.MP4 --target 48.123162,17.1386555
    python scripts/postflight/camera-aim.py flight.telemetry.csv --target 48.123162,17.1386555 \
        --target-alt 134 -o out/aim.json
"""

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _postflight as pf  # noqa: E402


def _rows_from_csv(path: str) -> list[dict]:
    """load telemetry rows from a .telemetry.csv produced by dji-telemetry."""
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                rows.append(
                    {
                        "lat": float(r["lat"]),
                        "lon": float(r["lon"]),
                        "abs_alt": float(r["abs_alt"]),
                        "rel_alt": float(r["rel_alt"]) if r.get("rel_alt") else None,
                        "gb_yaw": float(r["gb_yaw"]),
                        "gb_pitch": float(r["gb_pitch"]),
                    }
                )
            except (ValueError, KeyError):
                continue
    return rows


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(description="reconstruct camera aim vs a target")
    ap.add_argument("source", help="DJI video, .srt, or .telemetry.csv")
    ap.add_argument("--target", required=True, help="target as LAT,LON")
    ap.add_argument(
        "--target-alt",
        type=float,
        default=None,
        help="target MSL altitude (default: estimated ground from telemetry)",
    )
    ap.add_argument("-o", "--out", help="write aim report json here")
    args = ap.parse_args()

    lat_s, lon_s = args.target.split(",")
    tlat, tlon = float(lat_s), float(lon_s)

    if args.source.lower().endswith(".csv"):
        rows = _rows_from_csv(args.source)
    else:
        rows, _ = pf.telemetry_rows(args.source)
    if not rows:
        print("no telemetry rows found", file=sys.stderr)
        return 1

    report = pf.camera_aim_report(rows, tlat, tlon, args.target_alt)
    yr = report["yaw_residual_deg"]
    print(
        f"frames: {report['frames']}  target {tlat:.6f},{tlon:.6f} "
        f"@ {report['target']['alt']:.1f} m"
    )
    print(
        f"  gimbal-yaw - bearing: mean {yr['mean']:+.2f} deg  median {yr['median']:+.2f} "
        f"[p10 {yr['p10']:+.2f}, p90 {yr['p90']:+.2f}]"
    )
    print(f"  median range to target: {report['median_horizontal_range_m']:.0f} m")
    print(
        f"  lateral aim error: {report['lateral_aim_error_m']:+.2f} m "
        f"({report['lateral_aim_error_note']})"
    )
    c = report["ray_convergence_enu_m"]
    print(
        f"  ray convergence (ENU vs target): E {c['east']:+.2f} N {c['north']:+.2f} "
        f"Up {c['up']:+.2f}  | horiz offset {report['ray_convergence_horiz_offset_m']:.2f} m"
    )

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        pf.write_json(args.out, report)
        print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
