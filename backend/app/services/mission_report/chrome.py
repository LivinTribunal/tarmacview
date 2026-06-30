"""page chrome - shared page geometry and the per-page header/footer."""

from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


def _draw_header(c: canvas.Canvas, title: str, page_num: int, *, title_size=10, page_size=8):
    """draw page header with title and page number (font sizes default to the mission report)."""
    c.setFont("Helvetica-Bold", title_size)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, PAGE_H - 15 * mm, title)
    c.setFont("Helvetica", page_size)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 15 * mm, f"Page {page_num}")
    c.setStrokeColor(colors.HexColor("#CCCCCC"))
    c.line(MARGIN, PAGE_H - 18 * mm, PAGE_W - MARGIN, PAGE_H - 18 * mm)


def _draw_footer(c: canvas.Canvas, *, label="TarmacView Mission Technical Report", time_size=7):
    """draw page footer (label + time-stamp font size default to the mission report)."""
    c.setFont("Helvetica", time_size)
    c.setFillColor(colors.HexColor("#999999"))
    c.drawString(MARGIN, 10 * mm, label)
    c.drawRightString(
        PAGE_W - MARGIN,
        10 * mm,
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )
