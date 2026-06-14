"""mission-media matching - time window, area containment, tie-break, failure safety."""

from datetime import datetime, timezone
from uuid import uuid4

from app.core.enums import MediaFileStatus
from app.models.agl import AGL, LHA
from app.models.airport import Airport, Runway
from app.models.drone_media_file import DroneMediaFile
from app.models.flight_plan import FlightPlan, Waypoint
from app.models.inspection import Inspection, InspectionTemplate
from app.models.mission import Mission
from app.models.wayline_dispatch import WaylineDispatch
from app.services import drone_media_service

# coordinates isolated from every other suite so committed fixtures from
# api-level tests can never become accidental matching candidates here
BASE_LON, BASE_LAT = 15.50, 49.50

DISPATCHED_AT = datetime(2026, 6, 9, 10, 0, tzinfo=timezone.utc)
CAPTURED_AT = datetime(2026, 6, 9, 12, 0, tzinfo=timezone.utc)
BEFORE_DISPATCH = datetime(2026, 6, 9, 9, 0, tzinfo=timezone.utc)


def _wkt(lon: float, lat: float, alt: float = 400.0) -> str:
    """point z wkt literal."""
    return f"POINT Z ({lon} {lat} {alt})"


def _make_airport(db) -> Airport:
    """minimal airport row for fk chains."""
    airport = Airport(
        icao_code=uuid4().hex[:4].upper(),
        name="Matching Airport",
        elevation=300.0,
        location=_wkt(BASE_LON, BASE_LAT, 300.0),
    )
    db.add(airport)
    db.flush()
    return airport


def _make_mission(
    db,
    airport,
    *,
    bbox=(BASE_LON, BASE_LAT, BASE_LON + 0.004, BASE_LAT + 0.004),
    dispatched_at=DISPATCHED_AT,
    device_sn=None,
    name="Matching Mission",
) -> Mission:
    """mission with a flight plan spanning bbox and a dispatch record."""
    mission = Mission(name=name, airport_id=airport.id)
    db.add(mission)
    db.flush()

    fp = FlightPlan(mission_id=mission.id, airport_id=airport.id)
    db.add(fp)
    db.flush()
    min_lon, min_lat, max_lon, max_lat = bbox
    for i, (lon, lat) in enumerate([(min_lon, min_lat), (max_lon, max_lat)], start=1):
        db.add(
            Waypoint(
                flight_plan_id=fp.id,
                sequence_order=i,
                position=_wkt(lon, lat),
                waypoint_type="MEASUREMENT",
            )
        )

    db.add(WaylineDispatch(mission_id=mission.id, device_sn=device_sn, dispatched_at=dispatched_at))
    db.flush()
    return mission


def _make_media(
    db,
    *,
    captured_at=CAPTURED_AT,
    position=_wkt(BASE_LON + 0.002, BASE_LAT + 0.002),
    device_sn=None,
) -> DroneMediaFile:
    """received media row as the hub callback would create it."""
    media = DroneMediaFile(
        object_key=f"media/{uuid4().hex}.JPG",
        fingerprint=uuid4().hex,
        captured_at=captured_at,
        capture_position=position,
        device_sn=device_sn,
    )
    db.add(media)
    db.flush()
    return media


def _add_inspection_target(db, airport, mission, lon: float, lat: float) -> None:
    """inspection whose template targets an AGL with its LHA centroid at (lon, lat)."""
    surface = Runway(
        airport_id=airport.id,
        identifier=uuid4().hex[:4],
        geometry=f"LINESTRING Z ({lon} {lat} 300, {lon + 0.01} {lat} 300)",
    )
    db.add(surface)
    db.flush()

    agl = AGL(
        surface_id=surface.id,
        agl_type="PAPI",
        name=f"PAPI {uuid4().hex[:4]}",
        position=_wkt(lon, lat, 300.0),
    )
    db.add(agl)
    db.flush()
    db.add(
        LHA(agl_id=agl.id, unit_designator="A", position=_wkt(lon, lat, 300.0), sequence_number=1)
    )

    template = InspectionTemplate(name=f"tpl {uuid4().hex[:4]}")
    template.targets.append(agl)
    db.add(template)
    db.flush()

    db.add(
        Inspection(
            mission_id=mission.id,
            template_id=template.id,
            method="HORIZONTAL_RANGE",
            sequence_order=1,
        )
    )
    db.flush()


def test_inside_window_and_area_matches(db_session):
    """capture after dispatch and inside the plan area -> MATCHED to the mission."""
    airport = _make_airport(db_session)
    mission = _make_mission(db_session, airport)
    media = _make_media(db_session)

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.MATCHED.value
    assert media.mission_id == mission.id


