"""measurement results report pdf generator.

mirrors ``mission_report`` (matplotlib charts embedded into a reportlab canvas) but
for one measurement run: a cover page with the per-light PASS/FAIL table scored vs
``setting_angle`` +/- ``tolerance``, then per-light angle / intensity / chromaticity
charts rendered from the same pivoted blob the results page reads. read-only.
"""

import io
from datetime import datetime, timezone
from uuid import UUID

import matplotlib
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.schemas.measurement import MeasurementResultsResponse
from app.services import measurement_service
from app.services.mission_report.chrome import (
    CONTENT_W,
    MARGIN,
    PAGE_H,
    PAGE_W,
    _draw_footer,
    _draw_header,
)

matplotlib.use("Agg")

# per-light line colors, mirrors --tv-inspection-* so the pdf reads like the ui
_LIGHT_COLORS = {
    "PAPI_A": "#4595e5",
    "PAPI_B": "#3bbb3b",
    "PAPI_C": "#e5a545",
    "PAPI_D": "#9b59b6",
}
_FALLBACK_COLOR = "#6b6b6b"


def _pass_label(passed: bool | None) -> tuple[str, colors.Color]:
    """map a tri-state pass flag to a label + color."""
    if passed is True:
        return "PASS", colors.HexColor("#3bbb3b")
    if passed is False:
        return "FAIL", colors.HexColor("#e54545")
    return "UNKNOWN", colors.HexColor("#757575")


def _draw_summary_table(c: canvas.Canvas, results: MeasurementResultsResponse, top: float) -> float:
    """per-light PASS/FAIL table; returns the y just below it."""
    headers = ["Light", "Setting", "Tolerance", "Measured", "Result"]
    col_x = [MARGIN, MARGIN + 35 * mm, MARGIN + 65 * mm, MARGIN + 95 * mm, MARGIN + 130 * mm]
    row_h = 8 * mm
    y = top

    c.setFillColor(colors.HexColor("#161616"))
    c.setFont("Helvetica-Bold", 9)
    for x, head in zip(col_x, headers):
        c.drawString(x, y, head)
    y -= 3 * mm
    c.setStrokeColor(colors.HexColor("#CCCCCC"))
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= row_h

    c.setFont("Helvetica", 9)
    for summary in results.summaries:
        c.setFillColor(colors.HexColor("#161616"))
        c.drawString(col_x[0], y, summary.light_name)
        c.drawString(col_x[1], y, _fmt_angle(summary.setting_angle))
        c.drawString(col_x[2], y, _fmt_angle(summary.tolerance))
        c.drawString(col_x[3], y, _fmt_angle(summary.measured_transition_angle))
        label, color = _pass_label(summary.passed)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(col_x[4], y, label)
        c.setFont("Helvetica", 9)
        y -= row_h

    if not results.summaries:
        c.setFillColor(colors.HexColor("#757575"))
        c.drawString(col_x[0], y, "No per-light summaries available.")
        y -= row_h
    return y


def _fmt_angle(value: float | None) -> str:
    """format an angle in degrees, dash when missing."""
    return f"{value:.2f}°" if value is not None else "-"


def _build_cover_page(c: canvas.Canvas, results: MeasurementResultsResponse, label: str) -> None:
    """title, run metadata, and the PASS/FAIL summary table."""
    _draw_header(c, "Measurement Results", 1, title_size=11, page_size=9)
    y = PAGE_H - 32 * mm

    c.setFillColor(colors.HexColor("#161616"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, "PAPI Measurement Report")
    y -= 10 * mm

    c.setFont("Helvetica", 10)
    meta = [
        ("Measurement", str(results.id)),
        ("Inspection", str(results.inspection_id)),
        ("Status", results.status),
        ("Runway heading", _fmt_angle(results.runway_heading)),
        ("Operator", label),
    ]
    for key, value in meta:
        c.setFillColor(colors.HexColor("#6b6b6b"))
        c.drawString(MARGIN, y, f"{key}:")
        c.setFillColor(colors.HexColor("#161616"))
        c.drawString(MARGIN + 40 * mm, y, value)
        y -= 6 * mm

    y -= 6 * mm
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.HexColor("#161616"))
    c.drawString(MARGIN, y, "Transition angles (PASS / FAIL)")
    y -= 8 * mm
    _draw_summary_table(c, results, y)
    _draw_footer(c, label="TarmacView Measurement Report", time_size=8)


def _series_chart(results: MeasurementResultsResponse, attr: str, title: str, ylabel: str) -> bytes:
    """render one per-light timeseries chart (attr off each LightSeriesPoint) to png bytes."""
    fig, ax = plt.subplots(1, 1, figsize=(7, 3.5))
    plotted = False
    for light in results.lights:
        xs = [p.timestamp for p in light.points if getattr(p, attr) is not None]
        ys = [getattr(p, attr) for p in light.points if getattr(p, attr) is not None]
        if not xs:
            continue
        plotted = True
        color = _LIGHT_COLORS.get(light.light_name, _FALLBACK_COLOR)
        ax.plot(xs, ys, label=light.light_name, color=color)
    ax.set_title(title)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel(ylabel)
    ax.grid(True, alpha=0.3)
    if plotted:
        ax.legend(loc="best", fontsize=8)
    else:
        ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def _build_charts_page(
    c: canvas.Canvas, results: MeasurementResultsResponse, page_num: int
) -> None:
    """angle / intensity / chromaticity charts stacked on one page."""
    _draw_header(c, "Measurement Results", page_num, title_size=11, page_size=9)
    charts = [
        _series_chart(results, "angle", "Elevation angle vs time", "Angle (deg)"),
        _series_chart(results, "intensity", "Intensity vs time", "Intensity"),
        _series_chart(
            results, "chromaticity_x", "Chromaticity (red fraction) vs time", "r / (r+g+b)"
        ),
    ]
    y = PAGE_H - 28 * mm
    chart_h = 72 * mm
    for png in charts:
        c.drawImage(
            ImageReader(io.BytesIO(png)),
            MARGIN,
            y - chart_h,
            width=CONTENT_W,
            height=chart_h,
            preserveAspectRatio=True,
            anchor="n",
        )
        y -= chart_h + 4 * mm
    _draw_footer(c, label="TarmacView Measurement Report", time_size=8)


def generate_measurement_report(
    db: Session, measurement_id: UUID, operator_label: str = "N/A"
) -> tuple[bytes, str]:
    """generate the measurement results pdf, returning (bytes, filename).

    reuses ``measurement_service.build_results_data`` so the pdf and the results page
    read the same pivoted blob. ``operator_label`` is rendered on the cover page.
    """
    results = measurement_service.build_results_data(db, measurement_id)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pdf_title = f"MeasurementReport_{measurement_id}_{date_str}"
    c.setTitle(pdf_title)

    _build_cover_page(c, results, operator_label)
    if results.has_results:
        c.showPage()
        _build_charts_page(c, results, 2)

    c.save()
    return buf.getvalue(), f"{pdf_title}.pdf"
