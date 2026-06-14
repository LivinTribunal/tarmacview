"""dji wpmz 1.0.6 mission config block + small route-level emitter helpers.

mission-config + takeoff-ref + RTH lives here (`_append_mission_config`,
`_dji_enums_for`, `_takeoff_ref_point` / `_takeoff_ref_msl`,
`_global_rth_height`), alongside the small route-level emitters consumed by
the document assembler: `_max_relative_height`, `_resolve_auto_speed`,
`_emitted_distance_duration`. per-waypoint placemark emission
(`_append_placemark`, `_append_turn_param`, `_append_payload_param`,
`_nearest_leg_lengths`, `_zoom_factor_for`) lives in the sibling
`placemark.py`. document assembly (`_build_dji_template_kml`,
`_build_dji_waylines_wpml`, `_append_dji_template_keepouts`) stays in
`builders.py` and imports from both this module and `placemark.py`.
"""

import math
import xml.etree.ElementTree as ET

from app.core.constants import DJI_WPML_ENUMS, DJI_WPML_M4T_FALLBACK_ENUM
from app.core.geometry import point_lonlatalt
from app.services.trajectory.orchestrator import _segment_duration_with_accel
from app.services.trajectory.types import (
    GIMBAL_SETTLE_TIME,
    LANDING_DURATION,
    MIN_SPEED_FLOOR,
    TAKEOFF_DURATION,
)
from app.utils.geo import distance_between, msl_to_hae

from ..shared import _sub_text, _waypoint_sort_key, _wpml_tag

# gimbal-settle penalty fires on segment-type transitions into a measurement
# or hover - mirrors the orchestrator's `_compute_totals` rule.
_GIMBAL_SETTLE_TYPES = ("MEASUREMENT", "HOVER")

# scopes where the operator hand-launches the drone and triggers the wayline
# while airborne: the wayline carries no ground takeoff/landing waypoints, the
# takeoff anchor is the airport ground, and the mission must not auto-land.
# after the FULL-scope collapse, every surviving scope is airborne; the
# constant is kept for future-scope extensibility and call-site clarity.
_AIRBORNE_SCOPES = frozenset({"FULL", "MEASUREMENTS_ONLY"})

# WPML range for takeOffSecurityHeight is [1.2, 1500] m on an RC-controlled
# aircraft; 0 is invalid. the operator hand-launches above this height so the
# climb-to-security phase is operationally inert - emit a small valid value.
_AIRBORNE_TAKEOFF_SECURITY_HEIGHT = "1.5"

# legacy underscore aliases for the existing call sites + tests; the source
# of truth lives in `app.core.constants` so the schema layer can read it
# without crossing the schemas -> services boundary.
_DJI_WPML_ENUMS = DJI_WPML_ENUMS
_M4T_FALLBACK_ENUM = DJI_WPML_M4T_FALLBACK_ENUM

# globalRTHHeight is takeoff-relative per the dji wpml spec (sibling of
# takeOffSecurityHeight). it must clear the highest waypoint in that same
# relative frame by this margin, never fall below the floor, and never exceed
# dji's documented [2,1500] ceiling. the floor doubles as the all-failure
# fallback so a mission can never fail to export over an rth computation.
_RTH_MARGIN_M = 20
_MIN_RTH_HEIGHT_M = 100
_MAX_RTH_HEIGHT_M = 1500

# wpml 1.0.6 documents globalTransitionalSpeed range as [0, 15]; emitting the
# inclusive upper bound trips WaylineCheckError -7 TransitionalSpeedOutOfRange
# on stricter pilot 2 firmware (zero margin for fp-rounding inside
# iwpmzmanager.checkValidation, zero margin for a future tightening to
# exclusive). stay strictly below the ceiling - dji's own samples emit 8 / 10.
_MAX_GLOBAL_TRANSITIONAL_SPEED = 14
# fallback when mission.default_speed is missing / zero; matches the cruise
# speed dji uses in its own canonical samples.
_DEFAULT_GLOBAL_TRANSITIONAL_SPEED = 8


def drone_supports_dji_wpml(drone_profile) -> bool:
    """true when the configured drone has a dji wpml drone-enum mapping."""
    return drone_profile is not None and drone_profile.model in _DJI_WPML_ENUMS


