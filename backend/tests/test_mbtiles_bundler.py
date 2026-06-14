"""tests for the offline MBTiles base-map bundler (scripts/field-hub/bundle-basemap.py).

the bundler is a standalone script outside the backend package; it is loaded
here by file path so its pure tile-math + MBTiles schema helpers can be unit
tested without a network fetch.
"""

import importlib.util
import sqlite3
from pathlib import Path

_BUNDLER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "field-hub" / "bundle-basemap.py"


def _load_bundler():
    """import the hyphenated bundle-basemap.py module by file path."""
    spec = importlib.util.spec_from_file_location("bundle_basemap", _BUNDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bundler = _load_bundler()


class TestLonLatToTile:
    """slippy XYZ tile selection from lon/lat."""

    def test_origin_at_zoom_zero(self):
        """zoom 0 is a single tile covering the whole world."""
        assert bundler.lonlat_to_tile(0.0, 0.0, 0) == (0, 0)

    def test_prague_at_zoom_ten(self):
        """a known lon/lat resolves to a stable tile column/row."""
        assert bundler.lonlat_to_tile(14.26, 50.10, 10) == (552, 346)

    def test_clamps_to_grid_bounds(self):
        """coordinates at the antimeridian clamp to the last valid column."""
        x, y = bundler.lonlat_to_tile(180.0, 0.0, 2)
        assert x == 3  # n - 1 for zoom 2
        assert 0 <= y <= 3


class TestXyzToTmsRow:
    """XYZ -> TMS row flip (MBTiles stores TMS, origin at the bottom)."""

    def test_top_row_flips_to_bottom(self):
        """XYZ row 0 (north) becomes the top TMS row 2^z - 1."""
        assert bundler.xyz_to_tms_row(0, 3) == 7

    def test_flip_is_an_involution(self):
        """flipping twice returns the original row."""
        for z in (1, 5, 12):
            for y in (0, 3, 2**z - 1):
                assert bundler.xyz_to_tms_row(bundler.xyz_to_tms_row(y, z), z) == y


class TestTilesForBbox:
    """bbox + zoom range enumeration."""

    def test_single_tile_low_zoom(self):
        """a small bbox at a low zoom resolves to one tile."""
        tiles = bundler.tiles_for_bbox((14.20, 50.06, 14.32, 50.14), 2, 2)
        assert len(tiles) == 1
        assert tiles[0][0] == 2

    def test_zoom_range_is_inclusive(self):
        """both endpoints of the zoom range are enumerated."""
        tiles = bundler.tiles_for_bbox((14.20, 50.06, 14.32, 50.14), 5, 8)
        zooms = {z for z, _, _ in tiles}
        assert zooms == {5, 6, 7, 8}

    def test_north_maps_to_smaller_row(self):
        """the NE corner yields the smallest XYZ row in the covered set."""
        bbox = (14.0, 50.0, 15.0, 51.0)
        z = 10
        tiles = [t for t in bundler.tiles_for_bbox(bbox, z, z)]
        rows = sorted({y for _, _, y in tiles})
        # NE corner (max_lat) is the smallest row
        ne_x, ne_y = bundler.lonlat_to_tile(15.0, 51.0, z)
        assert rows[0] == ne_y

    def test_tile_count_matches_grid_span(self):
        """enumerated tiles equal the rectangular column x row span."""
        bbox = (14.0, 50.0, 15.0, 51.0)
        z = 9
        tiles = bundler.tiles_for_bbox(bbox, z, z)
        cols = {x for _, x, _ in tiles}
        rows = {y for _, _, y in tiles}
        assert len(tiles) == len(cols) * len(rows)


class TestFormatTileUrl:
    """url template placeholder substitution preserves path order."""

    def test_esri_z_y_x_order(self):
        """esri's {z}/{y}/{x} path order is honored verbatim."""
        url = bundler.format_tile_url("https://h/tile/{z}/{y}/{x}", 5, 1, 2)
        assert url == "https://h/tile/5/2/1"

    def test_osm_z_x_y_order(self):
        """osm's {z}/{x}/{y} path order is honored verbatim."""
        url = bundler.format_tile_url("https://h/{z}/{x}/{y}.png", 5, 1, 2)
        assert url == "https://h/5/1/2.png"


class TestMbtilesSchemaRoundTrip:
    """metadata + tiles tables, y-flip on store/read, raw sqlite verification."""

    def test_metadata_keys_written(self, tmp_path):
        """build_metadata + write_metadata persist the standard MBTiles keys."""
        db = tmp_path / "round.mbtiles"
        conn = sqlite3.connect(db)
        bundler.init_mbtiles(conn)
        meta = bundler.build_metadata("KPRG", (14.2, 50.06, 14.32, 50.14), 8, 16, "jpg")
        bundler.write_metadata(conn, meta)
        conn.commit()
        conn.close()

        conn = sqlite3.connect(db)
        rows = dict(conn.execute("SELECT name, value FROM metadata").fetchall())
        conn.close()
        for key in ("name", "type", "format", "bounds", "minzoom", "maxzoom", "center"):
            assert key in rows
        assert rows["format"] == "jpg"
        assert rows["name"] == "KPRG"

    def test_tile_stored_at_flipped_row_and_reads_back(self, tmp_path):
        """a stored XYZ tile lands at the TMS row and read_tile recovers it."""
        db = tmp_path / "tiles.mbtiles"
        conn = sqlite3.connect(db)
        bundler.init_mbtiles(conn)

        z, x, y = 10, 100, 200
        payload = b"\x89PNG-fake-tile-bytes"
        bundler.store_tile(conn, z, x, y, payload)
        conn.commit()

        # raw read: the row stored must be the TMS-flipped value, not the XYZ row
        stored_row = conn.execute(
            "SELECT tile_row FROM tiles WHERE zoom_level = ? AND tile_column = ?",
            (z, x),
        ).fetchone()[0]
        assert stored_row == bundler.xyz_to_tms_row(y, z)
        assert stored_row != y

        # high-level read flips back to the XYZ row
        assert bundler.read_tile(conn, z, x, y) == payload
        conn.close()

    def test_unique_index_dedupes_repeated_tile(self, tmp_path):
        """INSERT OR REPLACE keeps a single row per (zoom, col, row)."""
        db = tmp_path / "dedupe.mbtiles"
        conn = sqlite3.connect(db)
        bundler.init_mbtiles(conn)
        bundler.store_tile(conn, 5, 1, 1, b"first-tile-payload-bytes")
        bundler.store_tile(conn, 5, 1, 1, b"second-tile-payload-bytes")
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
        assert count == 1
        assert bundler.read_tile(conn, 5, 1, 1) == b"second-tile-payload-bytes"
        conn.close()


class TestSubThresholdSkip:
    """sub-100-byte responses are dropped as blank/error tiles."""

    def test_small_response_returns_none(self):
        """a response under MIN_TILE_BYTES is treated as a missing tile."""

        class _Resp:
            content = b"x" * 50

            def raise_for_status(self):
                """no-op - the response is a 200 with a tiny body."""

        class _Client:
            def get(self, url):
                """return the canned tiny response."""
                return _Resp()

        assert bundler._fetch_tile(_Client(), "https://h/0/0/0") is None

    def test_full_response_returns_bytes(self):
        """a response at or above the threshold is kept."""

        class _Resp:
            content = b"x" * 500

            def raise_for_status(self):
                """no-op - healthy 200 response."""

        class _Client:
            def get(self, url):
                """return the canned full response."""
                return _Resp()

        assert bundler._fetch_tile(_Client(), "https://h/0/0/0") == b"x" * 500
