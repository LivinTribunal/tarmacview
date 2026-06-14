"""photo position-metadata extraction: EXIF GPS, DJI XMP, lens-height derivation.

the extractor is read-only - these tests assert it never persists and that
per-image parse failures are reported without aborting the batch. JPEG fixtures
are generated with Pillow (a guaranteed transitive dep via matplotlib).
"""

import io

import pytest

from app.models.airport import Airport
from app.services import photo_metadata_service as pm
from tests.data.airports import AIRPORT_PAYLOAD

# coords used across the fixtures - inside the DEM bounds written below
_LAT = 50.10
_LON = 14.27
_MSL = 325.3


def _to_dms(dec: float) -> tuple[float, float, float]:
    """split a positive decimal degree into (deg, min, sec) floats for Pillow EXIF."""
    deg = int(dec)
    minutes_full = (dec - deg) * 60
    minutes = int(minutes_full)
    seconds = (minutes_full - minutes) * 60
    return (float(deg), float(minutes), float(seconds))


def _jpeg_with_gps(*, lat: float, lon: float, alt: float | None = None) -> bytes:
    """build an in-memory JPEG carrying EXIF GPS lat/lon (and optional altitude)."""
    from PIL import Image
    from PIL.ExifTags import GPS, IFD

    img = Image.new("RGB", (8, 8), (0, 0, 0))
    exif = img.getexif()
    gps = {
        GPS.GPSLatitudeRef: "N" if lat >= 0 else "S",
        GPS.GPSLatitude: _to_dms(abs(lat)),
        GPS.GPSLongitudeRef: "E" if lon >= 0 else "W",
        GPS.GPSLongitude: _to_dms(abs(lon)),
    }
    if alt is not None:
        gps[GPS.GPSAltitudeRef] = 0
        gps[GPS.GPSAltitude] = float(alt)
    exif[IFD.GPSInfo] = gps
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _jpeg_plain() -> bytes:
    """build an in-memory JPEG with no EXIF GPS data."""
    from PIL import Image

    img = Image.new("RGB", (8, 8), (5, 5, 5))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _dji_xmp(
    *, abs_alt: float | None = None, rel_alt: float | None = None, lat=None, lon=None
) -> bytes:
    """a DJI XMP packet (byte-scannable) carrying the requested fields."""
    attrs = []
    if abs_alt is not None:
        attrs.append(f'drone-dji:AbsoluteAltitude="{abs_alt:+.2f}"')
    if rel_alt is not None:
        attrs.append(f'drone-dji:RelativeAltitude="{rel_alt:+.2f}"')
    if lat is not None:
        attrs.append(f'drone-dji:GpsLatitude="{lat}"')
    if lon is not None:
        attrs.append(f'drone-dji:GpsLongitude="{lon}"')
    joined = " ".join(attrs)
    packet = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        f"<rdf:RDF><rdf:Description {joined}/></rdf:RDF>"
        "</x:xmpmeta>"
    )
    return packet.encode("utf-8")


# ---- service-level parsing ----


def test_parse_exif_gps_with_altitude():
    """EXIF GPS lat/lon/alt round-trips through the parser."""
    raw = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    pos = pm._parse_position(raw)
    assert pos is not None
    assert pos["lat"] == pytest.approx(_LAT, abs=1e-4)
    assert pos["lon"] == pytest.approx(_LON, abs=1e-4)
    assert pos["alt"] == pytest.approx(_MSL, abs=0.5)


def test_parse_no_gps_returns_none():
    """a JPEG without GPS tags yields no position."""
    assert pm._parse_position(_jpeg_plain()) is None


def test_parse_dji_xmp_absolute_and_relative_altitude():
    """DJI XMP absolute + relative altitudes are both extracted."""
    dji = pm._parse_dji_xmp(_dji_xmp(abs_alt=325.30, rel_alt=45.60))
    assert dji["abs_alt"] == pytest.approx(325.30)
    assert dji["rel_alt"] == pytest.approx(45.60)


def test_dji_absolute_altitude_preferred_over_exif():
    """DJI AbsoluteAltitude wins for MSL when both EXIF and XMP are present."""
    raw = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=100.0) + _dji_xmp(abs_alt=325.30, rel_alt=45.6)
    pos = pm._parse_position(raw)
    assert pos["alt"] == pytest.approx(325.30)


def test_dji_xmp_supplies_position_when_exif_missing():
    """a plain JPEG with a DJI XMP packet still yields lat/lon/alt."""
    raw = _jpeg_plain() + _dji_xmp(abs_alt=200.0, lat=_LAT, lon=_LON)
    pos = pm._parse_position(raw)
    assert pos is not None
    assert pos["lat"] == pytest.approx(_LAT)
    assert pos["lon"] == pytest.approx(_LON)
    assert pos["alt"] == pytest.approx(200.0)


