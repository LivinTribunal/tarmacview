"""vertical altitude profile chart."""

import io

import matplotlib
import matplotlib.pyplot as plt
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt
from app.utils.geo import distance_between

from ..chrome import CONTENT_W, MARGIN, PAGE_H, _draw_footer, _draw_header
from ..data import ReportData
from ..formatting import SEGMENT_COLORS

matplotlib.use("Agg")


def _build_altitude_profile_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """vertical altitude profile chart."""
    _draw_header(c, "Vertical Altitude Profile", page_num)

    fig, ax = plt.subplots(1, 1, figsize=(7, 4))
    airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0

    if data.waypoints:
        distances = [0.0]
        alts_msl = []
        alts_agl = []
        colors_list = []

        prev_lon, prev_lat, prev_alt = point_lonlatalt(data.waypoints[0].position)
        alts_msl.append(prev_alt)
        alts_agl.append(prev_alt - airport_elev)

        for wp in data.waypoints:
            if wp.inspection_id:
                insp_idx = next(
                    (
                        i
                        for i, ins in enumerate(data.inspections)
                        if str(ins.id) == str(wp.inspection_id)
                    ),
                    0,
                )
                colors_list.append(SEGMENT_COLORS[insp_idx % len(SEGMENT_COLORS)])
            else:
                colors_list.append("#888888")

        for wp in data.waypoints[1:]:
            lon, lat, alt = point_lonlatalt(wp.position)
            dist = distance_between(prev_lon, prev_lat, lon, lat)
            distances.append(distances[-1] + dist)
            alts_msl.append(alt)
            alts_agl.append(alt - airport_elev)
            prev_lon, prev_lat = lon, lat

        # color-coded altitude segments (AGL)
        for i in range(len(distances) - 1):
            ax.plot(
                [distances[i], distances[i + 1]],
                [alts_agl[i], alts_agl[i + 1]],
                color=colors_list[i],
                linewidth=2,
            )

        ax.axhline(
            y=0,
            color="#8B4513",
            linewidth=1.5,
            linestyle="--",
            alpha=0.6,
            label="Ground",
        )

        # max altitude constraint
        for constraint in data.constraints:
            if constraint.constraint_type == "ALTITUDE" and constraint.max_altitude:
                max_agl = constraint.max_altitude - airport_elev
                ax.axhline(
                    y=max_agl,
                    color="#e54545",
                    linewidth=1,
                    linestyle=":",
                    alpha=0.7,
                    label="Max Altitude",
                )

        ax.set_xlabel("Distance Along Path (m)", fontsize=8)
        ax.set_ylabel("Altitude AGL (m)", fontsize=8)
        ax.tick_params(labelsize=6)
        ax.grid(True, alpha=0.3)

        # secondary y-axis for MSL with dashed grid lines
        ax2 = ax.twinx()
        agl_min, agl_max = ax.get_ylim()
        ax2.set_ylim(agl_min + airport_elev, agl_max + airport_elev)
        ax2.set_ylabel("Altitude MSL (m)", fontsize=8)
        ax2.tick_params(labelsize=6)
        ax2.grid(True, alpha=0.3, linestyle="--")

        ax.legend(fontsize=6, loc="upper right")
        ax.set_title("Altitude Profile", fontsize=10)

    fig.tight_layout()
    img_buf = io.BytesIO()
    fig.savefig(img_buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    img_buf.seek(0)

    c.drawImage(
        ImageReader(img_buf),
        MARGIN,
        PAGE_H - 160 * mm,
        width=CONTENT_W,
        height=120 * mm,
        preserveAspectRatio=True,
    )

    _draw_footer(c)
    c.showPage()
    return page_num
