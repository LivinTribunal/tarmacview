"""
PAPI light detection functions
"""

import logging
from itertools import combinations
from typing import Dict, List

import cv2
import numpy as np

from app.services.video_processing.config import settings

from ..models import DetectedLight

logger = logging.getLogger(__name__)
# Lazy import to avoid loading GPU dependencies at module level
# from ..detection import RunwayLightDetector


def detect_lights(image_path: str, reference_points: List[Dict]) -> Dict[str, Dict]:
    """Detect PAPI lights in image using advanced computer vision with line detection"""
    # Lazy import to avoid loading GPU dependencies at module level
    from ..detection import RunwayLightDetector

    try:
        img = cv2.imread(image_path)
        if img is None:
            logger.error(f"Could not load image: {image_path}")
            return {}

        height, width = img.shape[:2]
        detector = RunwayLightDetector()

        # Detect all lights in the image
        detected_lights_list = detector.detect_lights(img)

        if not detected_lights_list:
            logger.warning("No lights detected, using default positions")
            return _generate_default_positions(width, height)

        # Enhanced PAPI detection with line-based approach
        papi_candidates = _filter_papi_candidates(detected_lights_list)

        if not papi_candidates:
            logger.warning("No high-intensity PAPI candidates found, using default positions")
            return _generate_default_positions(width, height)

        # Find the best line of 4 PAPI lights
        best_papi_line = _find_best_papi_line(papi_candidates)

        if best_papi_line:
            logger.info(
                f"Found PAPI line with {len(best_papi_line)} lights, avg intensity:"
                f" {np.mean([light.intensity for light in best_papi_line]):.1f}"
            )
            return _convert_to_papi_positions(best_papi_line, width, height)
        else:
            logger.warning("No coherent PAPI light line found, using fallback method")
            return _fallback_papi_detection(papi_candidates, width, height)

    except Exception as e:
        logger.error(f"Error in light detection: {e}")
        return _generate_default_positions(width, height)


def _filter_papi_candidates(detected_lights_list: List[DetectedLight]) -> List[DetectedLight]:
    """Filter lights that could be PAPI lights based on
    intensity, size, characteristics, and position"""
    if not detected_lights_list:
        return []

    papi_candidates = []

    # Get image dimensions from detected lights
    max_y = max(light.y for light in detected_lights_list) if detected_lights_list else 1000
    max_x = max(light.x for light in detected_lights_list) if detected_lights_list else 1000

    # Define middle region (center 60% horizontal, center 70% vertical)
    mid_x_start = max_x * settings.PAPI_MIDDLE_X_START
    mid_x_end = max_x * settings.PAPI_MIDDLE_X_END
    mid_y_start = max_y * settings.PAPI_MIDDLE_Y_START
    mid_y_end = max_y * settings.PAPI_MIDDLE_Y_END

    # Calculate area statistics for size-based filtering
    areas = [
        max(light.width * light.height, light.width * light.width, light.height * light.height)
        for light in detected_lights_list
    ]
    avg_area = np.mean(areas) if areas else 0

    for light in detected_lights_list:
        light_area = max(
            light.width * light.height, light.width * light.width, light.height * light.height
        )

        # Calculate position-based bonus (prioritize middle region)
        in_middle_region = (
            mid_x_start <= light.x <= mid_x_end and mid_y_start <= light.y <= mid_y_end
        )
        position_bonus = settings.PAPI_POSITION_BONUS if in_middle_region else 0

        # Calculate red light bonus (PAPI often starts with red lights)
        is_red = light.class_name == "red_light" or (
            hasattr(light, "rgb_color")
            and light.rgb_color
            and light.rgb_color[0] > light.rgb_color[1] + 30
            and light.rgb_color[0] > light.rgb_color[2] + 30
        )
        red_bonus = settings.PAPI_RED_BONUS if is_red else 0

        adjusted_intensity = light.intensity + position_bonus + red_bonus

        # Primary filter: High intensity PAPI lights (very bright) with bonuses
        if adjusted_intensity > settings.PAPI_ADJUSTED_INTENSITY_THRESHOLD:
            papi_candidates.append(light)
            logger.debug(
                f"Candidate: pos=({light.x:.0f},{light.y:.0f}), "
                f"intensity={light.intensity:.0f}+{position_bonus}+{red_bonus}, "
                f"class={light.class_name}"
            )
            continue

        # Secondary filter: Large lights with good intensity in middle region
        if (
            in_middle_region
            and light_area > avg_area * settings.PAPI_AREA_MULTIPLIER_LARGE
            and light.intensity > settings.PAPI_MIDDLE_LARGE_INTENSITY_THRESHOLD
        ):
            papi_candidates.append(light)
            continue

        # Tertiary filter: Red lights with good intensity (prioritize red)
        if (
            is_red
            and light.intensity > settings.PAPI_RED_INTENSITY_THRESHOLD
            and light_area > avg_area * settings.PAPI_AREA_MULTIPLIER_RED
        ):
            papi_candidates.append(light)
            continue

        # Quaternary filter: High brightness with specific light types in middle region
        if (
            in_middle_region
            and light.brightness > settings.PAPI_HIGH_BRIGHTNESS_THRESHOLD
            and light.class_name in ["white_light", "red_light", "high_intensity_light"]
        ):
            papi_candidates.append(light)
            continue

        # Fifth filter: Large lights with high brightness
        if (
            light_area > avg_area * settings.PAPI_AREA_MULTIPLIER_VERY_LARGE
            and light.brightness > settings.PAPI_LARGE_HIGH_BRIGHTNESS_THRESHOLD
        ):
            papi_candidates.append(light)
            continue

        # Final filter: Very bright lights regardless of size
        if light.brightness > settings.PAPI_VERY_BRIGHT_THRESHOLD:
            papi_candidates.append(light)

    logger.info(
        f"Found {len(papi_candidates)} potential PAPI candidates "
        f"(prioritized middle region and red lights)"
    )
    return papi_candidates


