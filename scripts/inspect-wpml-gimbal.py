#!/usr/bin/env python3
"""inspect-wpml-gimbal.py - simulate gimbal motion from a generated DJI KMZ.

Parses waylines.wpml from a generated KMZ, extracts the gimbal commands
(per-WP gimbalRotate snaps + per-segment gimbalEvenlyRotate sweeps), and
builds a (time, pitch) trace of what the drone's gimbal would do during the
flight. Prints a per-segment breakdown plus an ASCII line chart, and can
optionally save a matplotlib PNG.

This is the no-hardware verification path for VP video smooth-sweep exports
(issue #444 / PR #446) when neither a DJI Dock nor an RC2 + drone is
available. It tells you what the WPML *commands*; whether the M4T's actual
firmware honors those commands the way you expect still requires hardware.

Usage:
    python scripts/inspect-wpml-gimbal.py path/to/mission.kmz
    python scripts/inspect-wpml-gimbal.py path/to/mission.kmz --plot out.png
    python scripts/inspect-wpml-gimbal.py --demo                 # synthesize a sample VP video KMZ
    python scripts/inspect-wpml-gimbal.py --demo --plot demo.png

Reads only stdlib + optional matplotlib. The demo mode imports the backend's
export_service and the test helper that builds a VP video pass fixture, so
the demo runs end-to-end against the same code path the production export
uses.
"""

from __future__ import annotations

import argparse
import math
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path

WPML_NS = "http://www.dji.com/wpmz/1.0.6"
KML_NS = "http://www.opengis.net/kml/2.2"


def _wp(tag: str) -> str:
    return f"{{{WPML_NS}}}{tag}"


def _km(tag: str) -> str:
    return f"{{{KML_NS}}}{tag}"


@dataclass
class Placemark:
    """parsed wpml waypoint with the gimbal-relevant + yaw-relevant fields."""

    seq: int
    lon: float
    lat: float
    alt: float
    speed: float
    turn_mode: str
    snap_pitch: float | None = None
    segment_target_pitch: float | None = None
    segment_end_index: int | None = None
    waypoint_type_hint: str = ""
    heading_mode: str = ""
    poi_point: tuple[float, float, float] | None = None
    rotate_yaw_target: float | None = None


@dataclass
class WaylineMeta:
    """folder-level metadata captured from waylines.wpml + template.kml.

    captures the fields driven by issue #442 / PR #445: the
    waylineCoordinateSysParam block (must be present in both files for Pilot
    RC to draw the polyline + populate the mission summary panel) and the
    folder-level distance/duration claims (must match the Haversine sum over
    the emitted waypoints, since flight_plan.total_distance / estimated_duration
    persist FULL-trajectory values that overstate MO/NTL slices).
    """

    waylines_coord_mode: str = ""
    waylines_height_mode: str = ""
    waylines_execute_height_mode: str = ""
    waylines_auto_flight_speed: float | None = None
    waylines_distance_claimed: float | None = None
    waylines_duration_claimed: float | None = None
    template_coord_mode: str = ""
    template_height_mode: str = ""


def _parse_pitch(action: ET.Element) -> float | None:
    """pull gimbalPitchRotateAngle out of an action's actuator params."""
    angle_el = action.find(
        f"{_wp('actionActuatorFuncParam')}/{_wp('gimbalPitchRotateAngle')}"
    )
    if angle_el is None or not angle_el.text:
        return None
    return float(angle_el.text)


def _parse_coord_sys(folder_el: ET.Element) -> tuple[str, str]:
    """pull (coordinateMode, heightMode) out of a folder's waylineCoordinateSysParam."""
    cs = folder_el.find(_wp("waylineCoordinateSysParam"))
    if cs is None:
        return "", ""
    cm = cs.find(_wp("coordinateMode"))
    hm = cs.find(_wp("heightMode"))
    return (
        (cm.text or "") if cm is not None else "",
        (hm.text or "") if hm is not None else "",
    )


