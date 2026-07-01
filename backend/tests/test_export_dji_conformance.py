"""shared dji wpml/kmz conformance validator + cross-product coverage matrix.

ground truth for "valid 1.0.6 wpml" is Pilot 2's own real export
(`docs/specs/PAPI 22.kmz`), NOT the public WPML 1.0.2 doc set. the validator
encodes only confirmed-real invariants and never enforces the 1.0.2 doc text -
the six doc-divergent-but-correct constructs (`globalHeight`, `caliFlightEnable`,
`payloadParam` after Placemarks, `globalUseStraightLine`, `payloadSubEnumValue`,
2-D `<coordinates>`) are PRESERVED, with `TestDjiNoFalsePositiveStrip` pinning
their presence so a future "spec fix" cannot strip them.

each validator rule cites the DJI `WaylineCheckError` code it defends against -
codes from `docs/audits/2026-05-26-kmz-review/agent-e1-wayline-check-errors.md`.
"""

import math
import re
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.export.dji.heading import (
    _append_heading_param,
    _body_tracks_target,
    _normalize_heading,
)
from app.services.trajectory.methods.fly_over import calculate_fly_over_path
from app.services.trajectory.types import Point3D, ResolvedConfig
from app.utils.geo import bearing_between, distance_between, point_at_distance
from tests.test_export_service import (
    _gen_kmz,
    _gen_wpml,
    _make_inspection_mock,
    _make_mission_mock,
    _make_waypoint,
    _make_wkt_point,
    _read_wpmz,
)

_KML_NS = "http://www.opengis.net/kml/2.2"
_WPML_NS = "http://www.dji.com/wpmz/1.0.6"
_NS = {"kml": _KML_NS, "wpml": _WPML_NS}

# wpml 1.0.6 spec ceilings / floors (agent-e1-wayline-check-errors.md).
# globalTransitionalSpeed range is [0, 15] inclusive (-7 TransitionalSpeedOutOfRange);
# the writer stays strictly below it but the validator accepts the spec bound.
_GLOBAL_TRANSITIONAL_SPEED_CEILING = 15.0
# waypointSpeed range is (0, max_drone_speed]; M4T max_speed is 21, so a 30 m/s
# ceiling is generous - the rule that bites is the strict `> 0` lower bound (-6).
_MAX_WAYPOINT_SPEED = 30.0
_RTH_MIN_M = 2  # wpml globalRTHHeight range is [2, 1500]
_RTH_MAX_M = 1500
_MIN_TAKEOFF_SECURITY_HEIGHT_M = 1.2  # wpml [1.2, 1500] (-15 InvalidSecurityTakeOffHeight)
_VALID_HEADING_MODES = {"smoothTransition", "towardPOI", "followWayline"}
_VALID_EXECUTE_HEIGHT_MODES = {"relativeToStartPoint", "EGM96", "WGS84"}
_USE_GLOBAL_TAGS = (
    "useGlobalSpeed",
    "useGlobalHeight",
    "useGlobalHeadingParam",
    "useGlobalTurnParam",
)
# float slack for the damping `<=` segment-length bound.
_DAMPING_EPS = 1e-6


def _w(name: str) -> str:
    """qualify an element name with the dji wpml namespace."""
    return f"{{{_WPML_NS}}}{name}"


def _placemark_lonlat(pm) -> tuple[float, float]:
    """parse a placemark's 2-D `<coordinates>` text into (lon, lat)."""
    text = pm.findtext("kml:Point/kml:coordinates", namespaces=_NS)
    lon_str, lat_str = text.split(",")[:2]
    return float(lon_str), float(lat_str)


def _placemark_height(pm, *, is_waylines: bool) -> float:
    """per-placemark height in the takeoff-relative frame.

    waylines carry `executeHeight`; the template carries `height` (same frame).
    """
    tag = "executeHeight" if is_waylines else "height"
    return float(pm.findtext(f"wpml:{tag}", namespaces=_NS))


