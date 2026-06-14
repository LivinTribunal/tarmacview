"""tests for mission report pdf generation service."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.core.exceptions import ConflictError, NotFoundError
from app.services import mission_report as mission_report_service


def _make_ewkb(lon: float, lat: float, alt: float) -> str:
    """build a POINT Z WKT string."""
    return f"POINT Z ({lon} {lat} {alt})"


def _make_polygon_ewkb(coords: list[tuple[float, float, float]]) -> str:
    """build a POLYGON Z WKT string from a single-ring coord list."""
    pts = ", ".join(f"{lon} {lat} {alt}" for lon, lat, alt in coords)
    return f"POLYGON Z (({pts}))"


def _make_geom(data: str) -> str:
    """pass-through - geometry columns now hold WKT strings directly."""
    return data


def _make_waypoint(seq, lat=49.69, lon=18.11, alt=300.0, wp_type="TRANSIT", inspection_id=None):
    """create a mock waypoint."""
    wp = MagicMock()
    wp.sequence_order = seq
    wp.waypoint_type = wp_type
    wp.camera_action = "NONE"
    wp.speed = 5.0
    wp.heading = 90.0
    wp.hover_duration = None
    wp.inspection_id = inspection_id
    wp.gimbal_pitch = None
    wp.camera_target = None
    wp.position = _make_ewkb(lon, lat, alt)
    return wp


def _make_inspection(
    seq=0,
    method="FLY_OVER",
    template_name="Test Template",
    camera_overrides=None,
):
    """create a mock inspection.

    ``camera_overrides`` lets a test inject white_balance / iso / shutter_speed /
    focus_mode / optical_zoom into the resolved config without rewriting the
    full dict each time.
    """
    insp = MagicMock()
    insp.id = uuid4()
    insp.sequence_order = seq
    insp.method = method
    insp.template = MagicMock()
    insp.template.name = template_name
    insp.template.default_config = None
    insp.config = MagicMock()
    resolved = {
        "altitude_offset": 10.0,
        "measurement_speed_override": None,
        "measurement_density": 5,
        "capture_mode": "VIDEO_CAPTURE",
        "camera_gimbal_angle": -45.0,
        "sweep_angle": None,
        "angle_source": None,
        "angle_start": None,
        "angle_end": None,
        "horizontal_distance": 30.0,
        "buffer_distance": None,
        "recording_setup_duration": 3.0,
        "custom_tolerances": None,
        "hover_duration": 2.0,
        "height_above_lights": None,
        "lateral_offset": None,
        "distance_from_lha": None,
        "height_above_lha": None,
        "selected_lha_id": None,
        "hover_bearing": None,
        "hover_bearing_reference": None,
        "lha_ids": None,
        "white_balance": None,
        "iso": None,
        "shutter_speed": None,
        "focus_mode": None,
        "optical_zoom": None,
    }
    if camera_overrides:
        resolved.update(camera_overrides)
    insp.config.resolve_with_defaults.return_value = resolved
    return insp


def _make_constraint(ctype="ALTITUDE", name="Max Altitude", hard=True):
    """create a mock constraint."""
    c = MagicMock()
    c.id = uuid4()
    c.constraint_type = ctype
    c.name = name
    c.is_hard_constraint = hard
    c.max_altitude = 400.0
    c.min_altitude = None
    c.max_horizontal_speed = None
    c.max_vertical_speed = None
    c.max_flight_time = None
    c.reserve_margin = None
    c.lateral_buffer = None
    c.longitudinal_buffer = None
    c.boundary = None
    return c


def _make_violation(category="violation", message="test violation", constraint_id=None):
    """create a mock validation violation."""
    v = MagicMock()
    v.id = uuid4()
    v.category = category
    v.message = message
    v.constraint_id = constraint_id
    v.waypoint_ids = None
    return v


def _make_report_data(
    num_waypoints=5,
    num_inspections=1,
    with_validation=True,
    with_drone=True,
):
    """build a complete ReportData object for testing."""
    mission = MagicMock()
    mission.id = uuid4()
    mission.name = "Test Mission"
    mission.status = "VALIDATED"
    mission.default_speed = 5.0
    mission.default_altitude_offset = 10.0
    mission.default_capture_mode = "VIDEO_CAPTURE"
    mission.default_buffer_distance = 5.0
    mission.takeoff_coordinate = None
    mission.landing_coordinate = None

    airport = MagicMock()
    airport.id = uuid4()
    airport.name = "Test Airport"
    airport.icao_code = "LZTT"
    airport.elevation = 290.0
    airport.surfaces = []
    airport.safety_zones = []

    # add a runway surface
    runway = MagicMock()
    runway.surface_type = "RUNWAY"
    runway.identifier = "09L"
    runway.boundary = _make_geom(
        _make_polygon_ewkb(
            [
                (18.10, 49.68, 290),
                (18.12, 49.68, 290),
                (18.12, 49.70, 290),
                (18.10, 49.70, 290),
                (18.10, 49.68, 290),
            ]
        )
    )
    runway.threshold_position = _make_geom(_make_ewkb(18.10, 49.68, 290))
    airport.surfaces.append(runway)

    flight_plan = MagicMock()
    flight_plan.id = uuid4()
    flight_plan.mission_id = mission.id
    flight_plan.total_distance = 1500.0
    flight_plan.estimated_duration = 300.0
    flight_plan.generated_at = None

    inspections = []
    for i in range(num_inspections):
        insp = _make_inspection(seq=i, template_name=f"Inspection {i + 1}")
        inspections.append(insp)

    waypoints = []
    for i in range(num_waypoints):
        if i == 0:
            wp_type = "TAKEOFF"
        elif i == num_waypoints - 1:
            wp_type = "LANDING"
        elif inspections:
            wp_type = "MEASUREMENT"
        else:
            wp_type = "TRANSIT"

        insp_id = inspections[0].id if inspections and wp_type == "MEASUREMENT" else None
        wp = _make_waypoint(
            seq=i,
            lat=49.69 + i * 0.001,
            lon=18.11 + i * 0.001,
            alt=300.0 + i * 5,
            wp_type=wp_type,
            inspection_id=insp_id,
        )
        waypoints.append(wp)

    drone_profile = None
    if with_drone:
        drone_profile = MagicMock()
        drone_profile.name = "DJI M30T"
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 30T"
        drone_profile.endurance_minutes = 40.0
        drone_profile.sensor_fov = 84.0
        drone_profile.camera_resolution = "4K"
        drone_profile.camera_frame_rate = 30

    validation_result = None
    violations = []
    if with_validation:
        validation_result = MagicMock()
        validation_result.id = uuid4()
        validation_result.passed = True
        validation_result.violations = []
        violations = []

    constraints = [_make_constraint()]

    return mission_report_service.ReportData(
        mission=mission,
        flight_plan=flight_plan,
        airport=airport,
        drone_profile=drone_profile,
        waypoints=waypoints,
        inspections=inspections,
        validation_result=validation_result,
        violations=violations,
        constraints=constraints,
    )


class TestGenerateMissionReport:
    """tests for the mission report pdf generation."""

    @patch.object(mission_report_service, "_load_report_data")
    def test_generates_valid_pdf(self, mock_load):
        """generated output is a valid pdf."""
        data = _make_report_data()
        mock_load.return_value = data

        pdf_bytes, filename = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"
        assert len(pdf_bytes) > 1000

    @patch.object(mission_report_service, "_load_report_data")
    def test_filename_format(self, mock_load):
        """filename follows the required pattern."""
        data = _make_report_data()
        mock_load.return_value = data

        _, filename = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert filename.startswith("MissionReport_LZTT_Test_Mission_")
        assert filename.endswith(".pdf")

    @patch.object(mission_report_service, "_load_report_data")
    def test_multiple_inspections(self, mock_load):
        """pdf generates successfully with multiple inspections."""
        data = _make_report_data(num_inspections=3, num_waypoints=10)
        mock_load.return_value = data

        pdf_bytes, _ = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"

    @patch.object(mission_report_service, "_load_report_data")
    def test_no_inspections(self, mock_load):
        """pdf generates with zero inspections."""
        data = _make_report_data(num_inspections=0, num_waypoints=3)
        mock_load.return_value = data

        pdf_bytes, _ = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"

    @patch.object(mission_report_service, "_load_report_data")
    def test_no_drone_profile(self, mock_load):
        """pdf generates without drone profile."""
        data = _make_report_data(with_drone=False)
        mock_load.return_value = data

        pdf_bytes, _ = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"

    @patch.object(mission_report_service, "_load_report_data")
    def test_with_violations(self, mock_load):
        """pdf generates with validation violations."""
        data = _make_report_data()
        data.validation_result.passed = False
        v1 = _make_violation("violation", "altitude exceeded")
        v2 = _make_violation("warning", "speed close to limit")
        data.violations = [v1, v2]
        data.validation_result.violations = [v1, v2]
        mock_load.return_value = data

        pdf_bytes, _ = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"

    @patch.object(mission_report_service, "_load_report_data")
    def test_no_validation(self, mock_load):
        """pdf generates without validation results."""
        data = _make_report_data(with_validation=False)
        mock_load.return_value = data

        pdf_bytes, _ = mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert pdf_bytes[:5] == b"%PDF-"


def _capture_drawn_strings(monkeypatch) -> list[str]:
    """patch reportlab's canvas drawString/drawCentredString/drawRightString to record text.

    returns a list that the calling test can inspect after invoking
    generate_mission_report - the patch persists for the duration of the test.
    """
    from reportlab.pdfgen import canvas as rl_canvas

    drawn: list[str] = []
    original_draw = rl_canvas.Canvas.drawString
    original_centred = rl_canvas.Canvas.drawCentredString
    original_right = rl_canvas.Canvas.drawRightString

    def _capture(self, x, y, text, *args, **kwargs):
        drawn.append(str(text))
        return original_draw(self, x, y, text, *args, **kwargs)

    def _capture_centred(self, x, y, text, *args, **kwargs):
        drawn.append(str(text))
        return original_centred(self, x, y, text, *args, **kwargs)

    def _capture_right(self, x, y, text, *args, **kwargs):
        drawn.append(str(text))
        return original_right(self, x, y, text, *args, **kwargs)

    monkeypatch.setattr(rl_canvas.Canvas, "drawString", _capture)
    monkeypatch.setattr(rl_canvas.Canvas, "drawCentredString", _capture_centred)
    monkeypatch.setattr(rl_canvas.Canvas, "drawRightString", _capture_right)
    return drawn


class TestCameraSettingsTable:
    """regression tests for AC#4 - briefing PDF camera settings + wpml callout."""

    @patch.object(mission_report_service, "_load_report_data")
    def test_camera_fields_render_for_every_inspection(self, mock_load, monkeypatch):
        """every non-null camera field appears once per inspection in the rendered pdf."""
        data = _make_report_data(num_inspections=0, num_waypoints=4)
        insp1 = _make_inspection(
            seq=0,
            template_name="Inspection A",
            camera_overrides={
                "white_balance": "TUNGSTEN",
                "iso": 800,
                "shutter_speed": "1/30",
                "focus_mode": "INFINITY",
                "optical_zoom": 3.0,
            },
        )
        insp2 = _make_inspection(
            seq=1,
            template_name="Inspection B",
            camera_overrides={
                "iso": 400,
                "optical_zoom": 5.0,
            },
        )
        data.inspections = [insp1, insp2]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())
        full = "\n".join(drawn)

        # full set on inspection A
        assert "White Balance: TUNGSTEN" in full
        assert "ISO: 800" in full
        assert "Shutter Speed: 1/30" in full
        assert "Focus Mode: INFINITY" in full
        assert "Optical Zoom: 3.0x" in full
        # partial set on inspection B
        assert "ISO: 400" in full
        assert "Optical Zoom: 5.0x" in full

    @patch.object(mission_report_service, "_load_report_data")
    def test_wpml_callout_present_when_kmz_in_formats(self, mock_load, monkeypatch):
        """the controller-preset callout appears when kmz is in the export bundle."""
        data = _make_report_data(num_inspections=0, num_waypoints=4)
        insp = _make_inspection(
            seq=0,
            camera_overrides={"iso": 800, "shutter_speed": "1/30", "optical_zoom": 3.0},
        )
        data.inspections = [insp]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4(), formats=["KMZ"])
        full = "\n".join(drawn)

        assert "Settings to preset on the controller before flight" in full

    @patch.object(mission_report_service, "_load_report_data")
    def test_wpml_callout_absent_for_json_only_export(self, mock_load, monkeypatch):
        """the callout does not pollute the pdf for missions that only export json."""
        data = _make_report_data(num_inspections=0, num_waypoints=4)
        insp = _make_inspection(
            seq=0,
            camera_overrides={"iso": 800, "optical_zoom": 3.0},
        )
        data.inspections = [insp]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4(), formats=["JSON"])
        full = "\n".join(drawn)

        assert "Settings to preset on the controller before flight" not in full

    @patch.object(mission_report_service, "_load_report_data")
    def test_wpml_callout_absent_when_no_formats_passed(self, mock_load, monkeypatch):
        """without formats (legacy callers) the callout stays off."""
        data = _make_report_data(num_inspections=0, num_waypoints=4)
        insp = _make_inspection(
            seq=0,
            camera_overrides={"iso": 800, "optical_zoom": 3.0},
        )
        data.inspections = [insp]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())
        full = "\n".join(drawn)

        assert "Settings to preset on the controller before flight" not in full

    @patch.object(mission_report_service, "_load_report_data")
    def test_wpml_callout_omits_optical_zoom_when_drone_profile_attached(
        self, mock_load, monkeypatch
    ):
        """optical_zoom is excluded from the callout when a drone profile is set.

        with a drone profile the export emits the zoom action via wpml
        focalLength/zoomFactor, so the operator does not need to preset zoom on
        the controller.
        """
        data = _make_report_data(num_inspections=0, num_waypoints=4, with_drone=True)
        insp = _make_inspection(
            seq=0,
            camera_overrides={"iso": 800, "optical_zoom": 3.0},
        )
        data.inspections = [insp]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4(), formats=["KMZ"])
        full = "\n".join(drawn)

        assert "Settings to preset on the controller before flight" in full
        # iso appears in callout, but optical_zoom is suppressed
        callout_idx = full.index("Settings to preset on the controller before flight")
        callout_section = full[callout_idx : callout_idx + 600]
        assert "ISO: 800" in callout_section
        assert "Optical Zoom" not in callout_section


