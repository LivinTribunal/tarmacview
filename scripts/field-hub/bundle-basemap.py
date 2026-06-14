#!/usr/bin/env python3
"""bundle-basemap.py - pull XYZ raster tiles for an airport bbox into an MBTiles.

Offline base-map bundler for air-gapped `field` deployments. Fetches the
configured Esri/MapLibre raster tiles covering an airport bounding box across a
zoom range and packs them into a standard MBTiles SQLite file (metadata + tiles
tables, XYZ->TMS y-flip), ready for MapLibre GL to render with no network.

Run this once while online (staging time); the resulting .mbtiles is then
served locally to the field stack. Skips sub-100-byte responses (error / blank
tiles). Stdlib + httpx only, no backend import - so it runs on a bare staging
laptop without the TarmacView app installed.

Usage:
    scripts/field-hub/bundle-basemap.py \
        --url "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" \
        --bbox 14.20 50.06 14.32 50.14 \
        --min-zoom 8 --max-zoom 16 \
        --out prague.mbtiles

The --url template uses {z}/{x}/{y} placeholders in any path order (Esri's
z/y/x and OSM's z/x/y both work). The {y} placeholder is the XYZ row; the
MBTiles file stores the TMS-flipped row internally.

Exit 0: bundle written. Exit 1: bad arguments / fetch failure.
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor

# responses below this are blank/error tiles from XYZ servers, not imagery.
MIN_TILE_BYTES = 100
DEFAULT_CONCURRENCY = 8
DEFAULT_TILE_FORMAT = "jpg"


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    """convert lon/lat to the XYZ (slippy) tile column/row at a zoom level."""
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    # clamp to the valid tile grid (points exactly on the antimeridian / poles)
    x = min(max(x, 0), n - 1)
    y = min(max(y, 0), n - 1)
    return x, y


def xyz_to_tms_row(y: int, zoom: int) -> int:
    """flip an XYZ tile row to the TMS row MBTiles stores (origin at bottom)."""
    return (2**zoom) - 1 - y


def tiles_for_bbox(
    bbox: tuple[float, float, float, float], min_zoom: int, max_zoom: int
) -> list[tuple[int, int, int]]:
    """enumerate every (zoom, x, y) XYZ tile covering the bbox across the zoom range.

    bbox is (min_lon, min_lat, max_lon, max_lat). north (max_lat) maps to the
    smaller XYZ row, so the row range runs from the NE corner down to the SW.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    tiles = []
    for z in range(min_zoom, max_zoom + 1):
        x_min, y_min = lonlat_to_tile(min_lon, max_lat, z)
        x_max, y_max = lonlat_to_tile(max_lon, min_lat, z)
        for x in range(min(x_min, x_max), max(x_min, x_max) + 1):
            for y in range(min(y_min, y_max), max(y_min, y_max) + 1):
                tiles.append((z, x, y))
    return tiles


def format_tile_url(template: str, z: int, x: int, y: int) -> str:
    """substitute {z}/{x}/{y} placeholders in a tile url template."""
    return template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


def init_mbtiles(conn: sqlite3.Connection) -> None:
    """create the standard MBTiles metadata + tiles schema."""
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (name text, value text)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tiles ("
        "zoom_level integer, tile_column integer, tile_row integer, tile_data blob)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS tile_index "
        "ON tiles (zoom_level, tile_column, tile_row)"
    )


def write_metadata(conn: sqlite3.Connection, metadata: dict[str, str]) -> None:
    """write the MBTiles metadata key/value rows."""
    conn.executemany(
        "INSERT INTO metadata (name, value) VALUES (?, ?)",
        [(k, str(v)) for k, v in metadata.items()],
    )


def store_tile(conn: sqlite3.Connection, z: int, x: int, y_xyz: int, data: bytes) -> None:
    """insert one XYZ tile, flipping its row to the TMS scheme MBTiles uses."""
    conn.execute(
        "INSERT OR REPLACE INTO tiles "
        "(zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
        (z, x, xyz_to_tms_row(y_xyz, z), data),
    )


def read_tile(conn: sqlite3.Connection, z: int, x: int, y_xyz: int) -> bytes | None:
    """read one XYZ tile back, flipping the row to the stored TMS scheme."""
    row = conn.execute(
        "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
        (z, x, xyz_to_tms_row(y_xyz, z)),
    ).fetchone()
    return row[0] if row else None


def build_metadata(
    name: str,
    bbox: tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    tile_format: str,
) -> dict[str, str]:
    """assemble the MBTiles metadata block from the bundle parameters."""
    min_lon, min_lat, max_lon, max_lat = bbox
    return {
        "name": name,
        "type": "baselayer",
        "version": "1.0",
        "description": f"offline base map for {name}",
        "format": tile_format,
        "bounds": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "center": f"{(min_lon + max_lon) / 2},{(min_lat + max_lat) / 2},{min_zoom}",
        "minzoom": min_zoom,
        "maxzoom": max_zoom,
    }


def _fetch_tile(client, url: str) -> bytes | None:
    """GET one tile; return its bytes or None on error / sub-threshold response."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.content
        if len(data) < MIN_TILE_BYTES:
            return None
        return data
    except Exception as e:
        print(f"  skip {url}: {e}", file=sys.stderr)
        return None


def bundle_basemap(
    url_template: str,
    bbox: tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    out_path: str,
    *,
    name: str = "basemap",
    tile_format: str = DEFAULT_TILE_FORMAT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> int:
    """fetch every covering tile in parallel and write the MBTiles. returns tiles stored."""
    import httpx

    tiles = tiles_for_bbox(bbox, min_zoom, max_zoom)
    print(f"enumerated {len(tiles)} tiles for zoom {min_zoom}-{max_zoom}")

    conn = sqlite3.connect(out_path)
    try:
        init_mbtiles(conn)
        write_metadata(conn, build_metadata(name, bbox, min_zoom, max_zoom, tile_format))

        stored = 0
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:

            def fetch(tile):
                """fetch one (z, x, y) tile and return it with its bytes."""
                z, x, y = tile
                return tile, _fetch_tile(client, format_tile_url(url_template, z, x, y))

            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                for (z, x, y), data in pool.map(fetch, tiles):
                    if data is not None:
                        store_tile(conn, z, x, y, data)
                        stored += 1
        conn.commit()
    finally:
        conn.close()

    print(f"wrote {stored} tiles to {out_path}")
    return stored


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """parse the bundler CLI arguments."""
    parser = argparse.ArgumentParser(description="bundle XYZ raster tiles into an MBTiles file")
    parser.add_argument("--url", required=True, help="tile url template with {z}/{x}/{y}")
    parser.add_argument(
        "--bbox",
        required=True,
        nargs=4,
        type=float,
        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"),
        help="airport bounding box in degrees",
    )
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=16)
    parser.add_argument("--out", required=True, help="output .mbtiles path")
    parser.add_argument("--name", default="basemap", help="layer name written to metadata")
    parser.add_argument("--tile-format", default=DEFAULT_TILE_FORMAT, help="png / jpg / webp")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint - bundle tiles for the given bbox into an MBTiles file."""
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    if args.min_zoom > args.max_zoom:
        print("error: --min-zoom must be <= --max-zoom", file=sys.stderr)
        return 1
    bundle_basemap(
        args.url,
        tuple(args.bbox),
        args.min_zoom,
        args.max_zoom,
        args.out,
        name=args.name,
        tile_format=args.tile_format,
        concurrency=args.concurrency,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
