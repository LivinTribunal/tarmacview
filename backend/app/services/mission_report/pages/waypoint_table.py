"""full waypoint table."""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt

from ..chrome import MARGIN, PAGE_H, PAGE_W, _draw_footer, _draw_header
from ..data import ReportData


def _build_waypoint_table_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """full waypoint table."""
    _draw_header(c, "Waypoint Table", page_num)
    airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0

    y = PAGE_H - 25 * mm

    # headers
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(colors.HexColor("#333333"))
    col_headers = [
        "#",
        "Type",
        "Lat",
        "Lon",
        "Alt MSL",
        "Alt AGL",
        "Speed",
        "Heading",
        "Camera",
        "Inspection",
    ]
    col_widths = [
        8 * mm,
        18 * mm,
        22 * mm,
        22 * mm,
        16 * mm,
        16 * mm,
        14 * mm,
        16 * mm,
        20 * mm,
        20 * mm,
    ]
    x = MARGIN
    for i, h in enumerate(col_headers):
        c.drawString(x, y, h)
        x += col_widths[i]
    y -= 3.5 * mm
    c.setStrokeColor(colors.HexColor("#CCCCCC"))
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= 4 * mm

    c.setFont("Helvetica", 6.5)
    c.setFillColor(colors.HexColor("#555555"))

    for wp in data.waypoints:
        if y < 20 * mm:
            _draw_footer(c)
            c.showPage()
            page_num += 1
            _draw_header(c, "Waypoint Table (cont.)", page_num)
            y = PAGE_H - 25 * mm

            # re-draw headers
            c.setFont("Helvetica-Bold", 7)
            c.setFillColor(colors.HexColor("#333333"))
            x = MARGIN
            for i, h in enumerate(col_headers):
                c.drawString(x, y, h)
                x += col_widths[i]
            y -= 3.5 * mm
            c.line(MARGIN, y, PAGE_W - MARGIN, y)
            y -= 4 * mm
            c.setFont("Helvetica", 6.5)
            c.setFillColor(colors.HexColor("#555555"))

        lon, lat, alt = point_lonlatalt(wp.position)
        agl = alt - airport_elev

        # find inspection name
        insp_name = ""
        if wp.inspection_id:
            for ins in data.inspections:
                if str(ins.id) == str(wp.inspection_id):
                    insp_name = ins.template.name if ins.template else ""
                    break

        x = MARGIN
        vals = [
            str(wp.sequence_order),
            wp.waypoint_type or "",
            f"{lat:.6f}",
            f"{lon:.6f}",
            f"{alt:.1f}",
            f"{agl:.1f}",
            f"{wp.speed or 0:.1f}",
            f"{wp.heading or 0:.0f}°",
            wp.camera_action or "NONE",
            insp_name[:12],
        ]
        for i, v in enumerate(vals):
            c.drawString(x, y, v)
            x += col_widths[i]
        y -= 3.5 * mm

    _draw_footer(c)
    c.showPage()
    return page_num