class TestPairedRunwayBundling:
    """paired runways collapse to '09L/27R' in the threshold-proximity rows.

    crossing rows no longer recompute from surfaces (they render the persisted
    validation warning verbatim, so their runway label is whatever the
    orchestrator wrote); the only report-side bundling left is the
    "Waypoints Near Runway Thresholds" list.
    """

    @patch.object(mission_report_service, "_load_report_data")
    def test_paired_runways_render_combined_identifier(self, mock_load, monkeypatch):
        """threshold rows show combined '09L/27R' with the per-end qualifier."""
        data = _make_report_data(num_inspections=1, num_waypoints=4)

        # pair the existing 09L runway with a 27R partner sharing the same boundary
        runway_09l = data.airport.surfaces[0]
        runway_09l_id = uuid4()
        runway_27r_id = uuid4()
        runway_09l.id = runway_09l_id
        runway_09l.paired_surface_id = runway_27r_id

        boundary = _make_polygon_ewkb(
            [
                (18.10, 49.68, 290),
                (18.12, 49.68, 290),
                (18.12, 49.70, 290),
                (18.10, 49.70, 290),
                (18.10, 49.68, 290),
            ]
        )
        runway_09l.boundary = _make_geom(boundary)
        runway_09l.threshold_position = _make_geom(_make_ewkb(18.10, 49.68, 290))

        runway_27r = MagicMock()
        runway_27r.id = runway_27r_id
        runway_27r.surface_type = "RUNWAY"
        runway_27r.identifier = "27R"
        runway_27r.boundary = _make_geom(boundary)
        runway_27r.threshold_position = _make_geom(_make_ewkb(18.12, 49.70, 290))
        runway_27r.paired_surface_id = runway_09l_id
        runway_27r.agls = []
        data.airport.surfaces.append(runway_27r)

        # park waypoints near each threshold so the threshold checks fire
        data.waypoints[1].position = _make_geom(_make_ewkb(18.1005, 49.681, 305))
        data.waypoints[2].position = _make_geom(_make_ewkb(18.1195, 49.6995, 305))

        mock_load.return_value = data
        drawn = _capture_drawn_strings(monkeypatch)

        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        # threshold rows still bundle the runway designator (the Surface
        # Crossings section is now violation-driven and absent without
        # surface_crossing violations - see issue #522)
        combined = [line for line in drawn if "09L/27R" in line]
        assert len(combined) >= 2, f"expected '09L/27R' in 2+ drawn lines, got {len(combined)}"

        # threshold rows preserve which physical end each waypoint approached
        assert any("(09L threshold)" in line for line in drawn)
        assert any("(27R threshold)" in line for line in drawn)

        # lone direction id must never appear as a standalone drawString in the
        # threshold section (would mean the bundling regressed to per-direction rows)
        assert not any(line.strip() == "09L" for line in drawn), (
            "lone '09L' leaked into the report - bundling regressed"
        )
        assert not any(line.strip() == "27R" for line in drawn)


