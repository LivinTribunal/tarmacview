"""trajectory path + waypoint dots + takeoff / landing markers."""

from app.core.geometry import point_lonlatalt

from ...data import ReportData
from ...formatting import SEGMENT_COLORS


def _draw_trajectory(ax, data: ReportData) -> tuple[list[float], list[float]]:
    """draw segments, waypoint dots, and start/end markers.

    returns the (wp_lons, wp_lats) lists so the orchestrator can extend the
    zoom bounds.
    """
    if not data.waypoints:
        return [], []

    insp_methods = {str(ins.id): ins.method for ins in data.inspections}

    wp_lons: list[float] = []
    wp_lats: list[float] = []
    wp_alts: list[float] = []
    wp_colors: list[str] = []
    wp_is_vp: list[bool] = []
    for wp in data.waypoints:
        lon, lat, alt = point_lonlatalt(wp.position)
        wp_lons.append(lon)
        wp_lats.append(lat)
        wp_alts.append(alt)
        if wp.inspection_id:
            insp_idx = next(
                (
                    i
                    for i, ins in enumerate(data.inspections)
                    if str(ins.id) == str(wp.inspection_id)
                ),
                0,
            )
            wp_colors.append(SEGMENT_COLORS[insp_idx % len(SEGMENT_COLORS)])
            method = insp_methods.get(str(wp.inspection_id), "")
            wp_is_vp.append(method == "VERTICAL_PROFILE")
        else:
            wp_colors.append("#888888")
            wp_is_vp.append(False)

    # path segments
    for i in range(len(wp_lons) - 1):
        ax.plot(
            [wp_lons[i], wp_lons[i + 1]],
            [wp_lats[i], wp_lats[i + 1]],
            color=wp_colors[i],
            linewidth=1.5,
            alpha=0.8,
            zorder=3,
        )

    # non-vertical-profile waypoint dots first (lower z)
    for i in range(len(wp_lons)):
        if not wp_is_vp[i]:
            ax.plot(
                wp_lons[i],
                wp_lats[i],
                "o",
                color=wp_colors[i],
                markersize=2,
                zorder=4,
            )

    # vertical profile waypoints on top
    for i in range(len(wp_lons)):
        if wp_is_vp[i]:
            ax.plot(
                wp_lons[i],
                wp_lats[i],
                "o",
                color=wp_colors[i],
                markersize=3,
                zorder=6,
            )

    # takeoff / landing markers
    ax.plot(wp_lons[0], wp_lats[0], "^", color="#3bbb3b", markersize=10, zorder=8)
    ax.plot(wp_lons[-1], wp_lats[-1], "v", color="#e54545", markersize=10, zorder=8)

    return wp_lons, wp_lats
