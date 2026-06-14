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