def parse_kmz(kmz_path: Path) -> tuple[list[Placemark], WaylineMeta]:
    """unzip the kmz and return (placemarks_in_order, wayline_metadata)."""
    with zipfile.ZipFile(kmz_path) as zf:
        wpml_text = zf.read("wpmz/waylines.wpml").decode("utf-8")
        try:
            template_text = zf.read("wpmz/template.kml").decode("utf-8")
        except KeyError:
            template_text = ""
    root = ET.fromstring(wpml_text)

    meta = WaylineMeta()
    folder_el = next((el for el in root.iter(_km("Folder"))), None)
    if folder_el is not None:
        meta.waylines_coord_mode, meta.waylines_height_mode = _parse_coord_sys(
            folder_el
        )
        ehm = folder_el.find(_wp("executeHeightMode"))
        if ehm is not None and ehm.text:
            meta.waylines_execute_height_mode = ehm.text
        speed_el = folder_el.find(_wp("autoFlightSpeed"))
        if speed_el is not None and speed_el.text:
            try:
                meta.waylines_auto_flight_speed = float(speed_el.text)
            except ValueError:
                pass
        dist_el = folder_el.find(_wp("distance"))
        if dist_el is not None and dist_el.text:
            try:
                meta.waylines_distance_claimed = float(dist_el.text)
            except ValueError:
                pass
        dur_el = folder_el.find(_wp("duration"))
        if dur_el is not None and dur_el.text:
            try:
                meta.waylines_duration_claimed = float(dur_el.text)
            except ValueError:
                pass

    if template_text:
        try:
            tmpl_root = ET.fromstring(template_text)
            tmpl_folder = next((el for el in tmpl_root.iter(_km("Folder"))), None)
            if tmpl_folder is not None:
                meta.template_coord_mode, meta.template_height_mode = _parse_coord_sys(
                    tmpl_folder
                )
        except ET.ParseError:
            pass

    placemarks: list[Placemark] = []
    for pm_el in root.iter(_km("Placemark")):
        seq_el = pm_el.find(_wp("index"))
        if seq_el is None or seq_el.text is None:
            continue
        seq = int(seq_el.text)

        coords_el = pm_el.find(f".//{_km('coordinates')}")
        lon = lat = 0.0
        if coords_el is not None and coords_el.text:
            parts = coords_el.text.strip().split(",")
            lon = float(parts[0])
            lat = float(parts[1])

        height_el = pm_el.find(_wp("executeHeight"))
        alt = (
            float(height_el.text) if (height_el is not None and height_el.text) else 0.0
        )

        speed_el = pm_el.find(_wp("waypointSpeed"))
        speed = (
            float(speed_el.text) if (speed_el is not None and speed_el.text) else 0.0
        )

        turn_mode = "(global)"
        turn_param = pm_el.find(_wp("waypointTurnParam"))
        if turn_param is not None:
            tm_el = turn_param.find(_wp("waypointTurnMode"))
            if tm_el is not None and tm_el.text:
                turn_mode = tm_el.text

        # heading mode + POI (from waypointHeadingParam, either per-placemark
        # in waylines.wpml or via useGlobalHeadingParam=1 inheriting the folder
        # default). per-placemark towardPOI for aimed waypoints is the issue
        # #443 fix; non-aimed waypoints stay on followWayline.
        heading_mode = ""
        poi_point: tuple[float, float, float] | None = None
        heading_param = pm_el.find(_wp("waypointHeadingParam"))
        if heading_param is not None:
            hm_el = heading_param.find(_wp("waypointHeadingMode"))
            if hm_el is not None and hm_el.text:
                heading_mode = hm_el.text
            poi_el = heading_param.find(_wp("waypointPoiPoint"))
            if poi_el is not None and poi_el.text:
                parts = poi_el.text.strip().split(",")
                if len(parts) == 3:
                    try:
                        poi_lat, poi_lon, poi_alt = (float(x) for x in parts)
                        # ignore the 0,0,0 sentinel used by followWayline blocks
                        if not (poi_lat == 0.0 and poi_lon == 0.0 and poi_alt == 0.0):
                            poi_point = (poi_lat, poi_lon, poi_alt)
                    except ValueError:
                        pass

        snap_pitch: float | None = None
        seg_target: float | None = None
        seg_end_idx: int | None = None
        rotate_yaw_target: float | None = None

        for grp in pm_el.findall(_wp("actionGroup")):
            trigger_el = grp.find(f"{_wp('actionTrigger')}/{_wp('actionTriggerType')}")
            if trigger_el is None:
                continue
            trigger = trigger_el.text or ""
            for action in grp.findall(_wp("action")):
                func_el = action.find(_wp("actionActuatorFunc"))
                if func_el is None:
                    continue
                func = func_el.text or ""
                if trigger == "reachPoint" and func == "gimbalRotate":
                    snap_pitch = _parse_pitch(action)
                elif (
                    trigger == "betweenAdjacentPoints" and func == "gimbalEvenlyRotate"
                ):
                    seg_target = _parse_pitch(action)
                    end_idx_el = grp.find(_wp("actionGroupEndIndex"))
                    if end_idx_el is not None and end_idx_el.text:
                        seg_end_idx = int(end_idx_el.text)
                elif trigger == "reachPoint" and func == "rotateYaw":
                    yaw_el = action.find(
                        f"{_wp('actionActuatorFuncParam')}/{_wp('aircraftHeading')}"
                    )
                    if yaw_el is not None and yaw_el.text:
                        try:
                            rotate_yaw_target = float(yaw_el.text)
                        except ValueError:
                            pass

        # heuristic hint about waypoint role (helpful in the per-WP table)
        hint = ""
        for action in pm_el.iter(_wp("action")):
            func_el = action.find(_wp("actionActuatorFunc"))
            if func_el is None or func_el.text is None:
                continue
            if func_el.text == "startRecord":
                hint = "REC_START"
                break
            if func_el.text == "stopRecord":
                hint = "REC_STOP"
                break
            if func_el.text == "takePhoto":
                hint = "PHOTO"
        if not hint:
            hover_el = next(
                (
                    a
                    for a in pm_el.iter(_wp("action"))
                    if (
                        a.find(_wp("actionActuatorFunc")) is not None
                        and a.find(_wp("actionActuatorFunc")).text == "hover"
                    )
                ),
                None,
            )
            if hover_el is not None:
                hint = "HOVER"

        placemarks.append(
            Placemark(
                seq=seq,
                lon=lon,
                lat=lat,
                alt=alt,
                speed=speed,
                turn_mode=turn_mode,
                snap_pitch=snap_pitch,
                segment_target_pitch=seg_target,
                segment_end_index=seg_end_idx,
                waypoint_type_hint=hint,
                heading_mode=heading_mode,
                poi_point=poi_point,
                rotate_yaw_target=rotate_yaw_target,
            )
        )

    placemarks.sort(key=lambda p: p.seq)
    return placemarks, meta


