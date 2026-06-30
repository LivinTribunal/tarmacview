"""litchi mission hub csv export."""

import csv
import io
import math

from app.core.constants import METERS_PER_DEG_LAT
from app.core.geometry import point_lonlatalt
from app.models.flight_plan import FlightPlan
from app.models.mission import Mission

from ..shared import _iter_waypoints_agl

# litchi camera action codes
_LITCHI_ACTION_TYPES = {
    "PHOTO_CAPTURE": 1,
    "RECORDING_START": 2,
    "RECORDING_STOP": 3,
}

# litchi action code for a timed dwell ("stay for", param = milliseconds)
_LITCHI_STAY_FOR_ACTION = 0
# litchi action code for "no action"
_LITCHI_NO_ACTION = -1
# action codes that pin the drone to a full stop - a curved fly-through
# would skip them, so curvesize is forced to 0 on rows carrying these
_LITCHI_STOP_TYPE_ACTIONS = frozenset({0, 2, 3})

# litchi gimbal modes
_LITCHI_GIMBAL_FOCUS_POI = 1
_LITCHI_GIMBAL_INTERPOLATE = 2

# fallback cruise speed when neither the waypoint nor the mission carries one
_LITCHI_DEFAULT_CRUISE_SPEED = 5.0
# positive floor so a zero/negative persisted speed never reaches the file
_LITCHI_MIN_SPEED = 0.1
# litchi rejects a 3d gap below this many metres between consecutive waypoints
_LITCHI_MIN_3D_DIST = 0.6
# curvesize as a fraction of the nearest-neighbour leg
_LITCHI_CURVE_FRACTION = 0.5
# litchi accepts at most 15 action pairs per waypoint
_LITCHI_MAX_ACTION_PAIRS = 15

# waypoint types that carry a measurement-target / dwell
_MEASUREMENT_TYPES = ("MEASUREMENT", "HOVER")


def _dist_3d(a: tuple, b: tuple) -> float:
    """3d distance in metres between two (lon, lat, alt) points."""
    lon1, lat1, alt1 = a
    lon2, lat2, alt2 = b
    mean_lat = math.radians((lat1 + lat2) / 2.0)
    dx = (lon2 - lon1) * METERS_PER_DEG_LAT * math.cos(mean_lat)
    dy = (lat2 - lat1) * METERS_PER_DEG_LAT
    dz = alt2 - alt1
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _rec_pos(rec: tuple) -> tuple:
    """(lon, lat, alt) of a waypoint record yielded by _iter_waypoints_agl."""
    return (rec[1], rec[2], rec[3])


def _group_collocated(records: list) -> list:
    """collapse runs of waypoints closer than the litchi 3d-distance floor."""
    groups: list[list] = []
    for rec in records:
        if groups and _dist_3d(_rec_pos(groups[-1][0]), _rec_pos(rec)) < _LITCHI_MIN_3D_DIST:
            groups[-1].append(rec)
        else:
            groups.append([rec])

    # defensive second pass: a near-but-not-exact duplicate can still leave
    # two group representatives under the floor - merge those until stable
    changed = True
    while changed and len(groups) > 1:
        changed = False
        merged: list[list] = [groups[0]]
        for grp in groups[1:]:
            prev = merged[-1]
            if _dist_3d(_rec_pos(prev[0]), _rec_pos(grp[0])) < _LITCHI_MIN_3D_DIST:
                merged[-1] = prev + grp
                changed = True
            else:
                merged.append(grp)
        groups = merged
    return groups


def _resolve_mission_speed(wp, mission: Mission | None) -> float:
    """fall back to mission speeds when the waypoint carries no usable speed."""
    if mission is not None:
        if wp.waypoint_type in _MEASUREMENT_TYPES:
            override = getattr(mission, "measurement_speed_override", None)
            if isinstance(override, (int, float)) and override > 0:
                return float(override)
        default = getattr(mission, "default_speed", None)
        if isinstance(default, (int, float)) and default > 0:
            return float(default)
    return _LITCHI_DEFAULT_CRUISE_SPEED


def _group_speed(members: list, mission: Mission | None) -> float:
    """resolve a positive litchi speed for a merged waypoint group."""
    for rec in members:
        speed = getattr(rec[0], "speed", None)
        if isinstance(speed, (int, float)) and speed > 0:
            return max(float(speed), _LITCHI_MIN_SPEED)
    return max(_resolve_mission_speed(members[0][0], mission), _LITCHI_MIN_SPEED)


def _group_actions(members: list) -> list:
    """litchi action pairs for a merged group; dwell preserved as 'stay for'."""
    actions: list[tuple[int, int]] = []
    for rec in members:
        wp = rec[0]
        code = _LITCHI_ACTION_TYPES.get(wp.camera_action)
        # any waypoint may carry a hover_duration (recording bookends now ride
        # on the first/last MEASUREMENT, not standalone HOVERs) - preserve the
        # dwell regardless of waypoint type so the camera-startup pause is
        # not silently dropped in the litchi file.
        dwell_ms = 0
        hover = getattr(wp, "hover_duration", None)
        if isinstance(hover, (int, float)) and hover > 0:
            dwell_ms = int(round(hover * 1000))

        # recording-stop dwells while still recording, then stops; every
        # other action fires first and the dwell follows
        if code == _LITCHI_ACTION_TYPES["RECORDING_STOP"]:
            if dwell_ms:
                actions.append((_LITCHI_STAY_FOR_ACTION, dwell_ms))
            actions.append((code, 0))
        else:
            if code is not None:
                actions.append((code, 0))
            if dwell_ms:
                actions.append((_LITCHI_STAY_FOR_ACTION, dwell_ms))

    # fold consecutive dwells from a hover-point-lock stack into one
    folded: list[tuple[int, int]] = []
    for code, param in actions:
        if code == _LITCHI_STAY_FOR_ACTION and folded and folded[-1][0] == _LITCHI_STAY_FOR_ACTION:
            folded[-1] = (_LITCHI_STAY_FOR_ACTION, folded[-1][1] + param)
        else:
            folded.append((code, param))
    return folded[:_LITCHI_MAX_ACTION_PAIRS]