class TestSurfaceCrossings:
    """the Surface Crossings section reads violation_kind, not waypoint geometry.

    selection is kind-driven (_surface_crossing_parts); waypoint # and min agl
    are resolved from each warning's structured waypoint_ids. the second pair of
    tests folds in the waypoint-resolution / slash-identifier / grouped-measurement
    guarantee from the superseded report-consistency fix (#526), rewritten for
    this section's columns.
    """

    def _wp(self, seq, wp_type="TRANSIT", agl=50.0):
        """waypoint with an explicit id/agl (MagicMock auto-attrs aren't usable here)."""
        wp = _make_waypoint(seq=seq, wp_type=wp_type)
        wp.id = uuid4()
        wp.agl = agl
        return wp

    @patch.object(mission_report_service, "_load_report_data")
    def test_runway_and_taxiway_rows_render(self, mock_load, monkeypatch):
        """one RUNWAY + one TAXIWAY surface_crossing produce two typed rows."""
        data = _make_report_data()
        rwy = _make_violation("warning", "wp 24-25 (WaypointType.TRANSIT): crosses RUNWAY 09L (1m)")
        rwy.violation_kind = "surface_crossing"
        twy = _make_violation(
            "warning", "inspection 2 crosses TAXIWAY A during measurement (3 segments)"
        )
        twy.violation_kind = "surface_crossing"
        data.violations = [rwy, twy]
        data.validation_result.violations = [rwy, twy]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert any(line == "Surface Crossings" for line in drawn)
        assert any(line == "No surface crossings detected." for line in drawn) is False
        # type column rendered for both surface kinds
        assert any(line == "RUNWAY" for line in drawn)
        assert any(line == "TAXIWAY" for line in drawn)
        # identifiers parsed from the (now stable) message
        assert any(line == "09L" for line in drawn)
        assert any(line == "A" for line in drawn)

    @patch.object(mission_report_service, "_load_report_data")
    def test_waypoint_and_agl_resolved_from_waypoint_ids(self, mock_load, monkeypatch):
        """waypoint # and min agl come from the warning's structured waypoint_ids,
        not a geometry recompute (the structured-column guarantee from #526)."""
        data = _make_report_data(num_inspections=0, num_waypoints=2)
        wp24 = self._wp(24, "TRANSIT", agl=42.0)
        wp25 = self._wp(25, "TRANSIT", agl=55.0)
        data.waypoints = [wp24, wp25]
        v = _make_violation("warning", "wp 24-25 (WaypointType.TRANSIT): crosses RUNWAY 1 (1m)")
        v.violation_kind = "surface_crossing"
        v.waypoint_ids = [str(wp24.id), str(wp25.id)]
        data.violations = [v]
        data.validation_result.violations = [v]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert any(line == "No surface crossings detected." for line in drawn) is False
        assert any(line == "24, 25" for line in drawn)  # resolved waypoint sequence numbers
        assert any(line == "42.0 m" for line in drawn)  # min agl across the two waypoints
        assert any(line == "RUNWAY" for line in drawn)

    @patch.object(mission_report_service, "_load_report_data")
    def test_grouped_measurement_slash_identifier_parses(self, mock_load, monkeypatch):
        """the grouped 'inspection N crosses RUNWAY X/Y during measurement' format
        keeps its slash identifier and resolves its waypoints (the #526 guarantee)."""
        data = _make_report_data(num_inspections=0, num_waypoints=3)
        wps = [self._wp(s, "MEASUREMENT", agl=a) for s, a in ((5, 30.0), (6, 28.0), (7, 31.0))]
        data.waypoints = wps
        v = _make_violation(
            "warning", "inspection 2 crosses RUNWAY 09L/27R during measurement (3 segments)"
        )
        v.violation_kind = "surface_crossing"
        v.waypoint_ids = [str(w.id) for w in wps]
        data.violations = [v]
        data.validation_result.violations = [v]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert any(line == "09L/27R" for line in drawn)  # slash identifier parsed intact
        assert any(line == "5, 6, 7" for line in drawn)
        assert any(line == "28.0 m" for line in drawn)  # lowest clearance over the runway
        assert any(line == "RUNWAY" for line in drawn)

    @patch.object(mission_report_service, "_load_report_data")
    def test_no_crossings_shows_empty_message(self, mock_load, monkeypatch):
        """a plan with no surface_crossing violations renders the empty message."""
        data = _make_report_data()
        other = _make_violation("warning", "battery check skipped")
        other.violation_kind = "battery"
        data.violations = [other]
        data.validation_result.violations = [other]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert any(line == "Surface Crossings" for line in drawn)
        assert any(line == "No surface crossings detected." for line in drawn)

    @patch.object(mission_report_service, "_load_report_data")
    def test_legacy_null_kind_still_classified(self, mock_load, monkeypatch):
        """a legacy row (violation_kind=None) is still picked up via message scan."""
        data = _make_report_data()
        legacy = _make_violation(
            "warning", "wp 3-4 (WaypointType.TRANSIT): crosses RUNWAY 27R (4m)"
        )
        legacy.violation_kind = None
        data.violations = [legacy]
        data.validation_result.violations = [legacy]
        mock_load.return_value = data

        drawn = _capture_drawn_strings(monkeypatch)
        mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert any(line == "Surface Crossings" for line in drawn)
        assert any(line == "27R" for line in drawn)
        assert any(line == "RUNWAY" for line in drawn)