def haversine_3d(p1: Placemark, p2: Placemark) -> float:
    """great-circle horizontal + euclidean vertical, in meters."""
    earth_r = 6371000.0
    lon1, lat1 = math.radians(p1.lon), math.radians(p1.lat)
    lon2, lat2 = math.radians(p2.lon), math.radians(p2.lat)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    horiz = earth_r * 2 * math.asin(math.sqrt(a))
    vert = p2.alt - p1.alt
    return math.sqrt(horiz * horiz + vert * vert)


def simulate(
    placemarks: list[Placemark], samples_per_segment: int = 30
) -> tuple[list[float], list[float], list[dict]]:
    """walk segments and build (times, pitches, segment_breakdown).

    state machine:
      - current pitch starts at 0 (or the first WP's snap, if any)
      - reaching a WP with snap_pitch -> instantaneous step to that value
      - segment WP_N -> WP_N+1 with WP_N.segment_target_pitch set ->
          linear interp from current pitch to target across the segment
      - segment without segment_target_pitch -> hold current pitch (manual mode)
      - segment time = 3D distance / max(WP_N.speed, 0.1) m/s

    matches the real M4T behavior our wpml drives: gimbalRotate snap is
    instantaneous (gimbalRotateTimeEnable=0), gimbalEvenlyRotate is the
    documented evenly-distribute-across-segment action.
    """
    if not placemarks:
        return [], [], []

    seed = next((p.snap_pitch for p in placemarks if p.snap_pitch is not None), 0.0)
    times: list[float] = [0.0]
    pitches: list[float] = [seed]
    breakdown: list[dict] = []

    current = seed
    t = 0.0

    for i, pm in enumerate(placemarks):
        if pm.snap_pitch is not None and pm.snap_pitch != current:
            # instantaneous snap when reached - record the step at this t
            times.append(t)
            pitches.append(current)
            current = pm.snap_pitch
            times.append(t)
            pitches.append(current)

        if i + 1 >= len(placemarks):
            break

        nxt = placemarks[i + 1]
        dist = haversine_3d(pm, nxt)
        speed = max(pm.speed, 0.1)
        dt = dist / speed

        seg_info = {
            "from_seq": pm.seq,
            "to_seq": nxt.seq,
            "dist_m": dist,
            "speed_mps": speed,
            "duration_s": dt,
            "start_pitch": current,
            "end_pitch": current,
            "mechanism": "hold",
        }

        if pm.segment_target_pitch is not None:
            target = pm.segment_target_pitch
            seg_info["mechanism"] = "gimbalEvenlyRotate"
            seg_info["end_pitch"] = target
            for k in range(1, samples_per_segment + 1):
                f = k / samples_per_segment
                interp = current + (target - current) * f
                times.append(t + dt * f)
                pitches.append(interp)
            current = target
        else:
            # hold over the segment - record one sample at the segment end
            times.append(t + dt)
            pitches.append(current)

        t += dt
        breakdown.append(seg_info)

    return times, pitches, breakdown


