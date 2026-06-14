"""post-pass formatting + totals: soft warnings, surface crossings, papi band, defaults."""

import math

import app.services.trajectory.orchestrator as _orch
from app.core.enums import InspectionMethod, WaypointType
from app.models.inspection import Inspection, InspectionTemplate
from app.utils.geo import distance_between
from app.utils.local_projection import LocalProjection

from ..helpers import resolve_vertical_profile_angles
from ..safety_validator import (
    validate_papi_angle_band,
    validate_vertical_profile_angle_band,
)
from ..types import (
    DEFAULT_ACCELERATION,
    DEFAULT_DECELERATION,
    GIMBAL_SETTLE_TIME,
    MIN_SPEED_FLOOR,
    Point3D,
    ResolvedConfig,
    Violation,
    WaypointData,
)


def _format_soft_warnings(
    violations: list,
    label: str,
    warnings: list[tuple[str, list[str], str | None]],
    wp_offset: int = 0,
) -> None:
    """group soft violations by message and append formatted warning tuples.

    wp_offset is added to each waypoint_index to convert pass-local indices
    to global all_waypoints indices for later uuid resolution. each appended
    tuple carries the validator-emitted violation_kind so downstream consumers
    don't have to re-parse the message.
    """
    groups: dict[str, list[int]] = {}
    # violations sharing a message share a kind; keep the first non-null one
    group_kind: dict[str, str | None] = {}
    for v in violations:
        if not v.is_warning:
            continue

        indices = groups.setdefault(v.message, [])
        if v.waypoint_index is not None:
            indices.append(v.waypoint_index + 1)
        if group_kind.get(v.message) is None:
            group_kind[v.message] = v.violation_kind

    seen_msgs = {w[0] for w in warnings}
    for msg, indices in groups.items():
        if indices:
            if len(indices) <= 3:
                wp_str = ", ".join(str(i) for i in sorted(indices))
            else:
                wp_str = f"{min(indices)}-{max(indices)}"
            full = f"{label} (wp {wp_str}): {msg}"
        else:
            full = f"{label}: {msg}"

        if full not in seen_msgs:
            # build idx: references for waypoint id resolution
            wp_ids = [f"idx:{(i - 1) + wp_offset}" for i in indices]
            warnings.append((full, wp_ids, group_kind.get(msg)))


def _inject_mission_default(
    config: ResolvedConfig,
    inspection: Inspection,
    template: InspectionTemplate,
    field: str,
    mission_value,
) -> None:
    """apply a mission-level default to config.<field> only when neither the
    inspection config nor the template default_config set it.

    mission_value is the already-gated mission default - None means the mission
    has no default for this field, so nothing is injected (callers pre-apply any
    truthiness / str-cast so the None sentinel is the single inject gate).
    """
    if mission_value is None:
        return
    insp_val = getattr(inspection.config, field, None) if inspection.config else None
    tmpl_val = getattr(template.default_config, field, None) if template.default_config else None
    if insp_val is None and tmpl_val is None:
        setattr(config, field, mission_value)


def _papi_band_violations(
    wps: list[WaypointData],
    center: Point3D,
    setting_angles: list[float],
    config: ResolvedConfig,
    method: InspectionMethod,
) -> list[Violation]:
    """shared papi all-white-zone band check used by generate + revalidate.

    HORIZONTAL_RANGE: every measurement against the all-white edge (no check
    when setting angles are unavailable). VERTICAL_PROFILE: per-bookend check
    against the resolved climb angles. any other method has no band check.

    this is the single dispatch seam - both _generate_trajectory_inner and
    revalidate_existing_plan route through it so the two paths cannot diverge.
    """
    if method == InspectionMethod.HORIZONTAL_RANGE:
        if not setting_angles:
            return []
        return validate_papi_angle_band(wps, center, max(setting_angles))
    if method == InspectionMethod.VERTICAL_PROFILE:
        angle_start, angle_end = resolve_vertical_profile_angles(config, setting_angles)
        return validate_vertical_profile_angle_band(
            wps,
            center,
            setting_angles,
            angle_start,
            angle_end,
            config.angle_source or "CUSTOM",
        )
    return []


def _segment_duration_with_accel(
    distance: float,
    v_start: float,
    v_end: float,
    accel: float = DEFAULT_ACCELERATION,
    decel: float = DEFAULT_DECELERATION,
) -> float:
    """compute segment travel time using a trapezoidal speed profile.

    models acceleration from v_start to cruise speed, constant cruise, then
    deceleration to v_end. falls back to triangular profile when the segment
    is too short for full accel/decel phases.
    """
    if distance <= 0:
        return 0.0
    v_start = max(v_start, MIN_SPEED_FLOOR)
    v_end = max(v_end, MIN_SPEED_FLOOR)
    v_cruise = max(v_start, v_end)

    # distance needed for accel and decel phases
    d_accel = (v_cruise**2 - v_start**2) / (2 * accel) if v_cruise > v_start else 0.0
    d_decel = (v_cruise**2 - v_end**2) / (2 * decel) if v_cruise > v_end else 0.0

    if d_accel + d_decel <= distance:
        # full trapezoidal profile
        d_cruise = distance - d_accel - d_decel
        t_accel = (v_cruise - v_start) / accel if v_cruise > v_start else 0.0
        t_decel = (v_cruise - v_end) / decel if v_cruise > v_end else 0.0
        t_cruise = d_cruise / v_cruise if v_cruise > 0 else 0.0
        return t_accel + t_cruise + t_decel

    # triangular profile - can't reach cruise speed
    # solve for peak velocity: d_accel + d_decel = distance
    # v_peak^2 = (2*accel*decel*distance + decel*v_start^2 + accel*v_end^2) / (accel + decel)
    numerator = 2 * accel * decel * distance + decel * v_start**2 + accel * v_end**2
    denominator = accel + decel
    if denominator == 0:
        return distance / max(v_start, MIN_SPEED_FLOOR)
    v_peak_sq = numerator / denominator
    if v_peak_sq < 0:
        return distance / max(v_start, MIN_SPEED_FLOOR)
    v_peak = math.sqrt(v_peak_sq)
    t_accel = (v_peak - v_start) / accel if v_peak > v_start else 0.0
    t_decel = (v_peak - v_end) / decel if v_peak > v_end else 0.0
    return t_accel + t_decel


