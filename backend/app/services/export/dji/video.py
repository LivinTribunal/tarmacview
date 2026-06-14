"""dji video smooth-turn planner - vp/hr video measurement gimbal sweep."""

_CAMERA_SETTING_KEYS = (
    "white_balance",
    "iso",
    "shutter_speed",
    "focus_mode",
    "optical_zoom",
    "capture_mode",
)


def _resolve_inspection_camera_settings(mission) -> dict:
    """map inspection_id -> resolved camera settings dict from mission + template.

    returns an empty dict when the mission has no inspections loaded. mirrors the
    resolution logic used in generate_json so both paths produce the same values.
    the resolved dict also carries `method` (the inspection's method string) so
    the export can branch the gimbal handling on VERTICAL_PROFILE + VIDEO_CAPTURE.

    capture_mode precedence mirrors the trajectory orchestrator
    (services/trajectory/orchestrator.py): inspection.config > template.default_config
    > mission.default_capture_mode > the trajectory's hardcoded "VIDEO_CAPTURE"
    default. resolve_with_defaults handles the first two levels; this function
    fills in the mission-level fallback. real-world inspections almost always
    leave capture_mode null on the inspection row and inherit from the mission
    default, so missing the inheritance silently disables the smooth-sweep
    branch on every production VP video mission.
    """
    if not mission or not getattr(mission, "inspections", None):
        return {}

    mission_default_cm = getattr(mission, "default_capture_mode", None)
    if not isinstance(mission_default_cm, str):
        mission_default_cm = None

    result: dict = {}
    for insp in mission.inspections:
        resolved: dict = {}
        if getattr(insp, "config", None):
            template_cfg = insp.template.default_config if getattr(insp, "template", None) else None
            resolved = insp.config.resolve_with_defaults(template_cfg)
        cam = {k: resolved.get(k) for k in _CAMERA_SETTING_KEYS}
        if cam.get("capture_mode") is None and mission_default_cm:
            cam["capture_mode"] = mission_default_cm
        cam["method"] = getattr(insp, "method", None)
        result[insp.id] = cam
    return result


def _is_vp_video_measurement(wp, inspection_camera: dict) -> bool:
    """true when wp is a MEASUREMENT inside a VERTICAL_PROFILE + VIDEO_CAPTURE pass.

    drives the smooth-sweep branch in the export: VP video is the only method
    where the gimbal pitch changes meaningfully across consecutive waypoints
    (climb from angle_start to angle_end), so it gets a per-segment
    gimbalEvenlyRotate. HR video also smooth-turns (see _is_hr_video_measurement)
    but anchors the gimbal once and holds it because pitch barely varies across
    an arc. fly-over, parallel-side-sweep, hover-point-lock, and meht-check stay
    on the proven per-WP snap pattern.

    capture_mode=None is treated as VIDEO_CAPTURE to match the trajectory
    pipeline, which uses `ResolvedConfig.capture_mode: str = "VIDEO_CAPTURE"`
    as the dataclass default (see services/trajectory/types.py). missions
    written before the capture_mode column existed (or with the column left
    blank) flow through the trajectory as video and emit RECORDING_START /
    RECORDING_STOP bookends - the export must read them as video too,
    otherwise the smooth-sweep branch silently skips them.
    """
    if getattr(wp, "waypoint_type", None) != "MEASUREMENT":
        return False
    insp_id = getattr(wp, "inspection_id", None)
    if insp_id is None:
        return False
    cam = inspection_camera.get(insp_id)
    if not cam:
        return False
    capture_mode = cam.get("capture_mode") or "VIDEO_CAPTURE"
    return cam.get("method") == "VERTICAL_PROFILE" and capture_mode == "VIDEO_CAPTURE"


