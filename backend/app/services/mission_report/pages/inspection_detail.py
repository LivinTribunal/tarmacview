"""inspection detail pages - one section per inspection."""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.geometry import point_lonlatalt

from ..chrome import MARGIN, PAGE_H, _draw_footer, _draw_header
from ..data import ReportData
from ..formatting import SEGMENT_COLORS, _format_method_label

_WPML_PRESET_FIELDS = (
    ("white_balance", "White Balance"),
    ("iso", "ISO"),
    ("shutter_speed", "Shutter Speed"),
    ("focus_mode", "Focus Mode"),
)


def _wpml_preset_fields(resolved: dict, has_drone_profile: bool) -> list[tuple[str, str]]:
    """label/value pairs for camera fields the operator must preset on the controller.

    optical_zoom is only included when there's no drone profile attached -
    with a profile, the export emits it via wpml focalLength/zoomFactor.
    """
    fields: list[tuple[str, str]] = []
    for key, label in _WPML_PRESET_FIELDS:
        val = resolved.get(key)
        if val is not None:
            fields.append((label, str(val)))
    if not has_drone_profile:
        zoom = resolved.get("optical_zoom")
        if zoom is not None:
            fields.append(("Optical Zoom", f"{zoom}x"))
    return fields


def _build_inspection_detail_pages(
    c: canvas.Canvas,
    data: ReportData,
    page_num: int,
    *,
    include_wpml_callout: bool = False,
) -> int:
    """inspection detail pages - one section per inspection."""
    if not data.inspections:
        _draw_header(c, "Inspection Procedures Detail", page_num)
        c.setFont("Helvetica", 10)
        c.drawString(MARGIN, PAGE_H - 30 * mm, "No inspections configured.")
        _draw_footer(c)
        c.showPage()
        return page_num

    y = PAGE_H - 25 * mm
    _draw_header(c, "Inspection Procedures Detail", page_num)

    for idx, insp in enumerate(data.inspections):
        if y < 60 * mm:
            _draw_footer(c)
            c.showPage()
            page_num += 1
            _draw_header(c, "Inspection Procedures Detail (cont.)", page_num)
            y = PAGE_H - 25 * mm

        # inspection header
        template_name = insp.template.name if insp.template else "N/A"
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(colors.HexColor("#1a1a1a"))
        color_hex = SEGMENT_COLORS[idx % len(SEGMENT_COLORS)]
        c.setFillColor(colors.HexColor(color_hex))
        c.rect(MARGIN, y - 1, 3 * mm, 5 * mm, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#1a1a1a"))
        c.drawString(MARGIN + 5 * mm, y, f"Inspection #{idx + 1} — {template_name}")
        y -= 7 * mm

        method_label = _format_method_label(insp.method)
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(MARGIN + 5 * mm, y, f"Method: {method_label}")
        y -= 6 * mm

        # resolve config
        resolved = {}
        if insp.config:
            template_cfg = insp.template.default_config if insp.template else None
            resolved = insp.config.resolve_with_defaults(template_cfg)

        # flight parameters
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(MARGIN + 5 * mm, y, "Flight Parameters")
        y -= 5 * mm
        c.setFont("Helvetica", 8)

        alt_offset = resolved.get("altitude_offset") or data.mission.default_altitude_offset or 0
        c.drawString(MARGIN + 10 * mm, y, f"Altitude Offset: {alt_offset} m")
        y -= 4.5 * mm

        meas_speed = (
            resolved.get("measurement_speed_override") or data.mission.measurement_speed_override
        )
        if meas_speed:
            c.drawString(MARGIN + 10 * mm, y, f"Measurement Speed: {meas_speed} m/s")
            y -= 4.5 * mm

        buffer_dist = resolved.get("buffer_distance") or data.mission.default_buffer_distance
        if buffer_dist:
            c.drawString(MARGIN + 10 * mm, y, f"Buffer Distance: {buffer_dist} m")
            y -= 4.5 * mm

        # camera parameters
        y -= 2 * mm
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(MARGIN + 5 * mm, y, "Camera Parameters")
        y -= 5 * mm
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#555555"))

        capture = resolved.get("capture_mode") or data.mission.default_capture_mode or "N/A"
        c.drawString(MARGIN + 10 * mm, y, f"Capture Mode: {capture}")
        y -= 4.5 * mm

        gimbal = resolved.get("camera_gimbal_angle")
        if gimbal is not None:
            c.drawString(MARGIN + 10 * mm, y, f"Gimbal Angle: {gimbal}°")
            y -= 4.5 * mm

        dp = data.drone_profile
        if dp:
            if dp.sensor_fov:
                c.drawString(MARGIN + 10 * mm, y, f"Sensor FOV: {dp.sensor_fov}°")
                y -= 4.5 * mm
            if dp.camera_resolution:
                c.drawString(MARGIN + 10 * mm, y, f"Resolution: {dp.camera_resolution}")
                y -= 4.5 * mm
            if dp.camera_frame_rate:
                c.drawString(MARGIN + 10 * mm, y, f"Frame Rate: {dp.camera_frame_rate} fps")
                y -= 4.5 * mm

        recording_dur = resolved.get("recording_setup_duration")
        if recording_dur:
            c.drawString(MARGIN + 10 * mm, y, f"Recording Setup: {recording_dur}s")
            y -= 4.5 * mm

        # night camera settings
        _cam_fields = [
            ("white_balance", "White Balance", None),
            ("iso", "ISO", None),
            ("shutter_speed", "Shutter Speed", None),
            ("focus_mode", "Focus Mode", None),
            ("optical_zoom", "Optical Zoom", "x"),
        ]
        _has_cam = any(resolved.get(f[0]) is not None for f in _cam_fields)
        if _has_cam:
            y -= 2 * mm
            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(colors.HexColor("#333333"))
            c.drawString(MARGIN + 5 * mm, y, "Night Camera Settings")
            y -= 5 * mm
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#555555"))
            for key, label, suffix in _cam_fields:
                val = resolved.get(key)
                if val is not None:
                    display = f"{label}: {val}{suffix}" if suffix else f"{label}: {val}"
                    c.drawString(MARGIN + 10 * mm, y, display)
                    y -= 4.5 * mm

        # wpml controller-preset callout
        if include_wpml_callout:
            preset_fields = _wpml_preset_fields(resolved, data.drone_profile is not None)
            if preset_fields:
                if y < 60 * mm:
                    _draw_footer(c)
                    c.showPage()
                    page_num += 1
                    _draw_header(c, "Inspection Procedures Detail (cont.)", page_num)
                    y = PAGE_H - 25 * mm
                y -= 2 * mm
                c.setFont("Helvetica-Bold", 9)
                c.setFillColor(colors.HexColor("#b3541e"))
                c.drawString(
                    MARGIN + 5 * mm,
                    y,
                    "Settings to preset on the controller before flight (WPML 1.0.2 limitation)",
                )
                y -= 5 * mm
                c.setFont("Helvetica", 8)
                c.setFillColor(colors.HexColor("#555555"))
                for label, val in preset_fields:
                    c.drawString(MARGIN + 10 * mm, y, f"{label}: {val}")
                    y -= 4.5 * mm

        # measurement parameters
        y -= 2 * mm
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(MARGIN + 5 * mm, y, "Measurement Parameters")
        y -= 5 * mm
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#555555"))

        density = resolved.get("measurement_density")
        if density:
            c.drawString(MARGIN + 10 * mm, y, f"Density: {density} waypoints")
            y -= 4.5 * mm

        sweep = resolved.get("sweep_angle")
        if sweep:
            c.drawString(MARGIN + 10 * mm, y, f"Sweep Angle: ±{sweep}°")
            y -= 4.5 * mm

        angle_start = resolved.get("angle_start")
        angle_end = resolved.get("angle_end")
        if angle_start is not None or angle_end is not None:
            start_str = f"{angle_start}°" if angle_start is not None else "default"
            end_str = f"{angle_end}°" if angle_end is not None else "default"
            c.drawString(
                MARGIN + 10 * mm,
                y,
                f"Vertical Profile Climb: {start_str} - {end_str}",
            )
            y -= 4.5 * mm

        horiz_dist = resolved.get("horizontal_distance")
        if horiz_dist:
            c.drawString(MARGIN + 10 * mm, y, f"Horizontal Distance: {horiz_dist} m")
            y -= 4.5 * mm

        # waypoint summary for this inspection
        insp_wps = [
            w for w in data.waypoints if w.inspection_id and str(w.inspection_id) == str(insp.id)
        ]
        if insp_wps:
            y -= 2 * mm
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#555555"))
            meas_count = sum(1 for w in insp_wps if w.waypoint_type == "MEASUREMENT")
            hover_count = sum(1 for w in insp_wps if w.waypoint_type == "HOVER")
            c.drawString(
                MARGIN + 10 * mm,
                y,
                f"Waypoints: {len(insp_wps)} total ({meas_count} measurement, {hover_count} hover)",
            )
            y -= 4.5 * mm

            airport_elev = data.airport.elevation if data.airport and data.airport.elevation else 0
            insp_alts = [point_lonlatalt(w.position)[2] for w in insp_wps]
            min_alt = min(insp_alts)
            max_alt = max(insp_alts)
            c.drawString(
                MARGIN + 10 * mm,
                y,
                f"Altitude: {min_alt - airport_elev:.1f} - {max_alt - airport_elev:.1f} m AGL"
                f" ({min_alt:.1f} - {max_alt:.1f} m MSL)",
            )
            y -= 4.5 * mm

        y -= 6 * mm

    _draw_footer(c)
    c.showPage()
    return page_num
