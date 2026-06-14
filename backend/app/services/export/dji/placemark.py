"""dji wpmz 1.0.6 per-waypoint placemark emission shared by KMZ + WPML.

per-waypoint XML construction lives here: `_append_placemark` (the placemark
itself with executeHeight / heading / turn / action / gimbal blocks plus the
template `useGlobal*` quartet), `_append_turn_param`, `_append_payload_param`,
`_nearest_leg_lengths`, and `_zoom_factor_for`. document-level mission config
and the small route-level emitters (`_append_mission_config`,
`_resolve_auto_speed`, `_max_relative_height`, `_emitted_distance_duration`,
`_takeoff_ref_*`, `_global_rth_height`, `_dji_enums_for`) stay in
`mission_config.py`. document assembly stays in `builders.py`; both
`builders.py` and `mission_config.py` may import from this module - this is
a leaf inside the dji sub-package, so it never imports back from either.
"""

import logging
import math
import xml.etree.ElementTree as ET

from app.core.geometry import point_lonlatalt
from app.utils.geo import distance_between, msl_to_hae

from ..shared import _kml_tag, _sub_text, _wpml_tag
from .actions import _append_action_group, _append_segment_action_group
from .heading import _append_heading_param, _emits_followwayline_block

logger = logging.getLogger(__name__)

# default-stop damping literal - kept verbatim across every non-passthrough
# placemark so the WPML range `(0, segment length]` is satisfied for the photo
# / hover / transit / takeoff / landing path where measurements are not flown
# through continuously.
_STOP_DAMPING_DIST_M = 0.2

# passthrough damping ceiling. continuity-curvature placemarks pick
# `min(_PASSTHROUGH_DAMPING_CEILING_M, 0.5 * nearest_leg)`. the previous
# hardcoded 0.2 m ceiling collapsed the smooth-turn arc into a corner at every
# measurement on a 4 m VP step; 2 m gives the drone a real curve while still
# leaving headroom inside any practical inter-measurement spacing.
_PASSTHROUGH_DAMPING_CEILING_M = 2.0

# wpml waypointSpeed range is (0, max] - strict firmware (Pilot 2 WaylineCheckError -6)
# rejects the literal 0 that bookend hover / takeoff / landing waypoints emit when
# wp.speed is null. mirrors litchi._LITCHI_MIN_SPEED.
_MIN_WAYPOINT_SPEED = 0.1


def _resolve_waypoint_speed(wp, mission) -> float:
    """positive waypoint speed: wp.speed > mission.default_speed > floor."""
    speed = getattr(wp, "speed", None)
    if isinstance(speed, (int, float)) and speed > 0:
        return float(speed)
    if mission is not None:
        default = getattr(mission, "default_speed", None)
        if isinstance(default, (int, float)) and default > 0:
            return float(default)
    return _MIN_WAYPOINT_SPEED


# one record per below-takeoff placemark surfaced to the operator before any
# KMZ/WPML file leaves the server. shape mirrors `app.schemas.export.AltitudeClamp`.
AltitudeClampRecord = dict


def _append_turn_param(parent, *, turn_mode: str | None = None, damping_dist: float = 0.2) -> None:
    """attach waypointTurnParam.

    default is `toPointAndStopWithDiscontinuityCurvature` - stop at each
    waypoint, which is the right shape for photo capture, hover bookends, and
    transit. VP video and HR video measurement-pass interiors override to
    `toPointAndPassWithContinuityCurvature` so the drone flies continuously
    through the arc / climb instead of halting at every waypoint. on VP video
    a sibling gimbalEvenlyRotate sweeps the pitch across each segment; on HR
    video the gimbal is anchored on the first measurement only and held.

    `damping_dist` defaults to 0.2 (the stop-path literal). continuity-curvature
    placemarks pass a value already clamped under the local leg length so the
    emitted distance stays inside the WPML range `(0, segment length]`.
    """
    mode = turn_mode or "toPointAndStopWithDiscontinuityCurvature"
    turn_param = ET.SubElement(parent, _wpml_tag("waypointTurnParam"))
    _sub_text(turn_param, "waypointTurnMode", mode)
    _sub_text(turn_param, "waypointTurnDampingDist", f"{damping_dist:g}")