def _find_best_papi_line(candidates: List[DetectedLight]) -> List[DetectedLight]:
    """Find the best line of 4 PAPI lights using geometric and intensity analysis"""
    if len(candidates) < 4:
        return []

    best_line = []
    best_score = -1

    # Try different combinations of 4 lights
    for combo in combinations(candidates, 4):
        score = _score_papi_line(list(combo))
        if score > best_score:
            best_score = score
            best_line = list(combo)

    # Require minimum score threshold for valid PAPI line
    if best_score > settings.PAPI_LINE_MIN_SCORE_THRESHOLD:
        return sorted(best_line, key=lambda x: x.x)  # Sort left to right

    return []


def _score_papi_line(lights: List[DetectedLight]) -> float:
    """Score a potential PAPI light line based on geometric alignment, intensity, and size"""
    if len(lights) != 4:
        return 0.0

    # Sort by x-coordinate (PAPI_A on left, PAPI_D on right)
    sorted_lights = sorted(lights, key=lambda x: x.x)

    # 1. Check horizontal alignment
    y_coords = [light.y for light in sorted_lights]
    y_std = np.std(y_coords)
    alignment_score = max(0, 1 - (y_std / settings.PAPI_LINE_Y_PENALTY_DIVISOR))

    # 2. Check spacing consistency
    x_coords = [light.x for light in sorted_lights]
    spacings = [x_coords[i + 1] - x_coords[i] for i in range(3)]
    avg_spacing = np.mean(spacings)
    spacing_std = np.std(spacings)
    spacing_consistency = (
        max(0, 1 - (spacing_std / (avg_spacing * settings.PAPI_LINE_SPACING_TOLERANCE)))
        if avg_spacing > 0
        else 0
    )
    spacing_score = spacing_consistency

    # 3. Check region compactness
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    bbox_width = max_x - min_x
    bbox_height = max_y - min_y

    compactness_score = (
        max(0, 1 - (bbox_height / (bbox_width * settings.PAPI_LINE_COMPACTNESS_RATIO)))
        if bbox_width > 0
        else 0
    )
    compactness_score = min(1.0, compactness_score)

    # 4. Check intensity consistency
    intensities = [light.intensity for light in sorted_lights]
    avg_intensity = np.mean(intensities)
    intensity_std = np.std(intensities)
    intensity_score = min(1.0, avg_intensity / settings.PAPI_LINE_INTENSITY_DIVISOR)
    intensity_consistency = max(0, 1 - (intensity_std / avg_intensity)) if avg_intensity > 0 else 0
    combined_intensity_score = intensity_score * 0.7 + intensity_consistency * 0.3

    # 5. Check size consistency
    areas = [
        max(light.width * light.height, light.width * light.width, light.height * light.height)
        for light in sorted_lights
    ]
    avg_area = np.mean(areas)
    area_std = np.std(areas)

    size_score = min(1.0, avg_area / settings.PAPI_LINE_SIZE_DIVISOR)
    size_consistency_score = max(0, 1 - (area_std / avg_area)) if avg_area > 0 else 0
    combined_size_score = size_score * 0.5 + size_consistency_score * 0.5

    # 6. Check line length
    line_length = bbox_width
    length_score = (
        1.0 if settings.PAPI_LINE_LENGTH_MIN < line_length < settings.PAPI_LINE_LENGTH_MAX else 0.5
    )

    # 7. Bonus for red lights
    red_count = sum(1 for light in sorted_lights if light.class_name == "red_light")
    red_bonus = min(
        settings.PAPI_LINE_MAX_RED_BONUS, red_count * settings.PAPI_LINE_RED_BONUS_PER_LIGHT
    )

    # Combined score
    total_score = (
        alignment_score * 0.25
        + spacing_score * 0.20
        + compactness_score * 0.15
        + combined_intensity_score * 0.25
        + combined_size_score * 0.10
        + length_score * 0.05
        + red_bonus
    )

    logger.debug(
        f"Line score: {total_score:.3f} (align:{alignment_score:.2f}, space:{spacing_score:.2f}, "
        f"compact:{compactness_score:.2f}, intensity:{combined_intensity_score:.2f}, "
        f"size:{combined_size_score:.2f}, length:{length_score:.2f}, red_bonus:{red_bonus:.2f})"
    )

    return total_score


