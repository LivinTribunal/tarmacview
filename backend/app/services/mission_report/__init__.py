"""mission technical report pdf generator.

the 1716-line `mission_report_service` module was split into this package:
`formatting` (pure helpers), `data` (`ReportData` + `_load_report_data`, the
only db-touching code), `chrome` (page geometry + header/footer), and
`pages/*` (one module per pdf page). this `__init__` is the orchestrator and
re-exports the prior module's public surface so callers can switch over with a
one-line import rename (`from app.services import mission_report as
mission_report_service`).
"""

import io
from datetime import datetime, timezone
from uuid import UUID

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from .data import ReportData, _load_report_data
from .formatting import (
    RUNWAY_THRESHOLD_PROXIMITY_M,
    SEGMENT_COLORS,
    _dedupe_paired_runways,
    _format_distance,
    _format_duration,
    _format_method_label,
    _point_in_polygon,
    _runway_display_identifier,
    _sanitize_filename,
    _should_include_wpml_callout,
    _surface_crossing_parts,
)
from .pages import (
    _build_2d_map_page,
    _build_activities,
    _build_altitude_profile_page,
    _build_cover_page,
    _build_crossing_analysis_page,
    _build_inspection_detail_pages,
    _build_inspection_summary_page,
    _build_timeline_page,
    _build_validation_summary_page,
    _build_waypoint_table_page,
)
from .pages.inspection_detail import _wpml_preset_fields

__all__ = [
    "RUNWAY_THRESHOLD_PROXIMITY_M",
    "SEGMENT_COLORS",
    "ReportData",
    "_build_2d_map_page",
    "_build_activities",
    "_build_altitude_profile_page",
    "_build_cover_page",
    "_build_crossing_analysis_page",
    "_build_inspection_detail_pages",
    "_build_inspection_summary_page",
    "_build_timeline_page",
    "_build_validation_summary_page",
    "_build_waypoint_table_page",
    "_dedupe_paired_runways",
    "_format_distance",
    "_format_duration",
    "_format_method_label",
    "_load_report_data",
    "_point_in_polygon",
    "_runway_display_identifier",
    "_sanitize_filename",
    "_should_include_wpml_callout",
    "_surface_crossing_parts",
    "_wpml_preset_fields",
    "generate_mission_report",
]


def generate_mission_report(
    db: Session,
    mission_id: UUID,
    formats: list[str] | None = None,
    operator_label: str = "N/A",
) -> tuple[bytes, str]:
    """generate a mission technical report pdf.

    when ``formats`` includes KMZ or WPML, the per-inspection detail section
    appends a callout listing the camera fields that must be preset on the
    controller before flight: wpml 1.0.2 has no per-waypoint action for them.

    ``operator_label`` is rendered as the cover-page Operator field.
    """
    data = _load_report_data(db, mission_id)
    data.operator_label = operator_label

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)

    icao = data.airport.icao_code or "XXXX"
    mission_name = _sanitize_filename(data.mission.name or "Mission")
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pdf_title = f"MissionReport_{icao}_{mission_name}_{date_str}"
    c.setTitle(pdf_title)

    include_wpml_callout = _should_include_wpml_callout(formats)

    page = 1
    _build_cover_page(c, data)
    if data.inspections:
        page += 1
    page = _build_inspection_detail_pages(
        c, data, page + 1, include_wpml_callout=include_wpml_callout
    )
    page = _build_2d_map_page(c, data, page + 1)
    page = _build_altitude_profile_page(c, data, page + 1)
    page = _build_timeline_page(c, data, page + 1)
    page = _build_waypoint_table_page(c, data, page + 1)
    page = _build_crossing_analysis_page(c, data, page + 1)
    _build_validation_summary_page(c, data, page + 1)

    c.save()

    filename = f"{pdf_title}.pdf"
    return buf.getvalue(), filename