class TestLoadReportData:
    """tests for data loading and error handling."""

    def test_mission_not_found_raises_404(self):
        """raises NotFoundError when mission does not exist."""
        db = MagicMock()
        db.query.return_value.options.return_value.filter.return_value.first.return_value = None

        with pytest.raises(NotFoundError, match="mission not found"):
            mission_report_service._load_report_data(db, uuid4())

    def test_no_flight_plan_raises_409(self):
        """raises ConflictError when no flight plan exists."""
        db = MagicMock()
        mission = MagicMock()
        mission.airport_id = uuid4()
        mission.drone_profile_id = None
        mission.inspections = []

        query_mock = MagicMock()
        results = [mission, None]

        def side_effect(*args, **kwargs):
            """return mock for sequential query calls."""
            return query_mock

        db.query.side_effect = side_effect
        query_mock.options.return_value.filter.return_value.first.side_effect = results

        with pytest.raises(ConflictError, match="no flight plan"):
            mission_report_service._load_report_data(db, uuid4())


class TestHelpers:
    """tests for helper functions."""

    def test_sanitize_filename(self):
        """special characters are removed, spaces become underscores."""
        assert mission_report_service._sanitize_filename("Test Mission!@#") == "Test_Mission"
        assert mission_report_service._sanitize_filename("hello world") == "hello_world"
        assert mission_report_service._sanitize_filename("a/b/c") == "abc"

    def test_format_duration(self):
        """durations are formatted correctly."""
        assert mission_report_service._format_duration(None) == "N/A"
        assert mission_report_service._format_duration(0) == "N/A"
        assert mission_report_service._format_duration(30) == "30s"
        assert mission_report_service._format_duration(90) == "1m 30s"
        assert mission_report_service._format_duration(3600) == "60m 0s"

    def test_format_distance(self):
        """distances are formatted correctly."""
        assert mission_report_service._format_distance(None) == "N/A"
        assert mission_report_service._format_distance(0) == "N/A"
        assert mission_report_service._format_distance(500) == "500.0 m"
        assert mission_report_service._format_distance(1500) == "1.50 km"

    def test_haversine(self):
        """distance_between (replaced _haversine) returns reasonable distances."""
        from app.utils.geo import distance_between

        dist = distance_between(18.11, 49.69, 18.12, 49.69)
        assert 500 < dist < 1000

    def test_point_in_polygon(self):
        """point-in-polygon test works correctly."""
        poly = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        assert mission_report_service._point_in_polygon(5, 5, poly) is True
        assert mission_report_service._point_in_polygon(15, 5, poly) is False

    def test_extract_coords(self):
        """coordinate extraction from WKT works via core.geometry helper."""
        from app.core.geometry import point_lonlatalt

        geom = _make_geom(_make_ewkb(18.11, 49.69, 300.0))
        lon, lat, alt = point_lonlatalt(geom)
        assert abs(lon - 18.11) < 0.001
        assert abs(lat - 49.69) < 0.001
        assert abs(alt - 300.0) < 0.1

    def test_extract_coords_none(self):
        """none geometry raises ValueError under the strict-raise contract."""
        from app.core.geometry import point_lonlatalt

        with pytest.raises(ValueError, match="missing point geometry"):
            point_lonlatalt(None)


