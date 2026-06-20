#!/usr/bin/env python3
"""bundle-terrain.py - drive Cesium Terrain Builder over a DEM into a quantised-mesh tileset.

Offline 3D-terrain bundler for air-gapped `field` deployments. Runs Cesium
Terrain Builder (the quantised-mesh fork, default docker image
`tumgis/ctb-quantized-mesh`) over a GLO-30 / SRTM DEM GeoTIFF to emit a Cesium
tileset (`layer.json` + `{z}/{x}/{y}.terrain` tiles). The tileset is uploaded to
MinIO under the `terrain/` prefix and served same-origin by the backend
`/api/v1/terrain/...` route, so the 3D viewer renders real terrain with Ion /
`cesium.com` blocked.

This is a different artefact from the backend's `download_srtm_for_location`
GLO-30 DEM, which feeds altitude math, not the render mesh.

Run this once while online (staging laptop with docker). Stdlib only, no pip dep
- CTB ships as a docker image, not a python package - so it runs on a bare
staging laptop without the TarmacView app installed.

Usage:
    scripts/field-hub/bundle-terrain.py \
        --dem prague-glo30.tif --out ./terrain-prague \
        --start-zoom 0 --end-zoom 14

Pass `--no-docker` to call a locally-installed `ctb-tile` instead of the docker
image. Exit 0: tileset written. Exit 1: missing DEM / CTB failure.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

DEFAULT_CTB_IMAGE = "tumgis/ctb-quantized-mesh"
# ctb output format for quantised-mesh (layer.json + .terrain tiles)
OUTPUT_FORMAT = "Mesh"


def build_ctb_command(
    dem_path: Path,
    out_dir: Path,
    *,
    layer_only: bool,
    start_zoom: int | None,
    end_zoom: int | None,
    use_docker: bool,
    ctb_image: str,
) -> list[str]:
    """assemble the ctb-tile argv for one pass (tiles, or layer.json with -l)."""
    if use_docker:
        prefix = [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{dem_path.parent.resolve()}:/dem:ro",
            "-v",
            f"{out_dir.resolve()}:/out",
            ctb_image,
        ]
        dem_arg = f"/dem/{dem_path.name}"
        out_arg = "/out"
    else:
        prefix = []
        dem_arg = str(dem_path)
        out_arg = str(out_dir)

    cmd = [*prefix, "ctb-tile", "-f", OUTPUT_FORMAT, "-o", out_arg]
    if layer_only:
        cmd.append("-l")
    if start_zoom is not None:
        cmd += ["-s", str(start_zoom)]
    if end_zoom is not None:
        cmd += ["-e", str(end_zoom)]
    cmd.append(dem_arg)
    return cmd


def bundle_terrain(
    dem_path: Path,
    out_dir: Path,
    *,
    start_zoom: int | None,
    end_zoom: int | None,
    use_docker: bool,
    ctb_image: str,
) -> None:
    """run ctb twice: pass 1 emits the .terrain tiles, pass 2 (-l) writes layer.json."""
    for layer_only in (False, True):
        cmd = build_ctb_command(
            dem_path,
            out_dir,
            layer_only=layer_only,
            start_zoom=start_zoom,
            end_zoom=end_zoom,
            use_docker=use_docker,
            ctb_image=ctb_image,
        )
        print(f"running: {' '.join(cmd)}")
        subprocess.run(cmd, check=True)
    print(f"wrote quantised-mesh tileset to {out_dir} (upload under the terrain/ prefix)")


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """parse the terrain-bundler CLI arguments."""
    parser = argparse.ArgumentParser(
        description="drive Cesium Terrain Builder over a DEM into a quantised-mesh tileset"
    )
    parser.add_argument("--dem", required=True, help="input DEM GeoTIFF (GLO-30 / SRTM)")
    parser.add_argument("--out", required=True, help="output tileset directory")
    parser.add_argument("--start-zoom", type=int, default=None, help="max zoom (ctb -s)")
    parser.add_argument("--end-zoom", type=int, default=None, help="min zoom (ctb -e)")
    parser.add_argument("--ctb-image", default=DEFAULT_CTB_IMAGE, help="ctb docker image")
    parser.add_argument(
        "--no-docker", action="store_true", help="call a locally-installed ctb-tile"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint - build the quantised-mesh tileset from the DEM."""
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    dem_path = Path(args.dem)
    if not dem_path.exists():
        print(f"error: DEM not found: {dem_path}", file=sys.stderr)
        return 1
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle_terrain(
        dem_path,
        out_dir,
        start_zoom=args.start_zoom,
        end_zoom=args.end_zoom,
        use_docker=not args.no_docker,
        ctb_image=args.ctb_image,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