def _nearest_legs(placemarks, *, is_waylines: bool) -> list[float | None]:
    """per-placemark shortest positive adjacent 3-D leg, mirroring the writer.

    matches `placemark._nearest_leg_lengths`: zero-length legs are excluded, so
    a placemark with no positive adjacent leg gets `None` (the writer falls
    back to stop-mode damping there, and the `(0, segment]` upper bound does
    not apply).
    """
    coords = []
    for pm in placemarks:
        lon, lat = _placemark_lonlat(pm)
        coords.append((lon, lat, _placemark_height(pm, is_waylines=is_waylines)))
    legs: list[float] = []
    for (lon1, lat1, h1), (lon2, lat2, h2) in zip(coords, coords[1:]):
        legs.append(math.hypot(distance_between(lon1, lat1, lon2, lat2), h2 - h1))
    nearest: list[float | None] = []
    for i in range(len(coords)):
        candidates = []
        if i > 0 and legs[i - 1] > 0:
            candidates.append(legs[i - 1])
        if i < len(legs) and legs[i] > 0:
            candidates.append(legs[i])
        nearest.append(min(candidates) if candidates else None)
    return nearest


def assert_valid_dji_wpml(
    xml: str,
    *,
    kind: str | None = None,
    max_waypoint_speed: float = _MAX_WAYPOINT_SPEED,
) -> None:
    """assert one WPML document (template.kml or waylines.wpml) is spec-valid.

    encodes the confirmed-real 1.0.6 invariants from issue #777. `kind`
    (`"template"` | `"waylines"`) is auto-detected from the presence of a
    folder-level `executeHeightMode` when not supplied. each block cites the
    DJI `WaylineCheckError` code it defends against.
    """
    root = ET.fromstring(xml)
    has_execute_mode = root.find(".//wpml:executeHeightMode", _NS) is not None
    if kind is None:
        kind = "waylines" if has_execute_mode else "template"
    is_waylines = kind == "waylines"

    placemarks = root.findall(".//kml:Placemark", _NS)
    assert placemarks, f"{kind}: expected at least one Placemark"
    max_index = len(placemarks) - 1

    # -16 InvalidWaypointPointIndex: wpml:index 0-indexed and contiguous from 0.
    indices = [pm.findtext("wpml:index", namespaces=_NS) for pm in placemarks]
    assert indices == [str(i) for i in range(len(placemarks))], (
        f"{kind}: wpml:index not 0-indexed contiguous: {indices}"
    )

    # -6 WaypointSpeedOutOfRange: per-WP waypointSpeed strictly in (0, max].
    speeds = [float(el.text) for el in root.findall(".//kml:Placemark/wpml:waypointSpeed", _NS)]
    assert len(speeds) == len(placemarks), f"{kind}: every placemark needs a waypointSpeed"
    for s in speeds:
        assert 0 < s <= max_waypoint_speed, (
            f"{kind}: waypointSpeed {s} outside (0, {max_waypoint_speed}]"
        )

    # autoFlightSpeed is folder-level; same positive band as waypointSpeed.
    for el in root.findall(".//wpml:autoFlightSpeed", _NS):
        v = float(el.text)
        assert 0 < v <= max_waypoint_speed, (
            f"{kind}: autoFlightSpeed {v} outside (0, {max_waypoint_speed}]"
        )

    # -8 DampintDistOutOfRange: waypointTurnDampingDist in (0, nearest-leg].
    nearest = _nearest_legs(placemarks, is_waylines=is_waylines)
    for pm, near in zip(placemarks, nearest):
        damping_el = pm.find("wpml:waypointTurnParam/wpml:waypointTurnDampingDist", _NS)
        if damping_el is None:
            continue
        dist = float(damping_el.text)
        assert dist > 0, f"{kind}: waypointTurnDampingDist {dist} not > 0"
        if near is not None:
            assert dist <= near + _DAMPING_EPS, (
                f"{kind}: waypointTurnDampingDist {dist} exceeds nearest leg {near}"
            )

    # actionGroup refs + ids.
    group_ids: list[int] = []
    for group in root.findall(".//wpml:actionGroup", _NS):
        gid = int(group.findtext("wpml:actionGroupId", namespaces=_NS))
        # actionGroupId is an opaque key but the spec still caps it at [0, 65535].
        assert 0 <= gid <= 65535, f"{kind}: actionGroupId {gid} out of [0, 65535]"
        group_ids.append(gid)
        # -16 InvalidWaypointPointIndex: action refs are 0-indexed and in range.
        start = int(group.findtext("wpml:actionGroupStartIndex", namespaces=_NS))
        end = int(group.findtext("wpml:actionGroupEndIndex", namespaces=_NS))
        assert 0 <= start <= end <= max_index, (
            f"{kind}: actionGroup [{start}, {end}] outside [0, {max_index}]"
        )
    assert len(group_ids) == len(set(group_ids)), f"{kind}: duplicate actionGroupId in {group_ids}"

    # -10 InvalidHeadingMode: waypointHeadingMode in the valid set; the
    # waypointPoiPoint element is present iff the mode is towardPOI (absent for
    # followWayline / smoothTransition - a stray zero sentinel reads as a real
    # mis-positioned POI to a strict validator).
    for el in root.iter():
        if el.tag not in (_w("waypointHeadingParam"), _w("globalWaypointHeadingParam")):
            continue
        mode = el.findtext("wpml:waypointHeadingMode", namespaces=_NS)
        assert mode in _VALID_HEADING_MODES, f"{kind}: invalid heading mode {mode!r}"
        poi_present = el.find("wpml:waypointPoiPoint", _NS) is not None
        assert poi_present == (mode == "towardPOI"), (
            f"{kind}: waypointPoiPoint presence ({poi_present}) must match towardPOI ({mode})"
        )

    # 261 InvalidExecuteAltitudeMode: waylines declare executeHeightMode;
    # template declares heightMode (in waylineCoordinateSysParam) and never
    # executeHeightMode.
    if is_waylines:
        mode = root.findtext(".//wpml:executeHeightMode", namespaces=_NS)
        assert mode in _VALID_EXECUTE_HEIGHT_MODES, f"waylines: invalid executeHeightMode {mode!r}"
        # waylines placemarks omit all four useGlobal* flags (already executable).
        for pm in placemarks:
            for tag in _USE_GLOBAL_TAGS:
                assert pm.find(f"wpml:{tag}", _NS) is None, (
                    f"waylines: placemark must omit wpml:{tag}"
                )
    else:
        assert root.find(".//wpml:waylineCoordinateSysParam/wpml:heightMode", _NS) is not None, (
            "template: missing waylineCoordinateSysParam/heightMode"
        )
        assert not has_execute_mode, "template: must not declare executeHeightMode"
        # every template placemark emits the four required useGlobal* flags.
        for pm in placemarks:
            idx = pm.findtext("wpml:index", namespaces=_NS)
            for tag in _USE_GLOBAL_TAGS:
                v = pm.findtext(f"wpml:{tag}", namespaces=_NS)
                assert v in ("0", "1"), f"template: placemark {idx} missing/invalid wpml:{tag}"

    # missionConfig range checks.
    config = root.find(".//wpml:missionConfig", _NS)
    assert config is not None, f"{kind}: missing missionConfig"
    # -15 InvalidSecurityTakeOffHeight: takeOffSecurityHeight >= 1.2 m.
    tsh = float(config.findtext("wpml:takeOffSecurityHeight", namespaces=_NS))
    assert tsh >= _MIN_TAKEOFF_SECURITY_HEIGHT_M, (
        f"{kind}: takeOffSecurityHeight {tsh} below {_MIN_TAKEOFF_SECURITY_HEIGHT_M}"
    )
    # -7 TransitionalSpeedOutOfRange / -14 InvalidTransitionalSpeed:
    # globalTransitionalSpeed strictly positive and within the spec ceiling.
    gts = float(config.findtext("wpml:globalTransitionalSpeed", namespaces=_NS))
    assert 0 < gts <= _GLOBAL_TRANSITIONAL_SPEED_CEILING, (
        f"{kind}: globalTransitionalSpeed {gts} outside (0, {_GLOBAL_TRANSITIONAL_SPEED_CEILING}]"
    )

    if is_waylines:
        # globalRTHHeight within [2, 1500] AND >= the route peak (max
        # executeHeight) so RTH never drops below the highest waypoint - DJI
        # rejects "RTH altitude lower than the highest point of flight route".
        rth = int(config.findtext("wpml:globalRTHHeight", namespaces=_NS))
        assert _RTH_MIN_M <= rth <= _RTH_MAX_M, f"waylines: globalRTHHeight {rth} outside clamp"
        peak = max(_placemark_height(pm, is_waylines=True) for pm in placemarks)
        assert rth >= peak, f"waylines: globalRTHHeight {rth} below route peak {peak}"