class TestBuildActivities:
    """tests for the timeline activity builder."""

    def test_basic_activity_sequence(self):
        """activities are built with correct names and colors."""
        data = _make_report_data(num_waypoints=5, num_inspections=1)
        activities = mission_report_service._build_activities(data)

        names = [a["name"] for a in activities]
        assert "Takeoff" in names
        assert "Landing" in names

    def test_activity_colors_match_type(self):
        """each activity gets the correct color for its type."""
        data = _make_report_data(num_waypoints=5, num_inspections=1)
        activities = mission_report_service._build_activities(data)

        for act in activities:
            if act["name"] == "Takeoff":
                assert act["color"] == "#3bbb3b"
            elif act["name"] == "Landing":
                assert act["color"] == "#e54545"
            elif act["name"] == "Transit":
                assert act["color"] == "#888888"

    def test_no_zero_duration_activities(self):
        """all returned activities have positive duration."""
        data = _make_report_data(num_waypoints=10, num_inspections=2)
        activities = mission_report_service._build_activities(data)

        for act in activities:
            assert act["duration"] > 0

    def test_empty_waypoints(self):
        """empty waypoint list produces no activities."""
        data = _make_report_data(num_waypoints=0, num_inspections=0)
        data.waypoints = []
        activities = mission_report_service._build_activities(data)

        assert activities == []