def _nearest_leg_lengths(waypoints) -> dict[int, float]:
    """map each waypoint's sequence_order to its shortest adjacent 3D leg.

    used to clamp waypointTurnDampingDist below the local segment length on
    continuity-curvature placemarks. leg geometry mirrors
    _emitted_distance_duration: horizontal haversine + altitude delta.
    waypoints with an unparseable position are skipped (same contract as
    _emitted_distance_duration), so the dict may omit a sequence_order.

    zero-length legs are excluded from the per-waypoint minimum: a video
    RECORDING_START hover bookend is collocated with the first measurement,
    so the hover->m1 leg is 0 - that is not a segment the drone overshoots,
    and the WPML damping range is `(0, segment length]` (exclusive of 0).
    a waypoint with no positive adjacent leg is omitted entirely so it falls
    back to the literal 0.2 default.
    """
    coords: list[tuple[int, float, float, float]] = []
    for wp in waypoints:
        try:
            lon, lat, alt = point_lonlatalt(wp.position)
        except ValueError:
            continue
        coords.append((wp.sequence_order, lon, lat, alt))

    legs: list[float] = []
    for (_, lon1, lat1, alt1), (_, lon2, lat2, alt2) in zip(coords, coords[1:]):
        horiz = distance_between(lon1, lat1, lon2, lat2)
        legs.append(math.hypot(horiz, alt2 - alt1))

    nearest: dict[int, float] = {}
    for i, (seq, *_rest) in enumerate(coords):
        candidates = []
        if i > 0 and legs[i - 1] > 0:
            candidates.append(legs[i - 1])
        if i < len(legs) and legs[i] > 0:
            candidates.append(legs[i])
        if candidates:
            nearest[seq] = min(candidates)
    return nearest


def _append_payload_param(folder) -> None:
    """attach the Folder-trailing wpml:payloadParam block.

    values mirror the dji pilot 2 defaults for an h20t-class inspection payload;
    flight hub 2 rejects the file if this block is missing.
    """
    payload = ET.SubElement(folder, _wpml_tag("payloadParam"))
    _sub_text(payload, "payloadPositionIndex", "0")
    _sub_text(payload, "focusMode", "firstPoint")
    _sub_text(payload, "meteringMode", "average")
    _sub_text(payload, "returnMode", "singleReturnStrongest")
    _sub_text(payload, "samplingRate", "240000")
    _sub_text(payload, "scanningMode", "repetitive")
    # visible-light only is intentional for PAPI inspections - the operator
    # frames the all-white edge from the rgb sensor and the report is built
    # off the visible imagery. enabling thermal (h20t / matrice 4t ir lens)
    # would require switching this to a multi-token value (e.g. "wide,ir"),
    # threading a per-action `payloadLensIndex` per MSDK issue #635, and
    # dropping the `useGlobalPayloadLensIndex=1` writes in actions.py (the
    # takePhoto / startRecord branches) so per-action lens selection wins
    # over the global default.
    _sub_text(payload, "imageFormat", "visable")
    _sub_text(payload, "photoSize", "default_l")


def _zoom_factor_for(wp, zoom_seqs: set, inspection_camera: dict) -> float | None:
    """return optical_zoom value to emit at this waypoint, or None."""
    if wp.sequence_order not in zoom_seqs:
        return None
    cam = inspection_camera.get(getattr(wp, "inspection_id", None))
    if not cam:
        return None
    return cam.get("optical_zoom")


