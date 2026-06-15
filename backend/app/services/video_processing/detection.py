"""
Light detection classes for video processing
"""

import logging
from typing import List, Tuple

import cv2
import numpy as np

from app.services.video_processing.config import settings

from .models import DetectedLight

logger = logging.getLogger(__name__)


class RunwayLightDetector:
    """Advanced light detection using computer vision techniques"""

    def __init__(
        self,
        brightness_threshold: int = None,
        min_area: int = None,
        max_area: int = None,
        saturation_threshold: int = None,
    ):
        self.brightness_threshold = brightness_threshold or settings.VIDEO_BRIGHTNESS_THRESHOLD
        self.min_area = min_area or settings.VIDEO_MIN_AREA
        self.max_area = max_area or settings.VIDEO_MAX_AREA
        self.saturation_threshold = saturation_threshold or settings.VIDEO_SATURATION_THRESHOLD
        logger.info("Light detector initialized")

    def preprocess_for_lights(self, frame: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Preprocess frame to enhance light detection"""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Extract value channel (brightness)
        value_channel = hsv[:, :, 2]

        # Apply CLAHE for contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(value_channel)

        # Create multiple masks for different light conditions
        bright_mask = cv2.threshold(
            value_channel, self.brightness_threshold, 255, cv2.THRESH_BINARY
        )[1]
        saturated_mask = cv2.threshold(
            value_channel, self.saturation_threshold, 255, cv2.THRESH_BINARY
        )[1]
        enhanced_mask = cv2.threshold(
            enhanced, settings.VIDEO_ENHANCED_THRESHOLD, 255, cv2.THRESH_BINARY
        )[1]

        combined_mask = cv2.bitwise_or(bright_mask, saturated_mask)
        combined_mask = cv2.bitwise_or(combined_mask, enhanced_mask)

        kernel = np.ones(
            (settings.VIDEO_MORPH_KERNEL_SIZE, settings.VIDEO_MORPH_KERNEL_SIZE), np.uint8
        )
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel)
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, kernel)

        return combined_mask, value_channel

    def detect_lights(
        self, frame: np.ndarray, downscale_factor: float = 0.5
    ) -> List[DetectedLight]:
        """
        Detect all bright spots and lights in frame.

        OPTIMIZED: Uses downscaling for ~4x speedup on 4K video.
        - Downscales frame before processing (0.5 = 50% size = 4x fewer pixels)
        - Upscales coordinates back to original resolution

        Args:
            frame: Input frame (BGR)
            downscale_factor: Scale factor for processing (0.5 = half resolution, 1.0 = full)
        """
        lights = []

        # Downscale for faster processing
        if downscale_factor < 1.0:
            small_frame = cv2.resize(
                frame, None, fx=downscale_factor, fy=downscale_factor, interpolation=cv2.INTER_AREA
            )
            scale_back = 1.0 / downscale_factor
        else:
            small_frame = frame
            scale_back = 1.0

        # Preprocess (now on smaller frame)
        mask, value_channel = self.preprocess_for_lights(small_frame)

        # Find contours of bright regions
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Adjust area thresholds for downscaled frame
        min_area_scaled = (
            self.min_area * (downscale_factor**2) if downscale_factor < 1.0 else self.min_area
        )
        max_area_scaled = (
            self.max_area * (downscale_factor**2) if downscale_factor < 1.0 else self.max_area
        )

        for contour in contours:
            area = cv2.contourArea(contour)

            if min_area_scaled <= area <= max_area_scaled:
                # Get bounding box (in downscaled coordinates)
                x, y, w, h = cv2.boundingRect(contour)

                # Get center point (in downscaled coordinates)
                cx = x + w / 2
                cy = y + h / 2

                # Create mask for this specific light
                light_mask = np.zeros(mask.shape, dtype=np.uint8)
                cv2.drawContours(light_mask, [contour], -1, 255, -1)

                # Extract RGB values within the light region (from downscaled frame)
                mean_vals = cv2.mean(small_frame, mask=light_mask)
                b, g, r = mean_vals[:3]

                # Calculate brightness and intensity
                brightness = np.mean([r, g, b])

                # Get peak intensity
                roi = value_channel[y : y + h, x : x + w]
                intensity = np.max(roi) if roi.size > 0 else brightness

                # Determine light type based on characteristics
                class_name = self.classify_light(r, g, b, area / (downscale_factor**2), intensity)

                # Scale coordinates back to original resolution
                light = DetectedLight(
                    x=cx * scale_back,
                    y=cy * scale_back,
                    width=w * scale_back,
                    height=h * scale_back,
                    confidence=min(1.0, intensity / 255.0),
                    class_name=class_name,
                    brightness=brightness,
                    intensity=intensity,
                    r=int(r),
                    g=int(g),
                    b=int(b),
                )
                lights.append(light)

        return lights

    def classify_light(self, r: float, g: float, b: float, area: float, intensity: float) -> str:
        """Classify light based on color and characteristics
        with priority for high-intensity PAPI lights"""
        # Normalize RGB values
        total = r + g + b
        if total == 0:
            return "unknown_light"

        r_norm = r / total
        g_norm = g / total
        b_norm = b / total

        # Priority 1: Very high intensity lights (likely PAPI)
        if intensity > settings.PAPI_HIGH_INTENSITY_THRESHOLD:
            return "high_intensity_light"

        # Priority 2: PAPI lights are usually white/red with high intensity
        if intensity > settings.PAPI_MEDIUM_INTENSITY_THRESHOLD:
            if r_norm > settings.PAPI_RED_NORM_THRESHOLD:
                if g_norm < settings.PAPI_GREEN_NORM_THRESHOLD:
                    return "red_light"
                else:
                    return "white_light"
            # White lights (balanced RGB) with high intensity
            if (
                abs(r_norm - settings.PAPI_WHITE_NORM_CENTER) < settings.PAPI_WHITE_NORM_TOLERANCE
                and abs(g_norm - settings.PAPI_WHITE_NORM_CENTER)
                < settings.PAPI_WHITE_NORM_TOLERANCE
            ):
                return "white_light"

        # Priority 3: Standard color-based classification for lower intensity lights
        # PAPI lights with moderate intensity
        if (
            r_norm > settings.PAPI_RED_NORM_THRESHOLD
            and intensity > settings.PAPI_MODERATE_INTENSITY_THRESHOLD
        ):
            if g_norm < settings.PAPI_GREEN_NORM_THRESHOLD:
                return "red_light"
            else:
                return "white_light"

        # Green taxiway lights
        if g_norm > settings.PAPI_RED_NORM_THRESHOLD:
            return "green_light"

        # Blue taxiway edge lights
        if b_norm > settings.PAPI_RED_NORM_THRESHOLD:
            return "blue_light"

        # Yellow/amber lights
        if r_norm > 0.35 and g_norm > 0.35 and b_norm < settings.PAPI_GREEN_NORM_THRESHOLD:
            return "yellow_light"

        # White lights (balanced RGB)
        if (
            abs(r_norm - settings.PAPI_WHITE_NORM_CENTER) < 0.1
            and abs(g_norm - settings.PAPI_WHITE_NORM_CENTER) < 0.1
        ):
            return "white_light"

        return "runway_light"


class PreciseLightDetector:
    """Detects precise light position within a user-defined rectangle using brightness analysis"""

    @staticmethod
    def find_brightest_point_in_rect(
        frame: np.ndarray, rect_center: Tuple[int, int], rect_size: int
    ) -> Tuple[int, int, float]:
        """
        Find the weighted center of brightest RED pixels within a rectangle.

        Uses RED channel instead of grayscale to provide stable tracking for PAPI lights
        (which are RED or WHITE - both have high red values). The center is calculated
        as the weighted average of pixel positions, weighted by RED intensity.

        Args:
            frame: The image frame (BGR)
            rect_center: Center of the rectangle (x, y)
            rect_size: Size of the rectangle in pixels

        Returns:
            Tuple of (x, y, confidence) - precise light position and confidence score
        """
        cx, cy = int(rect_center[0]), int(rect_center[1])
        half_size = rect_size // 2

        # Define ROI bounds (ensure integers for array slicing)
        x1 = int(max(0, cx - half_size))
        y1 = int(max(0, cy - half_size))
        x2 = int(min(frame.shape[1], cx + half_size))
        y2 = int(min(frame.shape[0], cy + half_size))

        roi = frame[y1:y2, x1:x2]

        if roi.size == 0:
            return (cx, cy, 0.0)

        # Use RED channel for PAPI light detection (both red and white lights have high RED)
        red_channel = roi[:, :, 2]  # BGR format, index 2 is RED

        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(red_channel, (5, 5), 0)

        # Find max RED value and create threshold mask (top 15% of brightness)
        max_red = np.max(blurred)
        if max_red == 0:
            return (cx, cy, 0.0)

        threshold_value = max_red * 0.85  # Top 15% of RED values
        red_mask = (blurred >= threshold_value).astype(np.uint8)

        # Find bright pixels
        coords = np.column_stack(np.where(red_mask > 0))
        if coords.shape[0] == 0:
            # Fallback to brightest point if no pixels above threshold
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(blurred)
            bright_x = x1 + max_loc[0]
            bright_y = y1 + max_loc[1]
            confidence = max_val / 255.0
            return (bright_x, bright_y, confidence)

        y_coords, x_coords = coords[:, 0], coords[:, 1]

        # Compute weighted center using RED intensity as weights
        bright_intensities = blurred[red_mask > 0]
        weighted_x = np.average(x_coords, weights=bright_intensities)
        weighted_y = np.average(y_coords, weights=bright_intensities)

        # Convert to frame coordinates
        bright_x = int(x1 + weighted_x)
        bright_y = int(y1 + weighted_y)

        # Calculate confidence based on brightness and contrast
        confidence = max_red / 255.0
        contrast = (max_red - np.mean(blurred)) / 255.0
        confidence = min(1.0, confidence * (1.0 + contrast))

        logger.debug(
            f"Found RED-weighted center at ({bright_x},"
            f" {bright_y}) with confidence {confidence:.2f}"
        )

        return (bright_x, bright_y, confidence)

    @staticmethod
    def detect_red_evaluation_area(
        frame: np.ndarray, rect_center: Tuple[int, int], rect_size: int, red_threshold: float = None
    ) -> dict:
        """
        Detect RGB evaluation area using RED channel values.
        Only pixels with top 85% of RED values are considered for evaluation.

        Args:
            frame: The image frame (BGR)
            rect_center: Center of the PAPI rectangle (x, y)
            rect_size: Size of the rectangle in pixels
            red_threshold: Threshold as fraction of max RED value (0.85 = top 85%)

        Returns:
            Dict containing:
            - center: (x, y) center of evaluation area
            - area_pixels: number of pixels in evaluation area
            - bounds: (x_min, y_min, x_max, y_max) bounding box of evaluation area
            - max_red: maximum RED value found
        """
        if red_threshold is None:
            red_threshold = 1.0 - settings.COLOR_BRIGHTNESS_PERCENTILE

        cx, cy = int(rect_center[0]), int(rect_center[1])
        half_size = rect_size // 2

        # Define ROI bounds (ensure integers for array slicing)
        x1 = int(max(0, cx - half_size))
        y1 = int(max(0, cy - half_size))
        x2 = int(min(frame.shape[1], cx + half_size))
        y2 = int(min(frame.shape[0], cy + half_size))

        roi = frame[y1:y2, x1:x2]

        if roi.size == 0:
            return {"center": (cx, cy), "area_pixels": 0, "bounds": (x1, y1, x2, y2), "max_red": 0}

        # Extract RED channel (BGR format, so index 2)
        red_channel = roi[:, :, 2]

        # Find maximum RED value
        max_red = np.max(red_channel)
        threshold_value = max_red * red_threshold

        # Create binary mask of pixels with RED >= 85% of max
        red_mask = (red_channel >= threshold_value).astype(np.uint8)

        # Count pixels in evaluation area
        area_pixels = np.sum(red_mask)

        # Find bounding box of evaluation area
        if area_pixels > 0:
            rows, cols = np.where(red_mask > 0)
            if len(rows) > 0:
                # Get bounds in ROI coordinates
                roi_y_min, roi_y_max = rows.min(), rows.max()
                roi_x_min, roi_x_max = cols.min(), cols.max()

                # Convert to frame coordinates
                eval_x_min = x1 + roi_x_min
                eval_y_min = y1 + roi_y_min
                eval_x_max = x1 + roi_x_max
                eval_y_max = y1 + roi_y_max

                # Calculate center
                center_x = (eval_x_min + eval_x_max) // 2
                center_y = (eval_y_min + eval_y_max) // 2
            else:
                # Fallback to rectangle center
                center_x, center_y = cx, cy
                eval_x_min, eval_y_min = x1, y1
                eval_x_max, eval_y_max = x2, y2
        else:
            # No pixels found, use rectangle bounds
            center_x, center_y = cx, cy
            eval_x_min, eval_y_min = x1, y1
            eval_x_max, eval_y_max = x2, y2

        return {
            "center": (center_x, center_y),
            "area_pixels": int(area_pixels),
            "bounds": (eval_x_min, eval_y_min, eval_x_max, eval_y_max),
            "max_red": float(max_red),
        }
