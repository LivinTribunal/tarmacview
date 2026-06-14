"""
Helper functions for PAPI light tracking
"""

import logging
import math
from typing import List, Tuple

import numpy as np

from app.services.video_processing.config import settings

from ..models import DetectedLight

logger = logging.getLogger(__name__)


def estimate_global_motion(
    current_lights: List[DetectedLight], prev_lights: List[DetectedLight]
) -> Tuple[float, float]:
    """Estimate global camera motion between frames using detected lights"""
    if len(current_lights) < 3 or len(prev_lights) < 3:
        return 0.0, 0.0

    motions = []
    for curr_light in current_lights:
        best_dist = float("inf")
        best_prev = None

        for prev_light in prev_lights:
            # Only match lights of similar brightness and characteristics
            if (
                abs(curr_light.brightness - prev_light.brightness)
                > settings.TRACKING_MOTION_CONSISTENCY_THRESHOLD
            ):
                continue

            dist = math.sqrt(
                (curr_light.x - prev_light.x) ** 2 + (curr_light.y - prev_light.y) ** 2
            )
            if dist < settings.TRACKING_REASONABLE_MOVEMENT_DISTANCE and dist < best_dist:
                best_dist = dist
                best_prev = prev_light

        if best_prev:
            dx = curr_light.x - best_prev.x
            dy = curr_light.y - best_prev.y
            motions.append((dx, dy))

    if len(motions) < 3:
        return 0.0, 0.0

    # Use median to get robust motion estimate (removes outliers)
    motions = np.array(motions)
    median_dx = np.median(motions[:, 0])
    median_dy = np.median(motions[:, 1])

    return median_dx, median_dy


def validate_motion_consistency(
    motion_vectors: List[Tuple[float, float]], motion_consistency_threshold: float
) -> bool:
    """
    Validate that all PAPI lights move consistently (they should since they're static
    and only the drone is moving).

    Args:
        motion_vectors: List of (dx, dy) motion vectors for each light
        motion_consistency_threshold: Maximum allowed deviation in pixels

    Returns:
        True if motion is consistent, False otherwise
    """
    if len(motion_vectors) < 2:
        return True  # Can't validate with less than 2 lights

    # Calculate mean motion
    mean_dx = np.mean([v[0] for v in motion_vectors])
    mean_dy = np.mean([v[1] for v in motion_vectors])

    # Calculate deviation from mean
    deviations = []
    for dx, dy in motion_vectors:
        deviation = math.sqrt((dx - mean_dx) ** 2 + (dy - mean_dy) ** 2)
        deviations.append(deviation)

    max_deviation = max(deviations)

    # Check if deviation is within threshold
    is_consistent = max_deviation < motion_consistency_threshold

    if not is_consistent:
        logger.warning(
            f"Inconsistent motion detected! Max deviation: {max_deviation:.1f}px"
            f" (threshold: {motion_consistency_threshold}px)"
        )
    else:
        logger.debug(f"Motion consistent: max deviation {max_deviation:.1f}px")

    return is_consistent


def stabilize_position_change(
    new_x: int, new_y: int, last_x: int, last_y: int, max_change_pixels: int = None
) -> Tuple[int, int]:
    """
    Limit position changes to maximum pixels between frames for stable tracking.

    This prevents the center from jumping too much between frames, providing
    smooth tracking even when brightness detection is noisy.

    Args:
        new_x, new_y: Newly detected position
        last_x, last_y: Previous frame's position
        max_change_pixels: Maximum allowed movement in pixels per frame

    Returns:
        Stabilized (x, y) position limited to max_change_pixels movement
    """
    if max_change_pixels is None:
        max_change_pixels = settings.TRACKING_MAX_POSITION_CHANGE_PER_FRAME

    # Calculate distance moved
    dx = new_x - last_x
    dy = new_y - last_y
    distance = math.sqrt(dx * dx + dy * dy)

    # If movement is within limit, use new position
    if distance <= max_change_pixels:
        return (int(new_x), int(new_y))

    # Otherwise, move towards new position but limit to max_change_pixels
    scale = max_change_pixels / distance
    stabilized_x = int(last_x + dx * scale)
    stabilized_y = int(last_y + dy * scale)

    return (stabilized_x, stabilized_y)


def stabilize_size_change(new_size: int, last_size: int, max_change_percent: float = None) -> int:
    """
    Limit frame size changes to maximum percentage between frames.

    Args:
        new_size: Newly detected size
        last_size: Previous frame's size
        max_change_percent: Maximum allowed change

    Returns:
        Stabilized size limited to max_change_percent
    """
    if max_change_percent is None:
        max_change_percent = settings.TRACKING_MAX_SIZE_CHANGE_PERCENT

    if last_size <= 0:
        return new_size

    # Calculate actual change percentage
    change_ratio = abs(new_size - last_size) / last_size

    # If change is within limit, use new size
    if change_ratio <= max_change_percent:
        return new_size

    # Otherwise, clamp to maximum allowed change
    max_change = int(last_size * max_change_percent)
    if new_size > last_size:
        stabilized_size = last_size + max_change
    else:
        stabilized_size = last_size - max_change

    return stabilized_size
