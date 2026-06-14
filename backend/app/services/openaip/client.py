"""openaip http client + lookup orchestration: client/auth, GET wrapper, lookup_airport_by_icao."""

import logging
import re
from typing import Any

import httpx

from app.core.config import settings
from app.core.constants import METERS_PER_KM
from app.core.exceptions import DomainError, NotFoundError
from app.schemas.geometry import PointZ
from app.schemas.openaip import (
    AirportLookupResponse,
    ObstacleSuggestion,
    RunwaySuggestion,
    SafetyZoneSuggestion,
)

from .parsers import (
    _extract_elevation,
    _extract_point,
    _parse_airspace,
    _parse_obstacle,
    _parse_runway,
)

logger = logging.getLogger(__name__)

_ICAO_PATTERN = re.compile(r"^[A-Z]{4}$")


# http client
def _client() -> httpx.Client:
    """build an httpx client with the configured timeout.

    raises DomainError(503) if no api key is configured.
    """
    if not settings.openaip_api_key:
        raise DomainError(
            "openaip api key not configured",
            status_code=503,
        )

    return httpx.Client(timeout=settings.openaip_request_timeout)


def _get(client: httpx.Client, path: str, params: dict | None = None) -> dict:
    """GET wrapper that injects auth header and maps errors to DomainError."""
    url = f"{settings.openaip_api_url.rstrip('/')}{path}"
    q = dict(params or {})
    headers = {"x-openaip-api-key": settings.openaip_api_key}

    try:
        resp = client.get(url, params=q, headers=headers)
    except httpx.TimeoutException as e:
        raise DomainError("openaip request timed out", status_code=502) from e
    except httpx.HTTPError as e:
        raise DomainError(f"openaip request failed: {e}", status_code=502) from e

    if resp.status_code == 404:
        raise NotFoundError("openaip resource not found")
    if resp.status_code == 401 or resp.status_code == 403:
        raise DomainError("openaip authentication failed", status_code=503)
    if resp.status_code >= 500:
        raise DomainError(f"openaip upstream error ({resp.status_code})", status_code=502)
    if resp.status_code >= 400:
        raise DomainError(f"openaip request rejected ({resp.status_code})", status_code=502)

    try:
        return resp.json()
    except ValueError as e:
        raise DomainError("openaip returned invalid json", status_code=502) from e


# response shape helpers
def _extract_items(payload: Any) -> list[dict]:
    """extract the item list from an openaip response, tolerating various shapes."""
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]

    if isinstance(payload, dict):
        for key in ("items", "data", "results"):
            v = payload.get(key)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]

    return []


def _pick_matching_airport(items: list[dict], icao: str) -> dict | None:
    """choose the airport whose icao code matches exactly, or None if no match."""
    for item in items:
        code = (item.get("icaoCode") or item.get("icao") or "").upper()
        if code == icao:
            return item

    if items:
        # openaip search is fuzzy - returning the first result risks pre-filling the
        # form with the wrong airport. log and let the caller raise NotFoundError.
        logger.warning(
            "openaip: no exact icao match for %s; %d unrelated result(s) discarded",
            icao,
            len(items),
        )

    return None


def _fetch_nearby_airspaces(
    client: httpx.Client, lat: float, lon: float, radius_km: float
) -> list[SafetyZoneSuggestion]:
    """fetch airspaces near a point and parse mapped ones."""
    try:
        payload = _get(
            client,
            "/airspaces",
            params={"pos": f"{lat},{lon}", "dist": radius_km * METERS_PER_KM, "limit": 100},
        )
    except NotFoundError:
        return []
    except DomainError as e:
        logger.warning("openaip airspace fetch failed: %s", e)
        return []

    out: list[SafetyZoneSuggestion] = []
    for item in _extract_items(payload):
        parsed = _parse_airspace(item)
        if parsed is not None:
            out.append(parsed)

    return out


def _fetch_nearby_obstacles(
    client: httpx.Client,
    lat: float,
    lon: float,
    radius_km: float,
    airport_elevation: float,
) -> list[ObstacleSuggestion]:
    """fetch obstacles near a point and parse them."""
    try:
        payload = _get(
            client,
            "/obstacles",
            params={"pos": f"{lat},{lon}", "dist": radius_km * METERS_PER_KM, "limit": 100},
        )
    except NotFoundError:
        return []
    except DomainError as e:
        logger.warning("openaip obstacle fetch failed: %s", e)
        return []

    out: list[ObstacleSuggestion] = []
    for item in _extract_items(payload):
        parsed = _parse_obstacle(item, airport_elevation)
        if parsed is not None:
            out.append(parsed)

    return out


# public api
def lookup_airport_by_icao(icao_code: str, radius_km: float = 3.0) -> AirportLookupResponse:
    """fetch airport + nearby airspaces + nearby obstacles for an icao code.

    raises NotFoundError if no airport matches the icao code.
    raises DomainError(503) when api key is missing / auth fails.
    raises DomainError(502) on upstream failures.
    """
    if not (0 < radius_km <= 50):
        raise DomainError("radius_km must be between 0 and 50", status_code=400)

    icao = (icao_code or "").strip().upper()
    if not _ICAO_PATTERN.match(icao):
        raise DomainError(
            "icao_code must be exactly 4 uppercase letters",
            status_code=400,
        )

    with _client() as client:
        search = _get(
            client,
            "/airports",
            params={"search": icao, "searchOptLwc": "true", "limit": 10},
        )
        items = _extract_items(search)
        airport = _pick_matching_airport(items, icao)
        if airport is None:
            raise NotFoundError(f"no airport found for ICAO {icao}")

        location = _extract_point(airport.get("geometry"))
        if location is None:
            raise DomainError("openaip airport is missing coordinates", status_code=502)

        lon, lat = location
        elevation = _extract_elevation(airport.get("elevation")) or 0.0

        runways_raw = airport.get("runways") or []
        runways: list[RunwaySuggestion] = []
        for rw in runways_raw:
            runways.extend(_parse_runway(rw, elevation, airport_center=(lon, lat)))

        airspaces = _fetch_nearby_airspaces(client, lat, lon, radius_km)
        obstacles = _fetch_nearby_obstacles(client, lat, lon, radius_km, elevation)

    return AirportLookupResponse(
        icao_code=icao,
        name=str(airport.get("name") or icao),
        city=airport.get("city") or None,
        country=airport.get("country") or None,
        elevation=float(elevation),
        location=PointZ(type="Point", coordinates=[lon, lat, float(elevation)]),
        runways=runways,
        obstacles=obstacles,
        safety_zones=airspaces,
    )
