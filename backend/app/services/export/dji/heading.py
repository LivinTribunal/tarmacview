"""dji wpml heading/yaw resolution + per-placemark waypointHeadingParam."""

import xml.etree.ElementTree as ET

from app.core.geometry import point_lonlatalt
from app.utils.geo import bearing_between

from ..shared import _sub_text, _wpml_tag

_AIMED_WAYPOINT_TYPES = {"MEASUREMENT", "HOVER"}

# tolerance used by `_body_tracks_target` to decide whether wp.heading is the
# bearing-to-camera-target (HR / VP / HOVER_POINT_LOCK / MEHT_CHECK / FLY_OVER
# shape) or the row direction (PARALLEL_SIDE_SWEEP shape). HR/VP set heading via
# bearing_between(wp_pos, lha_center) directly, and FLY_OVER back-offsets each
# waypoint along the row axis so the LHA sits dead ahead - both leave the diff
# sub-degree under normal operation. PARALLEL_SIDE_SWEEP offsets laterally, so
# its heading is the row direction, typically ~90° off bearing-to-LHA. 5° is
# generous on the body-tracks side and leaves a wide margin before any
# side-sweep waypoint could be misclassified.
_BODY_TRACKS_TARGET_TOLERANCE_DEG = 5.0

# valid dji heading mode values, kept in sync with the model + migration.
_DJI_HEADING_MODES = ("smoothTransition", "towardPOI", "followWayline")


def _aims_at_target(wp) -> bool:
    """true when the waypoint needs to rotate the aircraft toward a target.

    only measurement/hover points have a camera target - takeoff, landing,
    and transit points should keep the aircraft pointing along the flight
    direction (followWayline), not rotated toward the stored heading.
    """
    return wp.waypoint_type in _AIMED_WAYPOINT_TYPES and wp.camera_target is not None


def _body_tracks_target(wp) -> bool:
    """true when wp.heading is the bearing from wp.position to wp.camera_target.

    HORIZONTAL_RANGE, VERTICAL_PROFILE, HOVER_POINT_LOCK, and MEHT_CHECK
    methods all set wp.heading to bearing_between(wp_pos, target) so the
    drone body faces the target during the measurement. FLY_OVER and SURFACE_SCAN
    back-offset each waypoint along the row/run axis (no lateral component), so the
    target sits dead ahead and wp.heading - the row/run bearing - equals
    bearing(wp -> target); they too track the target. PARALLEL_SIDE_SWEEP offsets
    laterally instead, so its heading is the row direction (~90° off bearing-to-LHA)
    and the body flies along the row while the gimbal pitch frames the LHA.

    smoothTransition heading mode emits per-WP waypointHeadingAngle = wp.heading
    only for the body-tracks-target case; for the row-direction
    PARALLEL_SIDE_SWEEP it falls back to followWayline so the body keeps the
    row line.

    edge case: a HR/VP waypoint that was rerouted by `resolve_inspection_collisions`
    inherits the original wp.heading but sits at a new (lon, lat). the
    resolver does not recompute heading toward the camera_target (deliberate -
    see services/CLAUDE.md "metadata inheritance" gotcha), so the predicate may
    classify the rerouted WP as row-direction and emit followWayline for that
    single WP. the result is one snap mid-arc - cosmetic, not a safety issue.
    """
    if not _aims_at_target(wp):
        return False
    if wp.heading is None:
        return False
    try:
        wp_lon, wp_lat, _ = point_lonlatalt(wp.position)
        ct_lon, ct_lat, _ = point_lonlatalt(wp.camera_target)
    except (ValueError, AttributeError):
        return False
    bearing = bearing_between(wp_lon, wp_lat, ct_lon, ct_lat)
    delta = ((wp.heading - bearing + 180.0) % 360.0) - 180.0
    return abs(delta) <= _BODY_TRACKS_TARGET_TOLERANCE_DEG


def _dji_heading_mode(mission, override: str | None = None) -> str:
    """resolve the active dji heading mode for an export.

    resolution chain: explicit per-export `override` (when in the valid set) ->
    persisted `mission.dji_heading_mode` column (when in the valid set) ->
    `smoothTransition` default. the default is the documented all-models mode
    that interpolates body yaw between per-WP angles without runtime POI math.
    towardPOI is experimental continuous POI tracking; followWayline is the
    proven snap fallback that pairs with per-WP rotateYaw actions.
    """
    if override in _DJI_HEADING_MODES:
        return override
    value = getattr(mission, "dji_heading_mode", None)
    if value in _DJI_HEADING_MODES:
        return value
    return "smoothTransition"


def _normalize_heading(heading: float) -> float:
    """wrap a compass bearing into dji's [-180, 180] range.

    bearing_between returns [0, 360); dji's aircraftHeading expects
    [-180, 180]. a raw 202° becomes -158° (same physical direction).
    """
    return ((heading + 180.0) % 360.0) - 180.0