def ascii_chart(
    times: list[float], pitches: list[float], width: int = 78, height: int = 18
) -> str:
    """draw an ASCII line chart of pitch vs time."""
    if not times or not pitches:
        return "(empty trace)"
    pmin, pmax = min(pitches), max(pitches)
    if pmax - pmin < 0.01:
        pmin -= 0.5
        pmax += 0.5
    tmin, tmax = times[0], times[-1]
    if tmax - tmin < 0.01:
        return "(zero-duration trace - check that placemarks have non-zero speed)"

    grid = [[" "] * width for _ in range(height)]
    for tt, pp in zip(times, pitches):
        x = int((tt - tmin) / (tmax - tmin) * (width - 1))
        y = int((pp - pmin) / (pmax - pmin) * (height - 1))
        y = height - 1 - y
        if 0 <= x < width and 0 <= y < height:
            grid[y][x] = "*"

    lines: list[str] = []
    for y in range(height):
        v = pmax - (pmax - pmin) * (y / (height - 1))
        lines.append(f"{v:7.2f}° |{''.join(grid[y])}")
    lines.append("        +" + "-" * width)
    label = f"0s{' ' * (width - 4 - len(f'{tmax:.1f}s'))}{tmax:.1f}s"
    lines.append(f"         {label}")
    return "\n".join(lines)


def print_placemark_table(placemarks: list[Placemark]) -> None:
    print()
    print(
        f"{'seq':>4}  {'role':<10} {'turn':<14} {'speed':>6} {'snap':>10} {'seg→':>10} {'next':>5}"
    )
    print("-" * 78)
    for p in placemarks:
        snap = f"{p.snap_pitch:+7.2f}°" if p.snap_pitch is not None else "       -"
        seg = (
            f"{p.segment_target_pitch:+7.2f}°"
            if p.segment_target_pitch is not None
            else "       -"
        )
        nxt = str(p.segment_end_index) if p.segment_end_index is not None else "  -"
        tm_short = (
            p.turn_mode.replace(
                "toPointAndStopWithDiscontinuityCurvature", "stop+discont"
            )
            .replace("toPointAndPassWithContinuityCurvature", "pass+cont ")
            .replace("toPointAndStopWithContinuityCurvature", "stop+cont ")
        )
        print(
            f"{p.seq:>4}  {p.waypoint_type_hint:<10} {tm_short:<14} "
            f"{p.speed:>6.1f} {snap:>10} {seg:>10} {nxt:>5}"
        )


def emitted_distance_duration(
    placemarks: list[Placemark], auto_speed: float | None
) -> tuple[float, float]:
    """compute (3d_distance_m, duration_s) over consecutive placemarks.

    mirrors backend's _emitted_distance_duration: per-leg distance is the 3D
    flight path (sqrt(horizontal_haversine^2 + altitude_delta^2)) so vertical
    climbs at fixed standoff don't zero out; per-leg duration is `leg /
    (curr.speed or auto_speed)`. on uniform-speed plans this collapses to
    total_distance / auto_speed.
    """
    if len(placemarks) < 2:
        return 0.0, 0.0
    fallback = max(auto_speed or 0.0, 0.1)
    total_dist = 0.0
    total_dur = 0.0
    for a, b in zip(placemarks, placemarks[1:]):
        leg = haversine_3d(a, b)
        # match backend's _emitted_distance_duration: leg_speed is the
        # DESTINATION wp's speed (the speed used to reach it), not origin's
        leg_speed = b.speed if b.speed and b.speed > 0 else fallback
        total_dist += leg
        total_dur += leg / leg_speed
    return total_dist, total_dur