def _convert_to_papi_positions(
    lights: List[DetectedLight], width: int, height: int
) -> Dict[str, Dict]:
    """Convert detected lights to PAPI position format with boundary clamping"""
    detected_lights = {}
    papi_names = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]

    # Process detected lights
    for i, light in enumerate(lights):
        if i < len(papi_names):
            x_percent = (light.x / width) * 100
            y_percent = (light.y / height) * 100
            size_percent = max(8, min(15, (max(light.width, light.height) / width) * 100))

            # Clamp positions to ensure rectangles are visible within image bounds (5-95%)
            # This ensures that even if detection places lights outside the image,
            # they will be moved to the visible area for manual correction
            x_percent = max(5, min(95, x_percent))
            y_percent = max(5, min(95, y_percent))

            light_area = max(
                light.width * light.height, light.width * light.width, light.height * light.height
            )
            logger.info(
                f"Assigning {papi_names[i]}: pos=({x_percent:.1f}%, {y_percent:.1f}%), "
                f"intensity={light.intensity:.1f}, brightness={light.brightness:.1f}, "
                f"area={light_area:.1f}px²"
            )

            detected_lights[papi_names[i]] = {
                "x": x_percent,
                "y": y_percent,
                "size": size_percent,
                "width": (light.width / width) * 100,
                "height": (light.height / height) * 100,
                "confidence": light.confidence,
                "class_name": light.class_name,
                "brightness": light.brightness,
                "intensity": light.intensity,
            }

    # If fewer than 4 lights were detected, add default positions for missing lights
    if len(lights) < 4:
        logger.warning(
            f"Only {len(lights)} lights detected, filling in default positions for missing lights"
        )

        # Calculate default positions based on detected lights or use standard spacing
        if len(lights) > 0:
            # Use detected lights to estimate positions for missing ones
            detected_x_positions = [detected_lights[papi_names[i]]["x"] for i in range(len(lights))]
            detected_y_positions = [detected_lights[papi_names[i]]["y"] for i in range(len(lights))]
            avg_y = sum(detected_y_positions) / len(detected_y_positions)

            # Estimate spacing between lights
            if len(lights) > 1:
                x_spacing = (max(detected_x_positions) - min(detected_x_positions)) / (
                    len(lights) - 1
                )
            else:
                x_spacing = 15  # Default spacing of 15%

            # Fill in missing positions
            for i in range(len(lights), 4):
                if i == 0:
                    # Missing PAPI_A (leftmost)
                    x_percent = max(5, detected_x_positions[0] - x_spacing)
                else:
                    # Missing lights on the right
                    x_percent = min(
                        95, detected_x_positions[-1] + x_spacing * (i - len(lights) + 1)
                    )

                detected_lights[papi_names[i]] = {
                    "x": x_percent,
                    "y": avg_y,
                    "size": 8,
                    "width": 2.0,
                    "height": 2.0,
                    "confidence": 0.0,
                    "class_name": "estimated",
                    "brightness": 0.0,
                    "intensity": 0.0,
                }
                logger.info(
                    f"Added default position for {papi_names[i]}: ({x_percent:.1f}%, {avg_y:.1f}%)"
                )
        else:
            # No lights detected, use standard default positions
            logger.warning("No lights detected at all, using standard default positions")
            return _generate_default_positions(width, height)

    return detected_lights


