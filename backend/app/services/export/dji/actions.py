"""dji wpml actionGroup + zoom emission - reachPoint and betweenAdjacentPoints."""

import math
import xml.etree.ElementTree as ET

from ..shared import _sub_text, _wpml_tag
from .heading import _aims_at_target, _emits_followwayline_block, _normalize_heading

# dji camera action mapping - values match actionActuatorFunc in the dji wpml schema
_DJI_CAMERA_ACTIONS = {
    "PHOTO_CAPTURE": "takePhoto",
    "RECORDING_START": "startRecord",
    "RECORDING_STOP": "stopRecord",
}


def _first_zoom_emission_waypoints(
    waypoints,
    inspection_camera: dict,
    drone_profile=None,
) -> set:
    """sequence_orders of measurement waypoints that should emit a zoom action.

    walks waypoints in order, picks the first MEASUREMENT waypoint per
    inspection_id, and emits only when the resolved optical_zoom is set, differs
    from the drone's neutral framing (drone_profile.default_optical_zoom or 1.0),
    and differs from the last zoom value already emitted on route.
    """
    default_zoom = (
        getattr(drone_profile, "default_optical_zoom", None) if drone_profile else None
    ) or 1.0
    seen_inspection_ids = set()
    emissions: set = set()
    last_zoom = None
    for wp in waypoints:
        insp_id = getattr(wp, "inspection_id", None)
        if insp_id is None:
            continue
        if getattr(wp, "waypoint_type", None) != "MEASUREMENT":
            continue
        if insp_id in seen_inspection_ids:
            continue
        seen_inspection_ids.add(insp_id)

        cam = inspection_camera.get(insp_id)
        if not cam:
            continue
        zoom = cam.get("optical_zoom")
        # tolerant compare - default_zoom and resolved zoom may both pass through
        # arithmetic upstream, so strict float equality is fragile
        if zoom is None or math.isclose(zoom, default_zoom):
            continue
        if last_zoom is not None and math.isclose(zoom, last_zoom):
            continue

        emissions.add(wp.sequence_order)
        last_zoom = zoom
    return emissions


def _append_zoom_action(group, zoom_factor: float, drone_profile, action_id: int) -> int:
    """emit a wpml:zoom action translating optical_zoom into the dji schema.

    prefers focalLength when the drone profile exposes a 1x sensor base focal
    length, otherwise falls back to zoomFactor. returns the next action id.
    """
    action = ET.SubElement(group, _wpml_tag("action"))
    _sub_text(action, "actionId", str(action_id))
    _sub_text(action, "actionActuatorFunc", "zoom")
    params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
    _sub_text(params, "payloadPositionIndex", "0")

    base = getattr(drone_profile, "sensor_base_focal_length", None) if drone_profile else None
    if base is not None and base > 0:
        focal = zoom_factor * base
        _sub_text(params, "focalLength", f"{focal:g}")
    else:
        _sub_text(params, "zoomFactor", f"{zoom_factor:g}")

    return action_id + 1