def print_mission_stats(placemarks: list[Placemark], meta: WaylineMeta) -> None:
    """verify issue #442 / PR #445: waylineCoordinateSysParam + distance/duration.

    pilot rc refuses to draw the polyline + populate the mission summary panel
    when the wayline-level metadata is missing or inconsistent with the
    placemark stream. this prints both checks and emits a verdict.
    """
    print()
    print("=" * 78)
    print("MISSION STATS / COORD-SYS  (issue #442 / PR #445)")
    print("=" * 78)

    cs_template_ok = (
        meta.template_coord_mode == "WGS84"
        and meta.template_height_mode in ("EGM96", "WGS84")
    )
    cs_waylines_ok = (
        meta.waylines_coord_mode == "WGS84"
        and meta.waylines_height_mode in ("EGM96", "WGS84")
    )
    print()
    print(
        f"  template.kml  waylineCoordinateSysParam: "
        f"coordinateMode={meta.template_coord_mode or '(missing)'}, "
        f"heightMode={meta.template_height_mode or '(missing)'} "
        f"{'✓' if cs_template_ok else '✗'}"
    )
    print(
        f"  waylines.wpml waylineCoordinateSysParam: "
        f"coordinateMode={meta.waylines_coord_mode or '(missing)'}, "
        f"heightMode={meta.waylines_height_mode or '(missing)'} "
        f"{'✓' if cs_waylines_ok else '✗'}"
    )
    print(
        f"  waylines.wpml executeHeightMode: "
        f"{meta.waylines_execute_height_mode or '(missing)'}"
    )

    computed_dist, computed_dur = emitted_distance_duration(
        placemarks, meta.waylines_auto_flight_speed
    )
    claimed_dist = meta.waylines_distance_claimed
    claimed_dur = meta.waylines_duration_claimed

    print()
    print(f"  emitted waypoints: {len(placemarks)}")
    print(f"  autoFlightSpeed:   {meta.waylines_auto_flight_speed} m/s")

    if claimed_dist is None:
        print("  ✗ <wpml:distance> MISSING from waylines folder")
    else:
        delta = claimed_dist - computed_dist
        rel_err = abs(delta) / computed_dist if computed_dist > 0.01 else 0.0
        ok = abs(delta) < 1.0 or rel_err < 0.01
        print(
            f"  distance: claimed={claimed_dist:.2f} m, "
            f"computed_3d={computed_dist:.2f} m, "
            f"delta={delta:+.2f} m  {'✓' if ok else '✗'}"
        )

    if claimed_dur is None:
        print("  ✗ <wpml:duration> MISSING from waylines folder")
    else:
        delta = claimed_dur - computed_dur
        rel_err = abs(delta) / computed_dur if computed_dur > 0.01 else 0.0
        ok = abs(delta) < 1.0 or rel_err < 0.01
        print(
            f"  duration: claimed={claimed_dur:.2f} s, "
            f"computed_per_leg={computed_dur:.2f} s, "
            f"delta={delta:+.2f} s  {'✓' if ok else '✗'}"
        )

    print()
    issues: list[str] = []
    if not cs_template_ok:
        issues.append("template.kml waylineCoordinateSysParam missing/wrong")
    if not cs_waylines_ok:
        issues.append("waylines.wpml waylineCoordinateSysParam missing/wrong")
    if claimed_dist is None or (
        claimed_dist is not None
        and computed_dist > 0.01
        and abs(claimed_dist - computed_dist) >= 1.0
        and abs(claimed_dist - computed_dist) / computed_dist >= 0.01
    ):
        issues.append("distance mismatch (or missing)")
    if claimed_dur is None or (
        claimed_dur is not None
        and computed_dur > 0.01
        and abs(claimed_dur - computed_dur) >= 1.0
        and abs(claimed_dur - computed_dur) / computed_dur >= 0.01
    ):
        issues.append("duration mismatch (or missing)")

    if not issues:
        print(
            "  mission-stats verdict: ✓ Pilot RC should draw the polyline + "
            "populate the summary panel"
        )
    else:
        print(
            "  mission-stats verdict: ✗ likely Pilot RC reasons to refuse the summary:"
        )
        for s in issues:
            print(f"    - {s}")