def _fallback_papi_detection(
    candidates: List[DetectedLight], width: int, height: int
) -> Dict[str, Dict]:
    """Fallback PAPI detection using combined intensity, size, position, and color scoring"""
    # Get image center region boundaries
    mid_x_start = width * settings.PAPI_MIDDLE_X_START
    mid_x_end = width * settings.PAPI_MIDDLE_X_END
    mid_y_start = height * settings.PAPI_MIDDLE_Y_START
    mid_y_end = height * settings.PAPI_MIDDLE_Y_END

    # Calculate combined score for each candidate
    for candidate in candidates:
        light_area = max(
            candidate.width * candidate.height,
            candidate.width * candidate.width,
            candidate.height * candidate.height,
        )

        # Normalize scores
        intensity_score = candidate.intensity / 255.0
        size_score = min(1.0, light_area / settings.PAPI_FALLBACK_SIZE_NORMALIZE)

        # Position bonus (prioritize middle region)
        in_middle = (
            mid_x_start <= candidate.x <= mid_x_end and mid_y_start <= candidate.y <= mid_y_end
        )
        position_score = settings.PAPI_FALLBACK_POSITION_SCORE if in_middle else 0.0

        # Red light bonus
        is_red = candidate.class_name == "red_light" or (
            hasattr(candidate, "rgb_color")
            and candidate.rgb_color
            and candidate.rgb_color[0] > candidate.rgb_color[1] + 30
            and candidate.rgb_color[0] > candidate.rgb_color[2] + 30
        )
        red_score = settings.PAPI_FALLBACK_RED_SCORE if is_red else 0.0

        # Combined score
        candidate.combined_score = (
            intensity_score * settings.PAPI_FALLBACK_INTENSITY_WEIGHT
            + size_score * settings.PAPI_FALLBACK_SIZE_WEIGHT
            + position_score
            + red_score
        )

    # Sort by combined score (highest first)
    candidates.sort(key=lambda x: x.combined_score, reverse=True)

    # Take top 4 candidates
    top_candidates = candidates[:4]

    logger.info(
        f"Fallback detection selected 4 lights with combined scores: "
        f"{[f'{c.combined_score:.2f}' for c in top_candidates]} "
        f"(middle region + red light priority)"
    )

    # Sort by x-position for proper PAPI ordering
    top_candidates.sort(key=lambda x: x.x)

    return _convert_to_papi_positions(top_candidates, width, height)


def _generate_default_positions(width: int, height: int) -> Dict[str, Dict]:
    """Generate default PAPI positions when detection fails with boundary clamping"""
    detected_lights = {}
    base_x = width // 3
    base_y = height // 2

    for i, light_type in enumerate(["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]):
        x_percent = ((base_x + (i * 100)) / width) * 100
        y_percent = (base_y / height) * 100

        # Clamp positions to ensure rectangles are visible within image bounds (5-95%)
        x_percent = max(5, min(95, x_percent))
        y_percent = max(5, min(95, y_percent))

        detected_lights[light_type] = {"x": x_percent, "y": y_percent, "size": 8}

    return detected_lights