def _emits_followwayline_block(wp, mode: str) -> bool:
    """true when this placemark's heading-param block matches the global followWayline.

    used both to decide whether to emit `useGlobalHeadingParam=1` on a
    template placemark (matching means yes) and to decide whether
    `_append_action_group` should fire the per-WP `rotateYaw` snap (matching
    means yes - the body needs to be turned at the WP since the global block
    only follows the wayline).

    - `followWayline` mode: every placemark uses the global block.
    - `towardPOI` mode: aimed placemarks override (towardPOI), others match.
    - `smoothTransition` mode: aimed AND body-tracks-target placemarks
      override (per-WP smoothTransition + waypointHeadingAngle), aimed
      row-direction placemarks (PARALLEL_SIDE_SWEEP) match the global block,
      non-aimed placemarks match.
    """
    if mode == "followWayline":
        return True
    if mode == "towardPOI":
        return not _aims_at_target(wp)
    # smoothTransition
    return not _body_tracks_target(wp)


def _append_heading_param(parent, wp, *, in_waylines: bool, mode: str = "smoothTransition") -> None:
    """attach waypointHeadingParam, branching on the per-mission mode.

    `mode="smoothTransition"` (default): aimed waypoints whose heading is the
    bearing to camera_target (HR / VP / HOVER_POINT_LOCK / MEHT_CHECK, and
    FLY_OVER - whose axial back-offset puts the LHA dead ahead) emit
    waypointHeadingMode=smoothTransition + waypointHeadingAngle=<wp.heading>
    so the firmware interpolates body yaw between per-WP angles - no runtime
    POI math, works on every documented model. the row-direction method
    (PARALLEL_SIDE_SWEEP, lateral offset) and non-aimed placemarks fall
    through to the followWayline block.

    `mode="towardPOI"` (experimental): aimed waypoints emit
    waypointHeadingMode=towardPOI + per-placemark waypointPoiPoint so the
    aircraft yaw continuously tracks the LHA across the whole arc. transit /
    takeoff / landing keep followWayline so the nose stays along flight
    direction.

    `mode="followWayline"` (reliable fallback): every placemark emits the
    followWayline block (no waypointPoiPoint; common-element.md scopes it to
    towardPOI). body heading is then driven by the per-WP rotateYaw action
    emitted in `_append_action_group`. this mirrors the proven snap shape
    flown across previous flights.

    transit / takeoff / landing placemarks emit the followWayline block
    byte-for-byte in ALL three modes - non-aimed waypoints are mode-agnostic.
    """
    # the WPML product-support matrix does not list M4T as a supported model
    # for either smoothTransition or towardPOI; both are emitted here based on
    # empirical hardware behaviour. if a future M4T firmware revision breaks
    # them, fall back to followWayline + per-WP rotateYaw via the model's
    # dji_heading_mode column.
    if mode == "smoothTransition" and _body_tracks_target(wp):
        angle = _normalize_heading(wp.heading)
        heading_param = ET.SubElement(parent, _wpml_tag("waypointHeadingParam"))
        _sub_text(heading_param, "waypointHeadingMode", "smoothTransition")
        _sub_text(heading_param, "waypointHeadingAngle", f"{angle:g}")
        if in_waylines:
            # angle IS the override here (opposite of towardPOI which puts the
            # truth in waypointPoiPoint). enable so firmware honors per-WP angle.
            _sub_text(heading_param, "waypointHeadingAngleEnable", "1")
        _sub_text(heading_param, "waypointHeadingPathMode", "followBadArc")
        _sub_text(heading_param, "waypointHeadingPoiIndex", "0")
        return

    if mode == "towardPOI" and _aims_at_target(wp):
        lon, lat, _ = point_lonlatalt(wp.camera_target)
        heading_param = ET.SubElement(parent, _wpml_tag("waypointHeadingParam"))
        _sub_text(heading_param, "waypointHeadingMode", "towardPOI")
        _sub_text(heading_param, "waypointHeadingAngle", "0")
        # dji wpml writes lat,lon,alt - opposite order to the wkt point we get
        # back. spec (common-element.md) allows the altitude component to be
        # 0; pinning it here decouples the POI from camera_target.alt so a
        # below-takeoff target cannot trip Pilot 2's POI geometry pre-flight
        # check - that mismatch was a real launch-blocking bug.
        _sub_text(heading_param, "waypointPoiPoint", f"{lat:.6f},{lon:.6f},0.000000")
        if in_waylines:
            _sub_text(heading_param, "waypointHeadingAngleEnable", "0")
        _sub_text(heading_param, "waypointHeadingPathMode", "followBadArc")
        _sub_text(heading_param, "waypointHeadingPoiIndex", "0")
        return

    # followWayline block - waypointPoiPoint is required by the spec only for
    # towardPOI placemarks, so we omit it here. the previous 0,0,0 sentinel was
    # a real coordinate off the West African coast and a strict validator can
    # flag it as a mis-positioned POI.
    heading_param = ET.SubElement(parent, _wpml_tag("waypointHeadingParam"))
    _sub_text(heading_param, "waypointHeadingMode", "followWayline")
    _sub_text(heading_param, "waypointHeadingAngle", "0")
    if in_waylines:
        _sub_text(heading_param, "waypointHeadingAngleEnable", "0")
    _sub_text(heading_param, "waypointHeadingPathMode", "followBadArc")
    _sub_text(heading_param, "waypointHeadingPoiIndex", "0")
