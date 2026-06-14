"""tests for offline GLO-30 DEM staging (download_srtm_for_location + tile math)."""

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.core.exceptions import DomainError
from app.services.airport.terrain import (
    _glo30_tile_name,
    _glo30_tile_url,
    _glo30_tiles_for_bbox,
)


class TestGlo30TileName:
    """GLO-30 tile naming across the four hemisphere quadrants."""

    def test_north_east_quadrant(self):
        """prague-style N/E corner renders the canonical copernicus basename."""
        assert _glo30_tile_name(50, 14) == "Copernicus_DSM_COG_10_N50_00_E014_00_DEM"

    def test_south_east_quadrant(self):
        """southern hemisphere uses the S prefix on the SW-corner latitude."""
        assert _glo30_tile_name(-34, 151) == "Copernicus_DSM_COG_10_S34_00_E151_00_DEM"

    def test_north_west_quadrant(self):
        """western hemisphere uses the W prefix, zero-padded to three digits."""
        assert _glo30_tile_name(40, -74) == "Copernicus_DSM_COG_10_N40_00_W074_00_DEM"

    def test_south_west_quadrant(self):
        """both-negative corner renders S and W prefixes."""
        assert _glo30_tile_name(-1, -1) == "Copernicus_DSM_COG_10_S01_00_W001_00_DEM"


class TestGlo30TileUrl:
    """the public COG url is built from the configured base + tile basename twice."""

    def test_url_nests_basename_as_dir_and_file(self):
        """copernicus lays each COG out as <name>/<name>.tif under the bucket."""
        with patch("app.services.airport.terrain.settings") as mock_settings:
            mock_settings.copernicus_dem_base_url = "https://copernicus-dem-30m.s3.amazonaws.com"
            url = _glo30_tile_url(50, 14)
        name = "Copernicus_DSM_COG_10_N50_00_E014_00_DEM"
        assert url == f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"

    def test_trailing_slash_on_base_is_normalized(self):
        """a base url with a trailing slash does not double up the separator."""
        with patch("app.services.airport.terrain.settings") as mock_settings:
            mock_settings.copernicus_dem_base_url = "https://mirror.local/dem/"
            url = _glo30_tile_url(50, 14)
        assert "//Copernicus" not in url.replace("https://", "")


class TestGlo30TilesForBbox:
    """bbox -> covering 1-degree tile list selection."""

    def test_single_tile_bbox(self):
        """a small bbox fully inside one degree cell needs exactly one tile."""
        bbox = (14.20, 50.06, 14.32, 50.14)
        assert _glo30_tiles_for_bbox(bbox) == [(50, 14)]

    def test_bbox_straddles_longitude_boundary(self):
        """a bbox crossing an integer-degree meridian pulls both adjacent tiles."""
        bbox = (14.945, 50.05, 15.035, 50.10)
        assert _glo30_tiles_for_bbox(bbox) == [(50, 14), (50, 15)]

    def test_bbox_straddles_latitude_boundary(self):
        """a bbox crossing an integer-degree parallel pulls both rows."""
        bbox = (14.20, 49.98, 14.30, 50.02)
        assert _glo30_tiles_for_bbox(bbox) == [(49, 14), (50, 14)]

    def test_bbox_corner_straddle_yields_four_tiles(self):
        """a bbox straddling a degree corner covers a 2x2 block of tiles."""
        bbox = (13.98, 49.98, 14.02, 50.02)
        assert _glo30_tiles_for_bbox(bbox) == [(49, 13), (49, 14), (50, 13), (50, 14)]

    def test_southern_hemisphere_tiles(self):
        """negative latitudes floor toward the SW corner correctly."""
        bbox = (151.10, -33.95, 151.20, -33.90)
        assert _glo30_tiles_for_bbox(bbox) == [(-34, 151)]


def _patched_rasterio(write_calls, mosaic, transform, *, read_side_effect=None):
    """build a rasterio.open patch dispatching read vs write modes.

    write-mode opens record their kwargs into ``write_calls``; read-mode opens
    return a fresh mock dataset (or raise ``read_side_effect`` per tile).
    """
    read_calls = []

    def _open(path, mode="r", **kwargs):
        if mode == "w":
            dst = MagicMock()
            dst.__enter__ = MagicMock(return_value=dst)
            dst.__exit__ = MagicMock(return_value=False)
            write_calls.append({"path": path, **kwargs})
            return dst
        read_calls.append(path)
        if read_side_effect is not None:
            raise read_side_effect
        return MagicMock()

    return _open, read_calls


