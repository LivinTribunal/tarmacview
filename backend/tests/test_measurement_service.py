"""pure unit tests for the measurement results pivot helpers (no db)."""

from app.services.measurement_service import _drone_path


def _engine_frame(i: int) -> dict:
    """one per-frame blob dict shaped exactly as ``measurement_collector`` writes it.

    the drone gps keys are the canonical drone_latitude / drone_longitude /
    drone_elevation_wgs84; the papi_* keys ride alongside and must be ignored here.
    """
    return {
        "session_id": "s",
        "frame_number": i,
        "timestamp": i / 30.0,
        "drone_latitude": 48.1 + i * 1e-5,
        "drone_longitude": 17.2 + i * 1e-5,
        "drone_elevation_wgs84": 150.0 + i,
        "papi_a_status": "white",
        "papi_a_angle": 3.0,
    }


def test_drone_path_reads_engine_shaped_frames():
    """engine-shaped drone_* keys populate the path with the right field mapping."""
    frames = [_engine_frame(i) for i in range(3)]

    path = _drone_path(frames)

    assert len(path) == 3
    first = path[0]
    assert first.frame_number == 0
    assert first.timestamp == 0.0
    assert first.latitude == 48.1
    assert first.longitude == 17.2
    assert first.elevation == 150.0
    # elevation comes off drone_elevation_wgs84, ascending with the frame
    assert path[2].elevation == 152.0


def test_drone_path_skips_frames_without_gps():
    """frames missing lat/lon are dropped, the rest survive in order."""
    frames = [
        _engine_frame(0),
        {"frame_number": 1, "timestamp": 0.03, "drone_latitude": None, "drone_longitude": None},
        {"frame_number": 2, "timestamp": 0.06, "drone_longitude": 17.2},
        _engine_frame(3),
    ]

    path = _drone_path(frames)

    assert [p.frame_number for p in path] == [0, 3]


def test_drone_path_single_point():
    """a single engine frame yields a single path point (stationary path)."""
    path = _drone_path([_engine_frame(0)])

    assert len(path) == 1
    assert path[0].latitude == 48.1
    assert path[0].longitude == 17.2


def test_drone_path_allows_missing_elevation():
    """a frame with gps but no elevation key still produces a point (elevation null)."""
    frame = {"frame_number": 5, "timestamp": 1.0, "drone_latitude": 48.1, "drone_longitude": 17.2}

    path = _drone_path([frame])

    assert len(path) == 1
    assert path[0].elevation is None
