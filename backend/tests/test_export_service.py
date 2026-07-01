"""tests for export service file generators"""

import csv
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO, StringIO
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.core.geometry import point_lonlatalt
from app.services import export as export_service
from app.utils.geo import bearing_between, distance_between, point_at_distance


def _make_wkt_point(lon: float, lat: float, alt: float) -> str:
    """build a POINT Z WKT string."""
    return f"POINT Z ({lon} {lat} {alt})"


# back-compat alias - older tests still call _make_ewkb
_make_ewkb = _make_wkt_point


# default dji profile for direct generator calls. production gates non-wpml
# drones in export_mission, but these unit tests call generate_kmz / wpml
# directly and _dji_enums_for now raises without a mapped dji drone.
_M4T_PROFILE = MagicMock()
_M4T_PROFILE.model_identifier = None
_M4T_PROFILE.manufacturer = "DJI"
_M4T_PROFILE.model = "Matrice 4T"
_M4T_PROFILE.sensor_base_focal_length = None
_M4T_PROFILE.default_optical_zoom = None
# matches the seeded DroneProfile.max_speed for Matrice 4T (PR #741) so the
# globalTransitionalSpeed clamp sees a real numeric ceiling, not an auto-attr
# MagicMock.
_M4T_PROFILE.max_speed = 21.0


def _gen_kmz(*args, **kwargs):
    """generate_kmz wrapper that defaults to a mapped dji drone profile."""
    kwargs.setdefault("drone_profile", _M4T_PROFILE)
    return export_service.generate_kmz(*args, **kwargs)


def _gen_wpml(*args, **kwargs):
    """generate_wpml wrapper that defaults to a mapped dji drone profile."""
    kwargs.setdefault("drone_profile", _M4T_PROFILE)
    return export_service.generate_wpml(*args, **kwargs)


def _make_waypoint(seq, lat=49.69, lon=18.11, alt=300.0, wp_type="TRANSIT"):
    """create a mock waypoint with WKT geometry."""
    wp = MagicMock()
    wp.sequence_order = seq
    wp.waypoint_type = wp_type
    wp.camera_action = "NONE"
    wp.speed = 5.0
    wp.heading = 90.0
    wp.hover_duration = None
    wp.inspection_id = None
    wp.camera_target = None
    wp.gimbal_pitch = None

    wp.position = _make_wkt_point(lon, lat, alt)

    return wp


def _make_flight_plan(num_waypoints=3):
    """create a mock flight plan with waypoints.

    sequence_order starts at 1 to mirror production (flight_plan_service
    persists waypoints with enumerate(start=1)). DJI WPML wpml:index is
    0-indexed and is emitted as sequence_order - 1.
    """
    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 150.5
    fp.estimated_duration = 120.0
    fp.generated_at = None

    waypoints = []
    for i in range(num_waypoints):
        if i == 0:
            wp_type = "TAKEOFF"
        elif i == num_waypoints - 1:
            wp_type = "LANDING"
        else:
            wp_type = "MEASUREMENT"

        wp = _make_waypoint(
            seq=i + 1,
            lat=49.69 + i * 0.001,
            lon=18.11 + i * 0.001,
            alt=300.0 + i * 10,
            wp_type=wp_type,
        )
        waypoints.append(wp)

    fp.waypoints = waypoints
    return fp


def _make_inspection_mock(insp_id, method, capture_mode):
    """build a minimal mission inspection mock that resolves capture_mode + method."""
    insp = MagicMock()
    insp.id = insp_id
    insp.method = method
    config = MagicMock()
    config.resolve_with_defaults = MagicMock(
        return_value={
            "white_balance": None,
            "iso": None,
            "shutter_speed": None,
            "focus_mode": None,
            "optical_zoom": None,
            "capture_mode": capture_mode,
        }
    )
    insp.config = config
    template = MagicMock()
    template.default_config = None
    insp.template = template
    return insp


def _make_mission_mock(*, inspections, default_capture_mode=None, dji_heading_mode=None):
    """MagicMock auto-creates attrs as MagicMock (truthy), which corrupts the
    mission.default_capture_mode fallback in _resolve_inspection_camera_settings.
    explicit setter avoids that.
    """
    mission = MagicMock()
    mission.takeoff_coordinate = None
    mission.default_speed = 5.0
    mission.inspections = inspections
    mission.default_capture_mode = default_capture_mode
    mission.dji_heading_mode = dji_heading_mode
    return mission


def _make_heading_mode_mission(value=None):
    """build the minimal mission mock the export needs, with dji_heading_mode set."""
    mission = MagicMock()
    mission.takeoff_coordinate = None
    mission.default_speed = 5.0
    mission.inspections = []
    mission.default_capture_mode = None
    mission.dji_heading_mode = value
    return mission


def _make_vp_video_pass(num_measurements=4, *, with_bookends=True):
    """build a (flight_plan, mission) pair representing a VP video pass.

    structure (with_bookends=True): TAKEOFF, m1(RECORDING_START + hover),
    m2...m(N-1), mN(RECORDING_STOP + hover), LANDING. the recording start/stop
    actions ride on the first/last measurement's actionGroup (the planner's
    merged-bookend shape - the standalone HOVER bookends are gone so the
    drone can fly the climb as one continuous arc). measurements share
    lon/lat (vertical climb) and sweep gimbal pitch from -1° to -6.5°.
    heading is constant.
    """
    insp_id = uuid4()
    insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", "VIDEO_CAPTURE")

    target = _make_wkt_point(18.12, 49.69, 290.0)
    lon, lat = 18.11, 49.69

    waypoints = []
    waypoints.append(_make_waypoint(seq=1, lon=lon, lat=lat, alt=290.0, wp_type="TAKEOFF"))
    seq = 2

    pitches = []
    for i in range(num_measurements):
        if num_measurements > 1:
            pitch = -1.0 + (-6.5 - -1.0) * i / (num_measurements - 1)
        else:
            pitch = -3.0
        pitches.append(round(pitch, 4))

    for i in range(num_measurements):
        wp = _make_waypoint(seq=seq, lon=lon, lat=lat, alt=295.0 + i * 3, wp_type="MEASUREMENT")
        wp.heading = 90.0
        wp.gimbal_pitch = pitches[i]
        wp.camera_target = target
        wp.camera_action = "RECORDING"
        wp.inspection_id = insp_id
        waypoints.append(wp)
        seq += 1

    if with_bookends:
        # planner's merged-bookend shape: recording actions ride on the first
        # and last MEASUREMENT. the hover_duration carries the camera-startup /
        # tail dwell so the recorder is up before the gimbal sweep begins.
        first_m = waypoints[1]
        last_m = waypoints[-1]
        first_m.camera_action = "RECORDING_START"
        first_m.hover_duration = 3
        last_m.camera_action = "RECORDING_STOP"
        last_m.hover_duration = 3

    waypoints.append(_make_waypoint(seq=seq, lon=lon, lat=lat, alt=290.0, wp_type="LANDING"))

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 150.0
    fp.estimated_duration = 60.0
    fp.generated_at = None
    fp.waypoints = waypoints

    mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

    return fp, mission, pitches


def _make_hr_video_pass(num_measurements=10, *, with_bookends=True):
    """build a (flight_plan, mission, pitches) triple for an HR video arc.

    structure (with_bookends=True): TAKEOFF, m1(RECORDING_START + hover),
    m2...m(N-1), mN(RECORDING_STOP + hover), LANDING. recording actions ride
    on the first/last MEASUREMENT (planner's merged-bookend shape). the arc
    sweeps around a fixed LHA at constant altitude; heading per-WP points
    at the LHA; gimbal pitch drifts gently across the arc (~0.5° max).
    """
    insp_id = uuid4()
    insp = _make_inspection_mock(insp_id, "HORIZONTAL_RANGE", "VIDEO_CAPTURE")

    target_lon, target_lat, target_alt = 18.12, 49.69, 290.0
    target = _make_wkt_point(target_lon, target_lat, target_alt)
    arc_alt = 350.0
    arc_radius_m = 200.0

    waypoints = []
    waypoints.append(_make_waypoint(seq=1, lon=18.11, lat=49.69, alt=arc_alt, wp_type="TAKEOFF"))
    seq = 2

    pitches = []
    arc_lonlats = []
    for i in range(num_measurements):
        bearing_deg = 60.0 + (120.0 - 60.0) * i / max(1, num_measurements - 1)
        arc_lon, arc_lat = point_at_distance(target_lon, target_lat, bearing_deg, arc_radius_m)
        arc_lonlats.append((arc_lon, arc_lat))
        pitch = -3.0 + 0.05 * i
        pitches.append(round(pitch, 4))

    for i in range(num_measurements):
        lon_i, lat_i = arc_lonlats[i]
        wp = _make_waypoint(seq=seq, lon=lon_i, lat=lat_i, alt=arc_alt, wp_type="MEASUREMENT")
        wp.heading = bearing_between(lon_i, lat_i, target_lon, target_lat)
        wp.gimbal_pitch = pitches[i]
        wp.camera_target = target
        wp.camera_action = "RECORDING"
        wp.inspection_id = insp_id
        waypoints.append(wp)
        seq += 1

    if with_bookends:
        first_m = waypoints[1]
        last_m = waypoints[-1]
        first_m.camera_action = "RECORDING_START"
        first_m.hover_duration = 3
        last_m.camera_action = "RECORDING_STOP"
        last_m.hover_duration = 3

    waypoints.append(_make_waypoint(seq=seq, lon=18.11, lat=49.69, alt=arc_alt, wp_type="LANDING"))

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 500.0
    fp.estimated_duration = 100.0
    fp.generated_at = None
    fp.waypoints = waypoints

    mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

    return fp, mission, pitches


class TestExportModuleSplit:
    """guards the dji package split + shared.py dedup wiring (no import cycle)."""

    def test_dji_submodules_import_without_cycle(self):
        """the four dji package modules import cleanly downward-only."""
        from app.services.export.dji import actions, builders, heading, video

        assert builders._build_dji_template_kml is not None
        assert builders._build_dji_waylines_wpml is not None
        assert heading._dji_heading_mode is not None
        assert video._resolve_inspection_camera_settings is not None
        assert actions._append_action_group is not None

    def test_shared_primitives_are_single_source(self):
        """xml primitives + keepout text + agl helper resolve to one object."""
        from app.services.export import shared
        from app.services.export.dji import builders
        from app.services.export.formats import kml

        assert builders._sub_text is shared._sub_text
        assert builders._kml_tag is shared._kml_tag
        assert builders._KML_KEEPOUT_DESCRIPTION is shared._KML_KEEPOUT_DESCRIPTION
        assert kml._KML_KEEPOUT_DESCRIPTION is shared._KML_KEEPOUT_DESCRIPTION
        assert callable(shared._iter_waypoints_agl)


class TestGenerateKml:
    """tests for kml export generation."""

    def test_generates_valid_kml(self):
        """kml output contains xml declaration and kml elements."""
        fp = _make_flight_plan(3)

        result = export_service.generate_kml(fp, "Test Mission", 290.0)
        text = result.decode("utf-8")

        assert "<?xml" in text
        assert "<kml" in text
        assert "WP1" in text
        assert "WP2" in text
        assert "WP3" in text
        assert "<LineString" in text

    def test_mission_name_in_document(self):
        """kml document name includes mission name."""
        fp = _make_flight_plan(1)

        result = export_service.generate_kml(fp, "My Mission", 0)
        text = result.decode("utf-8")

        assert "Flight Plan - My Mission" in text

    def test_altitude_is_agl(self):
        """exported altitude is relative to ground, not absolute MSL."""
        fp = _make_flight_plan(1)

        result = export_service.generate_kml(fp, "Test", 290.0)
        text = result.decode("utf-8")

        # alt=300 - elevation=290 = 10m AGL
        assert "10.0" in text
        assert "relativeToGround" in text

    def test_single_waypoint_no_linestring(self):
        """single waypoint should not produce a linestring."""
        fp = _make_flight_plan(1)

        result = export_service.generate_kml(fp, "", 0)
        text = result.decode("utf-8")

        assert "WP1" in text
        assert "<LineString" not in text


def _read_wpmz(result: bytes) -> tuple[str, str]:
    """unzip a generated kmz and return (template.kml, waylines.wpml) as text."""
    with zipfile.ZipFile(BytesIO(result)) as zf:
        template = zf.read("wpmz/template.kml").decode("utf-8")
        waylines = zf.read("wpmz/waylines.wpml").decode("utf-8")
    return template, waylines


def _assert_dji_conformance(kmz_bytes=None, *, template=None, waylines=None):
    """umbrella check via the shared #777 conformance validator.

    the per-rule TestDji* classes below pin individual invariants; this runs the
    whole-file validator over the same fixtures so the scattered checks and the
    reusable validator can never drift. imported lazily because
    test_export_dji_conformance reuses the fixtures defined in this module.
    """
    from tests.test_export_dji_conformance import assert_valid_dji_kmz, assert_valid_dji_wpml

    if kmz_bytes is not None:
        assert_valid_dji_kmz(kmz_bytes)
    if template is not None:
        assert_valid_dji_wpml(template, kind="template")
    if waylines is not None:
        assert_valid_dji_wpml(waylines, kind="waylines")


