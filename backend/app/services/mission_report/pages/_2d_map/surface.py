"""runway / taxiway surfaces - paired runways collapse to one boundary + label."""

from app.core.geometry import polygon_xy

from ...data import ReportData
from ...formatting import _dedupe_paired_runways, _runway_display_identifier


def _draw_surfaces(ax, data: ReportData) -> None:
    """fill each surface polygon and label it; paired runways render once as '09L/27R'."""
    if not (data.airport and data.airport.surfaces):
        return
    surfaces_by_id = {s.id: s for s in data.airport.surfaces}
    runways = [s for s in data.airport.surfaces if s.surface_type == "RUNWAY"]
    non_runways = [s for s in data.airport.surfaces if s.surface_type != "RUNWAY"]
    deduped_surfaces = list(_dedupe_paired_runways(runways)) + non_runways
    for surface in deduped_surfaces:
        if not surface.boundary:
            continue
        coords = polygon_xy(surface.boundary)
        if not coords:
            continue
        lons, lats = zip(*coords)
        scolor = "#444444" if surface.surface_type == "RUNWAY" else "#888888"
        ax.fill(lons, lats, color=scolor, alpha=0.4)
        ax.plot(lons, lats, color=scolor, linewidth=1)

        label = (
            _runway_display_identifier(surface, surfaces_by_id)
            if surface.surface_type == "RUNWAY"
            else (surface.identifier or "")
        )
        clat = sum(lats) / len(lats)
        clon = sum(lons) / len(lons)
        ax.text(
            clon,
            clat,
            label,
            ha="center",
            va="center",
            fontsize=7,
            fontweight="bold",
            color="#222222",
        )