def assert_valid_dji_kmz(data: bytes, *, max_waypoint_speed: float = _MAX_WAYPOINT_SPEED) -> None:
    """assert a KMZ archive carries BOTH wpmz layers and both are spec-valid.

    FlightHub 2 rejects a template-only archive ("Format error. Failed to
    upload."), so the pair is mandatory (empirically confirmed 2026-05-28).
    """
    buf = BytesIO(data)
    assert zipfile.is_zipfile(buf), "not a zip archive"
    with zipfile.ZipFile(buf) as zf:
        names = set(zf.namelist())
        assert "wpmz/template.kml" in names, "kmz missing wpmz/template.kml"
        assert "wpmz/waylines.wpml" in names, "kmz missing wpmz/waylines.wpml"
        template = zf.read("wpmz/template.kml").decode("utf-8")
        waylines = zf.read("wpmz/waylines.wpml").decode("utf-8")
    assert_valid_dji_wpml(template, kind="template", max_waypoint_speed=max_waypoint_speed)
    assert_valid_dji_wpml(waylines, kind="waylines", max_waypoint_speed=max_waypoint_speed)


# --- coverage-matrix fixtures ------------------------------------------------
#
# the matrix exercises every inspection method (VP/HR already covered by
# _make_vp_video_pass / _make_hr_video_pass in test_export_service; this file
# adds AD/HPL/MEHT/FO/PSS). the export only branches on method through the
# VP/HR video smooth-turn predicates, so the other methods emit the per-WP
# snap shape - the matrix's job is to prove every cell produces a spec-valid
# archive, not to re-test method geometry.