def print_yaw_summary(placemarks: list[Placemark]) -> None:
    """print per-WP heading mode + POI + rotateYaw, plus a HR/VP verdict.

    issue #443 fix: aimed waypoints (MEASUREMENT/HOVER with camera_target) emit
    waypointHeadingMode=towardPOI with a non-zero waypointPoiPoint, and the
    rotateYaw action is suppressed (towardPOI handles continuous body tracking
    across the arc). non-aimed waypoints stay on followWayline. issue #444 fix:
    aim mechanism is unchanged from #443 - VP video adds the smooth pitch
    sweep on top.
    """
    print()
    print(
        f"{'seq':>4}  {'role':<10} {'heading_mode':<18} {'POI (lat,lon,alt)':<32} {'rotateYaw':>10}"
    )
    print("-" * 78)
    for p in placemarks:
        poi = (
            f"{p.poi_point[0]:.5f},{p.poi_point[1]:.5f},{p.poi_point[2]:.1f}"
            if p.poi_point
            else "-"
        )
        ry = f"{p.rotate_yaw_target:+7.2f}°" if p.rotate_yaw_target is not None else "-"
        hm = p.heading_mode or "(global)"
        print(f"{p.seq:>4}  {p.waypoint_type_hint:<10} {hm:<18} {poi:<32} {ry:>10}")
    print()

    aimed = [
        p
        for p in placemarks
        if p.waypoint_type_hint in ("REC_START", "REC_STOP", "PHOTO", "HOVER")
        or p.snap_pitch is not None
        or p.segment_target_pitch is not None
    ]
    if not aimed:
        return
    toward_poi_count = sum(
        1 for p in aimed if p.heading_mode == "towardPOI" and p.poi_point
    )
    follow_wayline_count = sum(1 for p in aimed if p.heading_mode == "followWayline")
    rotate_yaw_count = sum(1 for p in aimed if p.rotate_yaw_target is not None)

    if toward_poi_count == len(aimed) and rotate_yaw_count == 0:
        verdict = "✓ towardPOI active — body continuously tracks LHA across the pass"
    elif follow_wayline_count == len(aimed) and rotate_yaw_count == len(aimed):
        verdict = (
            "✗ followWayline + per-WP rotateYaw — body snaps at each WP "
            "(pre-#443 behavior, the choppy yaw the user complained about)"
        )
    else:
        verdict = (
            f"? mixed: {toward_poi_count}/{len(aimed)} towardPOI, "
            f"{follow_wayline_count}/{len(aimed)} followWayline, "
            f"{rotate_yaw_count}/{len(aimed)} have rotateYaw — investigate per-WP table"
        )
    print(f"  yaw verdict: {verdict}")


def print_segment_breakdown(breakdown: list[dict]) -> None:
    if not breakdown:
        return
    print()
    print(
        f"{'seg':>4}  {'mechanism':<22} {'dur':>6}  "
        f"{'pitch_from':>10} {'pitch_to':>10} {'Δ':>7}"
    )
    print("-" * 78)
    for i, seg in enumerate(breakdown):
        delta = seg["end_pitch"] - seg["start_pitch"]
        marker = " "
        if seg["mechanism"] == "gimbalEvenlyRotate":
            marker = "✓"
        elif abs(delta) > 0.01 and seg["mechanism"] == "hold":
            # pitch moved during a hold segment - that's a snap landing midway
            marker = "·"
        print(
            f"{i:>4}{marker} {seg['mechanism']:<22} {seg['duration_s']:>5.1f}s  "
            f"{seg['start_pitch']:>+9.2f}° {seg['end_pitch']:>+9.2f}° "
            f"{delta:>+6.2f}°"
        )
    print()
    sweep_count = sum(1 for s in breakdown if s["mechanism"] == "gimbalEvenlyRotate")
    hold_count = sum(1 for s in breakdown if s["mechanism"] == "hold")
    print(f"  {sweep_count} smooth-sweep segments, {hold_count} hold segments")


