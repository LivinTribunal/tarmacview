"""2d top-down map rendered with matplotlib."""

import io

import matplotlib
import matplotlib.pyplot as plt
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.core.geometry import polygon_xy

from ..chrome import CONTENT_W, MARGIN, PAGE_H, _draw_footer, _draw_header
from ..data import ReportData
from ._2d_map import (
    _draw_agls_and_lhas,
    _draw_legend,
    _draw_safety_zones,
    _draw_surfaces,
    _draw_trajectory,
)

matplotlib.use("Agg")


def _build_2d_map_page(c: canvas.Canvas, data: ReportData, page_num: int) -> int:
    """2d top-down map rendered with matplotlib."""
    _draw_header(c, "2D Top-Down Map", page_num)

    fig, ax = plt.subplots(1, 1, figsize=(7, 5.5))
    ax.set_aspect("equal")

    # layers in z-order: zones -> surfaces -> agl/lha -> trajectory -> legend/north
    _draw_safety_zones(ax, data)
    _draw_surfaces(ax, data)
    _draw_agls_and_lhas(ax, data)
    wp_lons, wp_lats = _draw_trajectory(ax, data)

    # zoom to trajectory extent (extended by surface bounds) with padding
    if wp_lons:
        all_lons = list(wp_lons)
        all_lats = list(wp_lats)
        if data.airport and data.airport.surfaces:
            for surface in data.airport.surfaces:
                if surface.boundary:
                    coords = polygon_xy(surface.boundary)
                    if coords:
                        s_lons, s_lats = zip(*coords)
                        all_lons.extend(s_lons)
                        all_lats.extend(s_lats)

        lon_min, lon_max = min(all_lons), max(all_lons)
        lat_min, lat_max = min(all_lats), max(all_lats)
        lon_pad = (lon_max - lon_min) * 0.15 or 0.0005
        lat_pad = (lat_max - lat_min) * 0.15 or 0.0005
        ax.set_xlim(lon_min - lon_pad, lon_max + lon_pad)
        ax.set_ylim(lat_min - lat_pad, lat_max + lat_pad)

    _draw_legend(ax, data)

    ax.set_xlabel("Longitude", fontsize=8)
    ax.set_ylabel("Latitude", fontsize=8)
    ax.tick_params(labelsize=6)
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right")
    ax.set_title("Flight Plan - Top Down View", fontsize=10)
    fig.tight_layout()

    img_buf = io.BytesIO()
    fig.savefig(img_buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    img_buf.seek(0)

    c.drawImage(
        ImageReader(img_buf),
        MARGIN,
        PAGE_H - 200 * mm,
        width=CONTENT_W,
        height=160 * mm,
        preserveAspectRatio=True,
    )

    _draw_footer(c)
    c.showPage()
    return page_num
