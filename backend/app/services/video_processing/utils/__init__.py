"""
Video Processing Utilities
"""

from .cache import BatchFrameProcessor, FrameProcessingCache
from .color import (
    classify_light_status,
    extract_color_from_brightest_pixels,
    measure_light_dimensions,
)
from .geometry import (
    calculate_angle,
    calculate_bearing,
    calculate_direct_distance,
    calculate_ground_distance,
    calculate_horizontal_angle,
    haversine_distance,
)
from .video import FfmpegH264Writer, convert_to_h264

__all__ = [
    # Geometry
    "haversine_distance",
    "calculate_bearing",
    "calculate_horizontal_angle",
    "calculate_angle",
    "calculate_ground_distance",
    "calculate_direct_distance",
    # Color
    "extract_color_from_brightest_pixels",
    "measure_light_dimensions",
    "classify_light_status",
    # Video
    "convert_to_h264",
    "FfmpegH264Writer",
    # Cache
    "FrameProcessingCache",
    "BatchFrameProcessor",
]
