"""
Video Processing Utilities
"""

from .geometry import (
    haversine_distance,
    calculate_bearing,
    calculate_horizontal_angle,
    calculate_angle,
    calculate_ground_distance,
    calculate_direct_distance
)
from .color import (
    extract_color_from_brightest_pixels,
    measure_light_dimensions,
    classify_light_status
)
from .video import convert_to_h264
from .cache import (
    FrameProcessingCache,
    BatchFrameProcessor
)

__all__ = [
    # Geometry
    'haversine_distance',
    'calculate_bearing',
    'calculate_horizontal_angle',
    'calculate_angle',
    'calculate_ground_distance',
    'calculate_direct_distance',
    # Color
    'extract_color_from_brightest_pixels',
    'measure_light_dimensions',
    'classify_light_status',
    # Video
    'convert_to_h264',
    # Cache
    'FrameProcessingCache',
    'BatchFrameProcessor',
]