class TestGenerateKmz:
    """tests for dji wpmz 1.0.6 (kmz) export generation."""

    def test_produces_dji_wpmz_archive_layout(self):
        """kmz is a valid zip with wpmz/template.kml + wpmz/waylines.wpml."""
        fp = _make_flight_plan(3)

        result = _gen_kmz(fp, "Test", 0)
        buf = BytesIO(result)

        assert zipfile.is_zipfile(buf)
        with zipfile.ZipFile(buf) as zf:
            assert set(zf.namelist()) == {"wpmz/template.kml", "wpmz/waylines.wpml"}

    def test_declares_wpmz_1_0_6_namespace(self):
        """both files declare kml 2.2 and dji wpmz 1.0.6."""
        fp = _make_flight_plan(2)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        for content in (template, waylines):
            assert "http://www.opengis.net/kml/2.2" in content
            assert "http://www.dji.com/wpmz/1.0.6" in content
            assert "1.0.2" not in content

    def test_waylines_folder_uses_relative_height_mode(self):
        """waylines folder declares executeHeightMode=relativeToStartPoint.

        relative-to-takeoff heights are geoid-free and cancel any datum error
        in the subtraction; they replace the absolute WGS84/HAE scheme whose
        template fields resolved ~45 m underground and flew the drone into the
        ground at mission start.
        """
        fp = _make_flight_plan(2)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in waylines
        assert "<wpml:realTimeFollowSurfaceByFov>0</wpml:realTimeFollowSurfaceByFov>" in waylines

    def test_template_folder_uses_relative_height_mode(self):
        """template folder declares heightMode=relativeToStartPoint.

        the template heightMode must match the waylines executeHeightMode so
        whichever file Pilot 2's regeneration consumes resolves the same frame.
        """
        fp = _make_flight_plan(1)

        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 0))

        assert "<wpml:heightMode>relativeToStartPoint</wpml:heightMode>" in template
        assert "<wpml:coordinateMode>WGS84</wpml:coordinateMode>" in template
        # positioningType was non-standard and must not be emitted
        assert "positioningType" not in template

    def test_waylines_has_one_placemark_per_waypoint(self):
        """every waypoint produces a placemark in waylines.wpml."""
        fp = _make_flight_plan(4)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        assert waylines.count("<Placemark") == 4

    def test_execute_height_is_takeoff_relative(self):
        """waylines executeHeight is wp_MSL - takeoff_ground_MSL.

        relativeToStartPoint heights are measured above the ground takeoff
        point, so they are geoid-free - no ellipsoidHeight / EGM96 ambiguity.
        """
        fp = _make_flight_plan(3)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        # airborne start: takeoff anchor is airport_elevation (290).
        # waypoints are 300 / 310 / 320 -> relative heights are 10 / 20 / 30.
        assert "<wpml:executeHeight>10.000000</wpml:executeHeight>" in waylines
        assert "<wpml:executeHeight>20.000000</wpml:executeHeight>" in waylines
        assert "<wpml:executeHeight>30.000000</wpml:executeHeight>" in waylines

    def test_template_placemark_height_is_relative_ellipsoid_is_hae(self):
        """template `height` is takeoff-relative; `ellipsoidHeight` is true HAE.

        `height` follows the folder heightMode (relativeToStartPoint).
        `ellipsoidHeight` is, per the WPML spec, always the WGS84 ellipsoid
        height regardless of heightMode - so it carries msl_to_hae(wp), not the
        relative value. that keeps the file correct whichever field a consumer
        reads.
        """
        from app.utils.geo import msl_to_hae

        fp = _make_flight_plan(3)

        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        # airborne start, no mission -> takeoff anchor = airport_elevation 290;
        # WP2 (alt 310) -> rel 20
        assert "<wpml:height>20.000000</wpml:height>" in template
        # ellipsoidHeight is WP2's true WGS84 ellipsoid height, not the relative value
        wp2_hae = msl_to_hae(49.691, 18.111, 310.0)
        assert f"<wpml:ellipsoidHeight>{wp2_hae:.6f}</wpml:ellipsoidHeight>" in template
        assert "<wpml:ellipsoidHeight>20.000000</wpml:ellipsoidHeight>" not in template

    def test_placemark_has_use_global_flags(self):
        """non-aimed template placemarks inherit speed, heading, and turn from globals.

        the default flight plan's wp0 is TAKEOFF (no camera target), so its
        placemark still inherits the global followWayline heading via
        useGlobalHeadingParam=1. aimed waypoints flip this off - covered by
        test_aimed_placemark_omits_use_global_heading_param.
        """
        fp = _make_flight_plan(1)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        assert "<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>" in template
        assert "<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>" in template
        assert "<wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>" in template
        assert "<wpml:useStraightLine>1</wpml:useStraightLine>" in template
        assert "<wpml:useStraightLine>1</wpml:useStraightLine>" in waylines
        assert "useGlobalHeadingParam" not in waylines

    def test_transit_placemark_heading_mode_is_follow_wayline(self):
        """transit placemarks (no camera target) keep followWayline with angle 0.

        regression guard: smoothTransition + explicit per-waypoint angles
        broke fh2's gimbal follow simulation and locked the camera to
        absolute north. transit/takeoff/landing must keep followWayline.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "TRANSIT"
        wp.heading = 222.0
        wp.camera_target = None

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        for content in (template, waylines):
            assert "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>" in content
            assert "smoothTransition" not in content
            # waypointPoiPoint is required by the spec only for towardPOI; non-towardPOI
            # placemarks must omit it to avoid the off-West-Africa zero sentinel that
            # strict validators flag as a mis-positioned POI.
            assert "<wpml:waypointPoiPoint>" not in content

    def test_aimed_placemark_emits_toward_poi(self):
        """measurement waypoint with a camera_target emits towardPOI in both files.

        the per-placemark heading override gives the drone continuous yaw
        tracking of the LHA across the full arc via runtime POI math (the
        experimental mode - hardware-dependent). this test pins the towardPOI
        shape; the new default is smoothTransition (covered separately).
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        mission = _make_heading_mode_mission("towardPOI")
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        # poi point order is lat,lon,alt - opposite to the WKT (lon, lat, alt) we feed
        # in. spec (common-element.md) allows alt=0; pinning it here decouples the POI
        # from camera_target.alt so a below-takeoff target cannot trip Pilot 2's POI
        # geometry pre-flight check (the launch bug closed by issue #508).
        expected_poi = "<wpml:waypointPoiPoint>49.690000,18.120000,0.000000</wpml:waypointPoiPoint>"
        expected_path_mode = (
            "<wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
        )
        for content in (template, waylines):
            assert "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>" in content
            assert expected_poi in content
            assert expected_path_mode in content
            assert "<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>" in content

    def test_aimed_placemark_omits_use_global_heading_param(self):
        """aimed template placemarks drop useGlobalHeadingParam so towardPOI wins.

        without dropping it, the placemark would inherit the document-level
        followWayline block and the per-placemark towardPOI override would
        be ignored by fh2 / the drone firmware.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        mission = _make_heading_mode_mission("towardPOI")
        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        # the aimed placemark omits useGlobalHeadingParam entirely. the takeoff
        # and landing placemarks (which do not aim) still carry it - exactly
        # one occurrence per non-aimed wp, so two for a 3-wp plan with one MH.
        assert template.count("<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>") == 2
        # speed and turn inheritance is unaffected
        assert template.count("<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>") == 3
        assert template.count("<wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>") == 3

    def test_placemark_includes_isRisky_and_turn_damping(self):
        """placemarks carry isRisky=0 and turnDampingDist=0.2."""
        fp = _make_flight_plan(1)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        for content in (template, waylines):
            assert "<wpml:isRisky>0</wpml:isRisky>" in content
            assert "<wpml:waypointTurnDampingDist>0.2</wpml:waypointTurnDampingDist>" in content

    def test_waylines_placemark_has_gimbal_and_work_type(self):
        """waylines placemark has waypointGimbalHeadingParam and waypointWorkType."""
        fp = _make_flight_plan(1)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        assert "<wpml:waypointGimbalHeadingParam>" in waylines
        assert "<wpml:waypointGimbalPitchAngle>" in waylines
        assert "<wpml:waypointWorkType>0</wpml:waypointWorkType>" in waylines

    def test_mission_config_has_rc_lost_and_rth(self):
        """missionConfig carries goContinue/goBack; globalRTHHeight scoped to waylines."""
        # all WPs at airport ground -> relative 0 -> RTH is the 20 m margin
        fp = _make_flight_plan(1)
        for wp in fp.waypoints:
            wp.position = _make_wkt_point(18.11, 49.69, 290.0)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        assert "<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>" in template
        assert "<wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>" in template
        # globalRTHHeight is a waylines-only element per common-element.md
        assert "<wpml:globalRTHHeight>" not in template
        assert "<wpml:globalRTHHeight>20</wpml:globalRTHHeight>" in waylines
        # waylineAvoidLimitAreaMode is not in the WPML spec - dropped per audit §2.1
        assert "waylineAvoidLimitAreaMode" not in template
        assert "waylineAvoidLimitAreaMode" not in waylines

    def test_take_off_ref_point_ignores_mission_takeoff_coordinate(self):
        """takeOffRefPoint anchors at WP1 lat/lon + airport_elevation regardless of mission coord.

        every export is airborne-start - the operator hand-launches and triggers
        the wayline mid-air. writing the operator's ground takeoff coord would
        make FH2 draw a stray takeoff icon tethered to the first measurement.
        """
        from app.utils.geo import msl_to_hae

        fp = _make_flight_plan(1)
        mission = MagicMock()
        # ground takeoff coord far from WP1 - must NOT leak into the ref point
        mission.takeoff_coordinate = _make_ewkb(17.123456, 48.987654, 175.5)

        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission))

        # ref point is WP1 lat/lon with airport_elevation HAE-converted
        hae = msl_to_hae(49.690, 18.110, 290.0)
        expected = f"<wpml:takeOffRefPoint>49.690000,18.110000,{hae:.6f}</wpml:takeOffRefPoint>"
        assert expected in template
        assert "<wpml:takeOffRefPointAGLHeight>0</wpml:takeOffRefPointAGLHeight>" in template
        # ground takeoff coord (48.987654, 17.123456) must not appear
        assert "48.987654" not in template
        assert "17.123456" not in template

    def test_take_off_ref_point_falls_back_to_first_waypoint(self):
        """takeOffRefPoint anchors at first waypoint lat/lon with airport_elevation HAE."""
        from app.utils.geo import msl_to_hae

        fp = _make_flight_plan(2)

        template, _ = _read_wpmz(_gen_kmz(fp, "", 290.0))

        # WP1 lat/lon with airport_elevation 290 HAE-converted
        hae = msl_to_hae(49.690, 18.110, 290.0)
        expected = f"<wpml:takeOffRefPoint>49.690000,18.110000,{hae:.6f}</wpml:takeOffRefPoint>"
        assert expected in template

    def test_camera_action_maps_to_dji_actuator_func(self):
        """photo_capture waypoint produces a takePhoto action inside an actionGroup."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "wpml:actionGroup" in waylines
        assert "takePhoto" in waylines
        assert "wpml:actionTriggerType>reachPoint" in waylines

    def test_hover_duration_produces_hover_action(self):
        """waypoint with hover_duration > 0 emits a hover action with hoverTime."""
        fp = _make_flight_plan(2)
        fp.waypoints[0].hover_duration = 4.5

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:actionActuatorFunc>hover</wpml:actionActuatorFunc>" in waylines
        assert "<wpml:hoverTime>4.5</wpml:hoverTime>" in waylines

    def test_aimed_measurement_does_not_emit_rotate_yaw(self):
        """aimed waypoints no longer emit a per-reachPoint rotateYaw action.

        the per-placemark towardPOI heading mode owns the aircraft yaw
        continuously across the arc; layering a reachPoint-triggered
        rotateYaw on top would re-introduce the snap on top of the smooth
        track. takePhoto / gimbalRotate / hover stay untouched.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 137.5
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        mission = _make_heading_mode_mission("towardPOI")
        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "<wpml:actionActuatorFunc>rotateYaw</wpml:actionActuatorFunc>" not in waylines
        assert "<wpml:aircraftHeading>" not in waylines
        assert "<wpml:aircraftPathMode>" not in waylines

    def test_measurement_waypoint_emits_gimbal_rotate_action(self):
        """measurement waypoint with gimbal_pitch emits gimbalRotate (pitch only).

        the gimbalRotate action is what commands the gimbal pitch: pitch is set
        absolute, yaw rotation is disabled so the gimbal stays in body-follow
        mode (the placemark's towardPOI heading mode has the body continuously
        tracking the camera_target across the arc, and the gimbal follows).
        this is the proven aiming mechanism that #446 accidentally dropped.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.gimbal_pitch = -45.0
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>" in waylines
        assert "<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>" in waylines
        assert "<wpml:gimbalPitchRotateAngle>-45</wpml:gimbalPitchRotateAngle>" in waylines
        assert "<wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>" in waylines

    def test_template_uses_manual_gimbal_pitch_mode(self):
        """template folder declares gimbalPitchMode=manual.

        manual lets the per-WP gimbalRotate action drive pitch while leaving
        gimbal yaw in the m4t default Follow mode (the placemark's towardPOI
        heading mode aims the body at the LHA, and the gimbal follows the body).
        usePointSetting was tried in #446 and broke camera aim on hardware -
        the per-placemark waypointGimbalYawAngle locked the gimbal to absolute
        north regardless of where the body was pointing.
        """
        fp = _make_flight_plan(1)

        template, _ = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>" in template
        assert "<wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>" not in template

    def test_transit_waypoint_does_not_rotate_yaw(self):
        """transit/takeoff/landing waypoints keep nose along flight direction.

        regression guard: transit waypoints carry a heading value for internal
        routing but must NOT emit rotateYaw, otherwise the aircraft pivots
        mid-flight to a direction unrelated to any camera target.
        """
        fp = _make_flight_plan(3)
        # default _make_flight_plan: wp0=TAKEOFF, wp1=MEASUREMENT, wp2=LANDING.
        # override middle to TRANSIT + heading, no camera target.
        fp.waypoints[1].waypoint_type = "TRANSIT"
        fp.waypoints[1].heading = 222.0
        fp.waypoints[1].camera_target = None

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "rotateYaw" not in waylines
        assert "gimbalRotate" not in waylines

    def test_transit_waypoint_keeps_zero_gimbal_pitch_block(self):
        """non-aiming waypoints serialize waypointGimbalPitchAngle=0.

        with gimbalPitchMode=manual the per-placemark block is informational
        only, but it must still be present and zeroed out to match the working
        fh2 export shape.
        """
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "TRANSIT"
        fp.waypoints[1].camera_target = None
        fp.waypoints[1].gimbal_pitch = None

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:waypointGimbalPitchAngle>0</wpml:waypointGimbalPitchAngle>" in waylines

    def test_horizontal_range_keeps_per_wp_gimbal_rotate_snap(self):
        """HR measurement waypoints use the per-WP gimbalRotate snap.

        VP video is the only method that sweeps gimbal pitch across a pass,
        so the smooth-sweep branch is scoped to it. HR holds gimbal pitch
        nearly constant across an arc - per-WP snap is fine and matches what
        the working fh2 reference export does.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 90.0
        wp.gimbal_pitch = -3.0
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        # per-WP snap is present, gimbalEvenlyRotate is not (no VP video metadata)
        assert "<wpml:gimbalPitchRotateAngle>-3</wpml:gimbalPitchRotateAngle>" in waylines
        assert "gimbalEvenlyRotate" not in waylines
        assert "betweenAdjacentPoints" not in waylines

    def test_gimbal_aim_consistent_across_export_scopes(self):
        """FULL / MEASUREMENTS_ONLY both use manual + gimbalRotate.

        the camera-aim contract is scope-agnostic - no scope-specific gimbal
        mode branching. every scope ships gimbalPitchMode=manual + a per-WP
        gimbalRotate snap on each measurement.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.gimbal_pitch = -45.0
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)
        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 5.0
        mission.inspections = []

        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            template, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission, scope=scope))
            assert "<wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>" in template, scope
            assert "<wpml:gimbalPitchRotateAngle>-45</wpml:gimbalPitchRotateAngle>" in waylines, (
                scope
            )

    def test_vp_video_first_measurement_anchors_gimbal_pitch_with_snap(self):
        """first MEASUREMENT of a VP video pass keeps the per-WP gimbalRotate snap.

        the snap anchors the gimbal at angle_start before the smooth segment
        sweep starts. without this, the gimbal would carry over its previous
        pitch (from transit / takeoff) into the first segment.
        """
        fp, mission, pitches = _make_vp_video_pass(num_measurements=4, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        # first measurement's pitch is anchored via gimbalRotate
        first_pitch = f"{pitches[0]:g}"
        assert (
            f"<wpml:gimbalPitchRotateAngle>{first_pitch}</wpml:gimbalPitchRotateAngle>" in waylines
        )

    def test_vp_video_interior_measurement_skips_gimbal_rotate_snap(self):
        """interior + last measurements of a VP video pass skip the per-WP snap.

        once the gimbal is anchored at the first measurement, gimbalEvenlyRotate
        between adjacent points handles the smooth sweep. emitting a per-WP
        gimbalRotate on top would re-lock the gimbal and undo the sweep.
        """
        fp, mission, pitches = _make_vp_video_pass(num_measurements=4, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        # interior + last measurement pitches MUST NOT appear in any
        # gimbalRotate (gimbalPitchRotateAngle) snap. they will appear inside
        # gimbalEvenlyRotate as segment targets, which is fine - that block
        # uses gimbalPitchRotateAngle as a per-segment target field.
        for pitch in pitches[1:]:
            snap_block = (
                "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>"
                "<wpml:actionActuatorFuncParam>"
                "<wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>"
                "<wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>"
                "<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>"
                f"<wpml:gimbalPitchRotateAngle>{pitch:g}</wpml:gimbalPitchRotateAngle>"
            )
            assert snap_block not in waylines, f"interior/last pitch {pitch} leaked into a snap"

    def test_vp_video_segment_emits_gimbal_evenly_rotate(self):
        """consecutive VP video MEASUREMENT WPs emit gimbalEvenlyRotate per segment.

        each segment carries an actionGroup with actionTriggerType
        =betweenAdjacentPoints + gimbalEvenlyRotate(target=next_wp.gimbal_pitch).
        the gimbal rotates evenly across the segment while the drone climbs.
        """
        fp, mission, pitches = _make_vp_video_pass(num_measurements=4, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "<wpml:actionTriggerType>betweenAdjacentPoints</wpml:actionTriggerType>" in waylines
        assert "gimbalEvenlyRotate" in waylines
        # one gimbalEvenlyRotate per segment, each targeting the NEXT measurement's pitch
        for next_pitch in pitches[1:]:
            target_block = (
                "<wpml:actionActuatorFunc>gimbalEvenlyRotate</wpml:actionActuatorFunc>"
                "<wpml:actionActuatorFuncParam>"
                f"<wpml:gimbalPitchRotateAngle>{next_pitch:g}</wpml:gimbalPitchRotateAngle>"
            )
            assert target_block in waylines, f"missing gimbalEvenlyRotate target {next_pitch}"

    def test_vp_video_measurement_uses_passthrough_turn_mode(self):
        """VP video MEASUREMENT WPs use toPointAndPassWithContinuityCurvature.

        without pass-through the drone halts at every measurement, breaking the
        continuous climb that gimbalEvenlyRotate is designed to ride. HOVER
        bookends + non-VP-video waypoints still use stop turn mode (default).
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=4, with_bookends=True)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert (
            "<wpml:waypointTurnMode>toPointAndPassWithContinuityCurvature</wpml:waypointTurnMode>"
            in waylines
        )
        # stop turn mode is still present (HOVER bookends, takeoff, landing)
        assert (
            "<wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>"
            in waylines
        )

    def test_vp_video_last_measurement_has_no_segment_action_group(self):
        """the last MEASUREMENT of a VP video pass emits no gimbalEvenlyRotate.

        with N=3 measurements there are exactly 2 segments (m1->m2, m2->m3).
        if the last measurement also emitted a betweenAdjacentPoints group, the
        target would point at a non-measurement (HOVER bookend or LANDING) and
        produce a spurious sweep.
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=3, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert waylines.count("gimbalEvenlyRotate") == 2

    def test_vp_video_inherits_capture_mode_from_mission_default(self):
        """capture_mode=None on inspection inherits from mission.default_capture_mode.

        the trajectory orchestrator (services/trajectory/orchestrator.py:680)
        applies the mission-level default when neither inspection nor template
        sets capture_mode. real-world missions in the DB almost always have
        capture_mode=None on every inspection row and rely on the mission's
        default_capture_mode column (whose own DB default is 'VIDEO_CAPTURE').
        without this inheritance the export's smooth-sweep branch silently
        skips every production VP video mission.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", capture_mode=None)

        target = _make_wkt_point(18.12, 49.69, 290.0)
        fp = _make_flight_plan(5)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[4].waypoint_type = "LANDING"
        for i, pitch in ((1, -1.0), (2, -3.5), (3, -6.5)):
            wp = fp.waypoints[i]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 90.0
            wp.gimbal_pitch = pitch
            wp.camera_target = target
            wp.camera_action = "RECORDING"
            wp.inspection_id = insp_id

        mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "<wpml:actionTriggerType>betweenAdjacentPoints</wpml:actionTriggerType>" in waylines
        assert "gimbalEvenlyRotate" in waylines

    def test_vp_video_falls_back_to_video_when_no_default_anywhere(self):
        """capture_mode=None at every level falls back to VIDEO_CAPTURE.

        matches the trajectory's `ResolvedConfig.capture_mode: str =
        "VIDEO_CAPTURE"` dataclass default - inspections / templates / missions
        with no capture_mode set anywhere should still smooth-sweep when the
        method is VERTICAL_PROFILE, since that's how the trajectory pipeline
        decides to emit RECORDING bookends in the first place.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", capture_mode=None)

        target = _make_wkt_point(18.12, 49.69, 290.0)
        fp = _make_flight_plan(5)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[4].waypoint_type = "LANDING"
        for i, pitch in ((1, -1.0), (2, -3.5), (3, -6.5)):
            wp = fp.waypoints[i]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 90.0
            wp.gimbal_pitch = pitch
            wp.camera_target = target
            wp.camera_action = "RECORDING"
            wp.inspection_id = insp_id

        mission = _make_mission_mock(inspections=[insp], default_capture_mode=None)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "gimbalEvenlyRotate" in waylines

    def test_vp_inspection_overrides_mission_default_to_photo(self):
        """inspection-level PHOTO_CAPTURE overrides mission default VIDEO_CAPTURE.

        precedence order matters: inspection.config wins over mission default.
        an inspection explicitly set to PHOTO_CAPTURE must take the per-WP snap
        path even on a mission whose default is VIDEO_CAPTURE.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", capture_mode="PHOTO_CAPTURE")

        target = _make_wkt_point(18.12, 49.69, 290.0)
        fp = _make_flight_plan(4)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[3].waypoint_type = "LANDING"
        for i, pitch in ((1, -2.0), (2, -5.0)):
            wp = fp.waypoints[i]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 90.0
            wp.gimbal_pitch = pitch
            wp.camera_target = target
            wp.camera_action = "PHOTO_CAPTURE"
            wp.inspection_id = insp_id

        mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "gimbalEvenlyRotate" not in waylines
        assert "<wpml:gimbalPitchRotateAngle>-2</wpml:gimbalPitchRotateAngle>" in waylines
        assert "<wpml:gimbalPitchRotateAngle>-5</wpml:gimbalPitchRotateAngle>" in waylines

    def test_vp_photo_keeps_per_wp_gimbal_rotate_snap(self):
        """VP PHOTO_CAPTURE keeps the per-WP gimbalRotate snap, no smooth sweep.

        photo capture needs the geometrically-exact pitch at every shot. the
        smooth-sweep branch is video-only.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", "PHOTO_CAPTURE")

        target = _make_wkt_point(18.12, 49.69, 290.0)
        fp = _make_flight_plan(4)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[3].waypoint_type = "LANDING"
        for i, pitch in ((1, -2.0), (2, -5.0)):
            wp = fp.waypoints[i]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 90.0
            wp.gimbal_pitch = pitch
            wp.camera_target = target
            wp.camera_action = "PHOTO_CAPTURE"
            wp.inspection_id = insp_id

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 5.0
        mission.inspections = [insp]

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "<wpml:gimbalPitchRotateAngle>-2</wpml:gimbalPitchRotateAngle>" in waylines
        assert "<wpml:gimbalPitchRotateAngle>-5</wpml:gimbalPitchRotateAngle>" in waylines
        assert "gimbalEvenlyRotate" not in waylines
        assert "betweenAdjacentPoints" not in waylines

    def test_hr_video_first_measurement_anchors_gimbal_pitch_with_snap(self):
        """first MEASUREMENT of an HR video arc keeps the per-WP gimbalRotate snap.

        the snap anchors the gimbal at the starting pitch before the smooth
        arc continues. without this the gimbal would carry whatever pitch the
        previous transit / hover bookend left it at.
        """
        fp, mission, pitches = _make_hr_video_pass(num_measurements=6, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        first_pitch = f"{pitches[0]:g}"
        snap_block = (
            "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>"
            "<wpml:actionActuatorFuncParam>"
            "<wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>"
            "<wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>"
            "<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>"
            f"<wpml:gimbalPitchRotateAngle>{first_pitch}</wpml:gimbalPitchRotateAngle>"
        )
        assert snap_block in waylines

    def test_hr_video_interior_measurement_skips_gimbal_rotate_snap(self):
        """interior + last measurements of an HR video arc skip the per-WP snap.

        body-follow + the anchored pitch keep the camera framed for the rest
        of the arc; per-WP snaps would re-lock the gimbal and stutter the video.
        """
        fp, mission, pitches = _make_hr_video_pass(num_measurements=6, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        for pitch in pitches[1:]:
            snap_block = (
                "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>"
                "<wpml:actionActuatorFuncParam>"
                "<wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>"
                "<wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>"
                "<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>"
                f"<wpml:gimbalPitchRotateAngle>{pitch:g}</wpml:gimbalPitchRotateAngle>"
            )
            assert snap_block not in waylines, f"interior/last pitch {pitch} leaked into a snap"

    def test_hr_video_measurement_uses_passthrough_turn_mode(self):
        """HR video MEASUREMENT WPs use toPointAndPassWithContinuityCurvature.

        without pass-through the drone halts at every arc waypoint - that's the
        regression #461 was filed against. HOVER bookends + non-HR-video
        waypoints still emit stop turn mode (default).
        """
        fp, mission, _ = _make_hr_video_pass(num_measurements=6, with_bookends=True)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert (
            "<wpml:waypointTurnMode>toPointAndPassWithContinuityCurvature</wpml:waypointTurnMode>"
            in waylines
        )
        assert (
            "<wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>"
            in waylines
        )

    def test_hr_video_emits_at_most_one_gimbal_rotate_per_inspection(self):
        """across the HR video MEASUREMENT slice exactly one gimbalRotate is emitted.

        anchor on the first measurement only; subsequent measurements ride on
        the held pitch + body-follow heading. HOVER bookends are HOVER not
        MEASUREMENT so they're not in the smooth-turn plan and are excluded
        from this slice.
        """
        fp, mission, _ = _make_hr_video_pass(num_measurements=10, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        # waypoints: TAKEOFF, m1..m10, LANDING. only m1 should carry gimbalRotate.
        snap_func = "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>"
        assert waylines.count(snap_func) == 1

    def test_hr_video_no_segment_action_group(self):
        """HR video MEASUREMENT WPs do not emit the betweenAdjacentPoints sweep.

        HR is anchor-only - pitch barely varies across an arc, so the firmware
        holds the anchored pitch through the rest of the measurements. the VP
        per-segment gimbalEvenlyRotate is not appropriate here.
        """
        fp, mission, _ = _make_hr_video_pass(num_measurements=6, with_bookends=False)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "betweenAdjacentPoints" not in waylines
        assert "gimbalEvenlyRotate" not in waylines

    def test_vp_video_recording_actions_merged_into_first_last_measurement(self):
        """VP video: recording start/stop fire inside the first/last MEASUREMENT's actionGroup.

        the merged-bookend shape eliminates the 0 m legs between the old
        standalone HOVER bookends and the first/last MEASUREMENT, so the drone
        can fly the climb as one continuous arc. there are no separate HOVER
        placemarks for the bookend; the recording action timing rides on the
        measurement's own reachPoint actionGroup.
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=4, with_bookends=True)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        ns = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.6"}
        root = ET.fromstring(waylines)
        placemarks = list(root.iter("{http://www.opengis.net/kml/2.2}Placemark"))

        # TAKEOFF, m1..m4, LANDING.
        assert len(placemarks) == 6
        first_measurement = placemarks[1]
        last_measurement = placemarks[4]
        first_funcs = [
            el.text for el in first_measurement.findall(".//wpml:actionActuatorFunc", ns)
        ]
        last_funcs = [el.text for el in last_measurement.findall(".//wpml:actionActuatorFunc", ns)]
        assert "startRecord" in first_funcs
        assert "stopRecord" in last_funcs
        start_tag = "<wpml:actionActuatorFunc>startRecord</wpml:actionActuatorFunc>"
        stop_tag = "<wpml:actionActuatorFunc>stopRecord</wpml:actionActuatorFunc>"
        all_starts = waylines.count(start_tag)
        all_stops = waylines.count(stop_tag)
        assert all_starts == 1
        assert all_stops == 1

    def test_hr_video_recording_actions_merged_into_first_last_measurement(self):
        """recording start/stop actions ride on the first/last MEASUREMENT actionGroup.

        the planner's merged-bookend shape removes the standalone HOVER bookends
        so the drone flies the arc as one continuous arc instead of stopping
        three times at the same physical point. the recording action timing now
        rides on the measurement's own reachPoint actionGroup, mirroring the
        structure of DJI's `docs/specs/PAPI 22.kmz` reference export.
        """
        fp, mission, _ = _make_hr_video_pass(num_measurements=4, with_bookends=True)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        ns = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.6"}
        root = ET.fromstring(waylines)
        placemarks = list(root.iter("{http://www.opengis.net/kml/2.2}Placemark"))

        # TAKEOFF, m1..m4, LANDING - the two HOVER bookends are gone.
        assert len(placemarks) == 6
        first_measurement = placemarks[1]
        last_measurement = placemarks[4]
        first_funcs = [
            el.text for el in first_measurement.findall(".//wpml:actionActuatorFunc", ns)
        ]
        last_funcs = [el.text for el in last_measurement.findall(".//wpml:actionActuatorFunc", ns)]
        assert "startRecord" in first_funcs
        assert "stopRecord" in last_funcs
        # neither of these actions appears anywhere else in the wayline.
        start_tag = "<wpml:actionActuatorFunc>startRecord</wpml:actionActuatorFunc>"
        stop_tag = "<wpml:actionActuatorFunc>stopRecord</wpml:actionActuatorFunc>"
        all_starts = waylines.count(start_tag)
        all_stops = waylines.count(stop_tag)
        assert all_starts == 1
        assert all_stops == 1

    def test_hr_photo_unchanged_per_wp_snap_and_stop_turn_mode(self):
        """HR + PHOTO_CAPTURE keeps per-WP snap and stop turn mode on every measurement.

        photo capture needs the drone still at every measurement for clean
        exposure. the smooth-turn branch is video-only.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "HORIZONTAL_RANGE", "PHOTO_CAPTURE")

        target = _make_wkt_point(18.12, 49.69, 290.0)
        fp = _make_flight_plan(5)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[4].waypoint_type = "LANDING"
        for i, pitch in ((1, -3.0), (2, -3.05), (3, -3.1)):
            wp = fp.waypoints[i]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 90.0
            wp.gimbal_pitch = pitch
            wp.camera_target = target
            wp.camera_action = "PHOTO_CAPTURE"
            wp.inspection_id = insp_id

        mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        for pitch in (-3.0, -3.05, -3.1):
            assert (
                f"<wpml:gimbalPitchRotateAngle>{pitch:g}</wpml:gimbalPitchRotateAngle>" in waylines
            )
        assert "toPointAndPassWithContinuityCurvature" not in waylines
        assert "gimbalEvenlyRotate" not in waylines
        assert "betweenAdjacentPoints" not in waylines

    def test_hr_video_inherits_capture_mode_from_mission_default(self):
        """HR + capture_mode=None inherits VIDEO_CAPTURE from mission default.

        production missions almost always leave capture_mode=None on the
        inspection row. without inheritance the HR-video smooth branch silently
        skips them and the export regresses to per-WP stops.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "HORIZONTAL_RANGE", capture_mode=None)

        target_lon, target_lat = 18.12, 49.69
        target = _make_wkt_point(target_lon, target_lat, 290.0)
        fp = _make_flight_plan(5)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[4].waypoint_type = "LANDING"
        for i in range(1, 4):
            arc_lon, arc_lat = point_at_distance(target_lon, target_lat, 60.0 + i * 20, 200.0)
            wp = fp.waypoints[i]
            wp.position = _make_wkt_point(arc_lon, arc_lat, 350.0)
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = bearing_between(arc_lon, arc_lat, target_lon, target_lat)
            wp.gimbal_pitch = -3.0
            wp.camera_target = target
            wp.camera_action = "RECORDING"
            wp.inspection_id = insp_id

        mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert (
            "<wpml:waypointTurnMode>toPointAndPassWithContinuityCurvature</wpml:waypointTurnMode>"
            in waylines
        )
        snap_func = "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>"
        assert waylines.count(snap_func) == 1

    def test_non_aimed_placemark_heading_block_byte_stable(self):
        """non-aimed placemarks emit the followWayline block without the POI sentinel.

        the towardPOI rewrite is scoped to MEASUREMENT/HOVER waypoints with a
        camera_target; takeoff, landing, and bare transit waypoints emit the
        followWayline shape across every scope. the WPML spec marks
        waypointPoiPoint as required only under towardPOI, so the followWayline
        block must omit it (audit §2.4).
        """
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "TRANSIT"
        fp.waypoints[1].heading = 222.0
        fp.waypoints[1].camera_target = None

        template, waylines = _read_wpmz(_gen_kmz(fp, "", 0))

        template_block = (
            "<wpml:waypointHeadingParam>"
            "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
            "<wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>"
            "<wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
            "<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>"
            "</wpml:waypointHeadingParam>"
        )
        waylines_block = (
            "<wpml:waypointHeadingParam>"
            "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
            "<wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>"
            "<wpml:waypointHeadingAngleEnable>0</wpml:waypointHeadingAngleEnable>"
            "<wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
            "<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>"
            "</wpml:waypointHeadingParam>"
        )
        # all three placemarks (takeoff, transit, landing) emit the unchanged block
        assert template.count(template_block) == 3
        assert waylines.count(waylines_block) == 3
        # POI sentinel must not appear anywhere on this all-non-aimed plan
        assert "<wpml:waypointPoiPoint>" not in template
        assert "<wpml:waypointPoiPoint>" not in waylines

    def test_explicit_toward_poi_mode_emits_per_placemark_poi(self):
        """missions with explicit dji_heading_mode='towardPOI' emit the #447 shape.

        towardPOI is the experimental continuous-tracking mode - aimed
        placemarks carry waypointHeadingMode=towardPOI + LHA poi point and
        no rotateYaw action. byte-identical output regardless of the
        drone's actual position relative to the camera target.
        """
        target = _make_ewkb(18.12, 49.69, 290.0)
        mission = _make_heading_mode_mission("towardPOI")
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.camera_target = target

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        for content in (template, waylines):
            assert "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>" in content
            # alt component is pinned to 0.000000 per common-element.md (audit §1)
            expected_poi = (
                "<wpml:waypointPoiPoint>49.690000,18.120000,0.000000</wpml:waypointPoiPoint>"
            )
            assert expected_poi in content
            assert "rotateYaw" not in content

    def test_aimed_placemark_followwayline_mode_emits_zero_poi_and_rotate_yaw(self):
        """followWayline mode re-emits the pre-#447 shape on aimed placemarks.

        every placemark carries the followWayline block with the zero-poi
        sentinel, aimed placemarks emit a rotateYaw action with normalized
        aircraftHeading + matching aircraftPathMode, useGlobalHeadingParam=1
        is restored on aimed template placemarks (no per-placemark override),
        and gimbalRotate(yaw_disabled) is retained.
        """
        mission = _make_heading_mode_mission("followWayline")
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 172.1
        wp.gimbal_pitch = -45.0
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        # waylines has one followWayline block per placemark (3); template also
        # carries the document-level globalWaypointHeadingParam followWayline so
        # counts are 4 in template, 3 in waylines.
        for content in (template, waylines):
            assert "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>" not in content
        assert (
            template.count("<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>")
            == 4
        )
        assert (
            waylines.count("<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>")
            == 3
        )
        # the zero-POI sentinel is gone across the board: spec marks
        # waypointPoiPoint as required only for towardPOI placemarks (audit §2.4)
        assert "<wpml:waypointPoiPoint>" not in template
        assert "<wpml:waypointPoiPoint>" not in waylines

        # rotateYaw is back on the aimed waypoint with normalized heading + clockwise path
        assert "<wpml:actionActuatorFunc>rotateYaw</wpml:actionActuatorFunc>" in waylines
        assert "<wpml:aircraftHeading>172.1</wpml:aircraftHeading>" in waylines
        assert "<wpml:aircraftPathMode>clockwise</wpml:aircraftPathMode>" in waylines

        # gimbalRotate stays for body-follow yaw
        assert "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>" in waylines
        assert "<wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>" in waylines

        # template placemark inherits the global followWayline block on every
        # placemark (3 in a 3-wp plan) including the aimed measurement
        assert template.count("<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>") == 3

    def test_followwayline_mode_normalizes_heading_short_way(self):
        """heading > 180 normalizes to negative + counterClockwise path.

        a raw 200° heading wraps to -160° in dji's [-180, 180] range and
        the path mode flips so the rotation takes the short way round
        (160° counterclockwise instead of 200° clockwise).
        """
        mission = _make_heading_mode_mission("followWayline")
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = 200.0
        wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        assert "<wpml:aircraftHeading>-160</wpml:aircraftHeading>" in waylines
        assert "<wpml:aircraftPathMode>counterClockwise</wpml:aircraftPathMode>" in waylines

    def test_smoothtransition_default_emits_per_placemark_heading_angle(self):
        """body-tracks-target placemarks (HR/VP) emit waypointHeadingMode=smoothTransition.

        when wp.heading equals the bearing from wp position to camera_target
        (within the 5° predicate tolerance), the export emits per-placemark
        smoothTransition + waypointHeadingAngle=<wp.heading>. drops the
        rotateYaw action and the useGlobalHeadingParam inheritance flag on
        the template placemark.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        # wp position is (18.111, 49.691); target due east → bearing ≈ 90°
        wp.heading = 90.0
        wp.camera_target = _make_ewkb(18.121, 49.691, 290.0)

        # mission=None → resolver default = smoothTransition
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        smooth_mode = "<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>"
        for content in (template, waylines):
            assert smooth_mode in content
            assert "<wpml:waypointHeadingAngle>90</wpml:waypointHeadingAngle>" in content
            assert "<wpml:actionActuatorFunc>rotateYaw</wpml:actionActuatorFunc>" not in content

        # the body-tracks-target placemark drops useGlobalHeadingParam on the
        # template; the takeoff and landing emit it, so 2 occurrences in a 3-WP
        # plan with one aimed measurement
        assert template.count("<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>") == 2
        # waylines emits waypointHeadingAngleEnable=1 (per-WP angle is the
        # override here, opposite of towardPOI which puts the truth in
        # waypointPoiPoint)
        assert "<wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>" in waylines

    def test_smoothtransition_normalizes_heading_to_signed_range(self):
        """heading > 180 wraps to negative for smoothTransition's per-WP angle."""
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        # place the target exactly at bearing 200° from wp position so the
        # body-tracks-target predicate fires for the smoothTransition branch
        wp_lon, wp_lat = 18.111, 49.691
        target_lon, target_lat = point_at_distance(wp_lon, wp_lat, 200.0, 100.0)
        wp.heading = 200.0
        wp.camera_target = _make_ewkb(target_lon, target_lat, 290.0)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        # 200° wraps to -160° in dji's signed range
        assert "<wpml:waypointHeadingAngle>-160</wpml:waypointHeadingAngle>" in waylines
        assert "<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>" in waylines

    def test_smoothtransition_falls_back_to_followwayline_for_row_methods(self):
        """row-direction methods (FO/SS) emit followWayline + rotateYaw under smoothTransition.

        FO/SS set wp.heading to the row direction (along the row of LHAs);
        the target sits perpendicular to the row. the body-tracks-target
        predicate fails and the placemark falls through to the followWayline
        block - matches the global, no per-placemark override, rotateYaw
        action is fired so the body still aligns with the row at each WP.
        """
        fp = _make_flight_plan(3)
        wp = fp.waypoints[1]
        wp.waypoint_type = "MEASUREMENT"
        # row heading = 0° (north); target due east → bearing ≈ 90°.
        # diff = 90° >> 5° tolerance → row-direction fallback.
        wp.heading = 0.0
        wp.camera_target = _make_ewkb(18.121, 49.691, 290.0)

        # mission=None → resolver default = smoothTransition
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        smooth_mode = "<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>"
        for content in (template, waylines):
            assert smooth_mode not in content
        # all three placemarks emit the followWayline block (3 in waylines,
        # plus the document-level globalWaypointHeadingParam in template = 4)
        assert (
            waylines.count("<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>")
            == 3
        )
        # rotateYaw is back on the aimed row-direction WP so the body snaps
        # to the row heading at each measurement
        assert "<wpml:actionActuatorFunc>rotateYaw</wpml:actionActuatorFunc>" in waylines
        # template inherits the global block on every placemark
        assert template.count("<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>") == 3

    def test_smoothtransition_predicate_tolerance_at_boundary(self):
        """5° tolerance: 4° diff classifies as body-tracks-target, 6° doesn't."""
        # target due east from (18.111, 49.691) → bearing ≈ 90°
        target = _make_ewkb(18.121, 49.691, 290.0)

        # 4° off bearing - within tolerance, smoothTransition emits per-WP angle
        fp_in = _make_flight_plan(3)
        fp_in.waypoints[1].waypoint_type = "MEASUREMENT"
        fp_in.waypoints[1].heading = 86.0
        fp_in.waypoints[1].camera_target = target
        _, in_wpml = _read_wpmz(_gen_kmz(fp_in, "", 0))
        assert "<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>" in in_wpml

        # 6° off bearing - outside tolerance, falls back to followWayline
        fp_out = _make_flight_plan(3)
        fp_out.waypoints[1].waypoint_type = "MEASUREMENT"
        fp_out.waypoints[1].heading = 84.0
        fp_out.waypoints[1].camera_target = target
        _, out_wpml = _read_wpmz(_gen_kmz(fp_out, "", 0))
        smooth_mode = "<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>"
        assert smooth_mode not in out_wpml

    def test_non_aimed_placemark_byte_stable_across_modes(self):
        """transit / takeoff / landing placemarks are byte-identical across modes.

        regression guard: flipping dji_heading_mode must not perturb the
        non-aimed (followWayline) block. only aimed measurement / hover
        placemarks differ between modes.
        """
        template_block = (
            "<wpml:waypointHeadingParam>"
            "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
            "<wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>"
            "<wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
            "<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>"
            "</wpml:waypointHeadingParam>"
        )
        waylines_block = (
            "<wpml:waypointHeadingParam>"
            "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
            "<wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>"
            "<wpml:waypointHeadingAngleEnable>0</wpml:waypointHeadingAngleEnable>"
            "<wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
            "<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>"
            "</wpml:waypointHeadingParam>"
        )
        for mode in ("smoothTransition", "towardPOI", "followWayline"):
            mission = _make_heading_mode_mission(mode)
            fp = _make_flight_plan(3)
            fp.waypoints[1].waypoint_type = "TRANSIT"
            fp.waypoints[1].heading = 222.0
            fp.waypoints[1].camera_target = None

            template, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

            # all three non-aimed placemarks emit the unchanged followWayline block
            assert template.count(template_block) == 3, mode
            assert waylines.count(waylines_block) == 3, mode
            # POI sentinel must be gone across all modes for non-aimed placemarks
            assert "<wpml:waypointPoiPoint>" not in template, mode
            assert "<wpml:waypointPoiPoint>" not in waylines, mode

    def test_payload_param_block_present(self):
        """template folder has the trailing payloadParam block required by fh2."""
        fp = _make_flight_plan(1)

        template, _ = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:payloadParam>" in template
        assert "<wpml:focusMode>firstPoint</wpml:focusMode>" in template
        assert "<wpml:imageFormat>visable</wpml:imageFormat>" in template
        assert "<wpml:photoSize>default_l</wpml:photoSize>" in template

    @pytest.mark.parametrize(
        "model,drone_enum,drone_sub,payload_enum,payload_sub",
        [
            ("Matrice 4T", "99", "1", "89", "0"),
            ("Matrice 300 RTK", "60", "0", "43", "0"),
            ("Matrice 350 RTK", "89", "0", "43", "0"),
            ("Mavic 3 Enterprise", "77", "0", "66", "0"),
        ],
    )
    def test_dji_enums_resolve_per_configured_drone(
        self, model, drone_enum, drone_sub, payload_enum, payload_sub
    ):
        """each mapped dji drone exports its own wpml drone + payload enum."""
        fp = _make_flight_plan(1)
        profile = MagicMock()
        profile.model_identifier = None
        profile.manufacturer = "DJI"
        profile.model = model

        template, waylines = _read_wpmz(_gen_kmz(fp, "", 0, drone_profile=profile))

        for doc in (template, waylines):
            assert f"<wpml:droneEnumValue>{drone_enum}</wpml:droneEnumValue>" in doc
            assert f"<wpml:droneSubEnumValue>{drone_sub}</wpml:droneSubEnumValue>" in doc
            assert f"<wpml:payloadEnumValue>{payload_enum}</wpml:payloadEnumValue>" in doc
            assert f"<wpml:payloadSubEnumValue>{payload_sub}</wpml:payloadSubEnumValue>" in doc

    def test_no_hardcoded_drone_enum(self):
        """the legacy single-tuple constant is gone - the table is the source of truth."""
        from app.services.export.dji import mission_config

        assert not hasattr(mission_config, "_DJI_FALLBACK_ENUMS")

    def test_dji_enums_fallback_to_m4t_for_unmapped_drone(self):
        """_dji_enums_for returns the m4t fallback for unmapped / non-dji / None drones."""
        from app.services.export.dji.mission_config import (
            _M4T_FALLBACK_ENUM,
            _dji_enums_for,
        )

        mavic = MagicMock()
        mavic.model = "Mavic 2 Pro"
        skydio = MagicMock()
        skydio.model = "Skydio X10"

        assert _dji_enums_for(mavic) == _M4T_FALLBACK_ENUM
        assert _dji_enums_for(skydio) == _M4T_FALLBACK_ENUM
        assert _dji_enums_for(None) == _M4T_FALLBACK_ENUM
        # sanity: the fallback IS the matrice 4t tuple
        assert _M4T_FALLBACK_ENUM == ("99", "1", "89", "0")

    def test_drone_supports_dji_wpml_predicate(self):
        """the predicate is true only for drones in the mapped enum table."""
        from app.services.export.dji.mission_config import drone_supports_dji_wpml

        mapped = MagicMock()
        mapped.model = "Matrice 350 RTK"
        unmapped = MagicMock()
        unmapped.model = "Mavic 2 Pro"
        non_dji = MagicMock()
        non_dji.model = "Skydio X10"

        assert drone_supports_dji_wpml(mapped) is True
        assert drone_supports_dji_wpml(unmapped) is False
        assert drone_supports_dji_wpml(non_dji) is False
        assert drone_supports_dji_wpml(None) is False

    def test_mission_config_drone_info_present(self):
        """missionConfig includes droneInfo and payloadInfo blocks."""
        fp = _make_flight_plan(1)

        template, _ = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "wpml:droneInfo" in template
        assert "wpml:droneEnumValue" in template
        assert "wpml:payloadInfo" in template
        assert "wpml:payloadEnumValue" in template

    def test_template_kml_has_template_folder(self):
        """template.kml folder declares templateType=waypoint and coordinate system."""
        fp = _make_flight_plan(1)

        template, _ = _read_wpmz(_gen_kmz(fp, "", 0))

        assert "<wpml:templateType>waypoint</wpml:templateType>" in template
        assert "<wpml:coordinateMode>WGS84</wpml:coordinateMode>" in template
        assert "<wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>" in template

    def test_empty_waypoints_produces_valid_archive(self):
        """missions with zero waypoints still emit a structurally valid wpmz archive."""
        fp = _make_flight_plan(0)

        result = _gen_kmz(fp, "", 0)
        template, waylines = _read_wpmz(result)

        assert "<Placemark" not in template
        assert "<Placemark" not in waylines
        # payloadParam must still be emitted so the schema stays valid
        assert "<wpml:payloadParam>" in template

    def test_kmz_full_uses_relative_height_mode(self):
        """FULL export emits executeHeightMode=relativeToStartPoint."""
        fp = _make_flight_plan(3)
        # collapse all WPs onto the airport ground -> relative 0 -> RTH is the 20 m margin
        for wp in fp.waypoints:
            wp.position = _make_wkt_point(18.11, 49.69, 290.0)

        template, waylines = _read_wpmz(_gen_kmz(fp, "", 290.0, scope="FULL"))

        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in waylines
        assert "<wpml:takeOffSecurityHeight>1.5</wpml:takeOffSecurityHeight>" in template
        # globalRTHHeight scoped to waylines.wpml only (audit §2.2)
        assert "<wpml:globalRTHHeight>" not in template
        assert "<wpml:globalRTHHeight>20</wpml:globalRTHHeight>" in waylines

    def test_kmz_measurements_only_structure(self):
        """MEASUREMENTS_ONLY export uses pilot-RC-compatible config.

        - takeOffRefPoint anchors lat/lon to first measurement, alt to airport
          ground level (HAE-converted), regardless of mission.takeoff_coordinate
          (the operator typically planned a FULL mission first and re-exports
          the same mission as MEASUREMENTS_ONLY for the in-air-handover
          workflow, so takeoff_coordinate is set but must not bleed into the
          wayline ref point - FH2 would draw a stray takeoff icon at it
          otherwise).
        - takeOffSecurityHeight is a small spec-valid value (>= 1.2 m), never 0
          (drone is already airborne, no climb-from-ground).
        - executeHeightMode=relativeToStartPoint with executeHeight measured
          above the takeoff ground point.
        - autoFlightSpeed falls back to mission.default_speed (cruise) instead
          of the slow first-waypoint speed.
        - globalRTHHeight covers the actual flight envelope, not the FULL-mode
          100m default.
        """
        from app.utils.geo import msl_to_hae

        # all three waypoints are MEASUREMENT at altitude (no takeoff/landing)
        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"
            wp.speed = 3.0
        # raise one waypoint well above the FULL-mode 100m RTH default
        fp.waypoints[1].position = _make_ewkb(18.115, 49.695, 450.0)

        mission = MagicMock()
        # takeoff coord is set to a ground point hundreds of metres from WP1 -
        # this is the realistic case (mission planned as FULL, re-exported as
        # MEASUREMENTS_ONLY). The ref point must still anchor at WP1.
        mission.takeoff_coordinate = _make_ewkb(17.500000, 48.500000, 175.5)
        mission.default_speed = 12.0
        mission.inspections = []

        template, waylines = _read_wpmz(
            _gen_kmz(
                fp,
                "Test",
                290.0,
                mission=mission,
                scope="MEASUREMENTS_ONLY",
            )
        )

        # takeOffRefPoint uses first wp lat/lon, airport elevation -> HAE
        ref_hae = msl_to_hae(49.690, 18.110, 290.0)
        assert (
            f"<wpml:takeOffRefPoint>49.690000,18.110000,{ref_hae:.6f}</wpml:takeOffRefPoint>"
            in template
        )
        # takeOffSecurityHeight is spec-valid (>= 1.2), never 0
        assert "<wpml:takeOffSecurityHeight>1.5</wpml:takeOffSecurityHeight>" in template
        assert "<wpml:takeOffSecurityHeight>0</wpml:takeOffSecurityHeight>" not in template
        # executeHeightMode is relativeToStartPoint on every scope
        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in waylines
        # executeHeight is wp_MSL - takeoff_ground_MSL; MO anchors at airport
        # ground (290), so the first waypoint at msl 300 -> relative 10
        assert "<wpml:executeHeight>10.000000</wpml:executeHeight>" in waylines
        # autoFlightSpeed comes from mission.default_speed, not the slow first wp
        assert "<wpml:autoFlightSpeed>12</wpml:autoFlightSpeed>" in template
        assert "<wpml:autoFlightSpeed>12</wpml:autoFlightSpeed>" in waylines
        # globalRTHHeight is scoped to waylines.wpml (audit §2.2). MO ceiling
        # clears the highest waypoint plus margin (not 100).
        assert "<wpml:globalRTHHeight>" not in template
        assert "<wpml:globalRTHHeight>180</wpml:globalRTHHeight>" in waylines

    def test_measurements_only_null_default_speed_floors_auto_flight_speed(self):
        """#231 fix 2 - a null default_speed floors autoFlightSpeed to cruise.

        the first waypoint is a slow measurement (~0.5 m/s); when
        mission.default_speed is null the old code leaked that slow speed into
        autoFlightSpeed and pilot rc rejected the wayline. it must floor to
        _DEFAULT_AUTO_FLIGHT_SPEED instead.
        """
        from app.services.export.dji.mission_config import (
            _DEFAULT_AUTO_FLIGHT_SPEED,
            _resolve_auto_speed,
        )

        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"
            wp.speed = 0.5

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = None
        mission.inspections = []

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 290.0, mission=mission, scope="MEASUREMENTS_ONLY")
        )

        floor = f"{_DEFAULT_AUTO_FLIGHT_SPEED:g}"
        assert f"<wpml:autoFlightSpeed>{floor}</wpml:autoFlightSpeed>" in template
        assert f"<wpml:autoFlightSpeed>{floor}</wpml:autoFlightSpeed>" in waylines
        assert "<wpml:autoFlightSpeed>0.5</wpml:autoFlightSpeed>" not in template
        assert "<wpml:autoFlightSpeed>0.5</wpml:autoFlightSpeed>" not in waylines

        # unit-level: null/zero floor, positive default passes through
        assert _resolve_auto_speed(fp.waypoints, mission, "MEASUREMENTS_ONLY") == floor
        mission.default_speed = 0
        assert _resolve_auto_speed(fp.waypoints, mission, "MEASUREMENTS_ONLY") == floor
        mission.default_speed = 12
        assert _resolve_auto_speed(fp.waypoints, mission, "MEASUREMENTS_ONLY") == "12"

    def test_kmz_measurements_only_takeoff_ref_anchors_at_wp1_when_takeoff_coord_set(self):
        """MEASUREMENTS_ONLY anchors takeOffRefPoint at WP1 even with takeoff_coord set.

        regression guard for the FH2 stray-takeoff-icon bug: the operator
        plans a FULL mission (which sets mission.takeoff_coordinate to a
        ground point), then re-exports the same mission as MEASUREMENTS_ONLY.
        the wayline must not carry the operator's ground takeoff coord into
        wpml:takeOffRefPoint - FH2 would draw an icon there with a tether
        to WP1. anchor at WP1 lat/lon with airport_elevation (HAE) instead.
        """
        from app.utils.geo import msl_to_hae

        fp = _make_flight_plan(2)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"

        mission = MagicMock()
        # ground takeoff coord far from WP1 (49.69, 18.11)
        mission.takeoff_coordinate = _make_ewkb(17.000000, 48.000000, 200.0)
        mission.default_speed = 10.0
        mission.inspections = []

        template, _ = _read_wpmz(
            _gen_kmz(
                fp,
                "Test",
                290.0,
                mission=mission,
                scope="MEASUREMENTS_ONLY",
            )
        )

        # ref point is WP1 lat/lon with airport_elevation HAE-converted - not
        # the operator's ground takeoff coord
        ref_hae = msl_to_hae(49.690, 18.110, 290.0)
        assert (
            f"<wpml:takeOffRefPoint>49.690000,18.110000,{ref_hae:.6f}</wpml:takeOffRefPoint>"
            in template
        )
        assert "48.000000" not in template
        assert "17.000000" not in template

    def test_kmz_measurements_only_uses_point_to_point_and_goto_first_waypoint(self):
        """MEASUREMENTS_ONLY emits flyToWaylineMode=pointToPoint, finishAction=gotoFirstWaypoint.

        the in-air-handover contract: drone enters the wayline at WP1 (no
        climb-to-safety ritual) and parks above WP1 after the last
        measurement (no goHome to runtime HP). operator manually flies it
        back and lands.
        """
        fp = _make_flight_plan(2)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 10.0
        mission.inspections = []

        template, waylines = _read_wpmz(
            _gen_kmz(
                fp,
                "Test",
                290.0,
                mission=mission,
                scope="MEASUREMENTS_ONLY",
            )
        )

        for content in (template, waylines):
            assert "<wpml:flyToWaylineMode>pointToPoint</wpml:flyToWaylineMode>" in content
            assert "<wpml:finishAction>gotoFirstWaypoint</wpml:finishAction>" in content
            assert "<wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>" not in content
            assert "<wpml:finishAction>goHome</wpml:finishAction>" not in content

    def test_kmz_full_uses_point_to_point_and_goto_first_waypoint(self):
        """FULL is hand-launched: pointToPoint + gotoFirstWaypoint, never goHome.

        the operator flies the drone up manually and triggers the wayline
        airborne, so FULL carries no ground takeoff/landing and
        must not auto-land - the same airborne handling as MEASUREMENTS_ONLY.
        a goHome finishAction would land the aircraft, contradicting the scope.
        """
        fp = _make_flight_plan(3)

        template, waylines = _read_wpmz(_gen_kmz(fp, "", 0, scope="FULL"))

        for content in (template, waylines):
            assert "<wpml:flyToWaylineMode>pointToPoint</wpml:flyToWaylineMode>" in content
            assert "<wpml:finishAction>gotoFirstWaypoint</wpml:finishAction>" in content
            assert "<wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>" not in content
            assert "<wpml:finishAction>goHome</wpml:finishAction>" not in content

    def test_waylines_wpml_emits_coordinate_sys_param_ntl_mo(self):
        """waylines folder declares waylineCoordinateSysParam on every scope.

        without it pilot rc renders placemark labels but refuses to draw the
        connecting polyline or populate the mission summary. block must sit
        before executeHeightMode so schema ordering matches the template.kml.
        coordinateMode is WGS84, heightMode is relativeToStartPoint.
        """
        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            fp = _make_flight_plan(3)
            for wp in fp.waypoints:
                wp.waypoint_type = "MEASUREMENT"
            mission = MagicMock()
            mission.takeoff_coordinate = None
            mission.default_speed = 10.0
            mission.inspections = []

            _, waylines = _read_wpmz(_gen_kmz(fp, "", 290.0, mission=mission, scope=scope))

            root = ET.fromstring(waylines)
            folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
            assert folder is not None, f"folder missing on scope={scope}"

            coord_sys = folder.findall(f"{{{wpml_ns}}}waylineCoordinateSysParam")
            assert len(coord_sys) == 1, f"expected exactly one block on scope={scope}"

            mode = coord_sys[0].find(f"{{{wpml_ns}}}coordinateMode")
            height = coord_sys[0].find(f"{{{wpml_ns}}}heightMode")
            assert mode is not None and mode.text == "WGS84"
            assert height is not None and height.text == "relativeToStartPoint"

            # ordering: coord-sys block must appear before executeHeightMode
            children = list(folder)
            tags = [c.tag for c in children]
            cs_idx = tags.index(f"{{{wpml_ns}}}waylineCoordinateSysParam")
            ehm_idx = tags.index(f"{{{wpml_ns}}}executeHeightMode")
            assert cs_idx < ehm_idx, f"coord-sys after executeHeightMode on scope={scope}"

    def test_waylines_wpml_distance_duration_match_emitted_waypoints_mo(self):
        """MO distance/duration come from emitted waypoints, not flight_plan.total_distance.

        the persisted flight_plan.total_distance is computed against the FULL
        trajectory; reusing it for MO would overstate the slice and may cause
        pilot rc to refuse to populate the summary panel. distance is the 3D
        flight path length (sqrt(horizontal_haversine^2 + alt_delta^2)) so
        vertical-profile climbs at fixed standoff don't zero out.
        """
        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        # MO slice with three measurements at known coords - 3D distance
        # is computable. flight_plan.total_distance is stubbed to a value
        # that does not match the slice (FULL trajectory was longer).
        fp = _make_flight_plan(3)
        coords = [
            (18.110, 49.690, 300.0),
            (18.115, 49.695, 310.0),
            (18.120, 49.700, 320.0),
        ]
        for wp, (lon, lat, alt) in zip(fp.waypoints, coords):
            wp.waypoint_type = "MEASUREMENT"
            wp.position = _make_ewkb(lon, lat, alt)
            # zero speed -> per-leg falls back to auto_speed (mission cruise)
            wp.speed = 0.0
        # persisted FULL-trajectory totals - must NOT leak into MO output
        fp.total_distance = 9999.0
        fp.estimated_duration = 999.0

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 10.0
        mission.inspections = []

        _, waylines = _read_wpmz(
            _gen_kmz(fp, "", 290.0, mission=mission, scope="MEASUREMENTS_ONLY")
        )

        root = ET.fromstring(waylines)
        folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
        distance_el = folder.find(f"{{{wpml_ns}}}distance")
        duration_el = folder.find(f"{{{wpml_ns}}}duration")
        assert distance_el is not None
        assert duration_el is not None

        expected_dist = sum(
            math.hypot(
                distance_between(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]),
                coords[i + 1][2] - coords[i][2],
            )
            for i in range(len(coords) - 1)
        )
        emitted_dist = float(distance_el.text)
        emitted_dur = float(duration_el.text)

        assert math.isclose(emitted_dist, expected_dist, abs_tol=1.0), (
            f"distance {emitted_dist} not close to 3D sum {expected_dist}"
        )
        # explicitly NOT equal to the persisted FULL value
        assert not math.isclose(emitted_dist, fp.total_distance, abs_tol=1.0)
        # uniform-speed fallback: duration ≈ distance / auto_speed (cruise)
        assert math.isclose(emitted_dur, expected_dist / mission.default_speed, abs_tol=0.5)

    def test_waylines_wpml_distance_includes_vertical_profile_climb(self):
        """3D distance counts altitude movement on vertical-profile climbs.

        VP measurement passes share lon/lat (vertical climb at fixed standoff)
        and only differ in altitude. horizontal-only haversine would emit 0
        distance for the entire pass, leaving Pilot RC to display 0 m / 0 s
        in the mission summary. The fix is to use 3D distance per leg so the
        wayline summary reflects the real flight path.
        """
        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        # all three waypoints at same lon/lat, different altitude (vertical climb)
        fp = _make_flight_plan(3)
        for i, wp in enumerate(fp.waypoints):
            wp.waypoint_type = "MEASUREMENT"
            wp.position = _make_ewkb(18.110, 49.690, 300.0 + i * 10)
            wp.speed = 2.0

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 5.0
        mission.inspections = []

        _, waylines = _read_wpmz(
            _gen_kmz(fp, "", 290.0, mission=mission, scope="MEASUREMENTS_ONLY")
        )

        root = ET.fromstring(waylines)
        folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
        emitted_dist = float(folder.find(f"{{{wpml_ns}}}distance").text)
        emitted_dur = float(folder.find(f"{{{wpml_ns}}}duration").text)

        # 2 legs * 10 m altitude delta each = 20 m total. horizontal=0, so
        # any non-trivial value here proves 3D distance is being computed.
        assert math.isclose(emitted_dist, 20.0, abs_tol=0.1), (
            f"expected ~20 m vertical climb, got {emitted_dist} m (alt-naive bug?)"
        )
        # 20 m / 2 m/s = 10 s
        assert math.isclose(emitted_dur, 10.0, abs_tol=0.1)

    def test_wayline_distance_duration_matches_orchestrator_totals(self):
        """emitted distance/duration mirror the orchestrator's trapezoidal totals.

        the wayline summary consumes `_segment_duration_with_accel` per leg
        plus the TAKEOFF/LANDING fixed time on synthetic TAKEOFF/LANDING-typed
        waypoints, the gimbal-settle penalty, and per-WP hover_duration so the
        operator's ETA from Pilot RC matches the backend's persisted
        `flight_plan.estimated_duration`. without this sync the export
        under-reported the flight time by 10-20%.
        """
        from app.services.trajectory.orchestrator import _segment_duration_with_accel
        from app.services.trajectory.types import (
            GIMBAL_SETTLE_TIME,
            LANDING_DURATION,
            TAKEOFF_DURATION,
        )

        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        # the test-only `_make_flight_plan(4)` fixture produces TAKEOFF ->
        # MEASUREMENT -> MEASUREMENT -> LANDING, all on the same heading at
        # fixed speed. the emitter adds TAKEOFF/LANDING fixed time on those
        # types and one gimbal-settle penalty on the TAKEOFF -> MEASUREMENT
        # transition.
        fp = _make_flight_plan(4)
        speed = 5.0
        coords = []
        for wp in fp.waypoints:
            lon, lat, alt = point_lonlatalt(wp.position)
            coords.append((lon, lat, alt))
            wp.speed = speed
            wp.hover_duration = None

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, scope="FULL"))

        root = ET.fromstring(waylines)
        folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
        emitted_dist = float(folder.find(f"{{{wpml_ns}}}distance").text)
        emitted_dur = float(folder.find(f"{{{wpml_ns}}}duration").text)

        # expected 3D distance per leg (matches `_compute_totals`).
        legs = []
        for (lon1, lat1, alt1), (lon2, lat2, alt2) in zip(coords, coords[1:]):
            horiz = distance_between(lon1, lat1, lon2, lat2)
            legs.append(math.hypot(horiz, alt2 - alt1))
        expected_dist = sum(legs)
        expected_dur = (
            TAKEOFF_DURATION
            + LANDING_DURATION
            + sum(_segment_duration_with_accel(leg, speed, speed) for leg in legs)
            + GIMBAL_SETTLE_TIME  # one TAKEOFF -> MEASUREMENT transition
        )

        assert math.isclose(emitted_dist, expected_dist, abs_tol=1.0), (
            f"distance {emitted_dist} not close to expected {expected_dist}"
        )
        assert math.isclose(emitted_dur, expected_dur, abs_tol=0.5), (
            f"duration {emitted_dur} not close to expected {expected_dur}"
        )

    def test_emitted_duration_includes_video_bookend_hover(self):
        """recording-bookend hover dwell on first/last MEASUREMENT lands in duration.

        the merged-bookend shape carries `hover_duration` on the first and last
        MEASUREMENT (camera-startup pause / tail dwell). these contribute to
        the wayline summary just like a standalone HOVER would, so the
        operator's ETA still absorbs the recording latency.
        """
        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        fp_with, mission, _ = _make_vp_video_pass(num_measurements=4, with_bookends=True)
        fp_without, _, _ = _make_vp_video_pass(num_measurements=4, with_bookends=False)

        def _dur(fp) -> float:
            """parse the emitted duration off a generated wayline."""
            _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))
            root = ET.fromstring(waylines)
            folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
            return float(folder.find(f"{{{wpml_ns}}}duration").text)

        # two 3-second hovers (first + last MEASUREMENT) add 6 s of dwell.
        delta = _dur(fp_with) - _dur(fp_without)
        assert math.isclose(delta, 6.0, abs_tol=0.5), (
            f"expected ~6 s extra duration from bookend dwell, got {delta}"
        )

    def test_waylines_wpml_distance_duration_full_scope_recomputed(self):
        """FULL scope also reports recomputed distance/duration (positive, finite)."""
        kml_ns = "http://www.opengis.net/kml/2.2"
        wpml_ns = "http://www.dji.com/wpmz/1.0.6"

        fp = _make_flight_plan(4)
        # set persisted totals to obviously-wrong sentinel values to prove
        # the emitted figures come from the recompute, not the row.
        fp.total_distance = 12345.0
        fp.estimated_duration = 678.0

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, scope="FULL"))

        root = ET.fromstring(waylines)
        folder = root.find(f"{{{kml_ns}}}Document/{{{kml_ns}}}Folder")
        emitted_dist = float(folder.find(f"{{{wpml_ns}}}distance").text)
        emitted_dur = float(folder.find(f"{{{wpml_ns}}}duration").text)

        assert math.isfinite(emitted_dist) and emitted_dist > 0
        assert math.isfinite(emitted_dur) and emitted_dur > 0
        # must not be the stubbed sentinels
        assert not math.isclose(emitted_dist, fp.total_distance, abs_tol=1.0)
        assert not math.isclose(emitted_dur, fp.estimated_duration, abs_tol=0.5)


class TestDjiZeroIndexedReferences:
    """regression coverage for DJI WPML 0-indexed wpml:index + actionGroup refs.

    the spec requires `<wpml:index>` to start at 0 and `actionGroupStartIndex`
    / `actionGroupEndIndex` to reference that same 0-indexed space. the export
    used to emit 1-indexed values throughout, so on real hardware (Pilot 2
    v10.1.8.18, M4T enterprise build) every reachPoint action fired one
    waypoint LATER than intended - recording started after the bookend hover,
    HR gimbal snaps slid by one ~26 m segment, recording stopped after the
    drone left the arc. the drone executor reads the same WPML, so this is not
    only a Pilot 2 display issue.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _placemarks(self, template_xml: str):
        """parse template.kml and return its Placemark elements."""
        return ET.fromstring(template_xml).findall(".//kml:Placemark", self._WPML_NS)

    def test_first_placemark_emits_wpml_index_zero(self):
        """the first placemark's wpml:index is 0 (per DJI's 0-indexed spec)."""
        fp = _make_flight_plan(3)

        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 0))

        placemarks = self._placemarks(template)
        assert placemarks, "expected at least one placemark"
        first = placemarks[0].findtext("wpml:index", namespaces=self._WPML_NS)
        assert first == "0"

    def test_placemark_indices_are_contiguous_zero_indexed(self):
        """placemarks emit wpml:index in strict ascending order from 0."""
        fp = _make_flight_plan(5)

        template, _ = _read_wpmz(_gen_kmz(fp, "Test", 0))

        placemarks = self._placemarks(template)
        emitted = [pm.findtext("wpml:index", namespaces=self._WPML_NS) for pm in placemarks]
        assert emitted == [str(i) for i in range(len(placemarks))]
        _assert_dji_conformance(template=template)

    def test_reach_point_action_groups_match_parent_placemark_index(self):
        """every reachPoint actionGroupStart/EndIndex equals the parent wpml:index.

        reachPoint groups carry hover, gimbal snaps, recording start/stop, and
        zoom actions; misaligning the reference index against the structural
        index is what made each action fire one WP later on real hardware.
        """
        # HR video pass exercises both hover-bookend reachPoint groups
        # (RECORDING_START / RECORDING_STOP) and per-measurement reachPoint
        # groups (gimbal snap on the first measurement only, plus the body
        # smoothTransition heading), so this test covers both call paths.
        fp, mission, _ = _make_hr_video_pass(num_measurements=3, with_bookends=True)

        template, _ = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        placemarks = self._placemarks(template)
        groups_checked = 0
        for pm in placemarks:
            wp_index = pm.findtext("wpml:index", namespaces=self._WPML_NS)
            for group in pm.findall("wpml:actionGroup", self._WPML_NS):
                trigger = group.findtext(
                    "wpml:actionTrigger/wpml:actionTriggerType", namespaces=self._WPML_NS
                )
                if trigger != "reachPoint":
                    continue
                start = group.findtext("wpml:actionGroupStartIndex", namespaces=self._WPML_NS)
                end = group.findtext("wpml:actionGroupEndIndex", namespaces=self._WPML_NS)
                assert start == wp_index, (
                    f"actionGroupStartIndex={start} on placemark wpml:index={wp_index}"
                )
                assert end == wp_index, (
                    f"actionGroupEndIndex={end} on placemark wpml:index={wp_index}"
                )
                groups_checked += 1

        assert groups_checked > 0, "expected at least one reachPoint actionGroup"

    def test_vp_video_segment_action_group_uses_zero_indexed_bounds(self):
        """VP video betweenAdjacentPoints groups span [wp_index, wp_index + 1].

        gimbalEvenlyRotate is applied across one segment between two adjacent
        measurements, so the start index is the parent placemark's wpml:index
        and the end index is the next adjacent measurement's wpml:index. both
        bounds are 0-indexed.
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=3, with_bookends=False)

        template, _ = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        placemarks = self._placemarks(template)
        segment_groups_checked = 0
        for pm in placemarks:
            wp_index_text = pm.findtext("wpml:index", namespaces=self._WPML_NS)
            wp_index = int(wp_index_text)
            for group in pm.findall("wpml:actionGroup", self._WPML_NS):
                trigger = group.findtext(
                    "wpml:actionTrigger/wpml:actionTriggerType", namespaces=self._WPML_NS
                )
                if trigger != "betweenAdjacentPoints":
                    continue
                start = int(group.findtext("wpml:actionGroupStartIndex", namespaces=self._WPML_NS))
                end = int(group.findtext("wpml:actionGroupEndIndex", namespaces=self._WPML_NS))
                assert start == wp_index
                assert end == wp_index + 1
                segment_groups_checked += 1

        # 3 measurements => 2 segments (m1->m2, m2->m3)
        assert segment_groups_checked == 2


class TestDjiUseGlobalFlags:
    """regression coverage for DJI WPML required useGlobal* flags on Placemark.

    the spec marks `useGlobalHeight`, `useGlobalHeadingParam`, `useGlobalSpeed`,
    and `useGlobalTurnParam` as Yes (required) on every template Placemark.
    earlier exports omitted `useGlobalHeight` entirely and dropped
    `useGlobalHeadingParam` on aimed measurements when a per-WP heading block
    overrode the global. Pilot 2 was tolerant, but strict validators would
    reject the file and behavior is undefined per spec.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _template_placemarks(self, kmz_bytes):
        """parse template.kml from a kmz blob and return its Placemark elements."""
        template, _ = _read_wpmz(kmz_bytes)
        return ET.fromstring(template).findall(".//kml:Placemark", self._WPML_NS)

    def test_every_template_placemark_emits_use_global_height_zero(self):
        """useGlobalHeight is required on every Placemark and we always emit per-WP height."""
        fp = _make_flight_plan(5)

        placemarks = self._template_placemarks(_gen_kmz(fp, "Test", 0))

        assert placemarks
        for pm in placemarks:
            value = pm.findtext("wpml:useGlobalHeight", namespaces=self._WPML_NS)
            assert value == "0", (
                f"placemark wpml:index="
                f"{pm.findtext('wpml:index', namespaces=self._WPML_NS)} missing useGlobalHeight"
            )

    def test_aimed_placemark_emits_use_global_heading_param_zero(self):
        """aimed placemarks override the global heading param, so useGlobalHeadingParam=0."""
        fp, mission, _ = _make_hr_video_pass(num_measurements=3, with_bookends=True)

        placemarks = self._template_placemarks(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        # at least one aimed (MEASUREMENT/HOVER with camera target) placemark
        # must show useGlobalHeadingParam=0 since it overrides the global.
        aimed_with_override = 0
        for pm in placemarks:
            heading_param = pm.find("wpml:waypointHeadingParam", self._WPML_NS)
            if heading_param is None:
                continue
            mode = heading_param.findtext("wpml:waypointHeadingMode", namespaces=self._WPML_NS)
            if mode in ("smoothTransition", "towardPOI"):
                use_global = pm.findtext("wpml:useGlobalHeadingParam", namespaces=self._WPML_NS)
                assert use_global == "0", (
                    f"aimed placemark wpml:index="
                    f"{pm.findtext('wpml:index', namespaces=self._WPML_NS)} "
                    f"mode={mode} expected useGlobalHeadingParam=0, got {use_global!r}"
                )
                aimed_with_override += 1

        assert aimed_with_override > 0, "expected at least one aimed placemark with override"

    def test_non_aimed_placemark_emits_use_global_heading_param_one(self):
        """transit/takeoff/landing placemarks inherit the global, so useGlobalHeadingParam=1."""
        fp, mission, _ = _make_hr_video_pass(num_measurements=3, with_bookends=True)

        placemarks = self._template_placemarks(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        # at least one followWayline (transit/takeoff/landing) placemark must
        # show useGlobalHeadingParam=1 since it matches the global block.
        non_aimed_inheriting = 0
        for pm in placemarks:
            heading_param = pm.find("wpml:waypointHeadingParam", self._WPML_NS)
            if heading_param is None:
                continue
            mode = heading_param.findtext("wpml:waypointHeadingMode", namespaces=self._WPML_NS)
            if mode == "followWayline":
                use_global = pm.findtext("wpml:useGlobalHeadingParam", namespaces=self._WPML_NS)
                assert use_global == "1", (
                    f"transit placemark wpml:index="
                    f"{pm.findtext('wpml:index', namespaces=self._WPML_NS)} "
                    f"expected useGlobalHeadingParam=1, got {use_global!r}"
                )
                non_aimed_inheriting += 1

        assert non_aimed_inheriting > 0, "expected at least one transit placemark"

    def test_every_template_placemark_carries_all_required_use_global_flags(self):
        """every template Placemark emits the full required useGlobal* flag set.

        the spec marks useGlobalSpeed, useGlobalHeight, useGlobalHeadingParam,
        and useGlobalTurnParam as Yes on every Placemark. enforce the full set
        end-to-end to catch any future drop.
        """
        fp, mission, _ = _make_hr_video_pass(num_measurements=3, with_bookends=True)

        kmz = _gen_kmz(fp, "Test", 0, mission=mission)
        placemarks = self._template_placemarks(kmz)

        required = (
            "useGlobalSpeed",
            "useGlobalHeight",
            "useGlobalHeadingParam",
            "useGlobalTurnParam",
        )
        for pm in placemarks:
            idx = pm.findtext("wpml:index", namespaces=self._WPML_NS)
            for tag in required:
                value = pm.findtext(f"wpml:{tag}", namespaces=self._WPML_NS)
                assert value in ("0", "1"), (
                    f"placemark wpml:index={idx} missing or invalid {tag}: {value!r}"
                )
        _assert_dji_conformance(kmz_bytes=kmz)


class TestDjiBelowTakeoffClamp:
    """relative executeHeight clamps below-takeoff waypoints to 0.

    executeHeightMode=relativeToStartPoint heights are wp_MSL minus the ground
    takeoff MSL. a waypoint below the takeoff reference yields a negative
    value, which DJI firmware rejects; the writer clamps it to 0 and logs a
    warning rather than reverting to an absolute datum.

    Fixture mirrors the issue #508 mission shape (Luka Jaro, M4T):
    airport_elevation = 290, takeoff_coordinate.alt = 300 (above airport
    ground), one MEASUREMENT below the takeoff (alt=295), camera_target below
    takeoff (alt=280).
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _build_fixture(self):
        """build the issue #508-shape (fp, mission) pair."""
        fp = _make_flight_plan(3)
        # takeoff at airport_elevation + 10 (above ground)
        fp.waypoints[0].position = _make_wkt_point(18.110, 49.690, 300.0)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        # measurement BELOW the takeoff alt (300) but above airport ground (290)
        camera_target = _make_wkt_point(18.120, 49.691, 280.0)
        fp.waypoints[1].position = _make_wkt_point(18.115, 49.6905, 295.0)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[1].heading = 90.0
        fp.waypoints[1].camera_target = camera_target
        fp.waypoints[2].position = _make_wkt_point(18.110, 49.690, 300.0)
        fp.waypoints[2].waypoint_type = "LANDING"

        mission = _make_heading_mode_mission("towardPOI")
        mission.takeoff_coordinate = _make_wkt_point(18.110, 49.690, 300.0)
        return fp, mission

    def test_ntl_scope_execute_height_relative_to_airport_ground(self):
        """NTL anchors at airport ground (290); every fixture WP is above it."""
        fp, mission = self._build_fixture()

        kmz = _gen_kmz(fp, "Test", 290.0, mission=mission, scope="FULL")
        _, waylines = _read_wpmz(kmz)

        root = ET.fromstring(waylines)
        heights = [float(el.text) for el in root.findall(".//wpml:executeHeight", self._WPML_NS)]
        assert heights
        for h in heights:
            assert h >= 0
        # airport ground 290: takeoff/landing 300 -> 10, measurement 295 -> 5
        assert any(abs(h - 10.0) < 1e-3 for h in heights)
        assert any(abs(h - 5.0) < 1e-3 for h in heights)
        _assert_dji_conformance(kmz_bytes=kmz)

    def test_measurements_only_execute_height_relative_to_airport_ground(self):
        """MEASUREMENTS_ONLY anchors at airport ground (290), like NTL."""
        fp, mission = self._build_fixture()
        # MO requires every wp to be in-air; flip takeoff/landing to measurements
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"

        _, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 290.0, mission=mission, scope="MEASUREMENTS_ONLY"),
        )

        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in waylines
        root = ET.fromstring(waylines)
        heights = [float(el.text) for el in root.findall(".//wpml:executeHeight", self._WPML_NS)]
        for h in heights:
            assert h >= 0
        # airport ground 290: 300 -> 10, measurement 295 -> 5
        assert any(abs(h - 10.0) < 1e-3 for h in heights)
        assert any(abs(h - 5.0) < 1e-3 for h in heights)

    def test_toward_poi_alt_is_zero_regardless_of_camera_target(self):
        """waypointPoiPoint.alt is 0.000000 even when camera_target.alt is below takeoff."""
        fp, mission = self._build_fixture()

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 290.0, mission=mission, scope="FULL"),
        )

        # camera_target alt is 280 (below takeoff 300), but the writer must pin POI alt = 0
        for content in (template, waylines):
            assert (
                "<wpml:waypointPoiPoint>49.691000,18.120000,0.000000</wpml:waypointPoiPoint>"
                in content
            )
            # paranoia: the camera_target.alt value must NOT appear in a POI element
            for el in ET.fromstring(content).findall(".//wpml:waypointPoiPoint", self._WPML_NS):
                _, _, alt_str = el.text.split(",")
                assert float(alt_str) == 0.0


class TestDjiSpecConformance:
    """audit §2 schema-conformance regressions for the WPML 1.0.6 writer."""

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def test_mission_config_omits_wayline_avoid_limit_area_mode(self):
        """waylineAvoidLimitAreaMode is not in the WPML spec - never emitted (audit §2.1)."""
        fp = _make_flight_plan(3)

        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            mission = _make_heading_mode_mission(None)
            template, waylines = _read_wpmz(
                _gen_kmz(fp, "Test", 290.0, mission=mission, scope=scope),
            )
            assert "waylineAvoidLimitAreaMode" not in template, scope
            assert "waylineAvoidLimitAreaMode" not in waylines, scope

    def test_global_rth_height_emitted_in_waylines_only(self):
        """globalRTHHeight is scoped to waylines.wpml per common-element.md (audit §2.2)."""
        fp = _make_flight_plan(3)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        assert "<wpml:globalRTHHeight>" not in template
        assert "<wpml:globalRTHHeight>" in waylines

    def test_xml_header_uppercase_utf8(self):
        """both files' XML declarations use uppercase UTF-8 to match DJI samples (audit §2.5)."""
        fp = _make_flight_plan(3)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        assert "encoding='UTF-8'" in template or 'encoding="UTF-8"' in template
        assert "encoding='UTF-8'" in waylines or 'encoding="UTF-8"' in waylines
        # lowercase variant must not appear
        assert "encoding='utf-8'" not in template
        assert 'encoding="utf-8"' not in template
        assert "encoding='utf-8'" not in waylines
        assert 'encoding="utf-8"' not in waylines

    def test_no_accurate_shoot_emitted_across_modes(self):
        """accurateShoot is deprecated per spec - never emitted in any mode (audit §2.9)."""
        for mode in ("smoothTransition", "towardPOI", "followWayline"):
            mission = _make_heading_mode_mission(mode)
            fp = _make_flight_plan(3)
            wp = fp.waypoints[1]
            wp.waypoint_type = "MEASUREMENT"
            wp.heading = 172.1
            wp.gimbal_pitch = -45.0
            wp.camera_action = "PHOTO_CAPTURE"
            wp.camera_target = _make_ewkb(18.12, 49.69, 290.0)

            template, waylines = _read_wpmz(
                _gen_kmz(fp, "Test", 290.0, mission=mission),
            )
            assert "accurateShoot" not in template, mode
            assert "accurateShoot" not in waylines, mode

    def test_gimbal_evenly_rotate_paired_with_between_adjacent_points(self):
        """every gimbalEvenlyRotate sits inside a betweenAdjacentPoints actionGroup.

        WPML spec mandates the trigger pairing; if a future call site emitted the
        action under reachPoint the firmware would refuse the wayline (audit §2.8).
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=3, with_bookends=False)

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 290.0, mission=mission),
        )

        for label, content in (("template", template), ("waylines", waylines)):
            root = ET.fromstring(content)
            evenly_rotate_groups = 0
            for group in root.findall(".//wpml:actionGroup", self._WPML_NS):
                func_names = [
                    el.text for el in group.findall(".//wpml:actionActuatorFunc", self._WPML_NS)
                ]
                if "gimbalEvenlyRotate" not in func_names:
                    continue
                trigger = group.findtext(
                    "wpml:actionTrigger/wpml:actionTriggerType", namespaces=self._WPML_NS
                )
                assert trigger == "betweenAdjacentPoints", (
                    f"{label}: gimbalEvenlyRotate paired with {trigger!r}"
                )
                evenly_rotate_groups += 1
            assert evenly_rotate_groups > 0, f"{label}: expected at least one gimbalEvenlyRotate"

    def test_mission_config_element_order(self):
        """missionConfig children match the canonical sample in template-kml.md (audit §2.3).

        canonical order:
            flyToWaylineMode, finishAction, exitOnRCLost, executeRCLostAction,
            takeOffSecurityHeight, takeOffRefPoint (template only),
            takeOffRefPointAGLHeight (template only), globalTransitionalSpeed,
            globalRTHHeight (waylines only), droneInfo, payloadInfo.
        """
        fp = _make_flight_plan(3)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0))

        wpml = self._WPML_NS["wpml"]
        template_config = ET.fromstring(template).find(
            f".//{{{wpml}}}missionConfig",
        )
        waylines_config = ET.fromstring(waylines).find(
            f".//{{{wpml}}}missionConfig",
        )
        assert template_config is not None and waylines_config is not None

        template_tags = [child.tag.split("}", 1)[1] for child in template_config]
        waylines_tags = [child.tag.split("}", 1)[1] for child in waylines_config]

        expected_template = [
            "flyToWaylineMode",
            "finishAction",
            "exitOnRCLost",
            "executeRCLostAction",
            "takeOffSecurityHeight",
            "takeOffRefPoint",
            "takeOffRefPointAGLHeight",
            "globalTransitionalSpeed",
            "droneInfo",
            "payloadInfo",
        ]
        expected_waylines = [
            "flyToWaylineMode",
            "finishAction",
            "exitOnRCLost",
            "executeRCLostAction",
            "takeOffSecurityHeight",
            "globalTransitionalSpeed",
            "globalRTHHeight",
            "droneInfo",
            "payloadInfo",
        ]
        assert template_tags == expected_template
        assert waylines_tags == expected_waylines
        _assert_dji_conformance(template=template, waylines=waylines)

    @pytest.mark.parametrize(
        ("default_speed", "max_speed", "expected"),
        [
            # mission fallback wins, well below the 14 sub-ceiling
            (None, 21.0, "8"),
            # drone max wins
            (20.0, 10.0, "10"),
            # spec sub-ceiling wins; both inputs exceed it
            (18.0, 21.0, "14"),
            # mission default wins (smaller than both ceilings)
            (5.0, 21.0, "5"),
        ],
    )
    def test_global_transitional_speed_clamped_below_spec_ceiling(
        self, default_speed, max_speed, expected
    ):
        """globalTransitionalSpeed = min(default_speed or 8, max_speed, 14), never 15.

        wpml 1.0.6 caps the field inclusively at 15 but stricter pilot 2
        firmwares reject exactly 15 with WaylineCheckError -7
        TransitionalSpeedOutOfRange. dji's own samples emit 8 / 10.
        """
        from app.services.export.dji.mission_config import _resolve_global_transitional_speed

        mission = MagicMock()
        mission.default_speed = default_speed
        drone = MagicMock()
        drone.max_speed = max_speed

        assert _resolve_global_transitional_speed(mission, drone) == expected

    def test_global_transitional_speed_defensive_when_mission_or_drone_missing(self):
        """missing mission / drone falls back to 8 m/s; never emits the spec ceiling."""
        from app.services.export.dji.mission_config import _resolve_global_transitional_speed

        # no mission, no drone -> mission fallback 8 wins against sub-ceiling 14
        assert _resolve_global_transitional_speed(None, None) == "8"

    def test_global_transitional_speed_in_emitted_xml(self):
        """emitted XML carries the clamped value, never the spec-ceiling 15."""
        fp = _make_flight_plan(3)
        mission = _make_heading_mode_mission(None)
        mission.default_speed = 6.0
        # _M4T_PROFILE.max_speed is 21.0; min(6, 21, 14) = 6
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission))

        for content in (template, waylines):
            assert "<wpml:globalTransitionalSpeed>6</wpml:globalTransitionalSpeed>" in content
            assert "<wpml:globalTransitionalSpeed>15</wpml:globalTransitionalSpeed>" not in content

    def test_no_emitted_xml_carries_spec_ceiling_global_transitional_speed(self):
        """across every scope + every heading mode, emitted XML never carries 15.

        guards AC #3 - no `<wpml:globalTransitionalSpeed>15</wpml:globalTransitionalSpeed>`
        reaches the WPMZ archive on any combination of scope / heading mode the
        export panel can produce.
        """
        fp = _make_flight_plan(3)
        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            for mode in (None, "smoothTransition", "towardPOI", "followWayline"):
                mission = _make_heading_mode_mission(mode)
                template, waylines = _read_wpmz(
                    _gen_kmz(fp, "Test", 290.0, mission=mission, scope=scope),
                )
                msg = f"scope={scope}, mode={mode}"
                assert (
                    "<wpml:globalTransitionalSpeed>15</wpml:globalTransitionalSpeed>"
                    not in template
                ), msg
                assert (
                    "<wpml:globalTransitionalSpeed>15</wpml:globalTransitionalSpeed>"
                    not in waylines
                ), msg


def _stitch_two_vp_video_inspections():
    """combine two VP video passes into one flight plan + two-inspection mission.

    fp2's sequence_order is offset past fp1 so the merged stream stays a
    strictly ascending 1-indexed list (matches production enumerate(start=1)).
    each pass keeps its own inspection_id, so the export emits reachPoint
    bookend groups + per-measurement betweenAdjacentPoints groups for both.
    """
    fp1, m1, _ = _make_vp_video_pass(num_measurements=4, with_bookends=True)
    fp2, m2, _ = _make_vp_video_pass(num_measurements=5, with_bookends=True)

    offset = len(fp1.waypoints)
    for wp in fp2.waypoints:
        wp.sequence_order += offset

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 300.0
    fp.estimated_duration = 120.0
    fp.generated_at = None
    fp.waypoints = fp1.waypoints + fp2.waypoints

    mission = _make_mission_mock(
        inspections=m1.inspections + m2.inspections,
        default_capture_mode="VIDEO_CAPTURE",
    )
    return fp, mission


def _make_tight_vp_video_pass(num_measurements=5, *, step_m=0.3):
    """VP video pass whose adjacent measurement legs are a uniform `step_m`.

    measurements share lon/lat and climb by `step_m` so every inter-measurement
    3D leg equals `step_m`. recording actions ride on the first/last
    MEASUREMENT (planner's merged-bookend shape) so the nearest-leg minimum
    is exactly `step_m`.
    """
    insp_id = uuid4()
    insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", "VIDEO_CAPTURE")
    target = _make_wkt_point(18.12, 49.69, 290.0)
    lon, lat = 18.11, 49.69
    base_alt = 295.0

    waypoints = [_make_waypoint(seq=1, lon=lon, lat=lat, alt=290.0, wp_type="TAKEOFF")]
    seq = 2

    for i in range(num_measurements):
        wp = _make_waypoint(
            seq=seq, lon=lon, lat=lat, alt=base_alt + i * step_m, wp_type="MEASUREMENT"
        )
        wp.gimbal_pitch = -1.0 - i
        wp.camera_target = target
        wp.camera_action = "RECORDING"
        wp.inspection_id = insp_id
        waypoints.append(wp)
        seq += 1

    first_m = waypoints[1]
    last_m = waypoints[-1]
    first_m.camera_action = "RECORDING_START"
    first_m.hover_duration = 3
    last_m.camera_action = "RECORDING_STOP"
    last_m.hover_duration = 3

    waypoints.append(_make_waypoint(seq=seq, lon=lon, lat=lat, alt=290.0, wp_type="LANDING"))

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 50.0
    fp.estimated_duration = 30.0
    fp.generated_at = None
    fp.waypoints = waypoints

    mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")
    return fp, mission


def _make_tight_hr_video_pass(num_measurements=5, *, step_m=0.3):
    """HR video arc whose adjacent measurement chords are a uniform `step_m`.

    HR analogue of `_make_tight_vp_video_pass`: a constant-altitude arc around
    a fixed LHA, heading per-WP pointed at the LHA, gimbal pitch drifting
    gently. the bearing increment is sized so each inter-measurement chord
    equals `step_m` (chord = 2 r sin(dθ/2)), so every leg is purely horizontal
    and the nearest-leg minimum is `step_m`. recording actions ride on the
    first/last MEASUREMENT (planner's merged-bookend shape).
    """
    insp_id = uuid4()
    insp = _make_inspection_mock(insp_id, "HORIZONTAL_RANGE", "VIDEO_CAPTURE")

    target_lon, target_lat, target_alt = 18.12, 49.69, 290.0
    target = _make_wkt_point(target_lon, target_lat, target_alt)
    arc_alt = 350.0
    arc_radius_m = 200.0
    bearing_step_deg = math.degrees(2.0 * math.asin(step_m / (2.0 * arc_radius_m)))

    arc_lonlats = []
    pitches = []
    for i in range(num_measurements):
        bearing_deg = 90.0 + i * bearing_step_deg
        arc_lon, arc_lat = point_at_distance(target_lon, target_lat, bearing_deg, arc_radius_m)
        arc_lonlats.append((arc_lon, arc_lat))
        pitches.append(round(-3.0 + 0.01 * i, 4))

    waypoints = [_make_waypoint(seq=1, lon=18.11, lat=49.69, alt=arc_alt, wp_type="TAKEOFF")]
    seq = 2

    for i in range(num_measurements):
        lon_i, lat_i = arc_lonlats[i]
        wp = _make_waypoint(seq=seq, lon=lon_i, lat=lat_i, alt=arc_alt, wp_type="MEASUREMENT")
        wp.heading = bearing_between(lon_i, lat_i, target_lon, target_lat)
        wp.gimbal_pitch = pitches[i]
        wp.camera_target = target
        wp.camera_action = "RECORDING"
        wp.inspection_id = insp_id
        waypoints.append(wp)
        seq += 1

    first_m = waypoints[1]
    last_m = waypoints[-1]
    first_m.camera_action = "RECORDING_START"
    first_m.hover_duration = 3
    last_m.camera_action = "RECORDING_STOP"
    last_m.hover_duration = 3

    waypoints.append(_make_waypoint(seq=seq, lon=18.11, lat=49.69, alt=arc_alt, wp_type="LANDING"))

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 50.0
    fp.estimated_duration = 30.0
    fp.generated_at = None
    fp.waypoints = waypoints

    mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")
    return fp, mission


class TestDjiActionGroupIdRange:
    """issue #637 - actionGroupId must stay within the WPML range [0, 65535].

    the VP-video segment group id was `100000 + sequence_order`, already past
    the documented 65535 ceiling before any offset. reach-point groups now
    take the odd lane (2*index - 1) and segment groups the even lane
    (2*sequence_order) so the two streams stay unique and well inside range.
    `actionGroupId` is an opaque key (DJI Pilot 2 / fh2 reads it as an id, not
    a position reference), so the renumber is behaviour-preserving.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _action_group_ids(self, xml: str) -> list[int]:
        """every actionGroupId emitted in one WPML document, in order."""
        root = ET.fromstring(xml)
        return [
            int(el.text)
            for el in root.findall(".//wpml:actionGroup/wpml:actionGroupId", self._WPML_NS)
        ]

    def _segment_group_count(self, xml: str) -> int:
        """count betweenAdjacentPoints actionGroups (the renumbered even lane)."""
        root = ET.fromstring(xml)
        count = 0
        for group in root.findall(".//wpml:actionGroup", self._WPML_NS):
            trigger = group.findtext(
                "wpml:actionTrigger/wpml:actionTriggerType", namespaces=self._WPML_NS
            )
            if trigger == "betweenAdjacentPoints":
                count += 1
        return count

    def test_vp_video_action_group_ids_in_range_and_unique(self):
        """VP video emits reachPoint + betweenAdjacentPoints groups, all in range."""
        fp, mission, _ = _make_vp_video_pass(num_measurements=4, with_bookends=True)

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        for label, content in (("template", template), ("waylines", waylines)):
            ids = self._action_group_ids(content)
            assert ids, f"{label}: expected at least one actionGroup"
            assert self._segment_group_count(content) > 0, (
                f"{label}: expected at least one betweenAdjacentPoints group"
            )
            for gid in ids:
                assert 0 <= gid <= 65535, f"{label}: actionGroupId {gid} out of [0, 65535]"
            assert len(ids) == len(set(ids)), f"{label}: duplicate actionGroupId in {ids}"
        _assert_dji_conformance(template=template, waylines=waylines)

    def test_multi_inspection_action_group_ids_unique_and_in_range(self):
        """ids stay unique + in range across two inspections' group streams."""
        fp, mission = _stitch_two_vp_video_inspections()

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        for label, content in (("template", template), ("waylines", waylines)):
            ids = self._action_group_ids(content)
            assert ids, f"{label}: expected at least one actionGroup"
            for gid in ids:
                assert 0 <= gid <= 65535, f"{label}: actionGroupId {gid} out of [0, 65535]"
            assert len(ids) == len(set(ids)), f"{label}: duplicate actionGroupId in {ids}"

    def test_high_waypoint_count_stays_in_range(self):
        """a long pass keeps every id far below the 65535 ceiling.

        with 200 measurements the largest id is ~2*204, so the interleaved
        scheme has multi-order-of-magnitude headroom past the perf ceiling.
        """
        fp, mission, _ = _make_vp_video_pass(num_measurements=200, with_bookends=True)

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        for content in (template, waylines):
            ids = self._action_group_ids(content)
            assert ids
            assert max(ids) <= 65535
            assert len(ids) == len(set(ids))


class TestDjiTurnDampingClamp:
    """issue #637 - waypointTurnDampingDist clamped under the local leg length.

    spec range is `(0, max wayline-segment length]`; the constant 0.2 was safe
    only by an unenforced spacing assumption. continuity-curvature (video)
    placemarks now emit `min(0.2, 0.5 * nearest_leg)`; the default-stop path
    keeps the literal 0.2.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _placemark_turn_params(self, xml: str) -> list[tuple[str, float]]:
        """(turnMode, dampingDist) for every placemark carrying a turn param."""
        root = ET.fromstring(xml)
        out: list[tuple[str, float]] = []
        for pm in root.findall(".//kml:Placemark", self._WPML_NS):
            tp = pm.find("wpml:waypointTurnParam", self._WPML_NS)
            if tp is None:
                continue
            mode = tp.findtext("wpml:waypointTurnMode", namespaces=self._WPML_NS)
            dist = float(tp.findtext("wpml:waypointTurnDampingDist", namespaces=self._WPML_NS))
            out.append((mode, dist))
        return out

    def test_tight_video_pass_damping_below_min_measurement_leg(self):
        """every emitted damping is strictly < the minimum inter-measurement leg.

        the fixture spaces measurements 0.3 m apart, so the unclamped 0.2
        constant would already be < 0.3 - but the clamp must additionally
        bring every continuity-curvature placemark below 0.2, proving it
        actually engaged rather than passing trivially.
        """
        fp, mission = _make_tight_vp_video_pass(num_measurements=5, step_m=0.3)

        def _leg(a, b) -> float:
            """3D leg between two waypoints (horizontal haversine + alt delta)."""
            lon1, lat1, alt1 = point_lonlatalt(a.position)
            lon2, lat2, alt2 = point_lonlatalt(b.position)
            return math.hypot(distance_between(lon1, lat1, lon2, lat2), alt2 - alt1)

        measurements = [wp for wp in fp.waypoints if wp.waypoint_type == "MEASUREMENT"]
        min_leg = min(_leg(a, b) for a, b in zip(measurements, measurements[1:]))

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        for label, content in (("template", template), ("waylines", waylines)):
            params = self._placemark_turn_params(content)
            assert params, f"{label}: expected turn params"
            passthrough = [d for m, d in params if m == "toPointAndPassWithContinuityCurvature"]
            assert passthrough, f"{label}: expected continuity-curvature placemarks"
            for mode, dist in params:
                assert dist < min_leg, (
                    f"{label}: damping {dist} not < min leg {min_leg} (mode {mode})"
                )
            for dist in passthrough:
                assert dist < 0.2, f"{label}: clamp did not engage (damping {dist})"

    def test_tight_hr_video_pass_damping_below_min_measurement_leg(self):
        """HR arc damping is strictly < the minimum inter-measurement leg.

        HR video MEASUREMENTs also switch to
        toPointAndPassWithContinuityCurvature (the smooth-turn arc), so they
        hit the same clamp branch as VP. the tight arc spaces measurements
        0.3 m apart; the clamp must bring every continuity-curvature placemark
        below 0.2, proving it engaged rather than passing on the bare 0.2
        constant.
        """
        fp, mission = _make_tight_hr_video_pass(num_measurements=5, step_m=0.3)

        def _leg(a, b) -> float:
            """3D leg between two waypoints (horizontal haversine + alt delta)."""
            lon1, lat1, alt1 = point_lonlatalt(a.position)
            lon2, lat2, alt2 = point_lonlatalt(b.position)
            return math.hypot(distance_between(lon1, lat1, lon2, lat2), alt2 - alt1)

        measurements = [wp for wp in fp.waypoints if wp.waypoint_type == "MEASUREMENT"]
        min_leg = min(_leg(a, b) for a, b in zip(measurements, measurements[1:]))

        template, waylines = _read_wpmz(
            _gen_kmz(fp, "Test", 0, mission=mission),
        )

        for label, content in (("template", template), ("waylines", waylines)):
            params = self._placemark_turn_params(content)
            assert params, f"{label}: expected turn params"
            passthrough = [d for m, d in params if m == "toPointAndPassWithContinuityCurvature"]
            assert passthrough, f"{label}: expected continuity-curvature placemarks"
            for mode, dist in params:
                assert dist < min_leg, (
                    f"{label}: damping {dist} not < min leg {min_leg} (mode {mode})"
                )
            for dist in passthrough:
                assert dist < 0.2, f"{label}: clamp did not engage (damping {dist})"

    def test_default_stop_path_keeps_literal_damping(self):
        """non-video placemarks keep the exact 0.2 stop-path literal."""
        fp = _make_flight_plan(3)

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0))

        for content in (template, waylines):
            params = self._placemark_turn_params(content)
            assert params
            for mode, dist in params:
                assert mode == "toPointAndStopWithDiscontinuityCurvature"
                assert dist == 0.2
            assert "<wpml:waypointTurnDampingDist>0.2</wpml:waypointTurnDampingDist>" in content
        _assert_dji_conformance(template=template, waylines=waylines)

    def test_passthrough_damping_uses_2m_ceiling_when_leg_large(self):
        """passthrough placemarks with adjacent legs > 4 m emit ~2 m damping.

        the previous hardcoded 0.2 m ceiling collapsed the smooth-turn arc into
        a corner on a 4 m VP step and forced brake-thread-accelerate at every
        measurement. raising the ceiling to 2 m gives the drone a real curve
        while still leaving headroom under the 0.5x-nearest-leg clamp.
        """
        fp, mission = _make_tight_vp_video_pass(num_measurements=5, step_m=10.0)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        params = self._placemark_turn_params(waylines)
        passthrough = [d for m, d in params if m == "toPointAndPassWithContinuityCurvature"]
        assert passthrough, "expected at least one continuity-curvature placemark"
        # every passthrough damping equals the 2 m ceiling - 0.5 * 10 = 5 ≥ 2
        for dist in passthrough:
            assert dist == pytest.approx(2.0, abs=1e-3), f"expected 2 m ceiling, got {dist}"

    def test_passthrough_damping_clamps_to_half_nearest_leg_when_short(self):
        """short adjacent legs clamp damping below the 2 m ceiling.

        a 1.5 m step yields damping ≈ 0.75 m (0.5 * leg), well under both the
        ceiling and the WPML segment-length bound `(0, segment length]`.
        """
        fp, mission = _make_tight_vp_video_pass(num_measurements=5, step_m=1.5)

        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 0, mission=mission))

        params = self._placemark_turn_params(waylines)
        passthrough = [d for m, d in params if m == "toPointAndPassWithContinuityCurvature"]
        assert passthrough
        for dist in passthrough:
            assert dist == pytest.approx(0.75, abs=1e-3), f"expected 0.5 * 1.5 = 0.75, got {dist}"

    def test_zero_leg_falls_to_stop_mode(self):
        """a passthrough WP whose nearest leg is 0 falls to stop-mode damping.

        WPML scopes waypointTurnDampingDist to `(0, segment length]` and the
        continuity-curvature turn mode is undefined on a 0 m leg. before the
        bookend merge a recording HOVER bookend collocated with the first
        measurement made this branch reachable; the merge makes it
        structurally impossible, but the writer must still emit a valid file
        if a future reroute drops two measurements on top of each other.
        """
        insp_id = uuid4()
        insp = _make_inspection_mock(insp_id, "VERTICAL_PROFILE", "VIDEO_CAPTURE")

        lon, lat = 18.11, 49.69
        target = _make_wkt_point(18.12, 49.69, 290.0)

        # three measurements at exactly the same (lon, lat, alt). the middle
        # one (m2) has both adjacent legs at 0, so `_nearest_leg_lengths` omits
        # it from the dict and the placemark falls back to stop-mode.
        waypoints = [_make_waypoint(seq=1, lon=lon, lat=lat, alt=290.0, wp_type="TAKEOFF")]
        for seq in (2, 3, 4):
            wp = _make_waypoint(seq=seq, lon=lon, lat=lat, alt=295.0, wp_type="MEASUREMENT")
            wp.gimbal_pitch = -2.0
            wp.camera_target = target
            wp.camera_action = "RECORDING"
            wp.inspection_id = insp_id
            waypoints.append(wp)
        waypoints.append(_make_waypoint(seq=5, lon=lon, lat=lat, alt=290.0, wp_type="LANDING"))

        fp = MagicMock()
        fp.mission_id = uuid4()
        fp.airport_id = uuid4()
        fp.total_distance = 30.0
        fp.estimated_duration = 20.0
        fp.generated_at = None
        fp.waypoints = waypoints

        mission = _make_mission_mock(inspections=[insp], default_capture_mode="VIDEO_CAPTURE")

        _, waylines = _read_wpmz(_gen_kmz(fp, "", 0, mission=mission))

        ns = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.6"}
        root = ET.fromstring(waylines)
        placemarks = list(root.iter("{http://www.opengis.net/kml/2.2}Placemark"))
        # m2 is the middle MEASUREMENT (wpml:index=2 / sequence_order=3) -
        # both its adjacent legs are 0 so it must fall to stop-mode damping.
        m2 = placemarks[2]
        turn_mode = m2.find(".//wpml:waypointTurnMode", ns).text
        damping = float(m2.find(".//wpml:waypointTurnDampingDist", ns).text)
        assert turn_mode == "toPointAndStopWithDiscontinuityCurvature"
        assert damping == 0.2


class TestDjiRelativeHeightExport:
    """issue #722 - relativeToStartPoint altitude regression net.

    Pins the invariants of the switch from absolute WGS84/HAE altitude (which
    encoded the template fields ~45 m underground and flew the drone into the
    ground) back to takeoff-relative heights:
      - executeHeightMode is `relativeToStartPoint` on every scope.
      - executeHeight is wp_MSL - takeoff_ground_MSL, never absolute HAE.
      - template `height` matches waylines executeHeight; template
        `ellipsoidHeight` carries the true WGS84 HAE - no field is silently
        ~45 m wrong.
      - globalRTHHeight clears the route in that same relative frame.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def test_execute_height_mode_is_relative_on_every_scope(self):
        """waylines.wpml declares executeHeightMode=relativeToStartPoint everywhere.

        regression net against re-introducing the absolute WGS84/HAE scheme
        whose internally inconsistent height fields flew the drone underground.
        """
        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            fp = _make_flight_plan(3)
            for wp in fp.waypoints:
                wp.waypoint_type = "MEASUREMENT"
            mission = MagicMock()
            mission.takeoff_coordinate = None
            mission.default_speed = 10.0
            mission.inspections = []

            _, waylines = _read_wpmz(_gen_kmz(fp, "", 290.0, mission=mission, scope=scope))

            root = ET.fromstring(waylines)
            modes = [el.text for el in root.findall(".//wpml:executeHeightMode", self._WPML_NS)]
            assert modes == ["relativeToStartPoint"], f"scope={scope} got {modes}"

    def test_template_and_waylines_heights_are_mutually_consistent(self):
        """template `height` == waylines `executeHeight`; `ellipsoidHeight` is HAE.

        the bug was the template emitting ellipsoidHeight/height as raw MSL
        (~45 m below the true ellipsoid height) while waylines.wpml carried
        HAE - whichever field Pilot 2's regeneration consumed could be wrong.
        now `height` and `executeHeight` are the same takeoff-relative value
        and `ellipsoidHeight` is the true WGS84 ellipsoid height (msl_to_hae),
        so every field is correct for what it means.
        """
        from app.utils.geo import msl_to_hae

        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"
        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 10.0
        mission.inspections = []

        template, waylines = _read_wpmz(
            export_service.generate_kmz(fp, "", 290.0, mission=mission, scope="MEASUREMENTS_ONLY")
        )

        # MO anchors at airport ground (290); waypoints 300/310/320 -> 10/20/30
        t_root = ET.fromstring(template)
        w_root = ET.fromstring(waylines)
        template_heights = sorted(
            float(el.text) for el in t_root.findall(".//wpml:height", self._WPML_NS)
        )
        execute_heights = sorted(
            float(el.text) for el in w_root.findall(".//wpml:executeHeight", self._WPML_NS)
        )
        # template `height` (relativeToStartPoint frame) == waylines executeHeight
        assert template_heights == execute_heights == [10.0, 20.0, 30.0]
        # ellipsoidHeight carries each waypoint's true WGS84 ellipsoid height,
        # not the relative value - correct for what the WPML element means.
        for i in range(3):
            hae = msl_to_hae(49.69 + i * 0.001, 18.11 + i * 0.001, 300.0 + i * 10)
            assert f"<wpml:ellipsoidHeight>{hae:.6f}</wpml:ellipsoidHeight>" in template
        # template heightMode matches the waylines executeHeightMode
        assert "<wpml:heightMode>relativeToStartPoint</wpml:heightMode>" in template
        _assert_dji_conformance(template=template, waylines=waylines)

    def test_egm96_undulation_helper_in_jaro_band(self):
        """coarse EGM96 model returns a sane undulation near LZIB / Jaro Luka.

        msl_to_hae feeds the template ellipsoidHeight, so the undulation helper
        is load-bearing for the export and keeps direct coverage.
        """
        from app.utils.geo import egm96_undulation

        # published EGM96 undulation near 48.17 N, 17.21 E is ~+44.5 m; the
        # coarse closed-form model lands within a few metres of that.
        n = egm96_undulation(48.17, 17.21)
        assert 39.0 < n < 50.0, f"undulation {n} m outside the expected band"

    def test_msl_to_hae_is_msl_plus_undulation(self):
        """msl_to_hae(lat, lon, msl) == msl + egm96_undulation(lat, lon)."""
        from app.utils.geo import egm96_undulation, msl_to_hae

        lat, lon, msl = 49.690, 18.110, 300.0
        assert msl_to_hae(lat, lon, msl) == msl + egm96_undulation(lat, lon)
        assert msl_to_hae(lat, lon, 0.0) == egm96_undulation(lat, lon)

    def test_global_rth_height_clears_route_in_takeoff_relative_frame(self):
        """globalRTHHeight must clear the highest waypoint relative to takeoff.

        regression net for the DJI rejection "RTH altitude lower than the
        highest point of flight route". globalRTHHeight is takeoff-relative per
        the WPML spec (sibling of takeOffSecurityHeight); it must clear
        max(wp.alt) - takeoff_msl by a margin, with a [100, 1500] clamp.
        """
        RTH_MARGIN = 20

        for scope in ("FULL", "MEASUREMENTS_ONLY"):
            fp = _make_flight_plan(3)
            for wp in fp.waypoints:
                wp.waypoint_type = "MEASUREMENT"
            # a measurement 250 m above the takeoff anchor - the exact shape
            # the hardcoded-100 path could never clear.
            fp.waypoints[1].position = _make_ewkb(18.111, 49.691, 450.0)

            mission = MagicMock()
            mission.takeoff_coordinate = _make_ewkb(18.110, 49.690, 200.0)
            mission.default_speed = 10.0
            mission.inspections = []

            _, waylines = _read_wpmz(_gen_kmz(fp, "", 290.0, mission=mission, scope=scope))

            root = ET.fromstring(waylines)
            rth = [int(el.text) for el in root.findall(".//wpml:globalRTHHeight", self._WPML_NS)]
            assert len(rth) == 1, f"scope={scope}: expected one globalRTHHeight"
            rth_h = rth[0]

            # every remaining scope anchors at airport ground (airborne start)
            takeoff_msl = 290.0
            max_msl = max(300.0, 450.0, 320.0)
            ceiling_rel = max_msl - takeoff_msl

            assert rth_h >= ceiling_rel + RTH_MARGIN, (
                f"scope={scope}: RTH {rth_h} does not clear route ceiling "
                f"{ceiling_rel} + {RTH_MARGIN}"
            )
            assert 100 <= rth_h <= 1500, f"scope={scope}: RTH {rth_h} out of clamp"

    def test_low_altitude_papi_rth_is_route_derived_below_floor(self):
        """#231 fix 1 - a low papi mission returns route-derived RTH, not 100.

        the old hardcoded 100 m floor made the m4t reject the wayline (error
        513) when Max Flight Altitude was at/below ~100 m. with the floor at the
        wpml spec minimum (2), the route-derived value (highest wp + 20 m
        margin) wins for any real route.
        """
        RTH_MARGIN = 20

        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.waypoint_type = "MEASUREMENT"
        # peak ~43 m above the 290 m airport ground, well under the old floor
        fp.waypoints[1].position = _make_ewkb(18.111, 49.691, 333.0)

        mission = MagicMock()
        mission.takeoff_coordinate = None
        mission.default_speed = 10.0
        mission.inspections = []

        _, waylines = _read_wpmz(
            _gen_kmz(fp, "", 290.0, mission=mission, scope="MEASUREMENTS_ONLY")
        )

        root = ET.fromstring(waylines)
        rth = [int(el.text) for el in root.findall(".//wpml:globalRTHHeight", self._WPML_NS)]
        assert len(rth) == 1
        rth_h = rth[0]

        max_rel = 333.0 - 290.0
        assert rth_h == math.ceil(max_rel + RTH_MARGIN) == 63
        assert rth_h < 100, "the regression: RTH used to be floored at 100"
        assert rth_h >= max_rel + RTH_MARGIN
        assert rth_h <= 1500


class TestDjiWaypointSpeedClamp:
    """issue #745 - wpml waypointSpeed must be strictly positive.

    wpml range is (0, max]; strict firmware (Pilot 2 WaylineCheckError -6)
    refuses the literal 0 the writer emitted on bookend hover / takeoff /
    landing waypoints when wp.speed was null. fallback chain at write time:
    wp.speed > mission.default_speed > _MIN_WAYPOINT_SPEED.
    """

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _waypoint_speeds(self, xml: str) -> list[float]:
        """every wpml:waypointSpeed value emitted in one WPML document, in order."""
        root = ET.fromstring(xml)
        return [
            float(el.text)
            for el in root.findall(".//kml:Placemark/wpml:waypointSpeed", self._WPML_NS)
        ]

    def test_waypoint_speed_never_zero_on_bookends(self):
        """null waypoint speed + missing mission default still emit a positive value."""
        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.speed = None
        mission = _make_heading_mode_mission(None)
        mission.default_speed = None

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission))

        for label, content in (("template", template), ("waylines", waylines)):
            assert "<wpml:waypointSpeed>0</wpml:waypointSpeed>" not in content, label
            speeds = self._waypoint_speeds(content)
            assert speeds, f"{label}: expected at least one waypointSpeed element"
            for speed in speeds:
                assert speed > 0, f"{label}: emitted non-positive speed {speed}"

    def test_waypoint_speed_falls_back_to_default_speed(self):
        """mission.default_speed wins when wp.speed is missing."""
        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.speed = None
        mission = _make_heading_mode_mission(None)
        mission.default_speed = 7.5

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission))

        for label, content in (("template", template), ("waylines", waylines)):
            speeds = self._waypoint_speeds(content)
            assert speeds, f"{label}: expected at least one waypointSpeed element"
            for speed in speeds:
                assert speed == 7.5, f"{label}: expected 7.5, got {speed}"

    def test_waypoint_speed_prefers_waypoint_value(self):
        """wp.speed wins over mission.default_speed when both are positive."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].speed = 4.0
        mission = _make_heading_mode_mission(None)
        mission.default_speed = 7.5

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission))

        for label, content in (("template", template), ("waylines", waylines)):
            speeds = self._waypoint_speeds(content)
            assert len(speeds) >= 2, f"{label}: expected >=2 placemarks"
            assert speeds[1] == 4.0, f"{label}: expected wp.speed=4 on placemark 1, got {speeds[1]}"
        _assert_dji_conformance(template=template, waylines=waylines)

    def test_waypoint_speed_floor_when_mission_default_missing(self):
        """floor _MIN_WAYPOINT_SPEED kicks in when wp.speed and mission default are unset."""
        from app.services.export.dji.placemark import _MIN_WAYPOINT_SPEED

        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.speed = None

        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=None))

        for label, content in (("template", template), ("waylines", waylines)):
            assert "<wpml:waypointSpeed>0</wpml:waypointSpeed>" not in content, label
            speeds = self._waypoint_speeds(content)
            assert speeds, f"{label}: expected at least one waypointSpeed element"
            for speed in speeds:
                assert speed == _MIN_WAYPOINT_SPEED, (
                    f"{label}: expected floor {_MIN_WAYPOINT_SPEED}, got {speed}"
                )


class TestGenerateJson:
    """tests for json export generation."""

    def test_valid_json_structure(self):
        """json output has correct top-level keys and waypoint structure."""
        fp = _make_flight_plan(3)

        result = export_service.generate_json(fp, "Test Mission", 290.0)
        data = json.loads(result)

        assert data["mission_name"] == "Test Mission"
        assert "mission_id" in data
        assert "waypoints" in data
        assert "total_distance" in data
        assert "estimated_duration" in data
        assert data["airport_elevation"] == 290.0
        assert len(data["waypoints"]) == 3

    def test_waypoint_fields(self):
        """each waypoint has all required fields."""
        fp = _make_flight_plan(2)

        result = export_service.generate_json(fp, "", 0)
        data = json.loads(result)
        wp = data["waypoints"][0]

        assert "sequence_order" in wp
        assert "latitude" in wp
        assert "longitude" in wp
        assert "altitude_msl" in wp
        assert "altitude_agl" in wp
        assert "speed" in wp
        assert "heading" in wp

    def test_agl_altitude_correct(self):
        """agl altitude is msl minus airport elevation."""
        fp = _make_flight_plan(1)

        result = export_service.generate_json(fp, "", 290.0)
        data = json.loads(result)
        wp = data["waypoints"][0]

        assert wp["altitude_msl"] == 300.0
        assert wp["altitude_agl"] == 10.0

    def test_camera_target_when_set(self):
        """waypoint with a camera_target geometry serializes it into the json."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].camera_target = _make_ewkb(17.5, 48.5, 250.0)

        result = export_service.generate_json(fp, "", 100.0)
        data = json.loads(result)

        ct = data["waypoints"][0]["camera_target"]
        assert ct is not None
        assert abs(ct["latitude"] - 48.5) < 1e-6
        assert abs(ct["longitude"] - 17.5) < 1e-6
        assert ct["altitude_msl"] == 250.0
        assert ct["altitude_agl"] == 150.0

    def test_camera_settings_from_mission_inspections(self):
        """json output includes per-inspection camera settings when mission is provided."""
        fp = _make_flight_plan(2)

        config = MagicMock()
        config.resolve_with_defaults.return_value = {
            "white_balance": "TUNGSTEN",
            "iso": 800,
            "shutter_speed": "1/30",
            "focus_mode": "INFINITY",
            "optical_zoom": 2.0,
        }

        template_cfg = MagicMock()
        template = MagicMock()
        template.default_config = template_cfg

        insp = MagicMock()
        insp.id = uuid4()
        insp.method = "HORIZONTAL_RANGE"
        insp.sequence_order = 1
        insp.config = config
        insp.template = template

        mission = MagicMock()
        mission.inspections = [insp]

        result = export_service.generate_json(fp, "Night PAPI", 290.0, mission=mission)
        data = json.loads(result)

        assert "inspections" in data
        assert len(data["inspections"]) == 1
        cam = data["inspections"][0]["camera_settings"]
        assert cam["white_balance"] == "TUNGSTEN"
        assert cam["iso"] == 800
        assert cam["shutter_speed"] == "1/30"
        assert cam["focus_mode"] == "INFINITY"
        assert cam["optical_zoom"] == 2.0
        config.resolve_with_defaults.assert_called_once_with(template_cfg)

    def test_camera_settings_omitted_when_all_none(self):
        """inspection with no camera settings is excluded from the output."""
        fp = _make_flight_plan(1)

        config = MagicMock()
        config.resolve_with_defaults.return_value = {
            "white_balance": None,
            "iso": None,
            "shutter_speed": None,
            "focus_mode": None,
            "optical_zoom": None,
        }

        insp = MagicMock()
        insp.id = uuid4()
        insp.method = "VERTICAL_PROFILE"
        insp.sequence_order = 1
        insp.config = config
        insp.template = None

        mission = MagicMock()
        mission.inspections = [insp]

        result = export_service.generate_json(fp, "", 0, mission=mission)
        data = json.loads(result)

        assert "inspections" not in data


class TestGenerateMavlink:
    """tests for mavlink wpl 110 export generation."""

    def test_header_line(self):
        """output starts with qgc wpl 110 header."""
        fp = _make_flight_plan(3)

        result = export_service.generate_mavlink(fp)
        lines = result.decode("utf-8").split("\n")

        assert lines[0] == "QGC WPL 110"

    def test_waypoint_count(self):
        """correct number of waypoint lines generated."""
        fp = _make_flight_plan(3)

        result = export_service.generate_mavlink(fp)
        lines = result.decode("utf-8").split("\n")

        assert len(lines) == 4

    def test_first_waypoint_current(self):
        """first waypoint has current=1, others current=0."""
        fp = _make_flight_plan(3)

        result = export_service.generate_mavlink(fp)
        lines = result.decode("utf-8").split("\n")

        fields_0 = lines[1].split("\t")
        fields_1 = lines[2].split("\t")

        assert fields_0[1] == "1"
        assert fields_1[1] == "0"

    def test_takeoff_command(self):
        """takeoff waypoint uses nav_takeoff command (22)."""
        fp = _make_flight_plan(3)

        result = export_service.generate_mavlink(fp)
        lines = result.decode("utf-8").split("\n")

        fields = lines[1].split("\t")
        assert fields[3] == "22"

    def test_mavlink_uses_agl_altitude(self):
        """mavlink altitude is relative to ground."""
        fp = _make_flight_plan(1)

        result = export_service.generate_mavlink(fp, "", 290.0)
        lines = result.decode("utf-8").split("\n")

        fields = lines[1].split("\t")
        assert float(fields[10]) == 10.0


class TestSanitizeFilename:
    """tests for filename sanitization (fh2 + http safe)."""

    def test_strips_path_separators(self):
        """path separators are replaced so traversal is impossible."""
        # ../../evil -> "    evil" -> "evil" after collapse+trim
        assert export_service._sanitize_filename("../../evil") == "evil"

    def test_strips_backslashes(self):
        """backslashes are stripped."""
        assert export_service._sanitize_filename("..\\..\\evil") == "evil"

    def test_strips_quotes_and_newlines(self):
        """quotes are stripped and control chars (incl. \\r\\n) removed."""
        # " becomes space, \r\n are control chars (removed entirely) -> "my mission"
        assert export_service._sanitize_filename('my"mission\r\n') == "my mission"

    def test_normal_name_unchanged(self):
        """normal mission names pass through unchanged."""
        assert export_service._sanitize_filename("Test Mission 1") == "Test Mission 1"

    def test_strips_null_bytes(self):
        """null bytes and control characters are removed."""
        assert export_service._sanitize_filename("mis\x00sion\x01test\x7f") == "missiontest"

    def test_strips_dotdot_slash_variant(self):
        """combined dotdot and slash variants are stripped."""
        assert export_service._sanitize_filename("....//evil") == "evil"

    def test_strips_fh2_banned_chars(self):
        """all fh2-banned chars (< > : \" / | ? * . _) get replaced with spaces."""
        result = export_service._sanitize_filename('my<file>:"name|with?*.chars_here')
        for ch in '<>:"/|?*._':
            assert ch not in result
        assert result == "my file name with chars here"

    def test_underscore_replaced(self):
        """underscores - fh2-banned - are stripped even when the rest is fine."""
        assert export_service._sanitize_filename("Test_2") == "Test 2"

    def test_dot_replaced(self):
        """dots are stripped from the base name (extension is added later)."""
        assert export_service._sanitize_filename("v1.0.mission") == "v1 0 mission"

    def test_fallback_when_empty_after_sanitize(self):
        """when every char is stripped, fall back to 'mission' (no underscore)."""
        assert export_service._sanitize_filename("___...") == "mission"
        assert export_service._sanitize_filename("") == "mission"


def _build_export_db_mock(mission, fp, airport, drone_profile=None):
    """build a MagicMock Session that routes query(Model) to the right fixture.

    mission/airport/drone_profile are looked up via query.filter.first,
    flight_plan via query.options.filter.first.
    """
    db = MagicMock()

    def query_side_effect(model):
        mock_chain = MagicMock()
        if model.__name__ == "Mission":
            mock_chain.filter.return_value.first.return_value = mission
            # eager-load path: query(Mission).filter().options().first()
            mock_chain.filter.return_value.options.return_value.first.return_value = mission
            # options-first path: query(Mission).options().filter().first()
            mock_chain.options.return_value.filter.return_value.first.return_value = mission
        elif model.__name__ == "FlightPlan":
            mock_chain.options.return_value.filter.return_value.first.return_value = fp
        elif model.__name__ == "Airport":
            mock_chain.filter.return_value.first.return_value = airport
        elif model.__name__ == "DroneProfile":
            mock_chain.filter.return_value.first.return_value = drone_profile
        return mock_chain

    db.query.side_effect = query_side_effect
    return db


class TestExportMissionFormats:
    """tests for export_mission format validation."""

    def test_invalid_format_raises_domain_error(self):
        """unknown format string raises DomainError 422 before any db mutation."""
        from app.core.exceptions import DomainError

        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "test"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        import pytest

        with pytest.raises(DomainError) as exc_info:
            export_service.export_mission(db, uuid4(), ["INVALID"])
        assert exc_info.value.status_code == 422
        db.commit.assert_not_called()

    def test_valid_format_exports_and_commits(self):
        """successful export transitions status, flushes (route commits), and returns files."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test Mission"
        mission.drone_profile_id = None

        fp = _make_flight_plan(2)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, safe_name, _clamps = export_service.export_mission(db, uuid4(), ["JSON"])

        assert safe_name == "Test Mission"
        assert len(files) == 1
        filename = list(files.keys())[0]
        # no "mission_" prefix - fh2 rejects underscores in flight route names
        assert filename == "Test Mission.json"
        content, content_type = files[filename]
        assert content_type == "application/json"
        assert len(content) > 0
        mission.transition_to.assert_called_once_with("EXPORTED")
        db.commit.assert_not_called()

    def test_ugcs_format_exports_and_commits(self):
        """ugcs format export transitions status, flushes (route commits), and returns files."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test Mission"
        mission.drone_profile_id = None

        fp = _make_flight_plan(2)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, safe_name, _clamps = export_service.export_mission(db, uuid4(), ["UGCS"])

        assert safe_name == "Test Mission"
        assert len(files) == 1
        filename = list(files.keys())[0]
        assert filename == "Test Mission.ugcs.json"
        content, content_type = files[filename]
        assert content_type == "application/json"

        data = json.loads(content)
        assert "version" in data
        assert "route" in data
        assert isinstance(data["version"]["build"], str)

        mission.transition_to.assert_called_once_with("EXPORTED")
        db.commit.assert_not_called()

    def test_litchi_format_passes_mission_to_generator(self):
        """the litchi dispatch branch threads the mission object to the generator."""
        from unittest.mock import patch

        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test Mission"
        mission.drone_profile_id = None

        fp = _make_flight_plan(2)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        spy = MagicMock(return_value=b"latitude\n")
        with patch.dict(export_service.EXPORT_REGISTRY, {"LITCHI": spy}):
            export_service.export_mission(db, uuid4(), ["LITCHI"])

        spy.assert_called_once()
        assert spy.call_args.kwargs.get("mission") is mission

    def test_exported_mission_reexport_skips_transition(self):
        """re-exporting an EXPORTED mission must not call transition_to or commit."""
        mission = MagicMock()
        mission.status = "EXPORTED"
        mission.name = "Already Done"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, _, _clamps = export_service.export_mission(db, uuid4(), ["JSON"])

        assert len(files) == 1
        mission.transition_to.assert_not_called()
        db.commit.assert_not_called()

    def test_measured_mission_exports_and_skips_transition(self):
        """a MEASURED mission passes the gate and stays MEASURED (no EXPORTED bump)."""
        mission = MagicMock()
        mission.status = "MEASURED"
        mission.name = "Measured"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, _, _clamps = export_service.export_mission(db, uuid4(), ["JSON"])

        assert len(files) == 1
        mission.transition_to.assert_not_called()
        db.commit.assert_not_called()

    def test_draft_status_rejected(self):
        """missions in DRAFT status cannot be exported - DomainError 409."""
        from app.core.exceptions import DomainError

        mission = MagicMock()
        mission.status = "DRAFT"
        mission.name = "x"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        import pytest

        with pytest.raises(DomainError) as exc_info:
            export_service.export_mission(db, uuid4(), ["JSON"])
        assert exc_info.value.status_code == 409
        db.commit.assert_not_called()

    def test_missing_mission_raises_not_found(self):
        """mission lookup returning None raises NotFoundError."""
        from app.core.exceptions import NotFoundError

        db = _build_export_db_mock(None, None, None)

        import pytest

        with pytest.raises(NotFoundError):
            export_service.export_mission(db, uuid4(), ["JSON"])

    def test_missing_flight_plan_raises_not_found(self):
        """no flight plan for a validated mission raises NotFoundError."""
        from app.core.exceptions import NotFoundError

        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "x"
        mission.drone_profile_id = None

        db = _build_export_db_mock(mission, None, None)

        import pytest

        with pytest.raises(NotFoundError):
            export_service.export_mission(db, uuid4(), ["JSON"])

    def test_missing_airport_elevation_raises_domain_error(self):
        """airport without elevation raises DomainError 422 - agl cannot be computed."""
        from app.core.exceptions import DomainError

        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "x"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = None

        db = _build_export_db_mock(mission, fp, airport)

        import pytest

        with pytest.raises(DomainError) as exc_info:
            export_service.export_mission(db, uuid4(), ["JSON"])
        assert exc_info.value.status_code == 422

    def test_transition_value_error_becomes_domain_error(self):
        """ValueError from mission.transition_to is re-raised as DomainError 409."""
        from app.core.exceptions import DomainError

        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "x"
        mission.drone_profile_id = None
        mission.transition_to.side_effect = ValueError("bad transition")

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        import pytest

        with pytest.raises(DomainError) as exc_info:
            export_service.export_mission(db, uuid4(), ["JSON"])
        assert exc_info.value.status_code == 409

    def test_kmz_export_loads_drone_profile(self):
        """kmz export with a drone_profile_id loads the profile and applies its enums."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Airport Inspection"
        mission.drone_profile_id = uuid4()
        mission.takeoff_coordinate = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        drone_profile = MagicMock()
        drone_profile.model_identifier = None
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 4T"

        db = _build_export_db_mock(mission, fp, airport, drone_profile)

        files, safe_name, _clamps = export_service.export_mission(db, uuid4(), ["KMZ"])

        assert safe_name == "Airport Inspection"
        filename = list(files.keys())[0]
        assert filename == "Airport Inspection.kmz"
        content, _ = files[filename]

        with zipfile.ZipFile(BytesIO(content)) as zf:
            template = zf.read("wpmz/template.kml").decode("utf-8")

        assert "<wpml:droneEnumValue>99</wpml:droneEnumValue>" in template
        assert "<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>" in template

    def test_kmz_export_falls_back_to_m4t_for_mavic_2_pro(self):
        """unmapped dji drone exports successfully and tags the file as m4t."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Stevo test"
        mission.drone_profile_id = uuid4()
        mission.takeoff_coordinate = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        drone_profile = MagicMock()
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Mavic 2 Pro"

        db = _build_export_db_mock(mission, fp, airport, drone_profile)

        files, _, _clamps = export_service.export_mission(db, uuid4(), ["KMZ"])

        filename = next(iter(files))
        content, _ = files[filename]
        with zipfile.ZipFile(BytesIO(content)) as zf:
            template = zf.read("wpmz/template.kml").decode("utf-8")

        # m4t fallback enum
        assert "<wpml:droneEnumValue>99</wpml:droneEnumValue>" in template
        assert "<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>" in template

    def test_kmz_export_falls_back_to_m4t_for_non_dji_drone(self):
        """non-dji drone still produces a (m4t-tagged) kmz - frontend warns the operator."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test Mission"
        mission.drone_profile_id = uuid4()
        mission.takeoff_coordinate = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        drone_profile = MagicMock()
        drone_profile.manufacturer = "Skydio"
        drone_profile.model = "Skydio X10"

        db = _build_export_db_mock(mission, fp, airport, drone_profile)

        files, _, _clamps = export_service.export_mission(db, uuid4(), ["WPML"])

        filename = next(iter(files))
        content, _ = files[filename]
        text = content.decode("utf-8")

        assert "<wpml:droneEnumValue>99</wpml:droneEnumValue>" in text
        assert "<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>" in text

    def test_kmz_export_falls_back_to_m4t_when_no_drone_configured(self):
        """missing drone profile falls through to the m4t fallback rather than 422."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test Mission"
        mission.drone_profile_id = None
        mission.takeoff_coordinate = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, _, _clamps = export_service.export_mission(db, uuid4(), ["KMZ"])

        filename = next(iter(files))
        content, _ = files[filename]
        with zipfile.ZipFile(BytesIO(content)) as zf:
            template = zf.read("wpmz/template.kml").decode("utf-8")

        assert "<wpml:droneEnumValue>99</wpml:droneEnumValue>" in template
        assert "<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>" in template

    def test_banned_chars_in_mission_name_produce_safe_filename(self):
        """mission names with fh2-banned chars round-trip to a clean filename."""
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "Test_2.Mission: runway / 22"
        mission.drone_profile_id = None

        fp = _make_flight_plan(1)
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 100.0

        db = _build_export_db_mock(mission, fp, airport)

        files, safe_name, _clamps = export_service.export_mission(db, uuid4(), ["JSON"])
        filename = list(files.keys())[0]

        for banned in '<>:"/|?*_':
            assert banned not in safe_name
        # exactly one dot - the one separating extension from base
        assert filename.count(".") == 1
        assert filename.endswith(".json")


class TestGenerateUgcs:
    """tests for ugcs json route export generation."""

    def test_top_level_structure(self):
        """ugcs output has version object and route object at top level."""
        fp = _make_flight_plan(3)

        result = export_service.generate_ugcs(fp, "Test Route", 290.0)
        data = json.loads(result)

        assert "version" in data
        assert "route" in data
        assert isinstance(data["version"], dict)
        assert isinstance(data["route"], dict)

    def test_top_level_arrays_present(self):
        """ugcs output includes empty payload and vehicle profile arrays."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        assert data["payloadProfiles"] == []
        assert data["vehicleProfiles"] == []
        assert "vehicles" not in data

    def test_version_is_structured_object(self):
        """version field matches ugcs expected schema version."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        v = data["version"]
        assert v["major"] == 5
        assert v["minor"] == 16
        assert v["patch"] == 1
        assert v["build"] == "9205"
        assert isinstance(v["build"], str)
        assert v["component"] == "DATABASE"

    def test_coordinates_in_radians(self):
        """waypoint coordinates are converted from degrees to radians."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 290.0)
        data = json.loads(result)

        point = data["route"]["segments"][0]["point"]
        expected_lat = math.radians(49.69)
        expected_lon = math.radians(18.11)

        assert abs(point["latitude"] - expected_lat) < 1e-10
        assert abs(point["longitude"] - expected_lon) < 1e-10

    def test_altitude_is_agl(self):
        """segment altitude is relative to ground level."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 290.0)
        data = json.loads(result)

        point = data["route"]["segments"][0]["point"]
        assert point["altitude"] == 10.0
        assert point["altitudeType"] == "AGL"

    def test_segment_count_matches_waypoints(self):
        """each waypoint produces one segment."""
        fp = _make_flight_plan(5)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        assert len(data["route"]["segments"]) == 5

    def test_all_segments_are_waypoint_type(self):
        """all segments use Waypoint type - ugcs only accepts this for import."""
        fp = _make_flight_plan(3)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        for seg in data["route"]["segments"]:
            assert seg["type"] == "Waypoint"

    def test_route_name(self):
        """route name matches mission name."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "Airport Inspection", 0)
        data = json.loads(result)

        assert data["route"]["name"] == "Airport Inspection"

    def test_failsafes_present(self):
        """route includes default failsafe configuration."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        fs = data["route"]["failsafes"]
        assert fs["rcLost"] == "GO_HOME"
        assert fs["gpsLost"] is None
        assert fs["lowBattery"] is None
        assert fs["datalinkLost"] is None

    def test_camera_trigger_photo(self):
        """photo capture generates CameraTrigger with SINGLE_SHOT state."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].camera_action = "PHOTO_CAPTURE"

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        actions = data["route"]["segments"][0]["actions"]
        camera_actions = [a for a in actions if a["type"] == "CameraTrigger"]
        assert len(camera_actions) == 1
        assert camera_actions[0]["state"] == "SINGLE_SHOT"

    def test_camera_trigger_recording(self):
        """recording start generates CameraTrigger with START_RECORDING state."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].camera_action = "RECORDING_START"

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        actions = data["route"]["segments"][0]["actions"]
        camera_actions = [a for a in actions if a["type"] == "CameraTrigger"]
        assert len(camera_actions) == 1
        assert camera_actions[0]["state"] == "START_RECORDING"

    def test_heading_generates_heading_action(self):
        """waypoint heading generates Heading action in radians."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].heading = 90.0

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        actions = data["route"]["segments"][0]["actions"]
        heading_actions = [a for a in actions if a["type"] == "Heading"]
        assert len(heading_actions) == 1
        assert heading_actions[0]["relativeToNorth"] is True

    def test_gimbal_generates_camera_control(self):
        """waypoint gimbal pitch generates CameraControl action."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].gimbal_pitch = -45.0

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        actions = data["route"]["segments"][0]["actions"]
        cam_actions = [a for a in actions if a["type"] == "CameraControl"]
        assert len(cam_actions) == 1
        assert cam_actions[0]["roll"] == 0.0

    def test_hover_generates_wait_action(self):
        """waypoint with hover_duration generates Wait action with extra fields."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].hover_duration = 3.5

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        actions = data["route"]["segments"][0]["actions"]
        wait_actions = [a for a in actions if a["type"] == "Wait"]
        assert len(wait_actions) == 1
        assert wait_actions[0]["interval"] == 3.5
        assert wait_actions[0]["waitForOperator"] is False

    def test_empty_waypoints(self):
        """ugcs format works with zero waypoints."""
        fp = _make_flight_plan(0)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        assert data["route"]["segments"] == []
        assert "version" in data

    def test_route_nullable_fields(self):
        """route includes nullable fields that ugcs expects."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        route = data["route"]
        assert route["scheduledTime"] is None
        assert route["startDelay"] is None
        assert route["vehicleProfile"] is None
        assert route["takeoffHeight"] is None
        assert route["trajectoryType"] is None
        assert route["maxSpeed"] is None

    def test_route_defaults(self):
        """route has correct default values for ugcs."""
        fp = _make_flight_plan(1)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        route = data["route"]
        assert route["maxAltitude"] == 1500.0
        assert route["cornerRadius"] == 20.0
        assert route["safeAltitude"] == 50.0
        assert "altitudeType" not in route

    def test_segment_corner_radius(self):
        """each segment includes cornerRadius parameter."""
        fp = _make_flight_plan(2)

        result = export_service.generate_ugcs(fp, "", 0)
        data = json.loads(result)

        for seg in data["route"]["segments"]:
            assert "cornerRadius" in seg["parameters"]
            assert seg["parameters"]["cornerRadius"] is None


class TestGenerateCsv:
    """tests for csv export generation."""

    def test_generates_valid_csv(self):
        """csv output contains header and correct row count."""
        fp = _make_flight_plan(3)

        result = export_service.generate_csv_export(fp, "Test", 290.0)
        text = result.decode("utf-8")
        lines = text.strip().split("\n")

        assert lines[0].startswith("sequence")
        assert len(lines) == 4  # header + 3 waypoints

    def test_agl_altitude(self):
        """altitude_agl equals altitude_msl minus airport_elevation."""
        fp = _make_flight_plan(1)
        elev = 290.0

        result = export_service.generate_csv_export(fp, "", elev)
        text = result.decode("utf-8")
        lines = text.strip().split("\n")
        row = lines[1].split(",")

        alt_msl = float(row[3])
        alt_agl = float(row[4])
        assert abs(alt_agl - (alt_msl - elev)) < 0.01

    def test_camera_action_in_output(self):
        """camera action column is present."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        result = export_service.generate_csv_export(fp, "", 0)
        text = result.decode("utf-8")

        assert "PHOTO_CAPTURE" in text


class TestGenerateGpx:
    """tests for gpx export generation."""

    def test_generates_valid_gpx(self):
        """gpx output contains xml declaration and gpx elements."""
        fp = _make_flight_plan(3)

        result = export_service.generate_gpx(fp, "Test", 290.0)
        text = result.decode("utf-8")

        assert "<?xml" in text
        assert "<gpx" in text
        assert "<wpt" in text
        assert "<trk" in text

    def test_waypoint_count(self):
        """gpx has correct number of wpt elements."""
        fp = _make_flight_plan(5)

        result = export_service.generate_gpx(fp, "", 0)
        text = result.decode("utf-8")

        assert text.count("<wpt") == 5

    def test_elevation_values(self):
        """gpx wpt elements have elevation."""
        fp = _make_flight_plan(1)

        result = export_service.generate_gpx(fp, "", 0)
        text = result.decode("utf-8")

        assert "<ele>" in text

    def test_xml_encoding_declaration_utf8(self):
        """gpx xml declaration specifies utf-8 encoding."""
        fp = _make_flight_plan(1)

        result = export_service.generate_gpx(fp, "Letisko Žilina", 0)
        text = result.decode("utf-8")

        assert "encoding='utf-8'" in text.lower() or 'encoding="utf-8"' in text.lower()
        assert "Letisko Žilina" in text


class TestGenerateWpml:
    """tests for standalone dji waylines.wpml export generation."""

    def test_generates_valid_wpml(self):
        """wpml output is a kml 2.2 document carrying dji wpmz 1.0.6 extensions."""
        fp = _make_flight_plan(3)

        result = _gen_wpml(fp, "Test", 290.0)
        text = result.decode("utf-8")

        assert "<?xml" in text
        assert "http://www.opengis.net/kml/2.2" in text
        assert "http://www.dji.com/wpmz/1.0.6" in text
        assert "wpml:missionConfig" in text
        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in text

    def test_waypoint_count(self):
        """wpml has one placemark per waypoint."""
        fp = _make_flight_plan(4)

        result = _gen_wpml(fp, "", 0)
        text = result.decode("utf-8")

        assert text.count("<Placemark") == 4

    def test_camera_action_mapping(self):
        """dji camera action is mapped to wpml:actionActuatorFunc."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        result = _gen_wpml(fp, "", 0)
        text = result.decode("utf-8")

        assert "takePhoto" in text
        assert "wpml:actionGroup" in text

    def test_execute_height_is_takeoff_relative(self):
        """executeHeight is wp_MSL - takeoff_ground_MSL; mode relativeToStartPoint."""
        fp = _make_flight_plan(3)

        result = _gen_wpml(fp, "", 290.0)
        text = result.decode("utf-8")

        # airborne start, no mission: takeoff anchor is airport_elevation 290.
        # waypoints 300/310/320 -> relative heights 10/20/30.
        assert "<wpml:executeHeight>10.000000</wpml:executeHeight>" in text
        assert "<wpml:executeHeight>20.000000</wpml:executeHeight>" in text
        assert "<wpml:executeHeight>30.000000</wpml:executeHeight>" in text
        assert "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>" in text

    def test_xml_encoding_declaration_utf8(self):
        """wpml xml declaration specifies utf-8 encoding."""
        fp = _make_flight_plan(1)

        result = _gen_wpml(fp, "", 0)
        text = result.decode("utf-8")

        assert "encoding='utf-8'" in text.lower() or 'encoding="utf-8"' in text.lower()


def _make_hover_stack_fp(num_hovers=5):
    """flight plan with a stack of collocated hover waypoints on one (lon, lat, alt)."""
    waypoints = [_make_waypoint(seq=1, lon=18.11, lat=49.69, alt=290.0, wp_type="TAKEOFF")]
    for i in range(num_hovers):
        wp = _make_waypoint(seq=2 + i, lon=18.12, lat=49.70, alt=300.0, wp_type="HOVER")
        wp.hover_duration = 2.0
        waypoints.append(wp)
    waypoints.append(
        _make_waypoint(seq=2 + num_hovers, lon=18.13, lat=49.71, alt=290.0, wp_type="LANDING")
    )
    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.waypoints = waypoints
    return fp


def _parse_litchi(result):
    """parse litchi csv bytes into (header, list-of-dict rows)."""
    reader = list(csv.reader(StringIO(result.decode("utf-8"))))
    header = reader[0]
    rows = [dict(zip(header, r)) for r in reader[1:]]
    return header, rows


class TestGenerateLitchiCsv:
    """tests for litchi csv export generation."""

    def test_generates_valid_litchi_csv(self):
        """litchi csv output contains correct header columns."""
        fp = _make_flight_plan(3)

        result = export_service.generate_litchi_csv(fp, "Test", 290.0)
        header, _ = _parse_litchi(result)

        assert "latitude" in header
        assert "curvesize(m)" in header
        assert "altitudemode" in header
        assert "actiontype1" in header

    def test_row_count(self):
        """non-collocated waypoints produce one row each."""
        fp = _make_flight_plan(5)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        assert len(rows) == 5

    def test_action_type_mapping(self):
        """camera actions map to correct litchi action codes."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        assert rows[1]["actiontype1"] == "1"  # 1 = takePhoto

    def test_gimbal_mode_interpolate_when_no_target(self):
        """a waypoint without a camera target gets gimbalmode=2 (interpolate)."""
        fp = _make_flight_plan(1)
        fp.waypoints[0].gimbal_pitch = -45.0

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        assert rows[0]["gimbalmode"] == "2"
        assert rows[0]["gimbalpitchangle"] == "-45.0"

    def test_collocated_hover_recording_merges(self):
        """collocated recording-bookend hovers merge and keep their actions + dwell."""
        fp, _mission, _pitches = _make_vp_video_pass(num_measurements=2)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        # 6 waypoints -> takeoff, [hover+m1], m2, [m3-equivalent+hover], landing
        assert len(rows) == 4

        # the recording-start merge carries both the recording action and a dwell
        merged = next(r for r in rows if r["actiontype1"] == "2")
        assert merged["actiontype2"] == "0"  # stay-for dwell
        assert int(merged["actionparam2"]) == 3000  # 3 s hover -> ms

    def test_hover_point_lock_stack_collapses(self):
        """a stack of collocated hovers collapses to a single row."""
        fp = _make_hover_stack_fp(num_hovers=5)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        # takeoff + one merged hover row + landing
        assert len(rows) == 3
        hover_row = rows[1]
        # five 2 s hovers fold into one stay-for action
        assert hover_row["actiontype1"] == "0"
        assert int(hover_row["actionparam1"]) == 10000

    def test_speed_is_always_positive(self):
        """every row writes a strictly positive speed."""
        fp = _make_flight_plan(4)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        assert all(float(r["speed(m/s)"]) > 0 for r in rows)

    def test_speed_falls_back_to_default_speed(self):
        """a waypoint with no speed falls back to mission.default_speed."""
        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.speed = None
        mission = MagicMock()
        mission.default_speed = 7.5
        mission.measurement_speed_override = None

        result = export_service.generate_litchi_csv(fp, "", 0, mission=mission)
        _, rows = _parse_litchi(result)

        assert all(float(r["speed(m/s)"]) == 7.5 for r in rows)

    def test_speed_uses_measurement_override(self):
        """measurement waypoints pick measurement_speed_override over default_speed."""
        fp = _make_flight_plan(3)
        for wp in fp.waypoints:
            wp.speed = None
        mission = MagicMock()
        mission.default_speed = 7.5
        mission.measurement_speed_override = 3.0

        result = export_service.generate_litchi_csv(fp, "", 0, mission=mission)
        _, rows = _parse_litchi(result)

        # rows: takeoff, measurement, landing
        assert float(rows[0]["speed(m/s)"]) == 7.5
        assert float(rows[1]["speed(m/s)"]) == 3.0
        assert float(rows[2]["speed(m/s)"]) == 7.5

    def test_curvesize_within_neighbour_distance(self):
        """curvesize never exceeds the distance to the nearest neighbour."""
        from app.services.export.formats.litchi import _dist_3d

        fp = _make_flight_plan(5)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        pts = [(float(r["longitude"]), float(r["latitude"]), float(r["altitude(m)"])) for r in rows]
        for i in range(1, len(rows) - 1):
            nearest = min(_dist_3d(pts[i - 1], pts[i]), _dist_3d(pts[i], pts[i + 1]))
            assert float(rows[i]["curvesize(m)"]) <= nearest

    def test_curvesize_zero_on_stop_action_and_endpoints(self):
        """curvesize is 0 on takeoff, landing, and stop-type-action rows."""
        fp = _make_flight_plan(4)
        fp.waypoints[1].camera_action = "RECORDING_START"

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        assert float(rows[0]["curvesize(m)"]) == 0  # takeoff
        assert float(rows[-1]["curvesize(m)"]) == 0  # landing
        assert float(rows[1]["curvesize(m)"]) == 0  # recording-start row

    def test_poi_columns_for_camera_target(self):
        """a measurement waypoint with a camera target emits poi columns + gimbalmode 1."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_target = _make_wkt_point(18.2, 49.8, 310.0)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        measurement = rows[1]
        assert measurement["gimbalmode"] == "1"
        assert float(measurement["poi_latitude"]) != 0
        assert float(measurement["poi_longitude"]) != 0

    def test_consecutive_pairs_within_litchi_range(self):
        """after merging, every consecutive 3d pair is inside (0.6, 1999) m."""
        from app.services.export.formats.litchi import _dist_3d

        fp, _mission, _pitches = _make_vp_video_pass(num_measurements=4)

        result = export_service.generate_litchi_csv(fp, "", 0)
        _, rows = _parse_litchi(result)

        pts = [(float(r["longitude"]), float(r["latitude"]), float(r["altitude(m)"])) for r in rows]
        for a, b in zip(pts, pts[1:]):
            dist = _dist_3d(a, b)
            assert 0.6 <= dist <= 1999


class TestGenerateDronedeploy:
    """tests for dronedeploy json export generation."""

    def test_generates_valid_json(self):
        """dronedeploy output is valid json with required fields."""
        fp = _make_flight_plan(3)

        result = export_service.generate_dronedeploy(fp, "Test", 290.0)
        data = json.loads(result)

        assert data["version"] == 1
        assert data["name"] == "Test"
        assert len(data["waypoints"]) == 3

    def test_waypoint_fields(self):
        """dronedeploy waypoints have required fields."""
        fp = _make_flight_plan(2)

        result = export_service.generate_dronedeploy(fp, "", 0)
        data = json.loads(result)

        wp = data["waypoints"][0]
        assert "lat" in wp
        assert "lng" in wp
        assert "alt" in wp
        assert "speed" in wp
        assert "heading" in wp
        assert "actions" in wp

    def test_camera_action_mapping(self):
        """camera actions map to correct dronedeploy action objects."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        result = export_service.generate_dronedeploy(fp, "", 0)
        data = json.loads(result)

        assert data["waypoints"][1]["actions"] == [{"type": "photo"}]

    def test_agl_altitude(self):
        """altitude is agl (msl minus elevation)."""
        fp = _make_flight_plan(1)
        elev = 290.0

        result = export_service.generate_dronedeploy(fp, "", elev)
        data = json.loads(result)

        wp = data["waypoints"][0]
        # alt = 300 - 290 = 10
        assert abs(wp["alt"] - 10.0) < 0.01


def _make_inspection(optical_zoom, *, other_settings=None):
    """build a mock inspection whose config resolves to optical_zoom + extras."""
    resolved = {
        "white_balance": None,
        "iso": None,
        "shutter_speed": None,
        "focus_mode": None,
        "optical_zoom": optical_zoom,
    }
    if other_settings:
        resolved.update(other_settings)

    config = MagicMock()
    config.resolve_with_defaults.return_value = resolved

    template = MagicMock()
    template.default_config = MagicMock()

    insp = MagicMock()
    insp.id = uuid4()
    insp.config = config
    insp.template = template
    return insp


def _kmz_texts(fp, *, mission=None, drone_profile=None):
    """generate a kmz and return (template_kml, waylines_wpml) as strings."""
    result = _gen_kmz(fp, "Night", 0, mission=mission, drone_profile=drone_profile or _M4T_PROFILE)
    return _read_wpmz(result)


class TestGenerateKmzCameraSettings:
    """tests for per-inspection camera settings emission in the dji kmz export."""

    def test_no_zoom_action_when_optical_zoom_null(self):
        """inspection without optical_zoom emits no zoom action."""
        fp = _make_flight_plan(3)
        insp = _make_inspection(optical_zoom=None)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        template, waylines = _kmz_texts(fp, mission=mission)

        assert "actionActuatorFunc>zoom" not in template
        assert "actionActuatorFunc>zoom" not in waylines

    def test_no_zoom_action_when_optical_zoom_is_1x(self):
        """baseline 1.0x is a no-op and emits no zoom action."""
        fp = _make_flight_plan(3)
        insp = _make_inspection(optical_zoom=1.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        template, waylines = _kmz_texts(fp, mission=mission)

        assert "actionActuatorFunc>zoom" not in template
        assert "actionActuatorFunc>zoom" not in waylines

    def test_zoom_action_emitted_at_first_measurement_waypoint(self):
        """zoom action appears only in the first measurement waypoint per inspection."""
        fp = _make_flight_plan(4)
        # extend the flight plan so wp1, wp2 are both MEASUREMENT + same inspection
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[2].waypoint_type = "MEASUREMENT"
        insp = _make_inspection(optical_zoom=3.0)
        fp.waypoints[1].inspection_id = insp.id
        fp.waypoints[2].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        # exactly one zoom action across the whole wayline
        assert waylines.count("<wpml:actionActuatorFunc>zoom</wpml:actionActuatorFunc>") == 1
        # lives inside the first measurement waypoint's action group
        wp1_idx = waylines.find("<wpml:index>1</wpml:index>")
        wp2_idx = waylines.find("<wpml:index>2</wpml:index>")
        zoom_idx = waylines.find("<wpml:actionActuatorFunc>zoom")
        assert wp1_idx < zoom_idx < wp2_idx

    _WPML_NS = {
        "kml": "http://www.opengis.net/kml/2.2",
        "wpml": "http://www.dji.com/wpmz/1.0.6",
    }

    def _action_func_sequence(self, waylines: str, wp_index_zero_based: int) -> list[str]:
        """return ordered actionActuatorFunc tokens for the reachPoint group at wp_index."""
        root = ET.fromstring(waylines)
        for pm in root.findall(".//kml:Placemark", self._WPML_NS):
            idx = pm.findtext("wpml:index", namespaces=self._WPML_NS)
            if idx != str(wp_index_zero_based):
                continue
            for group in pm.findall("wpml:actionGroup", self._WPML_NS):
                trigger = group.findtext(
                    "wpml:actionTrigger/wpml:actionTriggerType", namespaces=self._WPML_NS
                )
                if trigger != "reachPoint":
                    continue
                return [
                    action.findtext("wpml:actionActuatorFunc", namespaces=self._WPML_NS)
                    for action in group.findall("wpml:action", self._WPML_NS)
                ]
        return []

    def test_zoom_action_emitted_before_take_photo(self):
        """zoom must precede takePhoto in the same reachPoint actionGroup.

        sequence-mode actionGroups apply actions in document order, so a zoom
        emitted after takePhoto would not take effect until the next waypoint
        and the anchor frame on the first measurement would be captured at the
        inherited baseline (1x) instead of the configured optical_zoom.
        """
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"
        insp = _make_inspection(optical_zoom=7.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        funcs = self._action_func_sequence(waylines, wp_index_zero_based=1)
        assert "zoom" in funcs, f"zoom action missing from waypoint 1 group: {funcs}"
        assert "takePhoto" in funcs, f"takePhoto action missing from waypoint 1 group: {funcs}"
        assert funcs.index("zoom") < funcs.index("takePhoto"), (
            f"zoom must precede takePhoto, got order: {funcs}"
        )

    def test_zoom_action_emitted_before_start_record(self):
        """zoom must also precede startRecord on a video-capture first measurement."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[1].camera_action = "RECORDING_START"
        insp = _make_inspection(optical_zoom=7.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        funcs = self._action_func_sequence(waylines, wp_index_zero_based=1)
        assert "zoom" in funcs, f"zoom action missing from waypoint 1 group: {funcs}"
        assert "startRecord" in funcs, f"startRecord action missing from waypoint 1 group: {funcs}"
        assert funcs.index("zoom") < funcs.index("startRecord"), (
            f"zoom must precede startRecord, got order: {funcs}"
        )

    def test_zoom_action_per_inspection_with_different_zoom(self):
        """two inspections with different optical_zoom each emit their own zoom action."""
        fp = _make_flight_plan(4)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[2].waypoint_type = "MEASUREMENT"
        insp1 = _make_inspection(optical_zoom=2.0)
        insp2 = _make_inspection(optical_zoom=5.0)
        fp.waypoints[1].inspection_id = insp1.id
        fp.waypoints[2].inspection_id = insp2.id

        mission = MagicMock()
        mission.inspections = [insp1, insp2]
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        assert waylines.count("<wpml:actionActuatorFunc>zoom</wpml:actionActuatorFunc>") == 2

    def test_zoom_action_not_repeated_when_value_matches_previous(self):
        """consecutive inspections with the same optical_zoom emit the action only once."""
        fp = _make_flight_plan(4)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[2].waypoint_type = "MEASUREMENT"
        insp1 = _make_inspection(optical_zoom=3.0)
        insp2 = _make_inspection(optical_zoom=3.0)
        fp.waypoints[1].inspection_id = insp1.id
        fp.waypoints[2].inspection_id = insp2.id

        mission = MagicMock()
        mission.inspections = [insp1, insp2]
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        assert waylines.count("<wpml:actionActuatorFunc>zoom</wpml:actionActuatorFunc>") == 1

    def test_zoom_uses_focal_length_when_drone_profile_has_base(self):
        """focalLength = optical_zoom × sensor_base_focal_length when the base is set."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        insp = _make_inspection(optical_zoom=5.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        drone_profile = MagicMock()
        drone_profile.model_identifier = None
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 4T"
        drone_profile.sensor_base_focal_length = 24.0

        _, waylines = _kmz_texts(fp, mission=mission, drone_profile=drone_profile)

        # 5.0 x 24.0 = 120.0 - :g formatting drops trailing .0
        assert "<wpml:focalLength>120</wpml:focalLength>" in waylines
        assert "zoomFactor" not in waylines

    def test_zoom_falls_back_to_zoom_factor_without_base(self):
        """when the drone profile lacks sensor_base_focal_length, emit zoomFactor."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        insp = _make_inspection(optical_zoom=4.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        drone_profile = MagicMock()
        drone_profile.model_identifier = None
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 4T"
        drone_profile.sensor_base_focal_length = None

        _, waylines = _kmz_texts(fp, mission=mission, drone_profile=drone_profile)

        assert "<wpml:zoomFactor>4</wpml:zoomFactor>" in waylines
        assert "focalLength" not in waylines

    def test_zoom_action_present_in_both_template_and_waylines(self):
        """both template.kml and waylines.wpml carry the zoom action."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        insp = _make_inspection(optical_zoom=2.5)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        template, waylines = _kmz_texts(fp, mission=mission)

        for content in (template, waylines):
            assert "<wpml:actionActuatorFunc>zoom</wpml:actionActuatorFunc>" in content

    def test_zoom_skipped_when_inspection_not_in_mission(self):
        """waypoint tagged to an inspection the mission doesn't know about emits nothing."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[1].inspection_id = uuid4()

        mission = MagicMock()
        mission.inspections = []
        mission.takeoff_coordinate = None

        _, waylines = _kmz_texts(fp, mission=mission)

        assert "actionActuatorFunc>zoom" not in waylines

    def test_default_optical_zoom_skips_emission_when_matched(self):
        """drone_profile.default_optical_zoom defines the no-op baseline.

        when an inspection's optical_zoom matches the drone's default, no zoom
        action is emitted; a different value still emits.
        """
        fp = _make_flight_plan(4)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[2].waypoint_type = "MEASUREMENT"
        insp_match = _make_inspection(optical_zoom=2.0)
        insp_other = _make_inspection(optical_zoom=3.0)
        fp.waypoints[1].inspection_id = insp_match.id
        fp.waypoints[2].inspection_id = insp_other.id

        mission = MagicMock()
        mission.inspections = [insp_match, insp_other]
        mission.takeoff_coordinate = None

        drone_profile = MagicMock()
        drone_profile.model_identifier = None
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 4T"
        drone_profile.sensor_base_focal_length = None
        drone_profile.default_optical_zoom = 2.0

        _, waylines = _kmz_texts(fp, mission=mission, drone_profile=drone_profile)

        # only the 3.0x inspection emits a zoom action
        assert waylines.count("<wpml:actionActuatorFunc>zoom</wpml:actionActuatorFunc>") == 1
        assert "<wpml:zoomFactor>3</wpml:zoomFactor>" in waylines

    def test_default_optical_zoom_falls_back_to_one_when_unset(self):
        """without a drone profile (or with default_optical_zoom unset) baseline is 1.0x."""
        fp = _make_flight_plan(3)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        insp = _make_inspection(optical_zoom=1.0)
        fp.waypoints[1].inspection_id = insp.id

        mission = MagicMock()
        mission.inspections = [insp]
        mission.takeoff_coordinate = None

        drone_profile = MagicMock()
        drone_profile.model_identifier = None
        drone_profile.manufacturer = "DJI"
        drone_profile.model = "Matrice 4T"
        drone_profile.sensor_base_focal_length = None
        drone_profile.default_optical_zoom = None

        _, waylines = _kmz_texts(fp, mission=mission, drone_profile=drone_profile)

        # 1.0 matches the implicit baseline, no zoom action emitted
        assert "actionActuatorFunc>zoom" not in waylines


def _make_polygon_wkt(rings: list[list[tuple[float, float, float]]]) -> str:
    """build a POLYGON Z WKT string from a list of rings."""
    parts = []
    for ring in rings:
        coords = ", ".join(f"{lon} {lat} {alt}" for lon, lat, alt in ring)
        parts.append(f"({coords})")
    return f"POLYGON Z ({', '.join(parts)})"


# back-compat alias
_make_polygon_ewkb = _make_polygon_wkt


def _make_polygon_geom(rings):
    """create a mock geometry column wrapping a WKT polygon."""
    return _make_polygon_wkt(rings)


def _make_safety_zone(
    name="Restricted A",
    zone_type="RESTRICTED",
    is_active=True,
    rings=None,
):
    """create a mock SafetyZone with polygon geometry."""
    if rings is None:
        rings = [
            [
                (18.10, 49.69, 100.0),
                (18.11, 49.69, 100.0),
                (18.11, 49.70, 100.0),
                (18.10, 49.70, 100.0),
                (18.10, 49.69, 100.0),
            ]
        ]
    zone = MagicMock()
    zone.id = uuid4()
    zone.name = name
    zone.type = zone_type
    zone.is_active = is_active
    zone.altitude_floor = 0.0
    zone.altitude_ceiling = 500.0
    zone.geometry = _make_polygon_geom(rings)
    return zone


def _make_obstacle(name="Tower", obstacle_type="BUILDING", rings=None):
    """create a mock Obstacle with boundary polygon."""
    if rings is None:
        rings = [
            [
                (18.115, 49.692, 100.0),
                (18.116, 49.692, 100.0),
                (18.116, 49.693, 100.0),
                (18.115, 49.693, 100.0),
                (18.115, 49.692, 100.0),
            ]
        ]
    obs = MagicMock()
    obs.id = uuid4()
    obs.name = name
    obs.type = obstacle_type
    obs.height = 25.0
    obs.buffer_distance = 10.0
    obs.boundary = _make_polygon_geom(rings)
    return obs


def _make_surface(identifier="08L", surface_type="RUNWAY", rings=None):
    """create a mock AirfieldSurface with buffer polygon."""
    if rings is None:
        rings = [
            [
                (18.108, 49.695, 100.0),
                (18.118, 49.695, 100.0),
                (18.118, 49.697, 100.0),
                (18.108, 49.697, 100.0),
                (18.108, 49.695, 100.0),
            ]
        ]
    sfc = MagicMock()
    sfc.id = uuid4()
    sfc.identifier = identifier
    sfc.surface_type = surface_type
    sfc.buffer_distance = 30.0
    sfc.boundary = _make_polygon_geom(rings)
    return sfc


def _make_airport_with_geozones(
    *, safety_zones=None, obstacles=None, surfaces=None, elevation=100.0
):
    """build a MagicMock Airport carrying optional safety zones/obstacles/surfaces."""
    airport = MagicMock()
    airport.elevation = elevation
    airport.safety_zones = list(safety_zones or [])
    airport.obstacles = list(obstacles or [])
    airport.surfaces = list(surfaces or [])
    return airport


class TestBuildGeozonePayload:
    """tests for build_geozone_payload filters and shape."""

    def test_excludes_inactive_safety_zones(self):
        """inactive zones must not appear in the payload."""
        active = _make_safety_zone(name="Active", is_active=True)
        inactive = _make_safety_zone(name="Inactive", is_active=False)
        airport = _make_airport_with_geozones(safety_zones=[active, inactive])

        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)

        names = [z["name"] for z in payload["safety_zones"]]
        assert names == ["Active"]

    def test_excludes_airport_boundary(self):
        """AIRPORT_BOUNDARY zones are filtered - they define location, not keep-out."""
        boundary = _make_safety_zone(name="Boundary", zone_type="AIRPORT_BOUNDARY")
        restricted = _make_safety_zone(name="R1", zone_type="RESTRICTED")
        airport = _make_airport_with_geozones(safety_zones=[boundary, restricted])

        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)

        names = [z["name"] for z in payload["safety_zones"]]
        assert names == ["R1"]

    def test_runway_buffers_only_when_requested(self):
        """runway_buffers stays empty unless include_runway_buffers is True."""
        sfc = _make_surface()
        airport = _make_airport_with_geozones(surfaces=[sfc])

        without = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        assert without["runway_buffers"] == []

        with_buffers = export_service.build_geozone_payload(airport, include_runway_buffers=True)
        assert len(with_buffers["runway_buffers"]) == 1
        assert with_buffers["runway_buffers"][0]["identifier"] == "08L"

    def test_empty_airport_yields_empty_arrays(self):
        """zero zones + zero obstacles -> empty arrays, no error."""
        airport = _make_airport_with_geozones()

        payload = export_service.build_geozone_payload(airport, include_runway_buffers=True)

        assert payload == {"safety_zones": [], "obstacles": [], "runway_buffers": []}

    def test_obstacles_and_zones_geometry_shape(self):
        """payload entries carry id, name, type, and a geojson Polygon geometry."""
        zone = _make_safety_zone(name="R1", zone_type="RESTRICTED")
        obs = _make_obstacle(name="Mast", obstacle_type="ANTENNA")
        airport = _make_airport_with_geozones(safety_zones=[zone], obstacles=[obs])

        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)

        z = payload["safety_zones"][0]
        assert z["name"] == "R1"
        assert z["type"] == "RESTRICTED"
        assert z["geometry"]["type"] == "Polygon"
        assert isinstance(z["geometry"]["coordinates"], list)

        o = payload["obstacles"][0]
        assert o["name"] == "Mast"
        assert o["type"] == "ANTENNA"
        assert o["height"] == 25.0
        assert o["geometry"]["type"] == "Polygon"


def _build_export_db_with_airport(mission, fp, airport, drone_profile=None):
    """variant of _build_export_db_mock that also routes Airport.options chains."""
    db = MagicMock()

    def query_side_effect(model):
        chain = MagicMock()
        if model.__name__ == "Mission":
            chain.filter.return_value.first.return_value = mission
            chain.filter.return_value.options.return_value.first.return_value = mission
            chain.options.return_value.filter.return_value.first.return_value = mission
        elif model.__name__ == "FlightPlan":
            chain.options.return_value.filter.return_value.first.return_value = fp
        elif model.__name__ == "Airport":
            chain.filter.return_value.first.return_value = airport
            chain.filter.return_value.options.return_value.first.return_value = airport
        elif model.__name__ == "DroneProfile":
            chain.filter.return_value.first.return_value = drone_profile
        return chain

    db.query.side_effect = query_side_effect
    return db


class TestExportMissionGeozoneGate:
    """gate tests for include_geozones / include_runway_buffers."""

    def _setup(self, *, drone_supports=False, has_drone=True):
        mission = MagicMock()
        mission.status = "VALIDATED"
        mission.name = "GZ Mission"
        mission.flight_plan_scope = "FULL"
        mission.takeoff_coordinate = None
        mission.inspections = []
        drone_profile = None
        if has_drone:
            mission.drone_profile_id = uuid4()
            drone_profile = MagicMock()
            drone_profile.supports_geozone_upload = drone_supports
            drone_profile.model_identifier = None
            drone_profile.manufacturer = "ArduPilot"
            drone_profile.model = "Generic"
            drone_profile.sensor_base_focal_length = None
            drone_profile.default_optical_zoom = None
        else:
            mission.drone_profile_id = None

        fp = _make_flight_plan(2)
        fp.airport_id = uuid4()

        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone()],
            obstacles=[_make_obstacle()],
            surfaces=[_make_surface()],
        )
        db = _build_export_db_with_airport(mission, fp, airport, drone_profile)
        return db, mission, drone_profile

    def test_incapable_format_with_flag_raises(self):
        """flag set but a selected format doesn't support geozones -> 400."""
        import pytest

        from app.core.exceptions import DomainError

        db, _, _ = self._setup(drone_supports=True)
        with pytest.raises(DomainError) as exc:
            export_service.export_mission(db, uuid4(), ["MAVLINK", "GPX"], include_geozones=True)
        assert exc.value.status_code == 400
        assert "GPX" in exc.value.message

    def test_drone_incapable_with_flag_raises(self):
        """flag set but drone lacks supports_geozone_upload -> 400."""
        import pytest

        from app.core.exceptions import DomainError

        db, _, _ = self._setup(drone_supports=False)
        with pytest.raises(DomainError) as exc:
            export_service.export_mission(db, uuid4(), ["MAVLINK"], include_geozones=True)
        assert exc.value.status_code == 400

    def test_no_drone_with_flag_raises(self):
        """flag set but mission has no drone -> 400."""
        import pytest

        from app.core.exceptions import DomainError

        db, _, _ = self._setup(has_drone=False)
        with pytest.raises(DomainError) as exc:
            export_service.export_mission(db, uuid4(), ["MAVLINK"], include_geozones=True)
        assert exc.value.status_code == 400

    def test_runway_buffers_without_parent_raises(self):
        """runway_buffers=True without include_geozones=True -> 400."""
        import pytest

        from app.core.exceptions import DomainError

        db, _, _ = self._setup(drone_supports=True)
        with pytest.raises(DomainError) as exc:
            export_service.export_mission(db, uuid4(), ["MAVLINK"], include_runway_buffers=True)
        assert exc.value.status_code == 400

    def test_capable_format_and_drone_passes(self):
        """flag accepted when format and drone capable - returns files."""
        db, _, _ = self._setup(drone_supports=True)
        files, _, _clamps = export_service.export_mission(
            db, uuid4(), ["MAVLINK"], include_geozones=True
        )
        # MAVLINK with geozones switches to .plan extension
        assert any(name.endswith(".plan") for name in files.keys())


class TestGeozoneEmissionMavlink:
    """mavlink .plan emission with geozones."""

    def _build(self, *, include_runway_buffers=False):
        fp = _make_flight_plan(2)
        airport = _make_airport_with_geozones(
            safety_zones=[
                _make_safety_zone(name="R1", zone_type="RESTRICTED"),
                _make_safety_zone(name="Boundary", zone_type="AIRPORT_BOUNDARY"),
            ],
            obstacles=[_make_obstacle(name="Tower")],
            surfaces=[_make_surface(identifier="08L")],
        )
        payload = export_service.build_geozone_payload(
            airport, include_runway_buffers=include_runway_buffers
        )
        result = export_service.generate_mavlink(fp, "Test", 100.0, geozone_payload=payload)
        return json.loads(result.decode("utf-8"))

    def test_plan_envelope_shape(self):
        """plan top-level keys match qgc .plan v1 schema."""
        plan = self._build()
        assert plan["fileType"] == "Plan"
        assert plan["version"] == 1
        assert "mission" in plan
        assert "geoFence" in plan

    def test_keep_outs_emitted_with_inclusion_false(self):
        """safety zones + obstacles produce inclusion=false polygons."""
        plan = self._build()
        polygons = plan["geoFence"]["polygons"]
        # AIRPORT_BOUNDARY excluded, so 1 zone + 1 obstacle = 2 polygons
        assert len(polygons) == 2
        for poly in polygons:
            assert poly["inclusion"] is False

    def test_runway_buffers_emit_inclusion_true(self):
        """runway buffers - when included - emit inclusion=true polygons."""
        plan = self._build(include_runway_buffers=True)
        polygons = plan["geoFence"]["polygons"]
        # 1 safety zone + 1 obstacle (inclusion=False) + 1 runway buffer (inclusion=True)
        assert len(polygons) == 3
        inclusion_true = [p for p in polygons if p["inclusion"] is True]
        assert len(inclusion_true) == 1

    def test_default_mavlink_unchanged_without_payload(self):
        """without geozone_payload the default WPL 110 plain text is unchanged."""
        fp = _make_flight_plan(2)
        result = export_service.generate_mavlink(fp, "Test", 100.0)
        assert result.decode("utf-8").startswith("QGC WPL 110")

    def test_plan_emits_camera_trigger_after_nav_item(self):
        """photo/video camera_action produces a follow-up SimpleItem like WPL does."""
        fp = _make_flight_plan(3)
        # mid waypoint shoots a photo; first/last keep camera_action="NONE"
        fp.waypoints[1].camera_action = "PHOTO_CAPTURE"

        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone(name="R1")],
            obstacles=[_make_obstacle(name="Mast")],
        )
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        plan = json.loads(
            export_service.generate_mavlink(fp, "Test", 100.0, geozone_payload=payload).decode(
                "utf-8"
            )
        )
        items = plan["mission"]["items"]
        # 3 nav + 1 camera trigger = 4 SimpleItems
        assert len(items) == 4
        commands = [i["command"] for i in items]
        # MAV_CMD_IMAGE_START_CAPTURE = 2000 follows the mid nav waypoint
        assert commands[2] == 2000
        cam_item = items[2]
        assert cam_item["params"] == [0, 0, 0, 0, 0, 0, 0]
        # MAV_FRAME_MISSION for the non-positional camera trigger
        assert cam_item["frame"] == 2
        # doJumpIds stay monotonic
        assert [i["doJumpId"] for i in items] == [1, 2, 3, 4]

    def test_plan_video_record_pair_emits_both_triggers(self):
        """RECORDING_START / RECORDING_STOP each emit their own SimpleItem."""
        fp = _make_flight_plan(3)
        fp.waypoints[0].camera_action = "RECORDING_START"
        fp.waypoints[2].camera_action = "RECORDING_STOP"

        airport = _make_airport_with_geozones(safety_zones=[_make_safety_zone()])
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        plan = json.loads(
            export_service.generate_mavlink(fp, "Test", 100.0, geozone_payload=payload).decode(
                "utf-8"
            )
        )
        commands = [i["command"] for i in plan["mission"]["items"]]
        # MAV_CMD_VIDEO_START_CAPTURE=2500, MAV_CMD_VIDEO_STOP_CAPTURE=2501
        assert 2500 in commands
        assert 2501 in commands


class TestGeozoneEmissionJson:
    """json emission with geozones."""

    def test_json_includes_geozones_key(self):
        """generate_json adds top-level geozones with safety_zones/obstacles/runway_buffers."""
        fp = _make_flight_plan(2)
        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone()],
            obstacles=[_make_obstacle()],
            surfaces=[_make_surface()],
        )
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=True)
        result = export_service.generate_json(fp, "T", 100.0, geozone_payload=payload)
        data = json.loads(result.decode("utf-8"))
        assert "geozones" in data
        assert {"safety_zones", "obstacles", "runway_buffers"} <= data["geozones"].keys()

    def test_json_byte_identical_without_payload(self):
        """no geozone_payload -> output byte-identical to legacy json."""
        from datetime import datetime, timezone

        fp = _make_flight_plan(2)
        # generate_json defaults to datetime.now() when generated_at is unset,
        # which races between the two calls and produces a false diff.
        fp.generated_at = datetime(2026, 5, 3, 12, 0, 0, tzinfo=timezone.utc)
        legacy = export_service.generate_json(fp, "T", 100.0)
        no_payload = export_service.generate_json(fp, "T", 100.0, geozone_payload=None)
        assert legacy == no_payload


class TestGeozoneEmissionUgcs:
    """ugcs emission with geozones."""

    def test_ugcs_flips_check_custom_nfz_and_emits_list(self):
        """payload bumps checkCustomNfz=True and emits customNfzList polygons."""
        fp = _make_flight_plan(2)
        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone(name="R1")],
            obstacles=[_make_obstacle(name="Mast")],
        )
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        result = export_service.generate_ugcs(fp, "T", 100.0, geozone_payload=payload)
        data = json.loads(result.decode("utf-8"))
        assert data["route"]["checkCustomNfz"] is True
        assert "customNfzList" in data
        assert len(data["customNfzList"]) == 2
        names = [n["name"] for n in data["customNfzList"]]
        assert "R1" in names
        assert "Mast" in names

    def test_ugcs_byte_identical_without_payload(self):
        """no geozone_payload -> output byte-identical to legacy ugcs route."""
        from datetime import datetime, timezone

        fp = _make_flight_plan(2)
        # generate_ugcs falls back to datetime.now() when generated_at is unset,
        # which races between the two calls and produces a false diff.
        fp.generated_at = datetime(2026, 5, 3, 12, 0, 0, tzinfo=timezone.utc)
        legacy = export_service.generate_ugcs(fp, "T", 100.0)
        no_payload = export_service.generate_ugcs(fp, "T", 100.0, geozone_payload=None)
        assert legacy == no_payload
        # legacy default keeps checkCustomNfz=false and no customNfzList sibling
        data = json.loads(no_payload.decode("utf-8"))
        assert data["route"]["checkCustomNfz"] is False
        assert "customNfzList" not in data


class TestGeozoneEmissionKml:
    """kml emission - advisory keep-out folder."""

    def test_kml_appends_keepout_folder_with_advisory_text(self):
        """kml output gains a Keep-out zones folder when payload supplied."""
        fp = _make_flight_plan(2)
        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone(name="R1")],
            obstacles=[_make_obstacle(name="Mast")],
        )
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        result = export_service.generate_kml(fp, "T", 100.0, geozone_payload=payload)
        text = result.decode("utf-8")
        assert "Keep-out zones" in text
        assert "Advisory only" in text
        assert "Safety Zone - R1" in text
        assert "Obstacle - Mast" in text

    def test_kml_no_keepout_section_without_payload(self):
        """no payload -> output has no Keep-out zones folder (legacy shape)."""
        fp = _make_flight_plan(2)
        result = export_service.generate_kml(fp, "T", 100.0)
        text = result.decode("utf-8")
        assert "Keep-out zones" not in text
        assert "Advisory only" not in text


class TestGeozoneEmissionKmz:
    """kmz emission - keep-out folder embedded in template.kml."""

    def test_kmz_template_carries_keepout_folder(self):
        """when payload set, template.kml includes the keep-out folder."""
        fp = _make_flight_plan(2)
        airport = _make_airport_with_geozones(
            safety_zones=[_make_safety_zone(name="R1")],
            obstacles=[_make_obstacle(name="Mast")],
        )
        payload = export_service.build_geozone_payload(airport, include_runway_buffers=False)
        result = _gen_kmz(fp, "T", 100.0, geozone_payload=payload)
        template, _ = _read_wpmz(result)
        assert "Keep-out zones" in template
        assert "Advisory only" in template
        assert "Safety Zone - R1" in template

    def test_kmz_no_keepout_section_without_payload(self):
        """no payload -> kmz template carries no Keep-out zones folder."""
        fp = _make_flight_plan(2)
        template, waylines = _read_wpmz(_gen_kmz(fp, "T", 100.0))
        for content in (template, waylines):
            assert "Keep-out zones" not in content
            assert "Advisory only" not in content


class TestExportMissionContentTypeSwitch:
    """content-type and extension switch for MAVLINK when geozones included."""

    def test_mavlink_default_content_type(self):
        """default MAVLINK export keeps text/plain + .waypoints."""
        ct, ext = export_service._resolve_export_content_type("MAVLINK", with_geozones=False)
        assert ct == "text/plain"
        assert ext == "waypoints"

    def test_mavlink_with_geozones_switches(self):
        """with_geozones flips MAVLINK to application/json + .plan."""
        ct, ext = export_service._resolve_export_content_type("MAVLINK", with_geozones=True)
        assert ct == "application/json"
        assert ext == "plan"

    def test_other_formats_unchanged(self):
        """capable formats other than MAVLINK keep their default content type."""
        for fmt in ("KML", "KMZ", "JSON", "UGCS"):
            with_gz = export_service._resolve_export_content_type(fmt, with_geozones=True)
            without = export_service._resolve_export_content_type(fmt, with_geozones=False)
            assert with_gz == without


class TestExportMissionAltitudeClampGate:
    """export_mission collects below-takeoff KMZ/WPML clamps and gates on ack.

    fixture mirrors `TestDjiBelowTakeoffClamp` (issue #508 mission shape):
    airport_elevation = 300 (the airborne FULL scope anchors the takeoff
    reference at airport ground), one MEASUREMENT below the airport at
    alt 295. clamps to relative 0 -> one clamp record per export.
    """

    def _build(self, *, status="VALIDATED"):
        """return (db, mission, fp) wired through `_build_export_db_mock`."""
        mission = _make_heading_mode_mission("smoothTransition")
        mission.status = status
        mission.name = "Issue 508"
        mission.drone_profile_id = None
        mission.takeoff_coordinate = _make_wkt_point(18.110, 49.690, 300.0)
        mission.flight_plan_scope = "FULL"

        fp = _make_flight_plan(3)
        fp.waypoints[0].position = _make_wkt_point(18.110, 49.690, 300.0)
        fp.waypoints[0].waypoint_type = "TAKEOFF"
        fp.waypoints[1].position = _make_wkt_point(18.115, 49.6905, 295.0)
        fp.waypoints[1].waypoint_type = "MEASUREMENT"
        fp.waypoints[2].position = _make_wkt_point(18.110, 49.690, 300.0)
        fp.waypoints[2].waypoint_type = "LANDING"
        fp.airport_id = uuid4()

        airport = MagicMock()
        airport.elevation = 300.0

        db = _build_export_db_mock(mission, fp, airport)
        return db, mission, fp

    def test_kmz_below_takeoff_collects_clamp_and_raises_409_without_ack(self):
        """ack=false + clamp present -> DomainError(409, extra=altitude_clamps)."""
        from app.core.exceptions import DomainError

        db, mission, _ = self._build()

        with pytest.raises(DomainError) as exc_info:
            export_service.export_mission(db, uuid4(), ["KMZ"])

        assert exc_info.value.status_code == 409
        clamps = exc_info.value.extra["altitude_clamps"]
        assert len(clamps) == 1
        only = clamps[0]
        assert only["waypoint_index"] == 2
        assert only["intended_alt"] == pytest.approx(295.0)
        assert only["clamped_alt"] == pytest.approx(300.0)
        assert only["reason"] == "below_takeoff"
        # rejection path skips status transition and never commits
        mission.transition_to.assert_not_called()
        db.commit.assert_not_called()

    def test_kmz_with_ack_returns_files_and_transitions(self):
        """ack=true returns the bytes and runs the VALIDATED -> EXPORTED transition."""
        db, mission, _ = self._build()

        files, _, clamps = export_service.export_mission(
            db, uuid4(), ["KMZ"], acknowledge_altitude_clamps=True
        )

        assert len(files) == 1
        assert next(iter(files)).endswith(".kmz")
        assert len(clamps) == 1
        mission.transition_to.assert_called_once_with("EXPORTED")

    def test_no_clamps_unchanged_path(self):
        """missions whose waypoints stay above the takeoff ref carry empty clamps."""
        mission = _make_heading_mode_mission("smoothTransition")
        mission.status = "VALIDATED"
        mission.name = "Clean"
        mission.drone_profile_id = None
        mission.flight_plan_scope = "FULL"
        # all waypoints at airport ground - no clamp can fire
        fp = _make_flight_plan(3)
        airport = MagicMock()
        airport.elevation = 100.0
        db = _build_export_db_mock(mission, fp, airport)

        files, _, clamps = export_service.export_mission(db, uuid4(), ["KMZ"])

        assert len(files) == 1
        assert clamps == []
        mission.transition_to.assert_called_once_with("EXPORTED")

    def test_kmz_and_wpml_record_each_waypoint_once(self):
        """requesting both KMZ + WPML lists each below-takeoff WP exactly once.

        guards the in_waylines once-per-WP rule across the two-format dispatch:
        KMZ's template + waylines pass plus the standalone WPML's waylines pass
        could otherwise emit the same waypoint three times.
        """
        db, _, _ = self._build()

        with pytest.raises(Exception) as exc_info:
            export_service.export_mission(db, uuid4(), ["KMZ", "WPML"])

        clamps = exc_info.value.extra["altitude_clamps"]
        indices = [c["waypoint_index"] for c in clamps]
        # one entry per dji file (KMZ + WPML) for the single below-takeoff WP -
        # never three (the template.kml pass must stay silent).
        assert indices == [2, 2]

    def test_non_dji_format_never_collects_clamps(self):
        """JSON export never trips the gate, even with the issue-508 fixture."""
        db, mission, _ = self._build()

        files, _, clamps = export_service.export_mission(db, uuid4(), ["JSON"])

        assert clamps == []
        assert len(files) == 1
        mission.transition_to.assert_called_once_with("EXPORTED")