class TestMap2dLayerOrder:
    """regression net for the _2d_map sub-package split.

    `pages/map_2d.py` is a slim orchestrator; the five layer drawers live
    under `pages/_2d_map/`. matplotlib output depends on the call order
    (zone -> surface -> agl -> trajectory -> legend) and on every drawer
    sharing the same Axes instance.
    """

    @patch.object(mission_report_service, "_load_report_data")
    def test_sub_drawers_called_in_layer_order(self, mock_load):
        """orchestrator dispatches drawers in zone/surface/agl/trajectory/legend order."""
        from app.services.mission_report.pages import map_2d

        data = _make_report_data(num_inspections=1, num_waypoints=4)
        mock_load.return_value = data

        calls: list[str] = []
        with (
            patch.object(
                map_2d, "_draw_safety_zones", side_effect=lambda ax, d: calls.append("zone")
            ),
            patch.object(
                map_2d, "_draw_surfaces", side_effect=lambda ax, d: calls.append("surface")
            ),
            patch.object(
                map_2d, "_draw_agls_and_lhas", side_effect=lambda ax, d: calls.append("agl")
            ),
            patch.object(
                map_2d,
                "_draw_trajectory",
                side_effect=lambda ax, d: calls.append("trajectory") or ([], []),
            ),
            patch.object(map_2d, "_draw_legend", side_effect=lambda ax, d: calls.append("legend")),
        ):
            mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert calls == ["zone", "surface", "agl", "trajectory", "legend"]

    @patch.object(mission_report_service, "_load_report_data")
    def test_orchestrator_passes_shared_axes(self, mock_load):
        """every sub-drawer receives the same Axes instance."""
        from app.services.mission_report.pages import map_2d

        data = _make_report_data(num_inspections=1, num_waypoints=4)
        mock_load.return_value = data

        seen: list[object] = []

        def _record(ax, _data):
            seen.append(ax)

        def _record_trajectory(ax, _data):
            seen.append(ax)
            return [], []

        with (
            patch.object(map_2d, "_draw_safety_zones", side_effect=_record),
            patch.object(map_2d, "_draw_surfaces", side_effect=_record),
            patch.object(map_2d, "_draw_agls_and_lhas", side_effect=_record),
            patch.object(map_2d, "_draw_trajectory", side_effect=_record_trajectory),
            patch.object(map_2d, "_draw_legend", side_effect=_record),
        ):
            mission_report_service.generate_mission_report(MagicMock(), uuid4())

        assert len(seen) == 5
        first = seen[0]
        assert all(ax is first for ax in seen)

    def test_zone_colors_constant_shared(self):
        """zone fill and legend chip resolve the same _ZONE_COLORS mapping."""
        from app.services.mission_report.pages import _2d_map
        from app.services.mission_report.pages._2d_map import legend, zone

        assert zone._ZONE_COLORS is _2d_map._ZONE_COLORS
        assert legend._ZONE_COLORS is _2d_map._ZONE_COLORS
        # documented zone keys are all present so downstream tests don't drift
        assert {"CTR", "RESTRICTED", "PROHIBITED", "TEMPORARY_NO_FLY", "AIRPORT_BOUNDARY"} <= set(
            _2d_map._ZONE_COLORS.keys()
        )


