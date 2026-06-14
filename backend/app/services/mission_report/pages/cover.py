"""page 1 - cover/summary."""

from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt

from ..chrome import MARGIN, PAGE_H, PAGE_W, _draw_footer
from ..data import ReportData
from ..formatting import _format_distance, _format_duration
from .inspection_summary import _build_inspection_summary_page


def _build_cover_page(c: canvas.Canvas, data: ReportData):
    """page 1 - cover/summary."""
    y = PAGE_H - 40 * mm

    # title
    c.setFont("Helvetica-Bold", 24)
    c.setFillColor(colors.HexColor("#1a1a1a"))
    c.drawCentredString(PAGE_W / 2, y, "Mission Technical Report")
    y -= 8 * mm
    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawCentredString(PAGE_W / 2, y, "Airport Lighting Inspection")
    y -= 15 * mm

    c.setStrokeColor(colors.HexColor("#3bbb3b"))
    c.setLineWidth(2)
    c.line(MARGIN + 40 * mm, y, PAGE_W - MARGIN - 40 * mm, y)
    y -= 15 * mm

    def _label_value(label: str, value: str, y_pos: float) -> float:
        """draw a label-value pair."""
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawString(MARGIN + 10 * mm, y_pos, label)
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(MARGIN + 65 * mm, y_pos, str(value))
        return y_pos - 7 * mm

    # airport info
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN + 10 * mm, y, "Airport")
    y -= 8 * mm
    airport = data.airport
    y = _label_value("Name", airport.name if airport else "N/A", y)
    y = _label_value("ICAO Code", airport.icao_code if airport else "N/A", y)
    elev_str = f"{airport.elevation:.1f} m MSL" if airport and airport.elevation else "N/A"
    y = _label_value("Elevation", elev_str, y)
    y -= 5 * mm

    # mission info
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN + 10 * mm, y, "Mission")
    y -= 8 * mm
    y = _label_value("Name", data.mission.name or "N/A", y)
    y = _label_value("ID", str(data.mission.id), y)
    y -= 5 * mm

    # drone info
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN + 10 * mm, y, "Drone")
    y -= 8 * mm
    dp = data.drone_profile
    y = _label_value("Name", dp.name if dp else "N/A", y)
    y = _label_value("Manufacturer", dp.manufacturer if dp else "N/A", y)
    y = _label_value("Model", dp.model if dp else "N/A", y)
    y -= 5 * mm

    # flight summary
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN + 10 * mm, y, "Flight Summary")
    y -= 8 * mm
    y = _label_value("Operator", data.operator_label, y)
    y = _label_value("Total Flight Time", _format_duration(data.flight_plan.estimated_duration), y)
    y = _label_value("Total Distance", _format_distance(data.flight_plan.total_distance), y)
    transit_speed = data.mission.default_speed
    y = _label_value("Transit Speed", f"{transit_speed} m/s" if transit_speed else "N/A", y)
    y = _label_value("Inspections", str(len(data.inspections)), y)
    y = _label_value("Waypoints", str(len(data.waypoints)), y)

    # min/max altitude from waypoints
    airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0
    if data.waypoints:
        alts = [point_lonlatalt(w.position)[2] for w in data.waypoints]
        min_msl = min(alts)
        max_msl = max(alts)
        min_agl = min_msl - airport_elev
        max_agl = max_msl - airport_elev
        y = _label_value("Min Altitude", f"{min_agl:.1f} m AGL / {min_msl:.1f} m MSL", y)
        y = _label_value("Max Altitude", f"{max_agl:.1f} m AGL / {max_msl:.1f} m MSL", y)
    y -= 5 * mm

    y = _label_value(
        "Generated",
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        y,
    )

    _draw_footer(c)
    c.showPage()

    if data.inspections:
        _build_inspection_summary_page(c, data)
