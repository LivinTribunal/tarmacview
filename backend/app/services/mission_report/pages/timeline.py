"""gantt-style timeline and time-based flight plan table."""

import io

import matplotlib
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt
from app.utils.geo import distance_between

from ..chrome import CONTENT_W, MARGIN, PAGE_H, PAGE_W, _draw_footer, _draw_header
from ..data import ReportData
from ..formatting import SEGMENT_COLORS, _format_duration

matplotlib.use("Agg")


def _build_timeline_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """gantt-style timeline and time-based flight plan table."""
    _draw_header(c, "Time-Based Flight Plan", page_num)

    activities = _build_activities(data)

    fig, ax = plt.subplots(1, 1, figsize=(7, 3))

    if activities:
        labels = []
        for i, act in enumerate(activities):
            ax.barh(
                i,
                act["duration"],
                left=act["start"],
                color=act["color"],
                height=0.6,
                alpha=0.8,
            )
            labels.append(act["name"])

        ax.set_yticks(range(len(labels)))
        ax.set_yticklabels(labels, fontsize=7)
        ax.set_xlabel("Time (seconds)", fontsize=8)
        ax.set_title("Flight Timeline", fontsize=10)
        ax.tick_params(labelsize=6)
        ax.invert_yaxis()
        ax.grid(True, alpha=0.3, axis="x")

    fig.tight_layout()
    img_buf = io.BytesIO()
    fig.savefig(img_buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    img_buf.seek(0)

    c.drawImage(
        ImageReader(img_buf),
        MARGIN,
        PAGE_H - 120 * mm,
        width=CONTENT_W,
        height=80 * mm,
        preserveAspectRatio=True,
    )

    # time table below chart
    y = PAGE_H - 130 * mm
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(colors.HexColor("#333333"))
    headers = ["Time", "Activity", "Position", "Alt (m)", "Speed (m/s)"]
    col_widths = [25 * mm, 40 * mm, 50 * mm, 25 * mm, 25 * mm]
    x = MARGIN
    for i, h in enumerate(headers):
        c.drawString(x, y, h)
        x += col_widths[i]
    y -= 4 * mm
    c.setStrokeColor(colors.HexColor("#CCCCCC"))
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= 5 * mm

    c.setFont("Helvetica", 7)
    c.setFillColor(colors.HexColor("#555555"))

    elapsed = 0.0
    prev_coords = None
    for wp in data.waypoints[:30]:
        if y < 20 * mm:
            break
        lon, lat, alt = point_lonlatalt(wp.position)
        agl = alt - (data.airport.elevation if data.airport and data.airport.elevation else 0)
        x = MARGIN
        c.drawString(x, y, _format_duration(elapsed))
        x += col_widths[0]
        c.drawString(x, y, wp.waypoint_type or "")
        x += col_widths[1]
        c.drawString(x, y, f"{lat:.5f}, {lon:.5f}")
        x += col_widths[2]
        c.drawString(x, y, f"{agl:.1f}")
        x += col_widths[3]
        c.drawString(x, y, f"{wp.speed or 0:.1f}")
        y -= 4 * mm

        # estimate time advance
        if prev_coords and wp.speed and wp.speed > 0:
            dist = distance_between(prev_coords[0], prev_coords[1], lon, lat)
            elapsed += dist / wp.speed
        if wp.hover_duration:
            elapsed += wp.hover_duration

        prev_coords = (lon, lat)

    _draw_footer(c)
    c.showPage()
    return page_num


def _build_activities(data: ReportData) -> list[dict]:
    """build activity list from waypoints for the timeline gantt chart."""
    activities = []
    current_time = 0.0
    current_activity = None
    activity_start = 0.0

    prev_coords = None
    for wp in data.waypoints:
        lon, lat, alt = point_lonlatalt(wp.position)

        # estimate segment duration
        seg_duration = 0.0
        if prev_coords and wp.speed and wp.speed > 0:
            dist = distance_between(prev_coords[0], prev_coords[1], lon, lat)
            seg_duration = dist / wp.speed
        if wp.hover_duration:
            seg_duration += wp.hover_duration

        # determine activity type
        if wp.waypoint_type == "TAKEOFF":
            activity_name = "Takeoff"
            color = "#3bbb3b"
        elif wp.waypoint_type == "LANDING":
            activity_name = "Landing"
            color = "#e54545"
        elif wp.inspection_id:
            insp_idx = next(
                (
                    i
                    for i, ins in enumerate(data.inspections)
                    if str(ins.id) == str(wp.inspection_id)
                ),
                0,
            )
            insp = data.inspections[insp_idx] if insp_idx < len(data.inspections) else None
            name = insp.template.name if insp and insp.template else f"Inspection {insp_idx + 1}"
            activity_name = name
            color = SEGMENT_COLORS[insp_idx % len(SEGMENT_COLORS)]
        else:
            activity_name = "Transit"
            color = "#888888"

        if activity_name != current_activity:
            if current_activity is not None and activities:
                activities[-1]["duration"] = max(current_time - activity_start, 1.0)
            current_activity = activity_name
            activity_start = current_time
            activities.append(
                {
                    "name": activity_name,
                    "start": activity_start,
                    "duration": 0,
                    "color": color,
                }
            )

        current_time += seg_duration
        prev_coords = (lon, lat)

    # finalize last activity
    if activities:
        activities[-1]["duration"] = max(current_time - activity_start, 1.0)

    # remove zero-duration placeholder entries
    return [a for a in activities if a["duration"] > 0]
