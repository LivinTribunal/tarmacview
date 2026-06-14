"""extract GPS position + PAPI lens height from uploaded drone photos.

read-only: parses EXIF GPS tags (via exifread) plus the DJI XMP packet for the
absolute / relative altitude DJI stores outside EXIF, and never writes to the DB.
the lens-height AGL is derived against the airport DEM when one is loaded; without
a DEM the AGL stays null and the coordinator fills it in by hand.
"""

import io
import logging
import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models.airport import Airport
from app.schemas.airport import PhotoMetadataItem, PhotoMetadataResponse
from app.schemas.geometry import PointZ
from app.services.elevation_provider import (
    DEMElevationProvider,
    ElevationProvider,
    create_elevation_provider,
)

logger = logging.getLogger(__name__)

# DJI stores altitude / position as signed decimal strings in its XMP packet,
# either as element attributes (drone-dji:Name="+1.23") or child elements.
_XMP_START = b"<x:xmpmeta"
_XMP_END = b"</x:xmpmeta>"
_NUM = r"([+-]?\d+(?:\.\d+)?)"


def extract_photo_metadata(
    db: Session,
    airport_id: UUID,
    photos: list[tuple[str, bytes]],
) -> PhotoMetadataResponse:
    """parse each (filename, bytes) photo into position + lens-height metadata.

    per-image parse failures are reported on the item's ``error`` field rather
    than aborting the batch. the DEM is scoped to ``airport_id``; lens AGL is
    derived only when a real DEM backs the airport.
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    provider, has_dem = _resolve_dem_provider(airport, db)
    try:
        items = [_extract_one(name, raw, provider) for name, raw in photos]
    finally:
        if provider is not None and hasattr(provider, "close"):
            provider.close()

    return PhotoMetadataResponse(items=items, has_dem=has_dem)


def _resolve_dem_provider(airport: Airport, db: Session) -> tuple[ElevationProvider | None, bool]:
    """return a DEM provider for lens-AGL derivation, or (None, False) when flat.

    only a real DEM backs the AGL calc - a flat airport leaves AGL null so the
    coordinator enters it manually (the issue forbids using the flat airport
    elevation as a stand-in for surveyed ground).
    """
    provider = create_elevation_provider(airport, allow_api=False, db=db)
    if isinstance(provider, DEMElevationProvider):
        return provider, True
    if hasattr(provider, "close"):
        provider.close()
    return None, False


def _extract_one(
    filename: str, raw: bytes, provider: ElevationProvider | None
) -> PhotoMetadataItem:
    """parse one photo's bytes into a metadata item, isolating parse failures."""
    try:
        gps = _parse_position(raw)
    except Exception as e:
        logger.warning("failed to parse metadata for %s: %s", filename, e)
        return PhotoMetadataItem(filename=filename, error="failed to parse image metadata")

    if gps is None or gps["lat"] is None or gps["lon"] is None:
        return PhotoMetadataItem(filename=filename, error="no GPS data found")

    lat, lon, msl = gps["lat"], gps["lon"], gps["alt"]
    coordinates = PointZ(coordinates=[lon, lat, msl if msl is not None else 0.0])

    agl: float | None = None
    if provider is not None and msl is not None:
        try:
            agl = msl - provider.get_elevation(lat, lon)
        except Exception as e:
            logger.warning("lens AGL derivation failed for %s: %s", filename, e)

    return PhotoMetadataItem(
        filename=filename,
        coordinates=coordinates,
        lens_height_msl_m=msl,
        lens_height_agl_m=agl,
    )


def _parse_position(raw: bytes) -> dict[str, float | None] | None:
    """combine EXIF GPS and DJI XMP into {lat, lon, alt}; None when no lat/lon.

    lat/lon come from EXIF first (DJI XMP as fallback); the MSL altitude prefers
    DJI's higher-precision AbsoluteAltitude and falls back to EXIF GPSAltitude.
    """
    exif = _parse_exif_gps(raw)
    dji = _parse_dji_xmp(raw)

    lat = (exif or {}).get("lat")
    lon = (exif or {}).get("lon")
    if lat is None:
        lat = dji.get("lat")
    if lon is None:
        lon = dji.get("lon")

    if lat is None or lon is None:
        return None

    alt = dji.get("abs_alt")
    if alt is None and exif is not None:
        alt = exif.get("alt")

    return {"lat": lat, "lon": lon, "alt": alt}