def _append_action_group(
    placemark,
    wp,
    index: int,
    *,
    zoom_factor: float | None = None,
    drone_profile=None,
    skip_gimbal_snap: bool = False,
    heading_mode: str = "smoothTransition",
) -> None:
    """emit a wpml:actionGroup covering yaw, gimbal, hover, camera, and zoom actions.

    `heading_mode="smoothTransition"` (default): rotateYaw is suppressed for
    aimed body-tracks-target placemarks (HR / VP / HOVER_POINT_LOCK /
    MEHT_CHECK) because the per-placemark waypointHeadingAngle drives body
    yaw via firmware interpolation. row/run-direction methods (FO / PSS /
    SURFACE_SCAN) fall
    through to the followWayline shape and DO emit per-WP rotateYaw because
    their heading-param block is the global followWayline (no per-WP angle
    override); they snap to the row direction at each measurement, but
    that's a no-op because adjacent WPs share the same row heading.

    `heading_mode="towardPOI"` (experimental): rotateYaw is suppressed for
    aimed placemarks because the per-placemark towardPOI heading owns body
    yaw continuously across the arc; layering rotateYaw on top would
    re-introduce the snap.

    `heading_mode="followWayline"` (reliable fallback): aimed placemarks
    emit a rotateYaw action with `aircraftHeading` normalized to [-180, 180]
    and `aircraftPathMode` matching the heading sign so the rotation takes
    the short way round - the snap shape proven across previous flights.

    gimbalRotate is emitted for measurement/hover waypoints with a camera
    target in ALL modes; gimbalYawRotateEnable=0 keeps the gimbal in
    body-follow mode regardless.

    `skip_gimbal_snap` suppresses the per-WP gimbalRotate action. video
    measurement passes use this on every measurement after the first so the
    smooth segment-wise gimbalEvenlyRotate (VP video) or the held anchor
    pitch (HR video) is not stomped by a per-WP snap.

    order is rotateYaw -> gimbalRotate -> hover -> zoom -> camera. zoom must
    fire BEFORE takePhoto / startRecord so the anchor frame on the first
    measurement is captured at the configured optical_zoom (e.g. 7x) rather
    than the inherited baseline (1x) - emitting zoom after takePhoto in a
    sequence-mode actionGroup made the very first shot blurred / wrong-framed
    until the next waypoint's zoom finally took effect.
    """
    camera_func = _DJI_CAMERA_ACTIONS.get(wp.camera_action)
    hover_secs = wp.hover_duration or 0
    aims = _aims_at_target(wp)
    # rotateYaw fires whenever this placemark's heading-param block is the
    # global followWayline (no per-WP angle override) AND the WP needs to
    # face a target. that's: followWayline mode for any aimed WP, plus
    # smoothTransition mode for aimed row-direction WPs (FO / SS).
    emit_rotate_yaw = (
        aims and wp.heading is not None and _emits_followwayline_block(wp, heading_mode)
    )
    gimbal_pitch = getattr(wp, "gimbal_pitch", None) if aims else None
    if skip_gimbal_snap:
        gimbal_pitch = None

    emit_zoom = zoom_factor is not None

    if (
        not camera_func
        and hover_secs <= 0
        and gimbal_pitch is None
        and not emit_zoom
        and not emit_rotate_yaw
    ):
        return

    # actionGroupStart/EndIndex must be 0-indexed to match the placemark's
    # wpml:index. wp.sequence_order is 1-indexed (production assigns it via
    # enumerate(start=1) in flight_plan_service), so subtract one.
    #
    # actionGroupId is an opaque unique key (DJI Pilot 2 / fh2 only reads it
    # as a key, not a position reference) but the WPML spec caps it at
    # [0, 65535]. reach-point groups take the odd lane (2*index - 1) and the
    # VP-video segment groups take the even lane (2*sequence_order) so the
    # two streams stay collision-free and well inside 65535 past the 500-WP
    # performance ceiling.
    ref_index = index - 1
    group = ET.SubElement(placemark, _wpml_tag("actionGroup"))
    _sub_text(group, "actionGroupId", str(2 * index - 1))
    _sub_text(group, "actionGroupStartIndex", str(ref_index))
    _sub_text(group, "actionGroupEndIndex", str(ref_index))
    _sub_text(group, "actionGroupMode", "sequence")

    trigger = ET.SubElement(group, _wpml_tag("actionTrigger"))
    _sub_text(trigger, "actionTriggerType", "reachPoint")

    action_id = 0

    if emit_rotate_yaw:
        heading_val = _normalize_heading(wp.heading)
        action = ET.SubElement(group, _wpml_tag("action"))
        _sub_text(action, "actionId", str(action_id))
        _sub_text(action, "actionActuatorFunc", "rotateYaw")
        params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
        _sub_text(params, "aircraftHeading", f"{heading_val:g}")
        # path mode must match the sign of the target heading so the
        # rotation takes the short way round. hardcoding counterClockwise
        # with a positive target (e.g. 172°) forces a 188° wrap-around
        # that fh2/firmware refuses to execute.
        path_mode = "counterClockwise" if heading_val < 0 else "clockwise"
        _sub_text(params, "aircraftPathMode", path_mode)
        action_id += 1

    if gimbal_pitch is not None:
        action = ET.SubElement(group, _wpml_tag("action"))
        _sub_text(action, "actionId", str(action_id))
        _sub_text(action, "actionActuatorFunc", "gimbalRotate")
        params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
        # matches fh2's own export: gimbal pitch is commanded, yaw is disabled.
        # the placemark's towardPOI heading mode aims the nose at the target;
        # the gimbal then follows the body via the m4t default Follow mode.
        # explicit yaw commands here break fh2's gimbal-follow simulation and
        # lock the camera to the commanded absolute angle - that regressed once
        # when the entire gimbalRotate action was dropped.
        _sub_text(params, "gimbalHeadingYawBase", "north")
        _sub_text(params, "gimbalRotateMode", "absoluteAngle")
        _sub_text(params, "gimbalPitchRotateEnable", "1")
        _sub_text(params, "gimbalPitchRotateAngle", f"{gimbal_pitch:g}")
        _sub_text(params, "gimbalRollRotateEnable", "0")
        _sub_text(params, "gimbalRollRotateAngle", "0")
        _sub_text(params, "gimbalYawRotateEnable", "0")
        _sub_text(params, "gimbalYawRotateAngle", "0")
        _sub_text(params, "gimbalRotateTimeEnable", "0")
        _sub_text(params, "gimbalRotateTime", "0")
        _sub_text(params, "payloadPositionIndex", "0")
        action_id += 1

    if hover_secs > 0:
        action = ET.SubElement(group, _wpml_tag("action"))
        _sub_text(action, "actionId", str(action_id))
        _sub_text(action, "actionActuatorFunc", "hover")
        params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
        _sub_text(params, "hoverTime", f"{hover_secs:g}")
        action_id += 1

    # zoom precedes camera so the anchor frame on the first measurement is
    # captured at the configured optical_zoom, not the inherited baseline.
    if emit_zoom:
        action_id = _append_zoom_action(group, zoom_factor, drone_profile, action_id)

    if camera_func:
        action = ET.SubElement(group, _wpml_tag("action"))
        _sub_text(action, "actionId", str(action_id))
        _sub_text(action, "actionActuatorFunc", camera_func)
        params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
        _sub_text(params, "payloadPositionIndex", "0")
        if camera_func == "takePhoto":
            _sub_text(params, "fileSuffix", "")
            _sub_text(params, "useGlobalPayloadLensIndex", "1")
        elif camera_func == "startRecord":
            _sub_text(params, "useGlobalPayloadLensIndex", "1")
        action_id += 1


