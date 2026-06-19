"""engine-local detection thresholds, decoupled from the app ``Settings``.

the vendored engine originally pulled every tuning constant off ``app.core.config``
(the upstream airport-lights-detection settings object). that coupled the OpenCV
pipeline to the FastAPI app config and meant the backend could not import the app
without the full engine settings surface. phase 2 moves the thresholds here into a
plain dataclass so the engine owns its own knobs.

the values below are reconstructed defaults: the upstream snapshot referenced the
constants by name but the original numeric defaults did not travel with the vendor
import. they are sensible starting points derived from how each constant is used
(intensity scales are 0-255, percentages are fractions of frame dimensions, etc.)
and can be re-tuned against real footage without touching the call sites.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class EngineConfig:
    """detection / tracking / video-generation thresholds for the PAPI engine."""

    # ffmpeg h.264 transcode - veryfast trades a little file size for a large encode-time
    # cut; these are review/proof videos, not archival masters
    FFMPEG_PRESET: str = "veryfast"
    FFMPEG_CRF: str = "23"
    FFMPEG_PIX_FMT: str = "yuv420p"
    FFMPEG_TIMEOUT_SECONDS: int = 300

    # geometry
    EARTH_RADIUS_METERS: float = 6_371_000.0
    DEFAULT_FALLBACK_DISTANCE: float = 100.0

    # gpu / batch processing
    GPU_THRESHOLD_VALUE: int = 200
    GPU_CACHE_MAX_SIZE: int = 1000
    VIDEO_GEN_BATCH_SIZE: int = 100
    VIDEO_GEN_NUM_WORKERS: int = 4

    # base light detection
    VIDEO_BRIGHTNESS_THRESHOLD: int = 200
    VIDEO_MIN_AREA: int = 10
    VIDEO_MAX_AREA: int = 50_000
    VIDEO_SATURATION_THRESHOLD: int = 60
    VIDEO_ENHANCED_THRESHOLD: int = 180
    VIDEO_MORPH_KERNEL_SIZE: int = 3

    # color extraction
    COLOR_BRIGHTNESS_PERCENTILE: float = 0.1
    COLOR_DEFAULT_R: int = 255
    COLOR_DEFAULT_G: int = 255
    COLOR_DEFAULT_B: int = 255
    COLOR_RED_THRESHOLD: float = 0.5
    COLOR_MIN_WIDTH: int = 4
    COLOR_MIN_HEIGHT: int = 4

    # per-frame roi + visibility
    FRAME_ROI_SIZE_FIXED: int = 300
    FRAME_MIN_INTENSITY_VISIBLE: float = 20.0
    FRAME_WHITE_INTENSITY_MIN: float = 180.0

    # papi middle-region window (fractions of frame extent)
    PAPI_MIDDLE_X_START: float = 0.2
    PAPI_MIDDLE_X_END: float = 0.8
    PAPI_MIDDLE_Y_START: float = 0.15
    PAPI_MIDDLE_Y_END: float = 0.85

    # papi candidate filtering (intensity on a 0-255 scale)
    PAPI_POSITION_BONUS: float = 30.0
    PAPI_RED_BONUS: float = 30.0
    PAPI_ADJUSTED_INTENSITY_THRESHOLD: float = 200.0
    PAPI_HIGH_INTENSITY_THRESHOLD: float = 200.0
    PAPI_MEDIUM_INTENSITY_THRESHOLD: float = 120.0
    PAPI_MODERATE_INTENSITY_THRESHOLD: float = 100.0
    PAPI_MIDDLE_LARGE_INTENSITY_THRESHOLD: float = 150.0
    PAPI_RED_INTENSITY_THRESHOLD: float = 120.0
    PAPI_HIGH_BRIGHTNESS_THRESHOLD: float = 200.0
    PAPI_LARGE_HIGH_BRIGHTNESS_THRESHOLD: float = 180.0
    PAPI_VERY_BRIGHT_THRESHOLD: float = 230.0
    PAPI_AREA_MULTIPLIER_LARGE: float = 1.5
    PAPI_AREA_MULTIPLIER_RED: float = 1.2
    PAPI_AREA_MULTIPLIER_VERY_LARGE: float = 2.0

    # normalized rgb classification (channel / total, ~0..1)
    PAPI_RED_NORM_THRESHOLD: float = 0.4
    PAPI_GREEN_NORM_THRESHOLD: float = 0.35
    PAPI_WHITE_NORM_CENTER: float = 0.333
    PAPI_WHITE_NORM_TOLERANCE: float = 0.06

    # papi line scoring
    PAPI_LINE_MIN_SCORE_THRESHOLD: float = 0.5
    PAPI_LINE_Y_PENALTY_DIVISOR: float = 50.0
    PAPI_LINE_SPACING_TOLERANCE: float = 0.5
    PAPI_LINE_COMPACTNESS_RATIO: float = 0.3
    PAPI_LINE_INTENSITY_DIVISOR: float = 255.0
    PAPI_LINE_SIZE_DIVISOR: float = 500.0
    PAPI_LINE_LENGTH_MIN: float = 50.0
    PAPI_LINE_LENGTH_MAX: float = 1000.0
    PAPI_LINE_MAX_RED_BONUS: float = 0.2
    PAPI_LINE_RED_BONUS_PER_LIGHT: float = 0.05

    # papi fallback scoring
    PAPI_FALLBACK_SIZE_NORMALIZE: float = 500.0
    PAPI_FALLBACK_POSITION_SCORE: float = 0.3
    PAPI_FALLBACK_RED_SCORE: float = 0.2
    PAPI_FALLBACK_INTENSITY_WEIGHT: float = 0.5
    PAPI_FALLBACK_SIZE_WEIGHT: float = 0.3

    # chromaticity transition angle percentiles (0..1 across the angle sweep)
    PAPI_TRANSITION_ANGLE_PERCENT: float = 0.5
    PAPI_TRANSITION_START_WHITE_PERCENT: float = 0.25
    PAPI_TRANSITION_END_WHITE_PERCENT: float = 0.75

    # optical-flow tracking
    TRACKING_OPTICAL_FLOW_WIN_SIZE: int = 15
    TRACKING_OPTICAL_FLOW_MAX_LEVEL: int = 2
    TRACKING_OPTICAL_FLOW_CRITERIA_COUNT: int = 10
    TRACKING_OPTICAL_FLOW_CRITERIA_EPS: float = 0.03
    TRACKING_OPTICAL_FLOW_ERROR_DIVISOR: float = 50.0
    TRACKING_MAX_DISTANCE: float = 100.0
    TRACKING_MAX_FRAME_GAP: int = 10
    TRACKING_DETECTION_INTERVAL: int = 30
    TRACKING_MAX_POSITION_CHANGE_PER_FRAME: float = 50.0
    TRACKING_MAX_SIZE_CHANGE_PERCENT: float = 0.5
    TRACKING_MOTION_CONSISTENCY_THRESHOLD: float = 50.0
    TRACKING_REASONABLE_MOVEMENT_DISTANCE: float = 100.0
    TRACKING_SUSPICIOUS_MOVEMENT_PER_FRAME: float = 50.0
    TRACKING_MOVEMENT_PENALTY: float = 0.5
    TRACKING_BRIGHTNESS_DIFF_PENALTY: float = 0.1

    # enhanced-video footer + contour styling (BGR-ish components)
    VIDEO_GEN_PAPI_WIDTH: int = 300
    VIDEO_GEN_PAPI_HEIGHT: int = 420
    VIDEO_GEN_PAPI_DISPLAY_HEIGHT: int = 300
    VIDEO_GEN_CONTOUR_COLOR_R: int = 0
    VIDEO_GEN_CONTOUR_COLOR_G: int = 255
    VIDEO_GEN_CONTOUR_COLOR_B: int = 0
    VIDEO_GEN_CONTOUR_THICKNESS: int = 1
    VIDEO_GEN_FOOTER_COLOR_R: int = 30
    VIDEO_GEN_FOOTER_COLOR_G: int = 30
    VIDEO_GEN_FOOTER_COLOR_B: int = 30

    # base url for report video links (results page wires real urls later)
    API_BASE_URL: str = ""


settings = EngineConfig()