def maybe_plot(
    times: list[float],
    pitches: list[float],
    placemarks: list[Placemark],
    breakdown: list[dict],
    out_path: Path,
) -> None:
    """save a matplotlib PNG with snap points + segment-target markers."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print(f"(matplotlib not installed - cannot write {out_path})")
        return

    fig, ax = plt.subplots(figsize=(13, 5))
    ax.plot(
        times,
        pitches,
        "-",
        linewidth=1.6,
        color="#1f77b4",
        label="commanded gimbal pitch",
    )

    snap_t: list[float] = []
    snap_p: list[float] = []
    seg_t: list[float] = []
    seg_p: list[float] = []
    cur_t = 0.0
    for i, pm in enumerate(placemarks):
        if pm.snap_pitch is not None:
            snap_t.append(cur_t)
            snap_p.append(pm.snap_pitch)
        if i + 1 < len(placemarks):
            nxt = placemarks[i + 1]
            dt = haversine_3d(pm, nxt) / max(pm.speed, 0.1)
            cur_t += dt
            if pm.segment_target_pitch is not None:
                seg_t.append(cur_t)
                seg_p.append(pm.segment_target_pitch)

    if snap_t:
        ax.scatter(
            snap_t,
            snap_p,
            color="red",
            s=55,
            label="gimbalRotate snap",
            zorder=5,
            marker="o",
        )
    if seg_t:
        ax.scatter(
            seg_t,
            seg_p,
            color="green",
            s=55,
            label="gimbalEvenlyRotate target",
            zorder=5,
            marker="s",
        )

    ax.set_xlabel("time since first waypoint (s)")
    ax.set_ylabel("gimbal pitch (deg, negative = looking down)")
    ax.set_title(f"expected gimbal pitch profile — {out_path.stem}")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="best")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"plot saved to {out_path}")


def generate_demo_kmz(out_path: Path, num_measurements: int = 6) -> None:
    """build a synthetic VP video pass via the test fixtures + export_service."""
    repo_root = Path(__file__).resolve().parent.parent
    backend_dir = repo_root / "backend"
    if not backend_dir.exists():
        raise SystemExit(
            f"can't find backend at {backend_dir}; run from repo root or pass an explicit kmz path"
        )
    sys.path.insert(0, str(backend_dir))
    try:
        from app.services import export_service  # type: ignore[import-not-found]
        from tests.test_export_service import _make_vp_video_pass  # type: ignore[import-not-found]
    except ImportError as e:
        raise SystemExit(
            f"failed to import backend modules ({e}); ensure the backend deps are installed "
            f"(pip install -r backend/requirements.txt)"
        ) from e

    fp, mission, _ = _make_vp_video_pass(
        num_measurements=num_measurements, with_bookends=True
    )
    kmz = export_service.generate_kmz(fp, "demo-vp-video", 290.0, mission=mission)
    out_path.write_bytes(kmz)
    print(
        f"demo kmz written to {out_path} ({num_measurements} measurements + 2 hover bookends)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="simulate gimbal motion from a generated DJI KMZ.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "kmz",
        nargs="?",
        type=Path,
        help="path to a generated KMZ file (omit when --demo is set)",
    )
    parser.add_argument(
        "--plot",
        type=Path,
        help="also save a matplotlib PNG line chart to this path",
    )
    parser.add_argument(
        "--no-table",
        action="store_true",
        help="suppress the per-WP table",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="synthesize a sample VP video KMZ via export_service and inspect it",
    )
    parser.add_argument(
        "--demo-measurements",
        type=int,
        default=6,
        help="how many measurements in the synthesized VP video pass (default: 6)",
    )
    args = parser.parse_args()

    kmz_path: Path
    tmp_dir: tempfile.TemporaryDirectory | None = None
    if args.demo:
        tmp_dir = tempfile.TemporaryDirectory(prefix="wpml-demo-")
        kmz_path = Path(tmp_dir.name) / "demo.kmz"
        generate_demo_kmz(kmz_path, num_measurements=args.demo_measurements)
    else:
        if args.kmz is None:
            parser.error("kmz path is required (or pass --demo)")
        kmz_path = args.kmz
        if not kmz_path.exists():
            raise SystemExit(f"file not found: {kmz_path}")

    placemarks, meta = parse_kmz(kmz_path)
    if not placemarks:
        raise SystemExit("no placemarks found in waylines.wpml")

    if not args.no_table:
        print_placemark_table(placemarks)

    print_mission_stats(placemarks, meta)
    print_yaw_summary(placemarks)

    times, pitches, breakdown = simulate(placemarks)
    print_segment_breakdown(breakdown)

    print()
    print("expected gimbal pitch over time (commanded by the WPML):")
    print(ascii_chart(times, pitches))

    if args.plot:
        maybe_plot(times, pitches, placemarks, breakdown, args.plot)

    if tmp_dir is not None:
        tmp_dir.cleanup()


if __name__ == "__main__":
    main()