def _collect_surface_crossing_warnings(
    all_waypoints: list[WaypointData],
    proj: LocalProjection,
    local_geoms,
    wp_inspection_seq: dict[int, int],
    warnings: list[tuple[str, list[str], str | None]],
) -> None:
    """append runway/taxiway crossing warnings onto `warnings`.

    measurement crossings are grouped by (inspection_seq, surface) into one
    warning; transit/other crossings are kept individually. the dedup is
    order-sensitive against the live `warnings` list, matching the inline form.
    """
    measurement_crossings: dict[tuple[int, str], list[int]] = {}
    for j in range(1, len(all_waypoints)):
        prev_wp = all_waypoints[j - 1]
        cur_wp = all_waypoints[j]
        prev_x, prev_y = proj.to_local(prev_wp.lon, prev_wp.lat)
        cur_x, cur_y = proj.to_local(cur_wp.lon, cur_wp.lat)
        for local_surface in local_geoms.surfaces:
            # segment_runway_crossing_length resolved off the package object so the
            # `monkeypatch.setattr(orchestrator, "segment_runway_crossing_length", ...)`
            # seam still reaches this loop after the package split.
            crossing = _orch.segment_runway_crossing_length(
                prev_x,
                prev_y,
                cur_x,
                cur_y,
                local_surface.polygon,
            )
            if crossing > 0:
                wp_type = cur_wp.waypoint_type
                if wp_type == WaypointType.MEASUREMENT:
                    seq = wp_inspection_seq.get(j, 0)
                    key = (
                        seq,
                        f"{local_surface.surface_type} {local_surface.identifier}",
                    )
                    measurement_crossings.setdefault(key, []).append(j)
                else:
                    msg = (
                        f"wp {j}-{j + 1} ({wp_type}): crosses "
                        f"{local_surface.surface_type} {local_surface.identifier} "
                        f"({crossing:.0f}m)"
                    )
                    seen_msgs = {w[0] for w in warnings}
                    if msg not in seen_msgs:
                        wp_ids = [f"idx:{j - 1}", f"idx:{j}"]
                        warnings.append((msg, wp_ids, "surface_crossing"))

    for (seq, surface_label), indices in measurement_crossings.items():
        count = len(indices)
        msg = f"inspection {seq} crosses {surface_label} during measurement ({count} segments)"
        wp_ids = []
        for wp_idx in indices:
            wp_ids.extend([f"idx:{wp_idx - 1}", f"idx:{wp_idx}"])
        # deduplicate while preserving order
        seen: set[str] = set()
        unique_ids: list[str] = []
        for wid in wp_ids:
            if wid not in seen:
                seen.add(wid)
                unique_ids.append(wid)
        warnings.append((msg, unique_ids, "surface_crossing"))


def _compute_totals(all_waypoints: list[WaypointData]) -> tuple[float, float]:
    """total 3D distance and duration over the assembled path.

    duration uses the trapezoidal speed profile, a gimbal-settle penalty on
    segment-type changes into MEASUREMENT/HOVER, and per-waypoint hover_duration.
    """
    total_dist = 0.0
    total_dur = 0.0
    for j in range(len(all_waypoints)):
        if j > 0:
            prev = all_waypoints[j - 1]
            cur = all_waypoints[j]
            seg = distance_between(prev.lon, prev.lat, cur.lon, cur.lat)
            altitude_diff = cur.alt - prev.alt
            d = math.sqrt(seg**2 + altitude_diff**2)
            total_dist += d

            v_prev = max(
                prev.speed if prev.speed is not None else MIN_SPEED_FLOOR,
                MIN_SPEED_FLOOR,
            )
            v_cur = max(
                cur.speed if cur.speed is not None else MIN_SPEED_FLOOR,
                MIN_SPEED_FLOOR,
            )
            total_dur += _segment_duration_with_accel(d, v_prev, v_cur)

            # gimbal settle when transitioning between segment types
            if prev.waypoint_type != cur.waypoint_type and cur.waypoint_type in (
                WaypointType.MEASUREMENT,
                WaypointType.HOVER,
            ):
                total_dur += GIMBAL_SETTLE_TIME

        if all_waypoints[j].hover_duration is not None:
            total_dur += all_waypoints[j].hover_duration

    return total_dist, total_dur
