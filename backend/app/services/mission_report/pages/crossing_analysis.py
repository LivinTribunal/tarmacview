"""runway crossing and safety zone conflict analysis."""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt, polygon_xy
from app.utils.geo import distance_between

from ..chrome import MARGIN, PAGE_H, PAGE_W, _draw_footer, _draw_header
from ..data import ReportData
from ..formatting import (
    RUNWAY_THRESHOLD_PROXIMITY_M,
    _point_in_polygon,
    _runway_display_identifier,
    _surface_crossing_parts,
)


def _build_crossing_analysis_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """runway crossing and safety zone conflict analysis."""
    _draw_header(c, "Crossing & Conflict Analysis", page_num)
    y = PAGE_H - 25 * mm
    # surface crossings come from the persisted validation result, not a
    # recompute. the orchestrator tags each crossing warning with
    # violation_kind == "surface_crossing" (legacy rows fall back to message
    # classification in _surface_crossing_parts); rendering those rows here
    # instead of re-deriving from waypoint geometry keeps this page in step
    # with the in-app warnings panel and covers RUNWAY + TAXIWAY. waypoint #
    # and min agl are resolved from each warning's structured waypoint_ids.
    airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, "Surface Crossings")
    y -= 7 * mm

    wp_by_id = {str(wp.id): wp for wp in data.waypoints}
    crossings = []
    seen_msgs: set[str] = set()
    for v in data.violations:
        parts = _surface_crossing_parts(v)
        if parts is None:
            continue
        if v.message in seen_msgs:
            continue
        seen_msgs.add(v.message)
        surface_type, identifier = parts
        wps = [wp_by_id[w] for w in (v.waypoint_ids or []) if w in wp_by_id]
        if wps:
            seqs = sorted({wp.sequence_order for wp in wps})
            wp_label = (
                ", ".join(str(s) for s in seqs) if len(seqs) <= 3 else f"{seqs[0]}-{seqs[-1]}"
            )
            agls = [
                wp.agl if wp.agl is not None else point_lonlatalt(wp.position)[2] - airport_elev
                for wp in wps
            ]
            agl_label = f"{min(agls):.1f} m"
        else:
            wp_label = agl_label = "-"
        crossings.append(
            {
                "surface": identifier,
                "type": surface_type,
                "waypoint": wp_label,
                "alt_agl": agl_label,
            }
        )

    if crossings:
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(colors.HexColor("#333333"))
        cross_headers = ["Surface", "Type", "Waypoint #", "Min Altitude AGL"]
        cross_widths = [30 * mm, 25 * mm, 35 * mm, 40 * mm]
        x = MARGIN
        for i, h in enumerate(cross_headers):
            c.drawString(x, y, h)
            x += cross_widths[i]
        y -= 3 * mm
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
        y -= 4 * mm

        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#555555"))
        for cr in crossings:
            if y < 30 * mm:
                break
            x = MARGIN
            c.drawString(x, y, cr["surface"] or "")
            x += cross_widths[0]
            c.drawString(x, y, cr["type"] or "")
            x += cross_widths[1]
            c.drawString(x, y, cr["waypoint"])
            x += cross_widths[2]
            c.drawString(x, y, cr["alt_agl"])
            y -= 4 * mm
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN + 5 * mm, y, "No surface crossings detected.")
        y -= 7 * mm

    # safety zone passes
    y -= 5 * mm
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, "Safety Zone Passes")
    y -= 7 * mm

    zone_passes = []
    if data.airport and data.airport.safety_zones:
        active_zones = [
            z for z in data.airport.safety_zones if z.is_active and z.type != "AIRPORT_BOUNDARY"
        ]
        for wp in data.waypoints:
            wp_lon, wp_lat, _ = point_lonlatalt(wp.position)
            for zone in active_zones:
                zone_coords = polygon_xy(zone.geometry)
                if zone_coords and _point_in_polygon(wp_lon, wp_lat, zone_coords):
                    zone_passes.append(
                        {
                            "zone": zone.name,
                            "type": zone.type,
                            "waypoint": wp.sequence_order,
                        }
                    )

    if zone_passes:
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(colors.HexColor("#333333"))
        zp_headers = ["Zone Name", "Zone Type", "Waypoint #"]
        zp_widths = [50 * mm, 40 * mm, 30 * mm]
        x = MARGIN
        for i, h in enumerate(zp_headers):
            c.drawString(x, y, h)
            x += zp_widths[i]
        y -= 3 * mm
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
        y -= 4 * mm

        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#555555"))
        seen = set()
        for zp in zone_passes:
            key = (zp["zone"], zp["waypoint"])
            if key in seen:
                continue
            seen.add(key)
            if y < 30 * mm:
                break
            x = MARGIN
            c.drawString(x, y, zp["zone"] or "")
            x += zp_widths[0]
            c.drawString(x, y, zp["type"] or "")
            x += zp_widths[1]
            c.drawString(x, y, str(zp["waypoint"]))
            y -= 4 * mm
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN + 5 * mm, y, "No safety zone passes detected.")
        y -= 7 * mm

    # waypoints near runway thresholds - intentionally an independent recompute,
    # not a violation read: the validator emits no kind for threshold proximity
    # (it is advisory geometry, not a safety constraint), so there is no
    # structured field to consume. kept separate by design.
    y -= 5 * mm
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, "Waypoints Near Runway Thresholds")
    y -= 7 * mm

    threshold_warnings = []
    if data.airport and data.airport.surfaces:
        surfaces_by_id = {s.id: s for s in data.airport.surfaces}
        runways = [s for s in data.airport.surfaces if s.surface_type == "RUNWAY"]
        for wp in data.waypoints:
            wp_lon, wp_lat, _ = point_lonlatalt(wp.position)
            for runway in runways:
                if runway.threshold_position:
                    t_lon, t_lat, _ = point_lonlatalt(runway.threshold_position)
                    dist = distance_between(wp_lon, wp_lat, t_lon, t_lat)
                    if dist < RUNWAY_THRESHOLD_PROXIMITY_M:
                        threshold_warnings.append(
                            {
                                # per-end key keeps both thresholds of a pair as distinct rows
                                "end": runway.identifier,
                                "runway": _runway_display_identifier(runway, surfaces_by_id),
                                "waypoint": wp.sequence_order,
                                "distance": dist,
                            }
                        )

    if threshold_warnings:
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#555555"))
        seen = set()
        for tw in threshold_warnings:
            key = (tw["end"], tw["waypoint"])
            if key in seen:
                continue
            seen.add(key)
            if y < 20 * mm:
                break
            qualifier = f" ({tw['end']} threshold)" if tw["runway"] != tw["end"] else " threshold"
            c.drawString(
                MARGIN + 5 * mm,
                y,
                f"WP#{tw['waypoint']} is {tw['distance']:.0f}m from {tw['runway']}{qualifier}",
            )
            y -= 4 * mm
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(
            MARGIN + 5 * mm,
            y,
            f"No waypoints within {RUNWAY_THRESHOLD_PROXIMITY_M:.0f}m of runway thresholds.",
        )

    _draw_footer(c)
    c.showPage()
    return page_num