def _is_hr_video_measurement(wp, inspection_camera: dict) -> bool:
    """true when wp is a MEASUREMENT inside a HORIZONTAL_RANGE + VIDEO_CAPTURE pass.

    HR video flies an arc around the LHA at constant altitude. snapping the
    body and gimbal at every arc waypoint halts the drone 10x through a single
    pass and breaks continuous video. instead the drone smooth-turns through
    the arc with the gimbal anchored once at the first measurement; firmware
    body-follow + per-placemark heading keeps the camera framed on the LHA
    across the rest of the arc.

    capture_mode=None is treated as VIDEO_CAPTURE to match the trajectory
    default and mirror _is_vp_video_measurement; production missions almost
    always leave capture_mode null on the inspection row and inherit from the
    mission default.
    """
    if getattr(wp, "waypoint_type", None) != "MEASUREMENT":
        return False
    insp_id = getattr(wp, "inspection_id", None)
    if insp_id is None:
        return False
    cam = inspection_camera.get(insp_id)
    if not cam:
        return False
    capture_mode = cam.get("capture_mode") or "VIDEO_CAPTURE"
    return cam.get("method") == "HORIZONTAL_RANGE" and capture_mode == "VIDEO_CAPTURE"


def _video_smooth_emit_plan(waypoints, inspection_camera: dict) -> dict:
    """plan per video MEASUREMENT waypoint: snap, segment target, turn mode.

    returns {wp.sequence_order: {skip_snap, segment_target, passthrough}} for
    every VP video and HR video MEASUREMENT waypoint. consumed by
    _append_placemark to:
      - skip the per-WP gimbalRotate snap on every measurement after the first
        in the same inspection (the first one anchors the gimbal so subsequent
        measurements ride on body-follow + held pitch on HR, or on
        gimbalEvenlyRotate from a known starting pitch on VP);
      - on VP only, emit a sibling actionGroup with actionTriggerType
        =betweenAdjacentPoints + gimbalEvenlyRotate(target=next_wp.gimbal_pitch)
        on every measurement that has a successor measurement in the same pass;
        HR pitch barely varies across an arc so it stays anchor-only;
      - switch waypointTurnMode to toPointAndPassWithContinuityCurvature so the
        drone flies through the arc / climb continuously instead of halting at
        each measurement.

    waypoints whose sequence_order is not in the dict get the default behavior
    (snap, no segment, stop turn mode) - HOVER bookends (RECORDING_START /
    RECORDING_STOP) keep stop + per-WP snap for action timing, plus transit,
    takeoff, landing, all non-video measurements, and the photo-mode paths.
    """
    plan: dict = {}
    for i, wp in enumerate(waypoints):
        is_vp = _is_vp_video_measurement(wp, inspection_camera)
        is_hr = _is_hr_video_measurement(wp, inspection_camera)
        if not (is_vp or is_hr):
            continue

        # is_first checks against the same predicate + same inspection so
        # adjacent passes from different methods (or different inspections)
        # each get their own anchor measurement.
        prev = waypoints[i - 1] if i > 0 else None
        prev_same = False
        if prev is not None and getattr(prev, "inspection_id", None) == wp.inspection_id:
            if is_vp and _is_vp_video_measurement(prev, inspection_camera):
                prev_same = True
            elif is_hr and _is_hr_video_measurement(prev, inspection_camera):
                prev_same = True
        is_first = not prev_same

        # HR is anchor-only: pitch is held by firmware after the first snap, so
        # no betweenAdjacentPoints sweep. VP fills next_meas to drive the
        # per-segment gimbalEvenlyRotate.
        next_meas = None
        if is_vp and i + 1 < len(waypoints):
            nxt = waypoints[i + 1]
            if (
                _is_vp_video_measurement(nxt, inspection_camera)
                and nxt.inspection_id == wp.inspection_id
            ):
                next_meas = nxt

        plan[wp.sequence_order] = {
            "skip_snap": not is_first,
            "segment_target": getattr(next_meas, "gimbal_pitch", None) if next_meas else None,
            "next_index": getattr(next_meas, "sequence_order", None) if next_meas else None,
            "passthrough": True,
        }
    return plan