def _group_poi(members: list, airport_elevation: float) -> tuple | None:
    """resolve (poi_lon, poi_lat, poi_agl) from a measurement/hover camera target."""
    for rec in members:
        wp = rec[0]
        if wp.waypoint_type not in _MEASUREMENT_TYPES:
            continue
        target = getattr(wp, "camera_target", None)
        if not target:
            continue
        t_lon, t_lat, t_alt = point_lonlatalt(target)
        target_agl = getattr(wp, "camera_target_agl", None)
        if isinstance(target_agl, (int, float)):
            poi_alt = float(target_agl)
        else:
            poi_alt = t_alt - airport_elevation
        return (t_lon, t_lat, poi_alt)
    return None


def _build_litchi_rows(groups: list, mission: Mission | None, airport_elevation: float) -> list:
    """flatten merged groups into per-row dicts (curvesize resolved later)."""
    rows: list[dict] = []
    for members in groups:
        _, lon, lat, alt, agl = members[0]
        types = {rec[0].waypoint_type for rec in members}
        heading = next((rec[0].heading for rec in members if rec[0].heading is not None), 0.0)
        gimbal_pitch = next(
            (rec[0].gimbal_pitch for rec in members if rec[0].gimbal_pitch is not None),
            None,
        )
        rows.append(
            {
                "lon": lon,
                "lat": lat,
                "alt": alt,
                "agl": agl,
                "heading": heading,
                "gimbal_pitch": gimbal_pitch,
                "actions": _group_actions(members),
                "poi": _group_poi(members, airport_elevation),
                "is_takeoff": "TAKEOFF" in types,
                "is_landing": "LANDING" in types,
                "speed": _group_speed(members, mission),
            }
        )
    return rows


def _curvesize_for(rows: list, i: int) -> float:
    """spacing-aware turn radius for row i; 0 where the drone must stop."""
    row = rows[i]
    if row["is_takeoff"] or row["is_landing"] or i == 0 or i == len(rows) - 1:
        return 0.0
    if any(code in _LITCHI_STOP_TYPE_ACTIONS for code, _ in row["actions"]):
        return 0.0

    pos = (row["lon"], row["lat"], row["alt"])
    prev, nxt = rows[i - 1], rows[i + 1]
    dist_prev = _dist_3d((prev["lon"], prev["lat"], prev["alt"]), pos)
    dist_next = _dist_3d(pos, (nxt["lon"], nxt["lat"], nxt["alt"]))
    return min(dist_prev, dist_next) * _LITCHI_CURVE_FRACTION


def generate_litchi_csv(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    mission: Mission | None = None,
) -> bytes:
    """serialize flight plan to litchi mission hub csv format."""
    records = list(_iter_waypoints_agl(flight_plan, airport_elevation))
    groups = _group_collocated(records)
    rows = _build_litchi_rows(groups, mission, airport_elevation)

    action_width = max((len(row["actions"]) for row in rows), default=0)
    action_width = max(1, min(action_width, _LITCHI_MAX_ACTION_PAIRS))

    buf = io.StringIO()
    writer = csv.writer(buf)

    header = [
        "latitude",
        "longitude",
        "altitude(m)",
        "heading(deg)",
        "curvesize(m)",
        "rotationdir",
        "gimbalmode",
        "gimbalpitchangle",
    ]
    for n in range(1, action_width + 1):
        header.append(f"actiontype{n}")
        header.append(f"actionparam{n}")
    header += [
        "altitudemode",
        "speed(m/s)",
        "poi_latitude",
        "poi_longitude",
        "poi_altitude(m)",
        "poi_altitudemode",
        "photo_timeinterval",
        "photo_distinterval",
    ]
    writer.writerow(header)

    for i, row in enumerate(rows):
        curvesize = _curvesize_for(rows, i)
        if row["poi"] is not None:
            poi_lon, poi_lat, poi_alt = row["poi"]
            gimbal_mode = _LITCHI_GIMBAL_FOCUS_POI
        else:
            poi_lon = poi_lat = poi_alt = 0.0
            gimbal_mode = _LITCHI_GIMBAL_INTERPOLATE

        action_cells: list = []
        actions = row["actions"]
        for n in range(action_width):
            code, param = actions[n] if n < len(actions) else (_LITCHI_NO_ACTION, 0)
            action_cells.append(code)
            action_cells.append(param)

        writer.writerow(
            [
                f"{row['lat']:.8f}",
                f"{row['lon']:.8f}",
                f"{row['agl']:.2f}",
                f"{row['heading']:.1f}",
                f"{curvesize:.2f}",
                0,
                gimbal_mode,
                f"{row['gimbal_pitch'] or 0:.1f}",
                *action_cells,
                0,
                f"{row['speed']:.2f}",
                f"{poi_lat:.8f}",
                f"{poi_lon:.8f}",
                f"{poi_alt:.2f}",
                0,
                -1,
                -1,
            ]
        )

    return buf.getvalue().encode("utf-8")
