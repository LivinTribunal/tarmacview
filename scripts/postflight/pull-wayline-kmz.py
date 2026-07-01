#!/usr/bin/env python3
"""pull-wayline-kmz.py - download a dispatched wayline KMZ from object storage.

when a mission is sent to the field hub, the exact KMZ the drone flew is stored
in the waylines bucket keyed by wayline id. this pulls that file so you can
diff what was actually dispatched against what the mission looks like now -
the only ground truth for a "the drone flew the wrong thing" report.

self-contained (boto3 only, no sibling imports) so it also runs inside the
worker container, which already has boto3 + the S3 env. inspect the result with
inspect-kmz.py afterwards.

find the wayline id for a mission first, e.g.:
    docker exec tarmacview-db psql -U tarmacview -d tarmacview -At -c \
      "select mission_id, wayline_id, dispatched_at from wayline_dispatch order by dispatched_at;"

Usage:
    # on host (MinIO published on localhost:9000):
    python scripts/postflight/pull-wayline-kmz.py WAYLINE_ID -o out/
    # inside the worker (internal endpoint + env creds, args before the redirect):
    docker exec -i tarmacview-worker python3 - WAYLINE_ID --endpoint http://minio:9000 \
        -o /tmp/pulled < scripts/postflight/pull-wayline-kmz.py
"""

import argparse
import os
import sys


def main() -> int:
    """cli entrypoint."""
    ap = argparse.ArgumentParser(
        description="pull a dispatched wayline KMZ from S3/MinIO"
    )
    ap.add_argument("wayline_ids", nargs="+", help="wayline uuid(s)")
    ap.add_argument(
        "--bucket", default=os.environ.get("WAYLINE_BUCKET", "tarmacview-waylines")
    )
    ap.add_argument("--prefix", default="wayline", help="key prefix (default: wayline)")
    ap.add_argument(
        "--endpoint", default=os.environ.get("S3_ENDPOINT_URL", "http://127.0.0.1:9000")
    )
    ap.add_argument(
        "--access-key", default=os.environ.get("AWS_ACCESS_KEY_ID", "tarmacview")
    )
    ap.add_argument(
        "--secret-key",
        default=os.environ.get("AWS_SECRET_ACCESS_KEY", "tarmacview-minio"),
    )
    ap.add_argument("-o", "--out-dir", default=".", help="output directory")
    args = ap.parse_args()

    try:
        import boto3
    except ImportError:
        print(
            "boto3 not installed. either `pip install boto3`, or run this inside the "
            "worker container (docker exec tarmacview-worker ...).",
            file=sys.stderr,
        )
        return 2

    s3 = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        aws_access_key_id=args.access_key,
        aws_secret_access_key=args.secret_key,
        region_name="us-east-1",
    )
    os.makedirs(args.out_dir, exist_ok=True)
    rc = 0
    for wid in args.wayline_ids:
        key = f"{args.prefix}/{wid}.kmz"
        dest = os.path.join(args.out_dir, f"{wid}.kmz")
        try:
            body = s3.get_object(Bucket=args.bucket, Key=key)["Body"].read()
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"{wid}: FAILED ({exc})", file=sys.stderr)
            rc = 1
            continue
        with open(dest, "wb") as fh:
            fh.write(body)
        print(f"{wid}: {len(body)} bytes -> {dest}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