_LON0, _LAT0 = 18.11, 49.69
_GROUND = 290.0
_BODY_TRACKS_METHODS = (
    "VERTICAL_PROFILE",
    "HORIZONTAL_RANGE",
    "APPROACH_DESCENT",
    "MEHT_CHECK",
    "HOVER_POINT_LOCK",
    "FLY_OVER",
    "SURFACE_SCAN",
)
# only PARALLEL_SIDE_SWEEP offsets laterally; FLY_OVER and SURFACE_SCAN axially
# back-offset so the target sits dead ahead and they body-track like the PAPI
# methods.
_ROW_METHODS = ("PARALLEL_SIDE_SWEEP",)
_ALL_METHODS = _BODY_TRACKS_METHODS + _ROW_METHODS


def _method_measurements(method: str, n: int) -> list[tuple]:
    """per-method (lon, lat, alt, heading, gimbal_pitch, camera_target) rows.

    body-tracks methods (VP/HR/AD/MEHT/HPL/FO/SS) set heading to the bearing
    toward the LHA so the smoothTransition predicate emits a per-WP angle;
    FLY_OVER and SURFACE_SCAN get there via the generator's axial back-offset
    (target dead ahead along the row/run). the lone row method
    PARALLEL_SIDE_SWEEP offsets laterally so its heading is ~90 deg off the
    bearing-to-LHA and the predicate falls back to followWayline.
    """
    target_lon, target_lat = _LON0 + 0.001, _LAT0
    target = _make_wkt_point(target_lon, target_lat, _GROUND)
    rows: list[tuple] = []

    if method == "VERTICAL_PROFILE":
        lon, lat = _LON0, _LAT0
        heading = bearing_between(lon, lat, target_lon, target_lat)
        for i in range(n):
            rows.append((lon, lat, _GROUND + 10 + i * 3, heading, round(-1.0 - i, 4), target))
    elif method in ("HORIZONTAL_RANGE", "MEHT_CHECK"):
        radius = 200.0
        for i in range(n):
            bearing_deg = 60.0 + (120.0 - 60.0) * i / max(1, n - 1)
            lon, lat = point_at_distance(target_lon, target_lat, bearing_deg, radius)
            heading = bearing_between(lon, lat, target_lon, target_lat)
            rows.append((lon, lat, _GROUND + 60, heading, round(-3.0 + 0.05 * i, 4), target))
    elif method == "APPROACH_DESCENT":
        # descending straight line approaching the LHA from the west.
        for i in range(n):
            lon, lat = point_at_distance(target_lon, target_lat, 270.0, 300.0 - i * 50.0)
            heading = bearing_between(lon, lat, target_lon, target_lat)
            rows.append((lon, lat, _GROUND + 40 - i * 6, heading, round(-3.0 - i * 0.5, 4), target))
    elif method == "HOVER_POINT_LOCK":
        # collocated hover on top of the LHA: position == target lon/lat, so
        # bearing-to-self is 0 and heading 0 takes the body-tracks-target path
        # (the C4 P1-3 undefined-bearing shape).
        for _ in range(n):
            rows.append((target_lon, target_lat, _GROUND + 30, 0.0, -45.0, target))
    elif method in ("FLY_OVER", "SURFACE_SCAN"):
        # row/run of LHAs along an east-west edge; the generator back-offsets
        # each waypoint along the reverse heading so the tilted optical axis
        # lands on the target. mirror that: the target sits dead ahead along the
        # row/run (due east), so bearing(wp -> target) == heading and the body
        # tracks it. surface scan flies a serpentine of the same shape.
        back_offset_deg = 0.0001
        for i in range(n):
            lha_lon = _LON0 + i * 0.0003
            lha = _make_wkt_point(lha_lon, _LAT0, _GROUND)
            rows.append((lha_lon - back_offset_deg, _LAT0, _GROUND + 15, 90.0, -70.0, lha))
    elif method == "PARALLEL_SIDE_SWEEP":
        # row of LHAs along an east-west edge; the lateral offset puts each
        # waypoint due north of the LHA it frames, so heading (due east along
        # the row) sits ~90 deg off the bearing-to-LHA -> followWayline.
        for i in range(n):
            lon = _LON0 + i * 0.0003
            lha = _make_wkt_point(lon, _LAT0 - 0.0002, _GROUND)
            rows.append((lon, _LAT0 + 0.0003, _GROUND + 15, 90.0, -70.0, lha))
    else:  # pragma: no cover - guard against an unmapped method
        raise ValueError(f"unmapped method {method}")
    return rows


