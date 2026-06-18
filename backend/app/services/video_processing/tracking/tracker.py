"""
PAPI light tracking module
"""

import logging
import math
from typing import Dict, List, Tuple

from app.services.video_processing.config import settings

from ..detection import PreciseLightDetector, RunwayLightDetector
from ..models import DetectedLight, TrackedPAPILight
from ..utils import extract_color_from_brightest_pixels
from .tracker_helpers import stabilize_position_change, stabilize_size_change

logger = logging.getLogger(__name__)


class PAPILightTracker:
    """PAPI light tracker using detection-based tracking"""

    def __init__(
        self,
        initial_positions: Dict,
        frame_width: int,
        frame_height: int,
        skip_full_detection: bool = False,
    ):
        """
        Initialize PAPI light tracker.

        Args:
            initial_positions: User-selected PAPI light positions
            frame_width: Video frame width
            frame_height: Video frame height
            skip_full_detection: If True, skip expensive full-frame detection and only
                                 use ROI-based refinement around known positions.
                                 Default: False (full detection every
                                 TRACKING_DETECTION_INTERVAL frames)
        """
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.skip_full_detection = skip_full_detection
        self.light_detector = RunwayLightDetector() if not skip_full_detection else None
        self.precise_detector = PreciseLightDetector()
        self.max_distance = settings.TRACKING_MAX_DISTANCE
        self.max_frame_gap = settings.TRACKING_MAX_FRAME_GAP
        self.detection_interval = settings.TRACKING_DETECTION_INTERVAL
        self.last_detection_frame = -999  # Force detection on first frame

        # Initialize tracked lights from manual positions
        self.tracked_lights: Dict[str, TrackedPAPILight] = {}
        valid_lights_count = 0

        logger.info(f"{'=' * 80}")
        logger.info(
            f"TRACKER INIT: Initializing with manual positions"
            f" for frame size {frame_width}x{frame_height}"
        )
        logger.info(f"TRACKER INIT: Received initial_positions = {initial_positions}")
        logger.info(f"{'=' * 80}")

        for light_name, pos in initial_positions.items():
            if light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
                # Handle different position data formats
                if isinstance(pos, dict):
                    if "x" in pos and "y" in pos:
                        # Use provided coordinates
                        pixel_x = int((pos["x"] / 100) * frame_width)
                        pixel_y = int((pos["y"] / 100) * frame_height)
                        pixel_size = int((pos.get("size", 8) / 100) * frame_width)
                        logger.info(
                            f"TRACKER INIT: {light_name} = ({pixel_x}, {pixel_y}) pixels"
                            f" from {pos['x']:.2f}%, {pos['y']:.2f}% | size={pixel_size}px"
                        )
                        valid_lights_count += 1
                    else:
                        # Use fallback default positions if coordinates are missing
                        logger.warning(
                            f"Using fallback position for {light_name}: incomplete data: {pos}"
                        )
                        light_index = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"].index(light_name)
                        pixel_x = int((20 + light_index * 20) / 100 * frame_width)
                        pixel_y = int(50 / 100 * frame_height)
                        pixel_size = int(8 / 100 * frame_width)
                        valid_lights_count += 1
                else:
                    # Handle completely invalid position data
                    logger.warning(f"Using fallback position for {light_name}: invalid data: {pos}")
                    light_index = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"].index(light_name)
                    pixel_x = int((20 + light_index * 20) / 100 * frame_width)
                    pixel_y = int(50 / 100 * frame_height)
                    pixel_size = int(8 / 100 * frame_width)
                    valid_lights_count += 1

                self.tracked_lights[light_name] = TrackedPAPILight(
                    light_name=light_name,
                    positions=[(pixel_x, pixel_y)],
                    rgb_values=[(255, 255, 255)],  # Default white
                    frame_numbers=[0],
                    confidence_scores=[0.0],
                    sizes=[pixel_size],
                    evaluation_area=[],  # Will be populated during frame processing
                )

        if valid_lights_count == 0:
            logger.error("No valid PAPI lights could be initialized for tracking")
        else:
            logger.info(f"Initialized {valid_lights_count} PAPI lights for tracking")

        self.global_motion = (0.0, 0.0)  # Estimated camera motion
        self.prev_detections = []  # Previous frame detections for motion estimation

    def refine_initial_positions(self, first_frame):
        """
        Refine initial positions by finding brightest point within user-selected rectangles.
        This should be called once on the first frame after initialization.
        """
        logger.info("=" * 80)
        logger.info("REFINING INITIAL PAPI LIGHT POSITIONS USING BRIGHTNESS ANALYSIS")
        logger.info("=" * 80)

        for light_name, tracked_light in self.tracked_lights.items():
            initial_x, initial_y = tracked_light.positions[0]
            initial_size = tracked_light.sizes[0]

            logger.info(f"Processing {light_name}:")
            logger.info(f"  User-selected center: ({initial_x}, {initial_y}) px")
            logger.info(f"  User-selected size: {initial_size} px")
            logger.info("  Searching for brightest point within rectangle...")

            # Find precise position within the rectangle
            refined_x, refined_y, confidence = self.precise_detector.find_brightest_point_in_rect(
                first_frame, (initial_x, initial_y), initial_size
            )

            # Calculate how much the position moved
            movement = math.sqrt((refined_x - initial_x) ** 2 + (refined_y - initial_y) ** 2)

            # Update the tracked light with refined position
            tracked_light.positions[0] = (refined_x, refined_y)
            tracked_light.confidence_scores[0] = confidence

            logger.info(f"  ✓ Refined position: ({refined_x}, {refined_y}) px")
            logger.info(f"  ✓ Movement: {movement:.1f} px")
            logger.info(f"  ✓ Confidence: {confidence:.2f}")

        logger.info("=" * 80)
        logger.info("REFINEMENT COMPLETE - REFINED POSITIONS WILL BE USED FOR TRACKING")
        logger.info("=" * 80)

    def update_frame(self, frame, frame_number: int) -> Dict:
        """Update light positions for current frame using detection-based tracking"""

        # SPECIAL CASE: For frame 0, refine initial positions
        if frame_number == 0:
            logger.info(f"{'=' * 80}")
            logger.info("UPDATE_FRAME: Frame 0 - Refining manually selected positions")

            # Refine positions by finding brightest point in each rectangle
            self.refine_initial_positions(frame)

            # Return refined positions
            frame_positions = {}
            for light_name, tracked_light in self.tracked_lights.items():
                last_x, last_y = tracked_light.get_last_position()
                last_size = tracked_light.sizes[-1] if tracked_light.sizes else 300

                # Extract RGB from refined position (ensure integers for array slicing)
                roi_size = last_size // 2
                lx, ly = int(last_x), int(last_y)
                x1 = int(max(0, lx - roi_size))
                y1 = int(max(0, ly - roi_size))
                x2 = int(min(frame.shape[1], lx + roi_size))
                y2 = int(min(frame.shape[0], ly + roi_size))
                roi = frame[y1:y2, x1:x2]

                if roi.size > 0:
                    rgb = extract_color_from_brightest_pixels(roi)
                else:
                    rgb = (255, 255, 255)

                tracked_light.rgb_values[0] = rgb

                # Detect RED-channel based evaluation area within this PAPI rectangle
                eval_area = self.precise_detector.detect_red_evaluation_area(
                    frame, (last_x, last_y), last_size
                )
                tracked_light.evaluation_area.append(eval_area)

                # Detect actual size from evaluation area and use it as the baseline
                # This replaces user-selected size with real detected size
                actual_size = last_size
                if eval_area and eval_area.get("area_pixels", 0) > 0:
                    detected_size = int(math.sqrt(eval_area["area_pixels"]) * 3)
                    actual_size = max(100, detected_size)
                    tracked_light.sizes[0] = actual_size
                    logger.info(
                        f"UPDATE_FRAME: {light_name} Frame 0 size set to {actual_size}px"
                        f" (detected from {eval_area['area_pixels']}px² area)"
                    )

                frame_positions[light_name] = {
                    "x": last_x,
                    "y": last_y,
                    "size": actual_size,
                    "rgb": rgb,
                    "confidence": tracked_light.confidence_scores[0],
                    "evaluation_area": eval_area,
                }

                # Log evaluation area info
                if eval_area and eval_area.get("area_pixels", 0) > 0:
                    logger.info(
                        f"UPDATE_FRAME: {light_name} → ({last_x}, {last_y}) size={actual_size}"
                        f" RGB={rgb}, evaluation area: {eval_area['area_pixels']}px²"
                    )
                else:
                    logger.info(
                        f"UPDATE_FRAME: {light_name} → ({last_x},"
                        f" {last_y}) size={actual_size} RGB={rgb}"
                    )

            logger.info(f"{'=' * 80}")
            return frame_positions

        # For all subsequent frames, use detection-based tracking
        logger.debug(f"Frame {frame_number}: Using detection-based tracking")
        frame_positions = self._process_detection_based_tracking(frame, frame_number)

        return frame_positions

    def _process_detection_based_tracking(self, frame, frame_number: int) -> Dict:
        """Process detection-based tracking (main tracking method)"""
        frame_positions = {}

        # OPTIMIZATION: Skip full-frame detection if enabled (default: True)
        # Since PAPI positions are user-selected, we only need ROI-based refinement
        if self.skip_full_detection:
            # Fast path: Only refine known positions using ROI
            return self._process_roi_only_tracking(frame, frame_number)

        # Only run full detection every N frames (detection_interval) to improve performance
        # Between detections, use predicted/refined positions based on last known positions
        frames_since_detection = frame_number - self.last_detection_frame
        should_run_detection = frames_since_detection >= self.detection_interval

        if should_run_detection:
            # Run light detection on current frame
            logger.debug(f"Frame {frame_number}: Running full light detection on frame...")
            detected_lights = self.light_detector.detect_lights(frame)
            logger.debug(f"Frame {frame_number}: Detected {len(detected_lights)} lights in frame")
            self.last_detection_frame = frame_number
        else:
            # Skip detection - use empty list and rely on position refinement
            detected_lights = []

        # Update each tracked PAPI light by matching to detected lights
        unmatched_detections = list(detected_lights)

        for light_name, tracked_light in self.tracked_lights.items():
            last_frame = tracked_light.frame_numbers[-1] if tracked_light.frame_numbers else 0
            frame_gap = frame_number - last_frame

            # Skip if track is too old
            if frame_gap > self.max_frame_gap:
                # Use global motion to predict position
                last_x, last_y = tracked_light.get_last_position()
                pred_x = int(last_x + self.global_motion[0] * frame_gap)
                pred_y = int(last_y + self.global_motion[1] * frame_gap)

                frame_positions[light_name] = {
                    "x": pred_x,
                    "y": pred_y,
                    "size": tracked_light.sizes[-1] if tracked_light.sizes else 20,
                    "rgb": tracked_light.rgb_values[-1]
                    if tracked_light.rgb_values
                    else [255, 255, 255],
                    "confidence": 0.1,  # Low confidence for predicted position
                }
                continue

            # Find best matching detection
            best_match, best_match_idx = self._find_best_match(
                tracked_light, unmatched_detections, frame_gap
            )

            if best_match:
                position_dict = self._process_matched_detection(
                    frame, tracked_light, best_match, frame_number, light_name
                )
                frame_positions[light_name] = position_dict

                # Remove from unmatched list
                if best_match_idx >= 0:
                    unmatched_detections.pop(best_match_idx)
            else:
                # No detection found - use predicted position
                position_dict = self._process_unmatched_light(
                    frame, tracked_light, frame_gap, frame_number
                )
                frame_positions[light_name] = position_dict

        # Store current detections for next iteration
        self.prev_detections = detected_lights

        return frame_positions

    def _find_best_match(
        self,
        tracked_light: TrackedPAPILight,
        unmatched_detections: List[DetectedLight],
        frame_gap: int,
    ):
        """Find best matching detection for a tracked light"""
        # Predict where this light should be
        pred_x, pred_y = tracked_light.predict_position(frame_gap)

        # Apply global motion correction
        pred_x += int(self.global_motion[0] * frame_gap)
        pred_y += int(self.global_motion[1] * frame_gap)

        best_match = None
        best_score = float("inf")
        best_match_idx = -1

        for idx, detection in enumerate(unmatched_detections):
            # Distance to predicted position
            pred_distance = math.sqrt((detection.x - pred_x) ** 2 + (detection.y - pred_y) ** 2)

            # Distance to last known position
            last_x, last_y = tracked_light.get_last_position()
            last_distance = math.sqrt((detection.x - last_x) ** 2 + (detection.y - last_y) ** 2)

            # Combined score (weighted towards prediction)
            score = 0.7 * pred_distance + 0.3 * last_distance

            # Penalty for significant brightness change
            if tracked_light.rgb_values:
                last_rgb = tracked_light.rgb_values[-1]
                last_brightness = sum(last_rgb) / 3
                brightness_diff = abs(detection.brightness - last_brightness)
                score += brightness_diff * settings.TRACKING_BRIGHTNESS_DIFF_PENALTY

            # Penalty for unreasonable movement
            if frame_gap > 0:
                movement_per_frame = last_distance / frame_gap
                if movement_per_frame > settings.TRACKING_SUSPICIOUS_MOVEMENT_PER_FRAME:
                    score += movement_per_frame * settings.TRACKING_MOVEMENT_PENALTY

            if score < self.max_distance and score < best_score:
                best_score = score
                best_match = detection
                best_match_idx = idx

        return best_match, best_match_idx

    def _process_matched_detection(
        self,
        frame,
        tracked_light: TrackedPAPILight,
        detection: DetectedLight,
        frame_number: int,
        light_name: str,
    ) -> Dict:
        """Process a matched detection"""
        # REFINE POSITION: Find brightest point within detected area for accuracy
        search_size = max(detection.width, detection.height)
        refined_x, refined_y, refined_conf = self.precise_detector.find_brightest_point_in_rect(
            frame, (int(detection.x), int(detection.y)), search_size
        )

        # Detect RED-channel based evaluation area within this PAPI rectangle
        eval_area = self.precise_detector.detect_red_evaluation_area(
            frame, (refined_x, refined_y), search_size
        )

        # Use refined position directly
        stabilized_x, stabilized_y = refined_x, refined_y

        # Extract RGB from stabilized position (ensure integers for array slicing)
        roi_size = search_size // 2
        sx, sy = int(stabilized_x), int(stabilized_y)
        x1 = int(max(0, sx - roi_size))
        y1 = int(max(0, sy - roi_size))
        x2 = int(min(frame.shape[1], sx + roi_size))
        y2 = int(min(frame.shape[0], sy + roi_size))
        roi = frame[y1:y2, x1:x2]

        if roi.size > 0:
            rgb = extract_color_from_brightest_pixels(roi)
        else:
            rgb = (detection.r, detection.g, detection.b)

        # Stabilize size changes to prevent jumps
        last_size = tracked_light.sizes[-1] if tracked_light.sizes else search_size
        stabilized_size = stabilize_size_change(search_size, last_size)

        # Update tracked light
        tracked_light.positions.append((stabilized_x, stabilized_y))
        tracked_light.rgb_values.append(rgb)
        tracked_light.frame_numbers.append(frame_number)
        tracked_light.confidence_scores.append(refined_conf)
        tracked_light.sizes.append(stabilized_size)
        tracked_light.evaluation_area.append(eval_area)

        # Log only first frame and then every 100 frames for debugging
        if frame_number == 0 or frame_number % 100 == 0:
            movement = math.sqrt(
                (refined_x - int(detection.x)) ** 2 + (refined_y - int(detection.y)) ** 2
            )
            eval_str = (
                f"{eval_area['area_pixels']}px²"
                if eval_area and eval_area.get("area_pixels", 0) > 0
                else "none"
            )
            logger.info(
                f"Frame {frame_number}: {light_name} detected"
                f" at ({int(detection.x)}, {int(detection.y)}), "
                f"refined to ({refined_x}, {refined_y}),"
                f" stabilized to ({stabilized_x}, {stabilized_y}), "
                f"movement={movement:.1f}px, evaluation area: {eval_str}"
            )

        return {
            "x": stabilized_x,
            "y": stabilized_y,
            "size": stabilized_size,
            "rgb": list(rgb),
            "confidence": refined_conf,
            "evaluation_area": eval_area,
        }

    def _process_roi_only_tracking(self, frame, frame_number: int) -> Dict:
        """
        OPTIMIZED: Process tracking using only ROI around known light positions.

        This is ~20x faster than full-frame detection for 4K video because:
        - Skips expensive full-frame light detection (8.3M pixels)
        - Only processes small ROIs around each PAPI light (~300x300 = 90K pixels each)
        - Total: ~360K pixels vs 8.3M pixels = 23x less data
        - ADDITIONAL: Processes all 4 lights in parallel for ~4x speedup
        """
        frame_positions = {}
        frame_height, frame_width = frame.shape[:2]

        def process_single_roi(light_name: str) -> Tuple[str, Dict, Tuple, int, float, Dict]:
            """Process a single light ROI (thread-safe read operations)"""
            tracked_light = self.tracked_lights[light_name]

            # Get last known position and size
            last_x, last_y = tracked_light.get_last_position()
            last_size = tracked_light.sizes[-1] if tracked_light.sizes else 300

            # Use larger search window to better track moving lights
            search_size = int(last_size * 2)

            # Refine position using brightest point in ROI
            refined_x, refined_y, refined_conf = self.precise_detector.find_brightest_point_in_rect(
                frame, (last_x, last_y), search_size
            )

            # Detect evaluation area and measure actual light size
            eval_area = self.precise_detector.detect_red_evaluation_area(
                frame, (refined_x, refined_y), search_size
            )

            # Calculate new size based on detected evaluation area
            new_size = last_size
            if eval_area and eval_area.get("area_pixels", 0) > 0:
                detected_size = int(math.sqrt(eval_area["area_pixels"]) * 3)
                max_change = last_size * settings.TRACKING_MAX_SIZE_CHANGE_PERCENT
                if detected_size > last_size:
                    new_size = min(detected_size, int(last_size + max_change))
                else:
                    new_size = max(detected_size, int(last_size - max_change))
                new_size = max(100, new_size)

            # Extract RGB from refined position (ensure integers for array slicing)
            roi_size = new_size // 2
            rx, ry = int(refined_x), int(refined_y)
            x1 = int(max(0, rx - roi_size))
            y1 = int(max(0, ry - roi_size))
            x2 = int(min(frame_width, rx + roi_size))
            y2 = int(min(frame_height, ry + roi_size))
            roi = frame[y1:y2, x1:x2]

            if roi.size > 0:
                rgb = extract_color_from_brightest_pixels(roi)
            else:
                rgb = tracked_light.rgb_values[-1] if tracked_light.rgb_values else (255, 255, 255)

            return light_name, {
                "refined_x": refined_x,
                "refined_y": refined_y,
                "new_size": new_size,
                "rgb": rgb,
                "refined_conf": refined_conf,
                "eval_area": eval_area,
            }

        # process the tracked lights serially - the per-roi work is small gil-bound
        # cv2/numpy, so a per-frame 4-worker pool cost more in thread churn than it saved
        light_names = list(self.tracked_lights.keys())
        results = [process_single_roi(name) for name in light_names]

        # Collect results and update tracked lights (must be sequential for state updates)
        for light_name, data in results:
            tracked_light = self.tracked_lights[light_name]
            refined_x = data["refined_x"]
            refined_y = data["refined_y"]
            new_size = data["new_size"]
            rgb = data["rgb"]
            refined_conf = data["refined_conf"]
            eval_area = data["eval_area"]

            # Apply position stabilization to prevent jumpy center detection
            last_x, last_y = tracked_light.get_last_position()
            stabilized_x, stabilized_y = stabilize_position_change(
                refined_x, refined_y, last_x, last_y
            )

            # Update tracked light with stabilized position and size
            tracked_light.positions.append((stabilized_x, stabilized_y))
            tracked_light.rgb_values.append(rgb)
            tracked_light.frame_numbers.append(frame_number)
            tracked_light.confidence_scores.append(refined_conf)
            tracked_light.sizes.append(new_size)
            tracked_light.evaluation_area.append(eval_area)

            frame_positions[light_name] = {
                "x": stabilized_x,
                "y": stabilized_y,
                "size": new_size,
                "rgb": list(rgb) if isinstance(rgb, tuple) else rgb,
                "confidence": refined_conf,
                "evaluation_area": eval_area,
            }

        return frame_positions

    def _process_unmatched_light(
        self, frame, tracked_light: TrackedPAPILight, frame_gap: int, frame_number: int
    ) -> Dict:
        """Process an unmatched light using predicted position"""
        # Predict position
        pred_x, pred_y = tracked_light.predict_position(frame_gap)
        pred_x += int(self.global_motion[0] * frame_gap)
        pred_y += int(self.global_motion[1] * frame_gap)

        last_size = tracked_light.sizes[-1] if tracked_light.sizes else 20

        # Try to find brightest point near predicted position
        refined_x, refined_y, refined_conf = self.precise_detector.find_brightest_point_in_rect(
            frame, (pred_x, pred_y), last_size
        )

        # Detect evaluation area
        eval_area = self.precise_detector.detect_red_evaluation_area(
            frame, (refined_x, refined_y), last_size
        )

        stabilized_x, stabilized_y = refined_x, refined_y

        # Extract RGB (ensure integers for array slicing)
        roi_size = last_size // 2
        sx, sy = int(stabilized_x), int(stabilized_y)
        x1 = int(max(0, sx - roi_size))
        y1 = int(max(0, sy - roi_size))
        x2 = int(min(frame.shape[1], sx + roi_size))
        y2 = int(min(frame.shape[0], sy + roi_size))
        roi = frame[y1:y2, x1:x2]

        if roi.size > 0:
            rgb = extract_color_from_brightest_pixels(roi)
        else:
            rgb = tracked_light.rgb_values[-1] if tracked_light.rgb_values else (255, 255, 255)

        # Update with predicted position for short gaps
        if frame_gap <= 5:
            tracked_light.positions.append((stabilized_x, stabilized_y))
            tracked_light.rgb_values.append(rgb)
            tracked_light.frame_numbers.append(frame_number)
            tracked_light.confidence_scores.append(max(0.3, refined_conf * 0.5))
            tracked_light.sizes.append(last_size)
            tracked_light.evaluation_area.append(eval_area)

        return {
            "x": stabilized_x,
            "y": stabilized_y,
            "size": last_size,
            "rgb": list(rgb) if isinstance(rgb, tuple) else rgb,
            "confidence": max(0.3, refined_conf * 0.5),
            "evaluation_area": eval_area,
        }