def _append_placemark(
    folder,
    wp,
    takeoff_ref_msl: float,
    *,
    in_waylines: bool,
    zoom_factor: float | None = None,
    drone_profile=None,
    video_smooth_plan: dict | None = None,
    heading_mode: str = "smoothTransition",
    nearest_leg: float | None = None,
    clamps: list[AltitudeClampRecord] | None = None,
    mission=None,
) -> None:
    """add a wpml waypoint placemark.

    altitude is takeoff-relative: `executeHeight` (waylines) and the template
    `height` field both carry `wp_MSL - takeoff_ref_msl`, paired with
    executeHeightMode / heightMode = relativeToStartPoint. relative heights are
    geoid-free and cancel any datum error - the WGS84/HAE scheme they replace
    encoded the template fields ~45 m too low and flew the drone into the
    ground.

    the template also emits `ellipsoidHeight`, which the WPML spec defines as
    the WGS84 ellipsoid height (HAE) regardless of the folder heightMode - so
    it carries the true HAE (`msl_to_hae`), not the relative value. that keeps
    the file correct whether a consumer honours heightMode and reads `height`
    or reads `ellipsoidHeight` as an absolute datum.

    a waypoint below the takeoff reference would yield a negative relative
    height; it is clamped to 0 with a warning rather than reverting to an
    absolute datum. for the PAPI inspection missions this never fires (every
    waypoint sits 8-24 m above takeoff ground).

    `video_smooth_plan` is the per-WP plan entry from
    `_video_smooth_emit_plan`. when set, this WP is a VP / HR video
    MEASUREMENT and the placemark gets:
      - skipped per-WP gimbalRotate snap (except on the first measurement of
        the pass, which anchors the gimbal);
      - a sibling betweenAdjacentPoints + gimbalEvenlyRotate group when the
        plan carries a `segment_target` (VP only - HR is anchor-only);
      - pass-through turn mode so the arc / climb is continuous.
    None for every other waypoint - hover bookends, transit, takeoff, landing,
    non-video measurements, and the photo-mode paths keep the existing snap +
    stop pattern.

    `nearest_leg` is this waypoint's shortest adjacent 3D leg (from
    `_nearest_leg_lengths`). on the continuity-curvature branch the damping
    distance is clamped to `min(0.2, 0.5 * nearest_leg)` so it cannot exceed
    the local segment length; the default-stop path keeps the literal 0.2.

    `clamps` is an optional collector; when supplied and the placemark would
    force `executeHeight=0`, one record is appended on the waylines pass only
    so each waypoint shows up once even though `_append_placemark` runs twice
    (template + waylines).
    """
    lon, lat, alt = point_lonlatalt(wp.position)
    relative_height = alt - takeoff_ref_msl
    if relative_height < 0:
        # _append_placemark runs once for template.kml and once for
        # waylines.wpml; log the clamp / append the record only on the
        # waylines pass so it fires once per waypoint, not twice.
        if in_waylines:
            logger.warning(
                "waypoint %s resolves %.2f m below the takeoff reference; "
                "clamping relative height to 0",
                wp.sequence_order,
                -relative_height,
            )
            if clamps is not None:
                clamps.append(
                    {
                        "waypoint_index": wp.sequence_order,
                        "intended_alt": alt,
                        "clamped_alt": takeoff_ref_msl,
                        "reason": "below_takeoff",
                    }
                )
        relative_height = 0.0

    placemark = ET.SubElement(folder, _kml_tag("Placemark"))
    point = ET.SubElement(placemark, _kml_tag("Point"))
    # 2-D coordinates (lon,lat) match pilot 2's own export (docs/specs/PAPI
    # 22.kmz); altitude lives in ellipsoidHeight / height / executeHeight, not
    # here. emitting a 3-D coordinate was a 1.0.2-doc false positive (audit
    # 2026-05-26).
    ET.SubElement(point, _kml_tag("coordinates")).text = f"{lon:.8f},{lat:.8f}"

    # WPML wpml:index is 0-indexed per DJI's spec; wp.sequence_order is
    # 1-indexed in production, so subtract one. emitting 1-indexed values
    # caused every reachPoint actionGroup to fire on the wrong waypoint
    # (recording started one WP late, gimbal snaps slid by one segment).
    _sub_text(placemark, "index", str(wp.sequence_order - 1))

    if in_waylines:
        _sub_text(placemark, "executeHeight", f"{relative_height:.6f}")
    else:
        # height follows the folder heightMode (relativeToStartPoint);
        # ellipsoidHeight is always WGS84 ellipsoid height (HAE) per the WPML
        # spec, independent of heightMode - so it carries the true HAE, not
        # the relative value. a relative value here would put a
        # far-below-ground number in a field a strict consumer reads as an
        # absolute datum, re-creating the descend-into-ground failure.
        _sub_text(placemark, "ellipsoidHeight", f"{msl_to_hae(lat, lon, alt):.6f}")
        _sub_text(placemark, "height", f"{relative_height:.6f}")

    _sub_text(placemark, "waypointSpeed", f"{_resolve_waypoint_speed(wp, mission):g}")
    _append_heading_param(placemark, wp, in_waylines=in_waylines, mode=heading_mode)
    # zero-leg fallback: a passthrough placemark whose nearest leg is None /
    # <= 0 has no segment to interpolate along (the collocated recording
    # bookend or a measurement reroute that landed on top of its neighbour).
    # the WPML range is `(0, segment length]` and the
    # `toPointAndPassWithContinuityCurvature` mode is undefined on a 0-m leg
    # (gimbalEvenlyRotate rate undefined, body-tracks-target bearing undefined),
    # so drop to stop-mode instead. the passthrough merge in the trajectory
    # generator makes this branch structurally unreachable for video missions,
    # but the fallback keeps the writer correct under any future regression.
    plan_passthrough = bool(video_smooth_plan and video_smooth_plan.get("passthrough"))
    is_passthrough = plan_passthrough and nearest_leg is not None and nearest_leg > 0
    turn_mode = "toPointAndPassWithContinuityCurvature" if is_passthrough else None
    if is_passthrough:
        damping_dist = min(_PASSTHROUGH_DAMPING_CEILING_M, 0.5 * nearest_leg)
    else:
        damping_dist = _STOP_DAMPING_DIST_M
    _append_turn_param(placemark, turn_mode=turn_mode, damping_dist=damping_dist)

    # template placemark inherits speed/turn from globals. heading inheritance
    # is dropped only when this placemark emits a per-WP heading override -
    # towardPOI on any aimed WP, smoothTransition on body-tracks-target WPs.
    # FO/SS in smoothTransition emit the followWayline block (no override) so
    # they inherit. followWayline mode emits the followWayline block on every
    # placemark so they all inherit. waylines placemark omits all useGlobal*
    # flags (it's already executable).
    #
    # useGlobalHeight=0 on every template placemark - the spec marks this
    # required on every Placemark and gates whether ellipsoidHeight/height
    # (per-WP) or globalHeight (folder-level) applies. we always emit per-WP
    # heights, so the answer is unconditionally 0. omitting the flag let
    # strict validators reject the file even though Pilot 2 tolerated it.
    #
    # useGlobalHeadingParam is also required on every Placemark. the previous
    # code emitted =1 only when the placemark matched the global followWayline
    # block, and dropped the tag entirely on aimed overrides. spec-correct is
    # =1 when inheriting, =0 when the local block overrides.
    if not in_waylines:
        _sub_text(placemark, "useGlobalSpeed", "1")
        _sub_text(placemark, "useGlobalHeight", "0")
        if _emits_followwayline_block(wp, heading_mode):
            _sub_text(placemark, "useGlobalHeadingParam", "1")
        else:
            _sub_text(placemark, "useGlobalHeadingParam", "0")
        _sub_text(placemark, "useGlobalTurnParam", "1")
    _sub_text(placemark, "useStraightLine", "1")

    _append_action_group(
        placemark,
        wp,
        wp.sequence_order,
        zoom_factor=zoom_factor,
        drone_profile=drone_profile,
        skip_gimbal_snap=bool(video_smooth_plan and video_smooth_plan.get("skip_snap")),
        heading_mode=heading_mode,
    )

    if video_smooth_plan and video_smooth_plan.get("segment_target") is not None:
        _append_segment_action_group(
            placemark,
            wp,
            next_index=video_smooth_plan["next_index"],
            target_pitch=video_smooth_plan["segment_target"],
        )

    if in_waylines:
        # waylines always carries waypointGimbalHeadingParam with zeros, per
        # the working fh2 export. with gimbalPitchMode=manual this block is
        # informational; the actual aim comes from the actionGroup. template
        # placemarks omit this block entirely.
        gimbal_param = ET.SubElement(placemark, _wpml_tag("waypointGimbalHeadingParam"))
        _sub_text(gimbal_param, "waypointGimbalPitchAngle", "0")
        _sub_text(gimbal_param, "waypointGimbalYawAngle", "0")

    _sub_text(placemark, "isRisky", "0")

    if in_waylines:
        _sub_text(placemark, "waypointWorkType", "0")
