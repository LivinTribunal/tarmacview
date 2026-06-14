"""pure formatting helpers, shared constants, and geometry predicates."""

import re

# advisory "near a runway threshold" radius for the crossing-analysis page
RUNWAY_THRESHOLD_PROXIMITY_M = 200

# inspection segment colors
SEGMENT_COLORS = [
    "#2196F3",
    "#4CAF50",
    "#FF9800",
    "#E91E63",
    "#9C27B0",
    "#00BCD4",
    "#FF5722",
    "#795548",
    "#607D8B",
    "#3F51B5",
]


def _format_method_label(method: str) -> str:
    """human-readable inspection-method label derived from the enum value."""
    return method.replace("_", " ").title()


# "crosses RUNWAY 09L" / "crosses TAXIWAY A" inside a surface-crossing warning
_SURFACE_CROSSING_RE = re.compile(r"crosses\s+(RUNWAY|TAXIWAY)\s+(\S+)", re.IGNORECASE)


def _surface_crossing_parts(violation) -> tuple[str, str] | None:
    """return (surface_type, identifier) for a surface-crossing violation, else None.

    decision is driven by the structured violation_kind, not the message text;
    the regex only supplies the displayed type/identifier and is the sole
    classifier for legacy rows persisted before violation_kind was populated.
    """
    kind = getattr(violation, "violation_kind", None)
    m = _SURFACE_CROSSING_RE.search(violation.message or "")
    if kind == "surface_crossing":
        return (m.group(1).upper(), m.group(2)) if m else ("-", "-")
    if kind is None and m:
        return m.group(1).upper(), m.group(2)
    return None


def _sanitize_filename(name: str) -> str:
    """strip special chars, collapse whitespace to underscores, force ascii."""
    sanitized = re.sub(r"[^\w\s-]", "", name)
    sanitized = re.sub(r"\s+", "_", sanitized).strip("_")
    return sanitized.encode("ascii", errors="ignore").decode()


def _format_duration(seconds: float | None) -> str:
    """format seconds into human-readable duration."""
    if seconds is None or seconds <= 0:
        return "N/A"
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    if mins > 0:
        return f"{mins}m {secs}s"
    return f"{secs}s"


def _format_distance(meters: float | None) -> str:
    """format meters into human-readable distance."""
    if meters is None or meters <= 0:
        return "N/A"
    if meters >= 1000:
        return f"{meters / 1000:.2f} km"
    return f"{meters:.1f} m"


def _runway_display_identifier(runway, by_id: dict | None = None) -> str:
    """combine paired runway designators as '01/19'.

    lex-sorts the two ends so '01/19' and '19/01' fold onto the same string.
    falls back to own identifier when uncoupled or when the partner cannot be
    resolved from `by_id`.
    """
    own = runway.identifier or ""
    partner_id = getattr(runway, "paired_surface_id", None)
    if not partner_id:
        return own
    partner_surface = by_id.get(partner_id) if by_id is not None else None
    partner = getattr(partner_surface, "identifier", None) if partner_surface else None
    if partner and partner != own:
        return "/".join(sorted([own, partner]))
    return own


def _dedupe_paired_runways(runways):
    """yield each physical runway once - skips the second side of a coupled pair."""
    seen = set()
    for r in runways:
        if r.id in seen:
            continue
        seen.add(r.id)
        partner_id = getattr(r, "paired_surface_id", None)
        if partner_id:
            seen.add(partner_id)
        yield r


def _should_include_wpml_callout(formats: list[str] | None) -> bool:
    """true when the export bundle contains a wpml-bound format (kmz or wpml)."""
    if not formats:
        return False
    upper = {f.upper() for f in formats if isinstance(f, str)}
    return "KMZ" in upper or "WPML" in upper


def _point_in_polygon(px: float, py: float, polygon: list[tuple[float, float]]) -> bool:
    """ray-casting point-in-polygon test."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside
