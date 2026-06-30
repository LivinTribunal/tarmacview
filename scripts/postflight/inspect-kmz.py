#!/usr/bin/env python3
"""inspect-kmz.py - summarise the altitude encoding + config of a DJI KMZ/WPML.

prints (and optionally saves) the altitude story of an exported or dispatched
wayline: executeHeightMode (relativeToStartPoint / WGS84 / EGM96), the
executeHeight range, globalRTHHeight, takeoff security height, heading modes,
and POI points. point it at a pile of files to spot which generation each one
is - the WGS84 / EGM96 absolutes are the legacy scheme; relativeToStartPoint is
current.

Usage:
    python scripts/postflight/inspect-kmz.py mission.kmz
    python scripts/postflight/inspect-kmz.py ~/Downloads/*.kmz -o out/kmz.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _postflight as pf  # noqa: E402


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(description="summarise DJI KMZ/WPML altitude encoding")
    ap.add_argument("files", nargs="+", help="KMZ or WPML file(s)")
    ap.add_argument("-o", "--out", help="write combined json here")
    args = ap.parse_args()

    results = []
    print(f"{'file':46} {'mode':22} {'execHt':>11} {'RTH':>5} heading")
    print("-" * 100)
    for path in args.files:
        try:
            s = pf.summarize_wpml(path)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"{os.path.basename(path)[:46]:46} ERROR {exc}")
            continue
        results.append(s)
        rng = s["executeHeight_range_m"]
        rng_s = f"{rng[0]:.0f}-{rng[1]:.0f}" if rng else "-"
        mode = ",".join(s["executeHeightMode"]) or "?"
        rth = ",".join(s["globalRTHHeight"]) or "-"
        print(
            f"{os.path.basename(path)[:46]:46} {mode:22} {rng_s:>11} {rth:>5} "
            f"{','.join(s['headingModes'])}"
        )

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)
        print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