def _dji_enums_for(drone_profile) -> tuple[str, str, str, str]:
    """return the dji drone + payload enum tuple for the configured drone.

    resolves from `_DJI_WPML_ENUMS` by `drone_profile.model`; falls back to
    `_M4T_FALLBACK_ENUM` when the drone is unmapped, non-dji, or absent. the
    fallback is intentional - the firmware drives flight, the enum just
    labels the file - and the frontend surfaces a confirm modal so the user
    knows the file is tagged as an m4t.
    """
    if not drone_supports_dji_wpml(drone_profile):
        return _M4T_FALLBACK_ENUM
    return _DJI_WPML_ENUMS[drone_profile.model]


def _takeoff_ref_point(
    mission,
    flight_plan,
    airport_elevation: float = 0.0,
) -> str:
    """build the 'lat,lon,alt' string for wpml:takeOffRefPoint.

    the dji schema documents this z-field as HAE (ellipsoid height). with the
    wayline using executeHeightMode=relativeToStartPoint, takeOffRefPoint is
    route-planning metadata only - at execution the firmware uses the actual
    ground takeoff point as the relative origin.

    the operator hand-launches and triggers the wayline mid-air, so the wayline
    must not command takeoff or landing. collocate the ref point with WP1
    (lat/lon) at airport ground level regardless of mission.takeoff_coordinate -
    writing the operator's ground point would make fh2 draw a stray takeoff icon
    tethered to the first measurement. the MSL value goes through `msl_to_hae`
    so the metadata z stays HAE.
    """
    waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)
    if waypoints:
        lon, lat, _ = point_lonlatalt(waypoints[0].position)
        hae = msl_to_hae(lat, lon, airport_elevation)
        return f"{lat:.6f},{lon:.6f},{hae:.6f}"
    return "0.000000,0.000000,0.000000"


def _takeoff_ref_msl(mission, flight_plan, airport_elevation: float) -> float:
    """resolved takeoff-reference MSL - the datum relative heights subtract.

    mirrors _takeoff_ref_point's anchor selection but returns the raw MSL (not
    the HAE-converted string): the ref point sits at airport ground because the
    operator triggers the wayline mid-air.
    """
    return airport_elevation


def _global_rth_height(flight_plan, mission, airport_elevation: float) -> int:
    """takeoff-relative RTH ceiling that always clears the route.

    globalRTHHeight is relative to the takeoff point per the dji wpml spec - the
    same frame the wayline executeHeight now uses (relativeToStartPoint). it
    must clear the highest waypoint in that frame (max(wp.alt) - takeoff_msl)
    plus a margin, clamped to dji's [100, 1500]. any data gap falls back to the
    floor so a mission never fails to export.
    """
    try:
        waypoints = sorted(flight_plan.waypoints, key=_waypoint_sort_key)
        takeoff_msl = _takeoff_ref_msl(mission, flight_plan, airport_elevation)
        ceiling_rel = 0.0
        for wp in waypoints:
            try:
                _, _, alt = point_lonlatalt(wp.position)
            except ValueError:
                continue
            ceiling_rel = max(ceiling_rel, alt - takeoff_msl)
        rth = math.ceil(ceiling_rel + _RTH_MARGIN_M)
        return max(_MIN_RTH_HEIGHT_M, min(rth, _MAX_RTH_HEIGHT_M))
    except Exception:
        # last-resort floor: a bad mission/flight-plan shape must never block
        # the export - a safe spec-valid ceiling beats a failed mission.
        return _MIN_RTH_HEIGHT_M


def _resolve_global_transitional_speed(mission, drone_profile) -> str:
    """clamp globalTransitionalSpeed strictly below the wpml 1.0.6 [0,15] ceiling.

    sources mission.default_speed (fallback _DEFAULT_GLOBAL_TRANSITIONAL_SPEED
    when missing or zero), drone_profile.max_speed when known, and the spec
    sub-ceiling _MAX_GLOBAL_TRANSITIONAL_SPEED; emits the minimum. mission and
    drone_profile may be None; both default_speed and max_speed are nullable
    columns, so a missing value just drops out of the candidate set.
    """
    default = getattr(mission, "default_speed", None) if mission is not None else None
    mission_speed = (
        float(default)
        if isinstance(default, (int, float)) and not isinstance(default, bool) and default
        else float(_DEFAULT_GLOBAL_TRANSITIONAL_SPEED)
    )
    candidates: list[float] = [mission_speed, float(_MAX_GLOBAL_TRANSITIONAL_SPEED)]
    max_speed = getattr(drone_profile, "max_speed", None) if drone_profile is not None else None
    if isinstance(max_speed, (int, float)) and not isinstance(max_speed, bool) and max_speed > 0:
        candidates.append(float(max_speed))
    return f"{min(candidates):g}"


