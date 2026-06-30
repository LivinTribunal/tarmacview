#!/usr/bin/env python3
"""dji-photo-metadata.py - pull DJI gps + gimbal + rtk metadata from a photo.

DJI keeps the high-precision position, gimbal angles, and rtk quality flags in
the photo's XMP packet, not in EXIF. this scrapes the drone-dji XMP fields so a
reference photo (e.g. one shot beside the PAPI) can be georeferenced against the
flight videos.

Usage:
    python scripts/postflight/dji-photo-metadata.py REF.jpeg
    python scripts/postflight/dji-photo-metadata.py *.jpeg -o out/photos.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _postflight as pf  # noqa: E402

_KEY = (
    "GpsLatitude",
    "GpsLongitude",
    "AbsoluteAltitude",
    "RelativeAltitude",
    "GpsStatus",
    "RtkFlag",
    "GimbalYawDegree",
    "GimbalPitchDegree",
    "ProductName",
)


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(description="extract DJI photo XMP metadata")
    ap.add_argument("photos", nargs="+", help="DJI photo file(s)")
    ap.add_argument("-o", "--out", help="write combined json here")
    args = ap.parse_args()

    results = {}
    for path in args.photos:
        meta = pf.extract_photo_xmp(path)
        results[os.path.basename(path)] = meta
        if not meta:
            print(f"{os.path.basename(path)}: no DJI XMP found")
            continue
        head = "  ".join(f"{k}={meta[k]}" for k in _KEY if k in meta)
        print(f"{os.path.basename(path)}: {head}")

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2, default=float)
        print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