def _make_method_pass(method: str, capture_mode: str, *, num_measurements: int = 4):
    """build a (flight_plan, mission) pair for one (method, capture_mode) cell.

    FULL shape: TAKEOFF, measurements, LANDING. VIDEO capture rides the
    recording start/stop on the first/last measurement (the merged-bookend
    shape); PHOTO capture emits a takePhoto per measurement.
    """
    insp_id = uuid4()
    insp = _make_inspection_mock(insp_id, method, capture_mode)

    waypoints = [_make_waypoint(seq=1, lon=_LON0, lat=_LAT0, alt=_GROUND + 5, wp_type="TAKEOFF")]
    seq = 2
    for lon, lat, alt, heading, gimbal, target in _method_measurements(method, num_measurements):
        wp = _make_waypoint(seq=seq, lon=lon, lat=lat, alt=alt, wp_type="MEASUREMENT")
        wp.heading = heading
        wp.gimbal_pitch = gimbal
        wp.camera_target = target
        wp.inspection_id = insp_id
        wp.camera_action = "PHOTO_CAPTURE" if capture_mode == "PHOTO_CAPTURE" else "RECORDING"
        waypoints.append(wp)
        seq += 1

    if capture_mode == "VIDEO_CAPTURE":
        waypoints[1].camera_action = "RECORDING_START"
        waypoints[1].hover_duration = 3
        waypoints[-1].camera_action = "RECORDING_STOP"
        waypoints[-1].hover_duration = 3

    waypoints.append(
        _make_waypoint(seq=seq, lon=_LON0, lat=_LAT0, alt=_GROUND + 5, wp_type="LANDING")
    )

    fp = MagicMock()
    fp.mission_id = uuid4()
    fp.airport_id = uuid4()
    fp.total_distance = 200.0
    fp.estimated_duration = 90.0
    fp.generated_at = None
    fp.waypoints = waypoints

    mission = _make_mission_mock(inspections=[insp], default_capture_mode=capture_mode)
    return fp, mission


def _measurements_only(fp):
    """strip TAKEOFF/LANDING and renumber - the MEASUREMENTS_ONLY airborne slice."""
    kept = [wp for wp in fp.waypoints if wp.waypoint_type not in ("TAKEOFF", "LANDING")]
    for i, wp in enumerate(kept, start=1):
        wp.sequence_order = i
    mo = MagicMock()
    mo.mission_id = fp.mission_id
    mo.airport_id = fp.airport_id
    mo.total_distance = fp.total_distance
    mo.estimated_duration = fp.estimated_duration
    mo.generated_at = None
    mo.waypoints = kept
    return mo


