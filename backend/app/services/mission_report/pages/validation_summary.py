"""validation summary with constraint results and battery analysis."""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from ..chrome import MARGIN, PAGE_H, _draw_footer, _draw_header
from ..data import ReportData
from ..formatting import _format_duration


def _build_validation_summary_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """validation summary with constraint results and battery analysis."""
    _draw_header(c, "Validation Summary", page_num)
    y = PAGE_H - 25 * mm

    # overall status
    c.setFont("Helvetica-Bold", 14)
    if data.validation_result:
        if data.validation_result.passed:
            c.setFillColor(colors.HexColor("#3bbb3b"))
            c.drawString(MARGIN, y, "PASSED")
        else:
            c.setFillColor(colors.HexColor("#e54545"))
            c.drawString(MARGIN, y, "FAILED")
    else:
        c.setFillColor(colors.HexColor("#e5a545"))
        c.drawString(MARGIN, y, "NOT VALIDATED")
    y -= 10 * mm

    # constraint results
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, "Constraint Results")
    y -= 7 * mm

    if data.constraints:
        c.setFont("Helvetica", 8)
        for constraint in data.constraints:
            if y < 30 * mm:
                break
            icon = "●"
            has_violation = any(
                v.constraint_id
                and str(v.constraint_id) == str(constraint.id)
                and v.category == "violation"
                for v in data.violations
            )
            if has_violation:
                c.setFillColor(colors.HexColor("#e54545"))
            else:
                c.setFillColor(colors.HexColor("#3bbb3b"))
            c.drawString(MARGIN + 5 * mm, y, icon)
            c.setFillColor(colors.HexColor("#333333"))
            hard_soft = "Hard" if constraint.is_hard_constraint else "Soft"
            c.drawString(MARGIN + 10 * mm, y, f"{constraint.name} ({hard_soft})")
            y -= 5 * mm
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN + 5 * mm, y, "No constraints defined.")
        y -= 7 * mm

    # violations
    y -= 5 * mm
    violations = [v for v in data.violations if v.category == "violation"]
    warnings = [v for v in data.violations if v.category != "violation"]

    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, f"Violations ({len(violations)})")
    y -= 7 * mm

    if violations:
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#e54545"))
        for v in violations[:15]:
            if y < 30 * mm:
                break
            c.drawString(MARGIN + 5 * mm, y, f"• {v.message}")
            y -= 4.5 * mm
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#3bbb3b"))
        c.drawString(MARGIN + 5 * mm, y, "No violations.")
        y -= 5 * mm

    y -= 5 * mm
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, f"Warnings ({len(warnings)})")
    y -= 7 * mm

    if warnings:
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#e5a545"))
        for w in warnings[:15]:
            if y < 30 * mm:
                break
            c.drawString(MARGIN + 5 * mm, y, f"• {w.message}")
            y -= 4.5 * mm

    # battery analysis
    y -= 8 * mm
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawString(MARGIN, y, "Battery Analysis")
    y -= 7 * mm

    dp = data.drone_profile
    fp = data.flight_plan
    if dp and dp.endurance_minutes and fp and fp.estimated_duration:
        endurance_secs = dp.endurance_minutes * 60
        usage_pct = (fp.estimated_duration / endurance_secs) * 100
        remaining_pct = max(0, 100 - usage_pct)

        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN + 5 * mm, y, f"Drone Endurance: {dp.endurance_minutes:.0f} min")
        y -= 5 * mm
        dur_str = _format_duration(fp.estimated_duration)
        c.drawString(MARGIN + 5 * mm, y, f"Est. Flight Time: {dur_str}")
        y -= 5 * mm
        c.drawString(MARGIN + 5 * mm, y, f"Est. Battery Usage: {usage_pct:.1f}%")
        y -= 5 * mm

        if remaining_pct < 20:
            c.setFillColor(colors.HexColor("#e54545"))
        elif remaining_pct < 40:
            c.setFillColor(colors.HexColor("#e5a545"))
        else:
            c.setFillColor(colors.HexColor("#3bbb3b"))
        c.drawString(MARGIN + 5 * mm, y, f"Est. Remaining: {remaining_pct:.1f}%")
    else:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        msg = "Battery analysis not available (no drone profile or duration)."
        c.drawString(MARGIN + 5 * mm, y, msg)

    _draw_footer(c)
    c.showPage()
    return page_num
