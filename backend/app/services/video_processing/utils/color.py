"""
Color extraction and light classification utilities
"""
import cv2
import numpy as np
from typing import Tuple

from app.core.config import settings


def extract_color_from_brightest_pixels(roi: np.ndarray, brightness_percentile: float = None) -> Tuple[int, int, int]:
    """
    Extract RGB color from pixels with highest RED channel values.

    This function uses the RED channel to identify the light source, matching
    the algorithm used for drawing green evaluation boxes in videos.

    Algorithm:
    1. Extracts RED channel from BGR image
    2. Finds maximum RED value in ROI
    3. Creates mask of pixels with RED >= threshold
    4. Averages RGB values ONLY from those pixels

    This ensures consistency between visualization (green boxes) and RGB computation.

    Args:
        roi: Region of interest (BGR image)
        brightness_percentile: RED threshold as fraction of max

    Returns:
        Tuple of (R, G, B) values
    """
    if brightness_percentile is None:
        brightness_percentile = settings.COLOR_BRIGHTNESS_PERCENTILE

    if roi.size == 0 or roi.shape[0] == 0 or roi.shape[1] == 0:
        return (settings.COLOR_DEFAULT_R, settings.COLOR_DEFAULT_G, settings.COLOR_DEFAULT_B)

    # Handle grayscale images
    if len(roi.shape) != 3:
        mean_gray = np.mean(roi)
        return (int(mean_gray), int(mean_gray), int(mean_gray))

    # Extract RED channel (BGR format, so index 2)
    red_channel = roi[:, :, 2]

    # Find maximum RED value
    max_red = np.max(red_channel)

    if max_red == 0:
        # No red signal, fallback to full ROI average
        mean_bgr = cv2.mean(roi)[:3]
        return (int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0]))

    # Create binary mask of pixels with RED >= threshold% of max RED
    threshold_value = max_red * brightness_percentile
    red_mask = (red_channel >= threshold_value)

    # Count pixels in evaluation area
    area_pixels = np.sum(red_mask)

    if area_pixels > 0:
        # Extract pixels that meet RED threshold
        bright_pixels = roi[red_mask]
        # Average the bright pixels (BGR)
        mean_bgr = np.mean(bright_pixels, axis=0)
        # Convert BGR to RGB
        r, g, b = int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])
    else:
        # Fallback to full ROI average if no pixels found
        mean_bgr = cv2.mean(roi)[:3]
        r, g, b = int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])

    return (r, g, b)


def measure_light_dimensions(frame: np.ndarray, center_x: int, center_y: int,
                            initial_search_size: int, brightness_threshold: float = None) -> Tuple[int, int, int, int]:
    """
    Measure actual light dimensions and compute center of mass of brightest pixels.

    This computes the weighted center using pixels above threshold of max RED intensity,
    which provides more stable positioning and captures a larger area around the light.

    Args:
        frame: Full video frame
        center_x, center_y: Initial center position for search
        initial_search_size: Initial search area size
        brightness_threshold: RED channel threshold

    Returns:
        (computed_center_x, computed_center_y, width, height) in frame coordinates
    """
    if brightness_threshold is None:
        brightness_threshold = settings.COLOR_BRIGHTNESS_PERCENTILE

    frame_height, frame_width = frame.shape[:2]

    # Extract initial search region
    half_size = initial_search_size // 2
    # Ensure integers for array slicing
    cx, cy = int(center_x), int(center_y)
    x1 = int(max(0, cx - half_size))
    y1 = int(max(0, cy - half_size))
    x2 = int(min(frame_width, cx + half_size))
    y2 = int(min(frame_height, cy + half_size))

    search_roi = frame[y1:y2, x1:x2]

    if search_roi.size == 0:
        return (center_x, center_y, initial_search_size, initial_search_size)

    # Create RED channel mask with 90% threshold
    red_channel = search_roi[:, :, 2]  # BGR format
    max_red = np.max(red_channel)

    if max_red == 0:
        return (center_x, center_y, initial_search_size, initial_search_size)

    threshold_value = max_red * brightness_threshold
    red_mask = (red_channel >= threshold_value).astype(np.uint8)

    # Find bright pixels
    coords = np.column_stack(np.where(red_mask > 0))
    if coords.shape[0] == 0:
        return (center_x, center_y, initial_search_size, initial_search_size)

    y_coords, x_coords = coords[:, 0], coords[:, 1]

    # Compute center of mass (weighted average of bright pixel positions)
    # Weight by RED channel intensity for better accuracy
    bright_intensities = red_channel[red_mask > 0]
    weighted_x = np.average(x_coords, weights=bright_intensities)
    weighted_y = np.average(y_coords, weights=bright_intensities)

    # Convert to frame coordinates
    computed_center_x = int(x1 + weighted_x)
    computed_center_y = int(y1 + weighted_y)

    # Measure dimensions (bounding box of bright pixels)
    measured_width = int(np.max(x_coords) - np.min(x_coords))
    measured_height = int(np.max(y_coords) - np.min(y_coords))

    # Ensure minimum size
    measured_width = max(measured_width, settings.COLOR_MIN_WIDTH)
    measured_height = max(measured_height, settings.COLOR_MIN_HEIGHT)

    return (computed_center_x, computed_center_y, measured_width, measured_height)


def calculate_white_percentage(r: float, g: float, b: float) -> float:
    """
    Calculate the white percentage of a PAPI light color.

    White percentage represents how much the color has shifted from pure red toward white.
    - 0% = pure red (R=255, G=0, B=0)
    - 100% = pure white (R=255, G=255, B=255)

    Formula: white_percent = G / R
    This measures the ratio of green to red - as light transitions from red to white,
    the green channel increases toward matching the red channel.

    Args:
        r, g, b: RGB color values

    Returns:
        White percentage as float (0.0 to 1.0)
    """
    if r <= 0:
        return 0.0

    # White percentage based on green/red ratio
    # For pure red: G=0, R=255 → 0/255 = 0%
    # For pure white: G=255, R=255 → 255/255 = 100%
    white_percent = g / r
    return min(white_percent, 1.0)  # Cap at 1.0


def classify_light_status(r: float, g: float, b: float, intensity: float) -> str:
    """
    Classify light status as per PAPI requirements.

    Uses white percentage for transition detection:
    - RED: white_percent < 33% (less than PAPI_TRANSITION_START_WHITE_PERCENT)
    - TRANSITION: 33% <= white_percent < 90%
    - WHITE: white_percent >= 90% (at least PAPI_TRANSITION_END_WHITE_PERCENT)

    Args:
        r, g, b: RGB color values
        intensity: Light intensity value

    Returns:
        Status string: "red", "white", "transition", or "not_visible"
    """
    if intensity < settings.FRAME_MIN_INTENSITY_VISIBLE:
        return "not_visible"

    # Handle edge case
    if r <= 0 and g <= 0 and b <= 0:
        return "not_visible"

    # Calculate white percentage
    white_percent = calculate_white_percentage(r, g, b)

    # Classify based on white percentage thresholds
    if white_percent < settings.PAPI_TRANSITION_START_WHITE_PERCENT:
        # Less than 33% white = RED
        return "red"
    elif white_percent >= settings.PAPI_TRANSITION_END_WHITE_PERCENT:
        # 90%+ white = WHITE (only if intensity is sufficient)
        if intensity > settings.FRAME_WHITE_INTENSITY_MIN:
            return "white"
        else:
            return "transition"
    else:
        # Between 33% and 90% = TRANSITION
        return "transition"