def test_captured_before_dispatch_unassigned(db_session):
    """capture predates the dispatch window -> UNASSIGNED."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport)
    media = _make_media(db_session, captured_at=BEFORE_DISPATCH)

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value
    assert media.mission_id is None


def test_null_captured_at_unassigned(db_session):
    """no device-reported capture time -> UNASSIGNED, never the laptop clock."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport)
    media = _make_media(db_session, captured_at=None)

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value


def test_missing_position_unassigned(db_session):
    """no capture gps -> containment cannot pass -> UNASSIGNED."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport)
    media = _make_media(db_session, position=None)

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value


def test_outside_area_unassigned(db_session):
    """inside the time window but far from the plan area -> UNASSIGNED."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport)
    media = _make_media(db_session, position=_wkt(BASE_LON + 0.1, BASE_LAT + 0.1))

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value


def test_within_buffer_just_outside_bbox_matches(db_session):
    """capture slightly past the bbox edge but inside the buffer -> MATCHED."""
    airport = _make_airport(db_session)
    mission = _make_mission(db_session, airport)
    # ~70 m east of the max-lon edge at this latitude, inside the 100 m buffer
    media = _make_media(db_session, position=_wkt(BASE_LON + 0.005, BASE_LAT + 0.002))

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.MATCHED.value
    assert media.mission_id == mission.id


def test_device_sn_mismatch_excluded(db_session):
    """both sides carry a serial and they differ -> mission excluded -> UNASSIGNED."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport, device_sn="SN-DISPATCHED")
    media = _make_media(db_session, device_sn="SN-OTHER")

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value


def test_device_sn_equality_matches(db_session):
    """matching serials on both sides keep the mission as a candidate."""
    airport = _make_airport(db_session)
    mission = _make_mission(db_session, airport, device_sn="SN-1")
    media = _make_media(db_session, device_sn="SN-1")

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.MATCHED.value
    assert media.mission_id == mission.id


def test_one_sided_device_sn_does_not_exclude(db_session):
    """dispatch has no serial bound yet -> equality is not enforced."""
    airport = _make_airport(db_session)
    mission = _make_mission(db_session, airport, device_sn=None)
    media = _make_media(db_session, device_sn="SN-1")

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.MATCHED.value
    assert media.mission_id == mission.id


def test_tie_break_picks_nearest_inspection(db_session):
    """two overlapping missions -> the one with the closer inspection target wins."""
    airport = _make_airport(db_session)
    overlap = (BASE_LON, BASE_LAT, BASE_LON + 0.004, BASE_LAT + 0.004)
    near = _make_mission(db_session, airport, bbox=overlap, name="Near Mission")
    far = _make_mission(db_session, airport, bbox=overlap, name="Far Mission")

    capture_lon, capture_lat = BASE_LON + 0.001, BASE_LAT + 0.001
    _add_inspection_target(db_session, airport, near, capture_lon, capture_lat)
    _add_inspection_target(db_session, airport, far, BASE_LON + 0.004, BASE_LAT + 0.004)

    media = _make_media(db_session, position=_wkt(capture_lon, capture_lat))
    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.MATCHED.value
    assert media.mission_id == near.id


def test_matching_error_leaves_row_received(db_session, monkeypatch):
    """an internal matching failure must not consume the row - sweep retries later."""
    airport = _make_airport(db_session)
    _make_mission(db_session, airport)
    media = _make_media(db_session)

    def _boom(db, m):
        """simulate a matching crash."""
        raise RuntimeError("matching-failure")

    monkeypatch.setattr(drone_media_service, "_resolve_mission", _boom)
    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.RECEIVED.value
    assert media.mission_id is None


def test_match_media_file_skips_non_received_rows(db_session):
    """rows already past RECEIVED are returned untouched."""
    airport = _make_airport(db_session)
    other = _make_mission(db_session, airport)
    media = _make_media(db_session)
    media.mark_unassigned()

    drone_media_service.match_media_file(db_session, media)

    assert media.status == MediaFileStatus.UNASSIGNED.value
    assert media.mission_id is None
    assert other.id is not None


def test_match_pending_sweeps_received_rows(db_session):
    """the sweep moves lingering RECEIVED rows and reports how many."""
    airport = _make_airport(db_session)
    mission = _make_mission(db_session, airport)
    inside = _make_media(db_session)
    no_gps = _make_media(db_session, position=None)

    moved = drone_media_service.match_pending(db_session)

    assert moved >= 2
    assert inside.status == MediaFileStatus.MATCHED.value
    assert inside.mission_id == mission.id
    assert no_gps.status == MediaFileStatus.UNASSIGNED.value
