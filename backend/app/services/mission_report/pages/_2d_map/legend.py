"""legend chips + north arrow."""

import matplotlib.patches as mpatches

from ...data import ReportData
from ...formatting import SEGMENT_COLORS
from . import _ZONE_COLORS


def _draw_legend(ax, data: ReportData) -> None:
    """assemble the legend handles and draw the north-arrow annotation."""
    legend_items = [
        mpatches.Patch(color="#3bbb3b", label="Takeoff"),
        mpatches.Patch(color="#e54545", label="Landing"),
        mpatches.Patch(color="#888888", label="Transit"),
    ]
    for idx, insp in enumerate(data.inspections):
        name = insp.template.name if insp.template else f"Inspection {idx + 1}"
        resolved = {}
        if insp.config:
            tmpl_cfg = insp.template.default_config if insp.template else None
            resolved = insp.config.resolve_with_defaults(tmpl_cfg)
        alt_offset = resolved.get("altitude_offset") or 0
        h_lights = resolved.get("height_above_lights")
        h_lha = resolved.get("height_above_lha")
        detail_parts = [f"AGL offset {alt_offset}m"]
        if h_lights is not None:
            detail_parts.append(f"HAL {h_lights}m")
        if h_lha is not None:
            detail_parts.append(f"H-LHA {h_lha}m")
        label = f"{name} ({', '.join(detail_parts)})"
        legend_items.append(
            mpatches.Patch(
                color=SEGMENT_COLORS[idx % len(SEGMENT_COLORS)],
                label=label,
            )
        )
    if data.airport and data.airport.safety_zones:
        seen_types = set()
        for zone in data.airport.safety_zones:
            if zone.type not in seen_types:
                seen_types.add(zone.type)
                color = _ZONE_COLORS.get(zone.type, "#CCCCCC44")
                label = zone.type.replace("_", " ").title()
                legend_items.append(mpatches.Patch(color=color, alpha=0.3, label=label))
    legend_items.append(mpatches.Patch(color="#FF6F00", label="AGL"))
    legend_items.append(mpatches.Patch(color="#FFB300", label="LHA"))
    ax.legend(
        handles=legend_items,
        loc="upper left",
        bbox_to_anchor=(1.02, 1),
        fontsize=5.5,
        framealpha=0.8,
    )

    # north arrow
    ax.annotate(
        "N",
        xy=(0.97, 0.97),
        xycoords="axes fraction",
        fontsize=10,
        fontweight="bold",
        ha="center",
        va="top",
    )
    ax.annotate(
        "",
        xy=(0.97, 0.97),
        xycoords="axes fraction",
        xytext=(0.97, 0.90),
        textcoords="axes fraction",
        arrowprops={"arrowstyle": "->", "color": "black", "lw": 1.5},
    )
