"""safety-zone polygons - filled patches with thin outlines."""

from app.core.geometry import polygon_xy

from ...data import ReportData
from . import _ZONE_COLORS


def _draw_safety_zones(ax, data: ReportData) -> None:
    """fill each safety-zone polygon and outline it."""
    if not (data.airport and data.airport.safety_zones):
        return
    for zone in data.airport.safety_zones:
        coords = polygon_xy(zone.geometry)
        if not coords:
            continue
        lons, lats = zip(*coords)
        color = _ZONE_COLORS.get(zone.type, "#CCCCCC44")
        ax.fill(lons, lats, alpha=0.3, color=color, label=zone.name)
        ax.plot(lons, lats, color=color[:7], linewidth=0.5)