class TestRouteEndpoint:
    """tests for the mission report route."""

    @patch("app.api.routes.missions.mission_service.get_mission")
    @patch.object(mission_report_service, "generate_mission_report")
    def test_get_mission_report_returns_pdf(self, mock_gen, mock_get_mission):
        """endpoint returns pdf with correct content type."""
        from types import SimpleNamespace

        from fastapi.testclient import TestClient

        from app.api.dependencies import get_current_user
        from app.main import app

        stub_user = SimpleNamespace(
            id="00000000-0000-0000-0000-000000000099",
            email="test@tarmacview.com",
            name="Test User",
            role="SUPER_ADMIN",
            is_active=True,
            airports=[],
        )
        stub_user.has_airport_access = lambda airport_id: True

        fake_id = str(uuid4())
        stub_mission = SimpleNamespace(airport_id=uuid4())
        mock_get_mission.return_value = stub_mission
        mock_gen.return_value = (b"%PDF-1.4 fake", "MissionReport_LZTT_Test_2026-04-17.pdf")

        saved = app.dependency_overrides.get(get_current_user)
        app.dependency_overrides[get_current_user] = lambda: stub_user
        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/missions/{fake_id}/mission-report")
        finally:
            if saved is not None:
                app.dependency_overrides[get_current_user] = saved
            else:
                app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert "MissionReport_LZTT_Test" in resp.headers["content-disposition"]
        assert resp.content == b"%PDF-1.4 fake"
