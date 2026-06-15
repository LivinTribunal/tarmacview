"""guards that the vendored engine stays decoupled from the app (phase 2 contract)."""

from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent / "app" / "services" / "video_processing"

# the four couplings VENDORED.md required stripping
_FORBIDDEN = (
    "from app.core.config",
    "from app.core.logging",
    "from app.repositories",
    "from app.services.s3_storage",
)


def _engine_py_files():
    """every python module in the vendored engine tree."""
    return [p for p in ENGINE_DIR.rglob("*.py")]


def test_no_app_couplings_remain():
    """no engine module imports the stripped app modules."""
    offenders = []
    for path in _engine_py_files():
        text = path.read_text()
        for needle in _FORBIDDEN:
            if needle in text:
                offenders.append(f"{path.name}: {needle}")
    assert not offenders, offenders


def test_step_functions_removed():
    """the aws step-functions orchestration is gone (replaced by the celery task)."""
    assert not (ENGINE_DIR / "step_functions").exists()


def test_engine_config_dataclass_has_thresholds():
    """the engine-local config carries the detection thresholds the engine reads."""
    from app.services.video_processing.config import EngineConfig, settings

    assert isinstance(settings, EngineConfig)
    # a representative slice of the threshold surface the engine consumes
    for field in (
        "VIDEO_GEN_PAPI_WIDTH",
        "PAPI_WHITE_NORM_CENTER",
        "TRACKING_MAX_DISTANCE",
        "FFMPEG_PRESET",
        "EARTH_RADIUS_METERS",
    ):
        assert hasattr(settings, field)


def test_engine_imports_without_app_settings():
    """the engine entrypoints import cleanly off the local config (needs opencv)."""
    pytest.importorskip("cv2")
    from app.services.video_processing.generation.two_pass_processor import TwoPassProcessor
    from app.services.video_processing.gps import GPSExtractor
    from app.services.video_processing.processor.core import VideoProcessor

    assert GPSExtractor is not None
    assert VideoProcessor is not None
    assert TwoPassProcessor is not None


def test_parse_srt_content_handles_m4_bracketed_telemetry():
    """matrice 4 footage carries per-frame gps as bracketed [latitude:]/[longitude:]/
    abs_alt: fields under a FrameCnt header, not the legacy "GPS (lat, lon, alt)" syntax.
    the embedded-subtitle path must still extract per-frame position from that shape."""
    from app.services.video_processing.gps import GPSExtractor

    srt = (
        "1\n"
        "00:00:00,000 --> 00:00:00,033\n"
        "FrameCnt: 0 2025-06-03 22:56:33.050\n"
        "[iso: 100] [shutter: 1/320.0] [latitude: 49.236466] [longitude: 18.623295] "
        "[rel_alt: 19.919 abs_alt: 373.753] [gb_yaw: -117.7 gb_pitch: -4.0 gb_roll: 0.0]\n"
        "\n"
        "2\n"
        "00:00:00,033 --> 00:00:00,066\n"
        "FrameCnt: 1 2025-06-03 22:56:33.084\n"
        "[iso: 100] [shutter: 1/320.0] [latitude: 49.236470] [longitude: 18.623300] "
        "[rel_alt: 22.5 abs_alt: 376.4] [gb_yaw: -117.7 gb_pitch: -4.0 gb_roll: 0.0]\n"
    )

    points = GPSExtractor()._parse_srt_content(srt)

    assert len(points) == 2
    assert points[0].latitude == pytest.approx(49.236466)
    assert points[0].longitude == pytest.approx(18.623295)
    # abs_alt is the WGS84 reading - never the relative-to-takeoff rel_alt
    assert points[0].elevation_wgs84 == pytest.approx(373.753)
    assert points[0].frame_number == 0
    assert points[1].frame_number == 1
    assert points[1].elevation_wgs84 == pytest.approx(376.4)


def test_parse_srt_content_still_handles_legacy_gps_syntax():
    """older DJI SRT sidecars use the "GPS (lat, lon, alt)" syntax - keep that path working."""
    from app.services.video_processing.gps import GPSExtractor

    srt = (
        "1\n"
        "00:00:00,000 --> 00:00:00,033\n"
        "HOME(0.0,0.0) 2025.01.01\n"
        "GPS (49.236466, 18.623295, 373.7) BAROMETER: 12.3\n"
    )

    points = GPSExtractor()._parse_srt_content(srt)

    assert len(points) == 1
    assert points[0].latitude == pytest.approx(49.236466)
    assert points[0].elevation_wgs84 == pytest.approx(373.7)