def _placemark_heading_modes(wpml: str) -> list[str]:
    """heading mode emitted on each placemark's waypointHeadingParam block."""
    root = ET.fromstring(wpml)
    modes: list[str] = []
    for pm in root.findall(".//kml:Placemark", _NS):
        mode = pm.findtext("wpml:waypointHeadingParam/wpml:waypointHeadingMode", namespaces=_NS)
        if mode is not None:
            modes.append(mode)
    return modes


class TestDjiWpmlValidator:
    """positive + per-rule negative coverage for the shared validator itself."""

    def test_papi22_shaped_export_passes(self):
        """a real HR-video KMZ passes both template + waylines validation."""
        fp, mission = _make_method_pass("HORIZONTAL_RANGE", "VIDEO_CAPTURE")
        kmz = _gen_kmz(fp, "Test", _GROUND, mission=mission)

        assert_valid_dji_kmz(kmz)
        template, waylines = _read_wpmz(kmz)
        assert_valid_dji_wpml(template, kind="template")
        assert_valid_dji_wpml(waylines, kind="waylines")

    def _valid_waylines(self, method="HORIZONTAL_RANGE", capture="VIDEO_CAPTURE", **gen_kwargs):
        """generate one spec-valid waylines.wpml to mutate in the negative tests."""
        fp, mission = _make_method_pass(method, capture)
        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission, **gen_kwargs))
        return waylines

    def test_zero_waypoint_speed_trips_validator(self):
        """a waypointSpeed of 0 fails (-6 WaypointSpeedOutOfRange)."""
        waylines = self._valid_waylines()
        broken = waylines.replace(
            "<wpml:waypointSpeed>5</wpml:waypointSpeed>",
            "<wpml:waypointSpeed>0</wpml:waypointSpeed>",
            1,
        )
        assert broken != waylines
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")

    def test_duplicate_action_group_id_trips_validator(self):
        """a duplicate actionGroupId fails the per-file uniqueness rule."""
        waylines = self._valid_waylines()
        ids = [el.text for el in ET.fromstring(waylines).findall(".//wpml:actionGroupId", _NS)]
        distinct = sorted(set(ids), key=int)
        assert len(distinct) >= 2, "fixture needs >= 2 distinct actionGroupId"
        broken = waylines.replace(
            f"<wpml:actionGroupId>{distinct[1]}</wpml:actionGroupId>",
            f"<wpml:actionGroupId>{distinct[0]}</wpml:actionGroupId>",
            1,
        )
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")

    def test_one_indexed_wpml_index_trips_validator(self):
        """a 1-indexed first wpml:index fails the contiguity rule (-16)."""
        waylines = self._valid_waylines()
        broken = waylines.replace("<wpml:index>0</wpml:index>", "<wpml:index>1</wpml:index>", 1)
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")

    def test_rth_below_route_peak_trips_validator(self):
        """a globalRTHHeight below the route peak fails even when within clamp."""
        # high VP climb so the route peak is well above the spec RTH floor and
        # the only rule a low RTH can break is the route-peak check.
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "PHOTO_CAPTURE")
        measurements = [wp for wp in fp.waypoints if wp.waypoint_type == "MEASUREMENT"]
        for i, wp in enumerate(measurements):
            wp.position = _make_wkt_point(_LON0, _LAT0, _GROUND + 400 + i * 10)
        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))
        rth = int(ET.fromstring(waylines).findtext(".//wpml:globalRTHHeight", namespaces=_NS))
        assert rth > _RTH_MIN_M, "fixture must drive RTH above the spec floor"
        broken = waylines.replace(
            f"<wpml:globalRTHHeight>{rth}</wpml:globalRTHHeight>",
            f"<wpml:globalRTHHeight>{_RTH_MIN_M}</wpml:globalRTHHeight>",
        )
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")

    def test_below_min_takeoff_security_height_trips_validator(self):
        """a takeOffSecurityHeight of 0.5 m fails (-15 InvalidSecurityTakeOffHeight)."""
        waylines = self._valid_waylines()
        broken = waylines.replace(
            "<wpml:takeOffSecurityHeight>1.5</wpml:takeOffSecurityHeight>",
            "<wpml:takeOffSecurityHeight>0.5</wpml:takeOffSecurityHeight>",
        )
        assert broken != waylines
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")

    def test_toward_poi_without_poi_point_trips_validator(self):
        """a towardPOI heading block missing waypointPoiPoint fails (-10)."""
        waylines = self._valid_waylines(heading_mode_override="towardPOI")
        assert "towardPOI" in waylines
        broken = re.sub(
            r"<wpml:waypointPoiPoint>[^<]*</wpml:waypointPoiPoint>", "", waylines, count=1
        )
        assert broken != waylines
        with pytest.raises(AssertionError):
            assert_valid_dji_wpml(broken, kind="waylines")