def _append_segment_action_group(
    placemark,
    wp,
    next_index: int,
    target_pitch: float,
) -> None:
    """emit a betweenAdjacentPoints actionGroup with gimbalEvenlyRotate.

    drives the smooth pitch sweep across a VP video measurement segment: the
    drone climbs continuously from wp to the next measurement (turn mode is
    pass-through), and the gimbal evenly rotates from its current pitch to
    `target_pitch` across the segment. gimbalEvenlyRotate only takes pitch -
    yaw is untouched, so the body-follow yaw established by the placemark's
    towardPOI heading mode + gimbalRotate(yaw_disabled) is preserved.

    actionGroupId takes the even lane (2*sequence_order) while the reachPoint
    group takes the odd lane (2*sequence_order - 1), so the two id streams
    never collide and both stay within the WPML spec range [0, 65535].
    """
    group = ET.SubElement(placemark, _wpml_tag("actionGroup"))
    _sub_text(group, "actionGroupId", str(2 * wp.sequence_order))
    # 0-indexed reference indices, matching the placemark wpml:index.
    _sub_text(group, "actionGroupStartIndex", str(wp.sequence_order - 1))
    _sub_text(group, "actionGroupEndIndex", str(next_index - 1))
    _sub_text(group, "actionGroupMode", "sequence")

    trigger = ET.SubElement(group, _wpml_tag("actionTrigger"))
    _sub_text(trigger, "actionTriggerType", "betweenAdjacentPoints")

    action = ET.SubElement(group, _wpml_tag("action"))
    _sub_text(action, "actionId", "0")
    _sub_text(action, "actionActuatorFunc", "gimbalEvenlyRotate")
    params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
    _sub_text(params, "gimbalPitchRotateAngle", f"{target_pitch:g}")
    _sub_text(params, "payloadPositionIndex", "0")
