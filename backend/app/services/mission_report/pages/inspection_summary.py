"""inspection summary page - list of all inspections with method and template."""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt

from ..chrome import MARGIN, PAGE_H, _draw_footer
from ..data import ReportData
from ..formatting import SEGMENT_COLORS, _format_method_label


def _build_inspection_summary_page(c: canvas.Canvas, data: ReportData):
    """inspection summary page - list of all inspections with method and template."""
    y = PAGE_H - 40 * mm

    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN + 10 * mm, y, "Inspection Summary")
    y -= 10 * mm

    airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0

    for idx, insp in enumerate(data.inspections):
        if y < 30 * mm:
            break
        method_label = _format_method_label(insp.method)
        template_name = insp.template.name if insp.template else "N/A"
        color_hex = SEGMENT_COLORS[idx % len(SEGMENT_COLORS)]

        c.setFillColor(colors.HexColor(color_hex))
        c.rect(MARGIN + 10 * mm, y - 1, 3 * mm, 5 * mm, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(
            MARGIN + 15 * mm,
            y,
            f"#{idx + 1} — {template_name} ({method_label})",
        )
        y -= 7 * mm

        # per-inspection altitude range
        insp_wps = [
            w for w in data.waypoints if w.inspection_id and str(w.inspection_id) == str(insp.id)
        ]
        if insp_wps:
            alts = [point_lonlatalt(w.position)[2] for w in insp_wps]
            min_alt = min(alts)
            max_alt = max(alts)
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#555555"))
            c.drawString(
                MARGIN + 15 * mm,
                y,
                f"Altitude range: {min_alt - airport_elev:.1f} - {max_alt - airport_elev:.1f} m AGL"
                f" ({min_alt:.1f} - {max_alt:.1f} m MSL)"
                f"  |  Waypoints: {len(insp_wps)}",
            )
            y -= 7 * mm
        else:
            y -= 3 * mm

    _draw_footer(c)
    c.showPage()