class TestDjiKmzContainer:
    """the empirically-required wpmz/template.kml + wpmz/waylines.wpml pair."""

    def test_both_layer_archive_passes(self):
        """a normal export carries both wpmz layers."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        assert_valid_dji_kmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

    def test_template_only_archive_is_rejected(self):
        """a template-only blob raises (FlightHub 2 refuses the import)."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, _ = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("wpmz/template.kml", template)

        with pytest.raises(AssertionError):
            assert_valid_dji_kmz(buf.getvalue())


class TestDjiCoverageMatrix:
    """heading x scope x capture x method cross-product over the shared validator.

    3 heading modes x {FULL, MEASUREMENTS_ONLY} x {PHOTO, VIDEO} x 8 methods =
    96 cells, explicitly including the previously-untested HOVER_POINT_LOCK,
    APPROACH_DESCENT (agent-d2-coverage-matrix.md), and the row-direction
    SURFACE_SCAN. raises the cell coverage materially.
    """

    @pytest.mark.parametrize("heading_mode", sorted(_VALID_HEADING_MODES))
    @pytest.mark.parametrize("scope", ["FULL", "MEASUREMENTS_ONLY"])
    @pytest.mark.parametrize("capture_mode", ["PHOTO_CAPTURE", "VIDEO_CAPTURE"])
    @pytest.mark.parametrize("method", _ALL_METHODS)
    def test_cell_exports_valid_kmz(self, heading_mode, scope, capture_mode, method):
        """every matrix cell exports a spec-valid KMZ (both wpmz layers)."""
        fp, mission = _make_method_pass(method, capture_mode)
        mission.dji_heading_mode = heading_mode
        if scope == "MEASUREMENTS_ONLY":
            fp = _measurements_only(fp)

        kmz = _gen_kmz(fp, "Test", _GROUND, mission=mission, scope=scope)
        assert_valid_dji_kmz(kmz)

    @pytest.mark.parametrize("method", ["HOVER_POINT_LOCK", "APPROACH_DESCENT"])
    def test_previously_untested_methods_export_valid_wpml(self, method):
        """HOVER_POINT_LOCK + APPROACH_DESCENT also validate via generate_wpml."""
        fp, mission = _make_method_pass(method, "VIDEO_CAPTURE")
        waylines = _gen_wpml(fp, "Test", _GROUND, mission=mission)
        assert_valid_dji_wpml(waylines, kind="waylines")


class TestDjiHeadingBranchPerMethod:
    """asserts each method emits the heading branch the generator actually flies.

    the coverage matrix proves every cell is spec-valid; this pins WHICH branch
    each method lands in per heading mode. FLY_OVER's axial back-offset puts the
    LHA dead ahead, so it body-tracks the target (smoothTransition) - only the
    laterally-offset PARALLEL_SIDE_SWEEP falls back to followWayline.
    """

    @pytest.mark.parametrize("method", _ALL_METHODS)
    @pytest.mark.parametrize("heading_mode", sorted(_VALID_HEADING_MODES))
    def test_method_emits_expected_heading_block(self, method, heading_mode):
        """per (method, mode), aimed placemarks land in the documented branch."""
        fp, mission = _make_method_pass(method, "PHOTO_CAPTURE")
        mission.dji_heading_mode = heading_mode
        _, waylines = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))
        modes = set(_placemark_heading_modes(waylines))

        if heading_mode == "followWayline":
            # every placemark (aimed and non-aimed) inherits the global block.
            assert modes == {"followWayline"}
        elif heading_mode == "towardPOI":
            # aimed measurements track the LHA; takeoff/landing stay followWayline.
            assert "towardPOI" in modes
            assert "smoothTransition" not in modes
        else:  # smoothTransition
            assert "towardPOI" not in modes
            if method in _BODY_TRACKS_METHODS:
                assert "smoothTransition" in modes
            else:
                # PARALLEL_SIDE_SWEEP: heading ~90 deg off bearing-to-LHA, so the
                # predicate fails and every placemark stays on followWayline.
                assert modes == {"followWayline"}