def _append_mission_config(
    doc,
    flight_plan,
    mission,
    drone_profile,
    *,
    in_waylines: bool,
    airport_elevation: float = 0.0,
) -> None:
    """build wpml:missionConfig. takeOffRefPoint belongs to template.kml only.

    every export uses the airborne-start config: the operator hand-launches and
    triggers the wayline mid-air, so the mission carries no ground takeoff/
    landing and must not auto-land - flyToWaylineMode=pointToPoint (no climb-to-
    safety ritual), finishAction=gotoFirstWaypoint (operator lands manually,
    never goHome/autoLand), takeOffSecurityHeight at a small spec-valid value.
    """
    drone_enum, drone_sub, payload_enum, payload_sub = _dji_enums_for(drone_profile)

    config = ET.SubElement(doc, _wpml_tag("missionConfig"))
    # child order matches the canonical sample in DJI's template-kml.md:
    # flyToWaylineMode, finishAction, exitOnRCLost, executeRCLostAction,
    # takeOffSecurityHeight, takeOffRefPoint (template only),
    # takeOffRefPointAGLHeight (template only), globalTransitionalSpeed,
    # globalRTHHeight (waylines only), droneInfo, payloadInfo.

    # drone is already in air at WP1, so no climb-to-safety ritual at the start
    # and no goHome at the end (operator reclaims the aircraft manually).
    _sub_text(config, "flyToWaylineMode", "pointToPoint")
    _sub_text(config, "finishAction", "gotoFirstWaypoint")
    _sub_text(config, "exitOnRCLost", "goContinue")
    _sub_text(config, "executeRCLostAction", "goBack")
    _sub_text(config, "takeOffSecurityHeight", _AIRBORNE_TAKEOFF_SECURITY_HEIGHT)
    if not in_waylines:
        # takeOffRefPoint lives in template.kml only; the real dji sample omits
        # it from waylines.wpml to keep the executable file minimal.
        _sub_text(
            config,
            "takeOffRefPoint",
            _takeoff_ref_point(mission, flight_plan, airport_elevation),
        )
        _sub_text(config, "takeOffRefPointAGLHeight", "0")
    _sub_text(
        config,
        "globalTransitionalSpeed",
        _resolve_global_transitional_speed(mission, drone_profile),
    )

    if in_waylines:
        # globalRTHHeight is waylines-only (common-element.md) and takeoff-
        # relative - the same frame as executeHeight; it must clear the highest
        # waypoint in that frame or dji rejects the file as "RTH below highest
        # route point". defensive: the helper floors and never raises.
        rth_height = _global_rth_height(flight_plan, mission, airport_elevation)
        _sub_text(config, "globalRTHHeight", str(rth_height))

    drone_info = ET.SubElement(config, _wpml_tag("droneInfo"))
    _sub_text(drone_info, "droneEnumValue", drone_enum)
    _sub_text(drone_info, "droneSubEnumValue", drone_sub)

    payload_info = ET.SubElement(config, _wpml_tag("payloadInfo"))
    _sub_text(payload_info, "payloadEnumValue", payload_enum)
    # pilot 2 emits the payloadSubEnumValue child in this block
    # (docs/specs/PAPI 22.kmz lines 22-26); the 1.0.2 docs omit it, so dropping
    # it would be a false-positive "fix" (audit 2026-05-26).
    _sub_text(payload_info, "payloadSubEnumValue", payload_sub)
    _sub_text(payload_info, "payloadPositionIndex", "0")