def _run_srtm_download(tmp_path, *, base_url="https://dem.test", read_side_effect=None):
    """invoke download_srtm_for_location with rasterio + merge fully mocked."""
    write_calls = []
    mosaic = np.array([[[100.0, 110.0], [120.0, 130.0]]], dtype=np.float32)
    transform = MagicMock()
    transform.a = 0.0002777
    transform.e = -0.0002777

    mock_settings = MagicMock()
    mock_settings.terrain_grid_delta_deg = 0.045
    mock_settings.copernicus_dem_base_url = base_url

    open_fn, read_calls = _patched_rasterio(
        write_calls, mosaic, transform, read_side_effect=read_side_effect
    )

    from app.services.airport.terrain import download_srtm_for_location

    with ExitStack() as stack:
        stack.enter_context(patch("app.services.airport.terrain.TERRAIN_DIR", tmp_path))
        stack.enter_context(patch("app.services.airport.terrain.settings", mock_settings))
        stack.enter_context(patch("rasterio.open", side_effect=open_fn))
        stack.enter_context(patch("rasterio.merge.merge", return_value=(mosaic, transform)))

        result = download_srtm_for_location(
            airport_id="test-airport-id",
            apt_lon=14.26,
            apt_lat=50.10,
            fallback_elevation=280.0,
        )
    return result, write_calls, read_calls


class TestDownloadSrtmForLocation:
    """download_srtm_for_location with mocked /vsicurl reads and merge."""

    def test_returns_dem_srtm_metadata_shape(self, tmp_path):
        """result carries the drop-in {terrain_source, bounds, resolution, file_path} shape."""
        result, _, _ = _run_srtm_download(tmp_path)

        assert result["terrain_source"] == "DEM_SRTM"
        assert len(result["bounds"]) == 4
        assert len(result["resolution"]) == 2
        assert result["file_path"].endswith("_srtm_cache.tif")
        assert result["tiles_used"] >= 1

    def test_bounds_cover_airport(self, tmp_path):
        """the staged bbox brackets the airport lon/lat by the configured delta."""
        result, _, _ = _run_srtm_download(tmp_path)
        min_lon, min_lat, max_lon, max_lat = result["bounds"]
        assert min_lon < 14.26 < max_lon
        assert min_lat < 50.10 < max_lat

    def test_geotiff_written_as_wgs84_float32_with_nodata(self, tmp_path):
        """the cached raster is EPSG:4326 float32 with the nodata sentinel set."""
        from app.services.airport.terrain import GEOTIFF_NODATA

        _, write_calls, _ = _run_srtm_download(tmp_path)
        assert len(write_calls) == 1
        w = write_calls[0]
        assert w["crs"] == "EPSG:4326"
        assert w["dtype"] == "float32"
        assert w["nodata"] == GEOTIFF_NODATA
        assert w["count"] == 1

    def test_reads_one_vsicurl_tile_per_covering_tile(self, tmp_path):
        """each covering tile is opened through GDAL's /vsicurl driver."""
        _, _, read_calls = _run_srtm_download(tmp_path)
        assert len(read_calls) == 1
        assert read_calls[0].startswith("/vsicurl/https://dem.test/")

    def test_all_tiles_unavailable_raises_502(self, tmp_path):
        """no openable tiles is an upstream failure, not a silent empty raster."""
        with pytest.raises(DomainError, match="no GLO-30 tiles available"):
            _run_srtm_download(tmp_path, read_side_effect=RuntimeError("404 not found"))

    def test_dem_srtm_airport_serializes_through_response(self):
        """a DEM_SRTM airport drops into AirportResponse without a validation error."""
        from app.schemas.airport import AirportResponse, ElevationAtPointResponse

        airport = MagicMock()
        airport.id = "00000000-0000-0000-0000-000000000001"
        airport.icao_code = "SRTM"
        airport.name = "srtm field"
        airport.city = None
        airport.country = None
        airport.elevation = 280.0
        airport.location = {"type": "Point", "coordinates": [14.26, 50.10, 280.0]}
        airport.default_drone_profile_id = None
        airport.terrain_source = "DEM_SRTM"
        airport.dem_file_path = "/data/terrain/x_srtm_cache.tif"

        resp = AirportResponse.model_validate(airport)
        assert resp.terrain_source == "DEM_SRTM"
        assert resp.has_dem is True

        # the elevation endpoint can label a staged airport's source DEM_SRTM
        elev = ElevationAtPointResponse(elevation=271.0, source="DEM_SRTM")
        assert elev.source == "DEM_SRTM"

    def test_rasterio_missing_raises_501(self, tmp_path):
        """rasterio import failure surfaces as a 501, mirroring the api downloader."""
        import builtins

        real_import = builtins.__import__

        def _no_rasterio(name, *args, **kwargs):
            if name == "rasterio" or name.startswith("rasterio."):
                raise ImportError("no rasterio")
            return real_import(name, *args, **kwargs)

        from app.services.airport.terrain import download_srtm_for_location

        with patch("builtins.__import__", side_effect=_no_rasterio):
            with pytest.raises(DomainError, match="not available"):
                download_srtm_for_location(
                    airport_id="x", apt_lon=14.26, apt_lat=50.10, fallback_elevation=280.0
                )