def test_real_fly_over_emits_smooth_transition():
    """bridge real calculate_fly_over_path output through the heading dispatch.

    closes the seam between the FLY_OVER generator and `_append_heading_param`:
    a due-east row of LHAs back-offsets each waypoint along the reverse heading
    so the LHA sits dead ahead, `_body_tracks_target` is True, and the default
    smoothTransition mode emits a per-WP waypointHeadingAngle ~= the row bearing
    (NOT the followWayline block the docs/fixture previously claimed).
    """
    lhas = [Point3D(lon=_LON0 + i * 0.0003, lat=_LAT0, alt=_GROUND) for i in range(3)]
    waypoints = calculate_fly_over_path(lhas, ResolvedConfig(), uuid4(), 5.0)
    row_bearing = bearing_between(lhas[0].lon, lhas[0].lat, lhas[-1].lon, lhas[-1].lat)
    expected_angle = _normalize_heading(row_bearing)

    assert waypoints, "generator must produce at least one waypoint"
    for wp_data in waypoints:
        ct = wp_data.camera_target
        wp = MagicMock()
        wp.waypoint_type = "MEASUREMENT"
        wp.heading = wp_data.heading
        wp.position = _make_wkt_point(wp_data.lon, wp_data.lat, wp_data.alt)
        wp.camera_target = _make_wkt_point(ct.lon, ct.lat, ct.alt)

        assert _body_tracks_target(wp) is True

        parent = ET.Element("Placemark")
        _append_heading_param(parent, wp, in_waylines=True, mode="smoothTransition")
        param = parent.find("wpml:waypointHeadingParam", _NS)
        assert param.findtext("wpml:waypointHeadingMode", namespaces=_NS) == "smoothTransition"
        angle = float(param.findtext("wpml:waypointHeadingAngle", namespaces=_NS))
        assert angle == pytest.approx(expected_angle, abs=0.5)


class TestDjiNoFalsePositiveStrip:
    """guards the six doc-divergent-but-correct constructs against a future 'fix'.

    ground truth is `docs/specs/PAPI 22.kmz`; the public WPML 1.0.2 docs flag
    these as out-of-spec, but Pilot 2 emits them and a strict-doc "fix" would
    break real FH2 imports (docs/audits/2026-05-26-kmz-export-review.md ->
    "False positives").
    """

    def test_template_keeps_global_height_and_cali_flight_enable(self):
        """globalHeight + caliFlightEnable stay in the template Folder (PAPI 22)."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, _ = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        assert "<wpml:globalHeight>" in template
        assert "<wpml:caliFlightEnable>" in template

    def test_template_keeps_global_use_straight_line_under_stop_turn(self):
        """globalUseStraightLine stays even under a stop-mode turn (PAPI 22)."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, _ = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        assert "<wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>" in template

    def test_payload_param_emitted_after_placemarks(self):
        """payloadParam is emitted AFTER the Placemarks in the template (PAPI 22)."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, _ = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        assert "<wpml:payloadParam>" in template
        assert template.rindex("</Placemark>") < template.index("<wpml:payloadParam>")

    def test_mission_config_keeps_payload_sub_enum_value(self):
        """the three-child payloadSubEnumValue block stays in both files (PAPI 22)."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        for content in (template, waylines):
            assert "<wpml:payloadSubEnumValue>" in content

    def test_placemark_coordinates_are_two_dimensional(self):
        """Placemark <coordinates> carry 2-D lon,lat only - altitude lives in height fields."""
        fp, mission = _make_method_pass("VERTICAL_PROFILE", "VIDEO_CAPTURE")
        template, waylines = _read_wpmz(_gen_kmz(fp, "Test", _GROUND, mission=mission))

        for content in (template, waylines):
            root = ET.fromstring(content)
            coord_els = root.findall(".//kml:Placemark/kml:Point/kml:coordinates", _NS)
            assert coord_els
            for el in coord_els:
                assert len(el.text.split(",")) == 2, f"expected 2-D coords, got {el.text!r}"