def test_extract_one_derives_agl_from_provider():
    """lens AGL = MSL - DEM ground; msl is surfaced verbatim."""

    class _StubProvider:
        def get_elevation(self, lat, lon):
            return 300.0

    raw = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    item = pm._extract_one("papi.jpg", raw, _StubProvider())
    assert item.lens_height_msl_m == pytest.approx(_MSL, abs=0.5)
    assert item.lens_height_agl_m == pytest.approx(_MSL - 300.0, abs=0.5)
    assert item.coordinates is not None


def test_extract_one_no_provider_leaves_agl_null():
    """without a DEM provider the AGL stays null but MSL is still captured."""
    raw = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    item = pm._extract_one("papi.jpg", raw, None)
    assert item.lens_height_msl_m == pytest.approx(_MSL, abs=0.5)
    assert item.lens_height_agl_m is None


# ---- route-level ----


def _create_airport(client, icao: str) -> dict:
    """create a throwaway airport and return its json."""
    r = client.post("/api/v1/airports", json={**AIRPORT_PAYLOAD, "icao_code": icao})
    assert r.status_code == 201
    return r.json()


def test_extract_endpoint_flat_airport(client):
    """flat airport: has_dem false, MSL captured, AGL null; bad image reported per-item."""
    apt = _create_airport(client, "QMPA")
    good = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    bad = _jpeg_plain()

    r = client.post(
        f"/api/v1/airports/{apt['id']}/extract-photo-metadata",
        files=[
            ("files", ("good.jpg", good, "image/jpeg")),
            ("files", ("nogps.jpg", bad, "image/jpeg")),
        ],
    )
    assert r.status_code == 200
    body = r.json()
    assert body["has_dem"] is False
    assert len(body["items"]) == 2

    good_item = next(i for i in body["items"] if i["filename"] == "good.jpg")
    assert good_item["error"] is None
    assert good_item["coordinates"]["coordinates"][0] == pytest.approx(_LON, abs=1e-3)
    assert good_item["coordinates"]["coordinates"][1] == pytest.approx(_LAT, abs=1e-3)
    assert good_item["lens_height_msl_m"] == pytest.approx(_MSL, abs=0.5)
    assert good_item["lens_height_agl_m"] is None

    bad_item = next(i for i in body["items"] if i["filename"] == "nogps.jpg")
    assert bad_item["coordinates"] is None
    assert bad_item["error"] is not None


def _write_constant_dem(path, *, elevation: float, bounds: tuple[float, float, float, float]):
    """write a tiny constant-elevation WGS84 GeoTIFF covering bounds."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    west, south, east, north = bounds
    width = height = 16
    data = np.full((height, width), elevation, dtype="float32")
    transform = from_bounds(west, south, east, north, width, height)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
    ) as dst:
        dst.write(data, 1)
    return str(path)


def test_extract_endpoint_with_dem_derives_agl(client, db_session, tmp_path):
    """when a DEM backs the airport, AGL = MSL - terrain is derived per image."""
    apt = _create_airport(client, "QMPB")
    dem_path = _write_constant_dem(
        tmp_path / "dem.tif", elevation=300.0, bounds=(14.20, 50.05, 14.35, 50.15)
    )

    airport = db_session.query(Airport).filter(Airport.id == apt["id"]).first()
    airport.terrain_source = "DEM_UPLOAD"
    airport.dem_file_path = dem_path
    db_session.commit()

    good = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    r = client.post(
        f"/api/v1/airports/{apt['id']}/extract-photo-metadata",
        files=[("files", ("papi.jpg", good, "image/jpeg"))],
    )
    assert r.status_code == 200
    body = r.json()
    assert body["has_dem"] is True
    item = body["items"][0]
    assert item["lens_height_msl_m"] == pytest.approx(_MSL, abs=0.5)
    assert item["lens_height_agl_m"] == pytest.approx(_MSL - 300.0, abs=1.0)


def test_extract_endpoint_unknown_airport_404(client):
    """extracting against a missing airport is a 404."""
    good = _jpeg_with_gps(lat=_LAT, lon=_LON, alt=_MSL)
    r = client.post(
        "/api/v1/airports/00000000-0000-0000-0000-0000000000aa/extract-photo-metadata",
        files=[("files", ("a.jpg", good, "image/jpeg"))],
    )
    assert r.status_code == 404