def _max_relative_height(waypoints, reference_msl: float) -> float:
    """highest waypoint height above the takeoff reference, or 100m fallback.

    measured in the same takeoff-relative frame as executeHeight so the
    folder-level globalHeight ceiling stays on the relative scale. a
    below-reference waypoint clamps to 0, matching the per-waypoint
    executeHeight clamp in `_append_placemark`.
    """
    heights = []
    for wp in waypoints:
        try:
            _, _, alt = point_lonlatalt(wp.position)
            heights.append(max(0.0, alt - reference_msl))
        except ValueError:
            continue
    return max(heights) if heights else 100.0


def _resolve_auto_speed(waypoints, mission, scope: str) -> str:
    """pick autoFlightSpeed - cruise speed for MEASUREMENTS_ONLY, first-wp otherwise.

    pilot RC rejects waylines whose autoFlightSpeed is below the drone's cruise
    threshold. in MEASUREMENTS_ONLY the first waypoint is a slow measurement
    (often <5 m/s), so we fall back to mission.default_speed when set.
    """
    if scope == "MEASUREMENTS_ONLY" and mission is not None:
        default = getattr(mission, "default_speed", None)
        if default:
            return f"{default:g}"
    return f"{waypoints[0].speed or 5:g}" if waypoints else "10"


def _emitted_distance_duration(
    waypoints, auto_speed: str, scope: str = "FULL"
) -> tuple[float, float]:
    """3D distance + duration over the emitted waypoint slice.

    pilot rc populates the mission summary panel from these wayline-level
    fields, so they must reflect the actual placemark stream rather than
    flight_plan.total_distance / estimated_duration (which are computed
    against the NTL trajectory and overstate MEASUREMENTS_ONLY slices).

    distance is `sqrt(horizontal_haversine^2 + altitude_delta^2)` per leg so
    the wayline summary reflects the true flight path length; horizontal-only
    haversine zeros out vertical-profile climbs at fixed standoff, where the
    drone genuinely travels meters of altitude even though lon/lat are
    constant.

    duration mirrors the orchestrator's `_compute_totals`: per-leg
    trapezoidal speed profile via `_segment_duration_with_accel`, FULL-scope
    takeoff + landing fixed time, a `GIMBAL_SETTLE_TIME` penalty on segment-
    type transitions into MEASUREMENT/HOVER, and the per-waypoint
    `hover_duration`. consuming the same helper keeps the wayline summary
    aligned with the persisted `flight_plan.estimated_duration` so the
    operator's ETA matches actual flight time.
    """
    try:
        auto_speed_f = float(auto_speed)
    except (TypeError, ValueError):
        auto_speed_f = 0.0
    speed_floor = max(auto_speed_f, MIN_SPEED_FLOOR)

    def _resolve_speed(wp) -> float:
        """waypoint speed -> the configured auto_speed -> MIN_SPEED_FLOOR."""
        s = getattr(wp, "speed", None)
        if s is not None and s > 0:
            return max(s, MIN_SPEED_FLOOR)
        return speed_floor

    total_dist = 0.0
    total_dur = TAKEOFF_DURATION + LANDING_DURATION if scope == "FULL" else 0.0

    parsed: list[tuple[float, float, float, object] | None] = []
    for wp in waypoints:
        try:
            lon, lat, alt = point_lonlatalt(wp.position)
        except ValueError:
            parsed.append(None)
            continue
        parsed.append((lon, lat, alt, wp))

    for j, current in enumerate(parsed):
        if current is None:
            continue
        if j > 0 and parsed[j - 1] is not None:
            lon1, lat1, alt1, prev_wp = parsed[j - 1]
            lon2, lat2, alt2, curr_wp = current
            horiz = distance_between(lon1, lat1, lon2, lat2)
            leg = math.hypot(horiz, alt2 - alt1)
            total_dist += leg
            v_prev = _resolve_speed(prev_wp)
            v_cur = _resolve_speed(curr_wp)
            total_dur += _segment_duration_with_accel(leg, v_prev, v_cur)
            if (
                prev_wp.waypoint_type != curr_wp.waypoint_type
                and curr_wp.waypoint_type in _GIMBAL_SETTLE_TYPES
            ):
                total_dur += GIMBAL_SETTLE_TIME

        wp = current[3]
        hover = getattr(wp, "hover_duration", None)
        if hover is not None:
            total_dur += hover

    return total_dist, total_dur