def _parse_exif_gps(raw: bytes) -> dict[str, float | None] | None:
    """read EXIF GPS lat/lon/alt; None when the GPS lat/lon tags are absent."""
    import exifread

    tags = exifread.process_file(io.BytesIO(raw), details=False)
    lat_t = tags.get("GPS GPSLatitude")
    lon_t = tags.get("GPS GPSLongitude")
    lat_ref = tags.get("GPS GPSLatitudeRef")
    lon_ref = tags.get("GPS GPSLongitudeRef")
    if not (lat_t and lon_t and lat_ref and lon_ref):
        return None

    lat = _dms_to_decimal(lat_t.values, _ref_str(lat_ref))
    lon = _dms_to_decimal(lon_t.values, _ref_str(lon_ref))

    alt: float | None = None
    alt_t = tags.get("GPS GPSAltitude")
    if alt_t and alt_t.values:
        alt = _ratio_to_float(alt_t.values[0])
        alt_ref = tags.get("GPS GPSAltitudeRef")
        # ref 1 = below sea level
        if alt_ref is not None and _int_ref(alt_ref) == 1:
            alt = -alt

    return {"lat": lat, "lon": lon, "alt": alt}


def _parse_dji_xmp(raw: bytes) -> dict[str, float | None]:
    """scan the DJI XMP packet for absolute / relative altitude and position."""
    out: dict[str, float | None] = {
        "abs_alt": None,
        "rel_alt": None,
        "lat": None,
        "lon": None,
    }
    start = raw.find(_XMP_START)
    if start == -1:
        return out
    end = raw.find(_XMP_END, start)
    if end == -1:
        return out

    packet = raw[start : end + len(_XMP_END)].decode("utf-8", errors="ignore")
    out["abs_alt"] = _xmp_value(packet, "AbsoluteAltitude")
    out["rel_alt"] = _xmp_value(packet, "RelativeAltitude")
    out["lat"] = _xmp_value(packet, "GpsLatitude") or _xmp_value(packet, "Latitude")
    out["lon"] = _xmp_value(packet, "GpsLongitude") or _xmp_value(packet, "Longitude")
    return out


def _xmp_value(packet: str, name: str) -> float | None:
    """pull a numeric DJI XMP field by name from either attribute or element form."""
    match = re.search(rf'{name}="\s*{_NUM}\s*"', packet)
    if match is None:
        match = re.search(rf"{name}>\s*{_NUM}\s*<", packet)
    if match is None:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _dms_to_decimal(values, ref: str) -> float:
    """convert an EXIF (deg, min, sec) ratio triple plus hemisphere ref to decimal."""
    deg = _ratio_to_float(values[0]) if len(values) > 0 else 0.0
    minutes = _ratio_to_float(values[1]) if len(values) > 1 else 0.0
    seconds = _ratio_to_float(values[2]) if len(values) > 2 else 0.0
    decimal = deg + minutes / 60.0 + seconds / 3600.0
    if ref.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


def _ratio_to_float(ratio) -> float:
    """coerce an exifread Ratio (Fraction subclass) to float, defensively."""
    try:
        return float(ratio)
    except (TypeError, ValueError):
        num = getattr(ratio, "num", getattr(ratio, "numerator", 0))
        den = getattr(ratio, "den", getattr(ratio, "denominator", 1)) or 1
        return num / den


def _ref_str(tag) -> str:
    """normalize an EXIF ref tag to a plain hemisphere string ('N'/'S'/'E'/'W')."""
    value = tag.values
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    return str(value).strip()


def _int_ref(tag) -> int:
    """normalize an EXIF integer ref tag (e.g. GPSAltitudeRef) to int, default 0."""
    value = tag.values
    if isinstance(value, (list, tuple)):
        value = value[0] if value else 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
