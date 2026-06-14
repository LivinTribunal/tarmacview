"""agl markers + per-agl lha dots."""

from app.core.geometry import point_lonlatalt

from ...data import ReportData


def _draw_agls_and_lhas(ax, data: ReportData) -> None:
    """plot agl squares, annotate them, and dot each owning lha."""
    if not (data.airport and data.airport.surfaces):
        return
    for surface in data.airport.surfaces:
        for agl in getattr(surface, "agls", []):
            agl_lon, agl_lat, _ = point_lonlatalt(agl.position)
            ax.plot(
                agl_lon,
                agl_lat,
                "s",
                color="#FF6F00",
                markersize=6,
                zorder=5,
                markeredgecolor="#333333",
                markeredgewidth=0.5,
            )
            ax.annotate(
                agl.name or agl.agl_type,
                (agl_lon, agl_lat),
                fontsize=5,
                color="#FF6F00",
                fontweight="bold",
                textcoords="offset points",
                xytext=(4, 4),
                zorder=7,
            )
            for lha in getattr(agl, "lhas", []):
                lha_lon, lha_lat, _ = point_lonlatalt(lha.position)
                ax.plot(
                    lha_lon,
                    lha_lat,
                    "d",
                    color="#FFB300",
                    markersize=3,
                    zorder=5,
                    markeredgecolor="#333333",
                    markeredgewidth=0.3,
                )
