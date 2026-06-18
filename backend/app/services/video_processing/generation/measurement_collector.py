"""
Measurement collection and transition angle computation
"""

import logging
import time
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from app.services.video_processing.config import settings

from ..gps import GPSExtractor
from ..processor import VideoProcessor
from ..tracking import PAPILightTracker
from ..utils import extract_color_from_brightest_pixels, measure_light_dimensions

logger = logging.getLogger(__name__)


def apply_trimmed_mean_filter(
    values: List[float], window_size: int = 20, trim_percent: float = 0.1
) -> List[float]:
    """
    Apply a trimmed mean filter to smooth signal values while rejecting outliers.

    This is a robust smoothing filter that:
    1. Takes a window of (window_size * 2 + 1) values centered on each point
    2. Removes the top and bottom trim_percent of values (e.g., 10% each)
    3. Averages the remaining values

    This is more robust than simple moving average because it ignores outliers/spikes.

    Args:
        values: Input signal values
        window_size: Number of points before AND after
        current point (total window = 2*window_size + 1)
        trim_percent: Fraction of values to remove from
        each end (0.1 = remove top 10% and bottom 10%)

    Returns:
        Smoothed signal values (same length as input)
    """
    if len(values) == 0:
        return values

    arr = np.array(values)
    n = len(arr)
    result = np.zeros(n)

    for i in range(n):
        # Define window boundaries (handle edges)
        start = max(0, i - window_size)
        end = min(n, i + window_size + 1)

        window = arr[start:end]
        window_len = len(window)

        if window_len <= 2:
            # Not enough values to trim, just use mean
            result[i] = np.mean(window)
        else:
            # Sort the window values
            sorted_window = np.sort(window)

            # Calculate how many values to trim from each end
            trim_count = max(1, int(window_len * trim_percent))

            # Ensure we have at least one value left after trimming
            if trim_count * 2 >= window_len:
                trim_count = max(0, (window_len - 1) // 2)

            # Trim and compute mean
            if trim_count > 0:
                trimmed = sorted_window[trim_count:-trim_count]
            else:
                trimmed = sorted_window

            result[i] = np.mean(trimmed)

    return result.tolist()


class MeasurementCollector:
    """Handles measurement collection and transition angle computation"""

    def __init__(self, progress_callback=None):
        """
        Initialize the MeasurementCollector.

        Args:
            progress_callback: Optional callback function for progress updates
        """
        self.progress_callback = progress_callback

    def collect_measurements_only(
        self,
        video_path: str,
        session_id: str,
        light_positions: Dict,
        real_gps_data: List,
        reference_points: Dict,
        runway_heading: float,
        fps: int = 30,
    ) -> tuple:
        """
        PASS 1: Collect measurements and compute transition angles.

        Process video to collect all frame measurements, then compute transition
        angles and inject them into the measurements data.

        Returns: (measurements_data, gps_cache, tracked_positions_cache)
            - measurements_data: List[Dict] with transition angles included
            - gps_cache: Dict[frame_num, gps_data] to avoid recomputation in Pass 2
            - tracked_positions_cache: Dict[frame_num, tracked_positions] to reuse in Pass 2
        """
        logger.info("=" * 80)
        logger.info("PASS 1: COLLECTING MEASUREMENTS AND COMPUTING TRANSITION ANGLES")
        logger.info(f"Video: {video_path}")
        logger.info(f"Session: {session_id}")
        logger.info("=" * 80)

        # Open video
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")

        # Get video properties
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_fps = int(cap.get(cv2.CAP_PROP_FPS)) or fps

        logger.info(f"Video: {frame_width}x{frame_height}, {video_fps}fps, {total_frames} frames")

        # Initialize tracker with ROI-only mode for ~20x speedup
        # Since PAPI positions are user-selected, we don't need full-frame detection
        light_tracker = PAPILightTracker(
            light_positions, frame_width, frame_height, skip_full_detection=True
        )
        if not light_tracker.tracked_lights:
            raise ValueError("No PAPI lights initialized for tracking")

        # Pre-compute GPS cache for all frames
        logger.info("Pre-computing GPS data cache...")
        gps_extractor = GPSExtractor()
        gps_cache = {}
        for frame_num in range(total_frames):
            interpolated = gps_extractor.interpolate_gps_for_frame(
                real_gps_data, frame_num, video_fps
            )
            if interpolated:
                gps_cache[frame_num] = {
                    "elevation_wgs84": interpolated.elevation_wgs84,
                    "latitude": interpolated.latitude,
                    "longitude": interpolated.longitude,
                    "speed": interpolated.speed or 0.0,
                    "heading": interpolated.heading or 0.0,
                    "ref_points": reference_points,
                    "runway_heading": runway_heading,
                }

                # Log first frame's GPS data for debugging
                if frame_num == 0:
                    logger.info("=" * 80)
                    logger.info("FIRST FRAME GPS DATA (all elevations in WGS84):")
                    logger.info(f"  interpolated.elevation_wgs84 = {interpolated.elevation_wgs84}m")
                    logger.info(f"  interpolated.latitude = {interpolated.latitude}")
                    logger.info(f"  interpolated.longitude = {interpolated.longitude}")
                    logger.info(
                        f"  gps_cache[0]['elevation_wgs84'] = {gps_cache[0]['elevation_wgs84']}m"
                    )
                    logger.info(f"  reference_points keys = {list(reference_points.keys())}")
                    for rp_name, rp_data in reference_points.items():
                        logger.info(f"    {rp_name}: {rp_data}")
                    logger.info("=" * 80)

        logger.info(f"Pre-computed GPS for {len(gps_cache)} frames")

        # Storage for measurements and cached data
        measurements_data = []
        tracked_positions_cache = {}  # Cache tracking positions to avoid recomputation in Pass 2

        # MEASUREMENT COLLECTION LOOP
        frame_number = 0
        start_time = time.time()

        # Timing accumulators for performance analysis
        timing_stats = {
            "read_frame": 0.0,
            "tracking": 0.0,
            "measurement": 0.0,
            "rgb_extraction": 0.0,
            "frame_processing": 0.0,
        }

        logger.info("Collecting measurements from all frames...")

        while True:
            t0 = time.time()
            ret, frame = cap.read()
            timing_stats["read_frame"] += time.time() - t0
            if not ret:
                break

            # Get GPS data for this frame
            drone_data = gps_cache.get(frame_number)
            if not drone_data:
                logger.warning(f"No GPS data for frame {frame_number}, skipping")
                frame_number += 1
                continue

            # Track light positions and cache for Pass 2
            t0 = time.time()
            tracked_positions = light_tracker.update_frame(frame, frame_number)
            timing_stats["tracking"] += time.time() - t0
            tracked_positions_cache[frame_number] = (
                tracked_positions  # Cache to avoid recomputation in Pass 2
            )

            # Measure precise light dimensions for each PAPI light (using RED channel method)
            # measured center/size is persisted into frame_data below so PASS 2 reuses it
            t0 = time.time()
            light_dimensions = {}
            light_rgb_values = {}  # Store RGB extracted from visualization ROI

            def process_single_light(
                light_name: str,
            ) -> Tuple[str, Optional[Dict], Optional[Dict], Optional[List]]:
                """Process a single PAPI light measurement (thread-safe)"""
                tracked_pos = tracked_positions.get(light_name)
                if not tracked_pos:
                    return light_name, None, None, None

                tracker_x, tracker_y = tracked_pos["x"], tracked_pos["y"]
                size = tracked_pos["size"]

                # OPTIMIZED: Single measurement with larger search area
                search_size = int(size * 1.5)
                final_center_x, final_center_y, measured_width, measured_height = (
                    measure_light_dimensions(
                        frame, tracker_x, tracker_y, search_size, brightness_threshold=0.10
                    )
                )

                dims = {
                    "center_x": final_center_x,
                    "center_y": final_center_y,
                    "width": measured_width,
                    "height": measured_height,
                }

                # Extract RGB from the SAME ROI that will be visualized in PASS 2
                roi_width = int(measured_width * 1.5)
                roi_height = int(measured_height * 1.5)
                roi_size = max(roi_width, roi_height)
                half_roi_size = roi_size // 2

                # Ensure integers for array slicing
                cx, cy = int(final_center_x), int(final_center_y)
                x1 = int(max(0, cx - half_roi_size))
                y1 = int(max(0, cy - half_roi_size))
                x2 = int(min(frame_width, cx + half_roi_size))
                y2 = int(min(frame_height, cy + half_roi_size))

                light_roi = frame[y1:y2, x1:x2]

                rgb_values = None
                rgb_list = None
                if light_roi.size > 0:
                    r, g, b = extract_color_from_brightest_pixels(light_roi)
                    rgb_values = {"r": r, "g": g, "b": b}
                    rgb_list = [r, g, b]

                return light_name, dims, rgb_values, rgb_list

            # process the 4 PAPI lights serially - the per-light work is small gil-bound
            # cv2/numpy on tiny rois, so spinning up a 4-worker pool every frame cost more
            # in thread churn than it saved
            results = [
                process_single_light(name) for name in ("PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D")
            ]

            # Collect results
            for light_name, dims, rgb_values, rgb_list in results:
                if dims:
                    light_dimensions[light_name] = dims
                if rgb_values:
                    light_rgb_values[light_name] = rgb_values
                if rgb_list and light_name in tracked_positions:
                    tracked_positions[light_name]["rgb"] = rgb_list

            timing_stats["measurement"] += time.time() - t0

            # Compute measurements for this frame (log every 30 frames to reduce noise)
            if frame_number % 30 == 0:
                logger.info(f"⏱️ Processing frame {frame_number}/{total_frames}")
            t0 = time.time()
            frame_measurements = VideoProcessor.process_frame(
                frame, tracked_positions, drone_data, reference_points
            )
            timing_stats["frame_processing"] += time.time() - t0

            # Log frame measurements for first frame
            if frame_number == 0:
                logger.info("=" * 80)
                logger.info("FIRST FRAME MEASUREMENTS:")
                logger.info(f"  frame_measurements = {frame_measurements}")
                logger.info("=" * 80)

            # Store measurements
            frame_data = {
                "session_id": session_id,
                "frame_number": frame_number,
                "timestamp": frame_number / video_fps,
                "drone_latitude": float(drone_data["latitude"]),
                "drone_longitude": float(drone_data["longitude"]),
                "drone_elevation_wgs84": drone_data["elevation_wgs84"],
            }

            # Add PAPI measurements
            for light_name in ["papi_a", "papi_b", "papi_c", "papi_d"]:
                light_key = light_name.upper().replace("_", "_")
                if light_key in frame_measurements:
                    data = frame_measurements[light_key]
                    frame_data[f"{light_name}_status"] = data["status"]
                    frame_data[f"{light_name}_rgb"] = data["rgb"]
                    frame_data[f"{light_name}_intensity"] = data["intensity"]
                    frame_data[f"{light_name}_angle"] = data["angle"]
                    frame_data[f"{light_name}_distance_ground"] = data["distance_ground"]
                    frame_data[f"{light_name}_horizontal_angle"] = data.get("horizontal_angle")

                    # Compute and store area_pixels from light dimensions (width × height)
                    if light_key in light_dimensions:
                        dims = light_dimensions[light_key]
                        area_pixels = int(dims.get("width", 0) * dims.get("height", 0))
                        frame_data[f"{light_name}_area_pixels"] = area_pixels

                        # persist the measured center/size so PASS 2 frames each PAPI crop on
                        # the precise red-channel box instead of silently falling back to the
                        # coarser tracker position (the keys PASS 2 reads were never written)
                        frame_data[f"{light_name}_center_x"] = dims.get("center_x")
                        frame_data[f"{light_name}_center_y"] = dims.get("center_y")
                        frame_data[f"{light_name}_width"] = dims.get("width")
                        frame_data[f"{light_name}_height"] = dims.get("height")
                    else:
                        frame_data[f"{light_name}_area_pixels"] = 0

                    # Log first frame angles
                    if frame_number == 0:
                        logger.info(
                            f"📊 {light_name}: angle={data['angle']}°,"
                            f" distance={data['distance_ground']}m"
                        )

            measurements_data.append(frame_data)

            frame_number += 1

            # Progress callback
            if frame_number % 30 == 0:
                progress = (frame_number / total_frames) * 100
                elapsed = time.time() - start_time
                fps_actual = frame_number / elapsed if elapsed > 0 else 0
                logger.info(
                    f"Progress: {progress:.1f}%"
                    f" ({frame_number}/{total_frames}) - {fps_actual:.1f} fps"
                )
                if self.progress_callback:
                    self.progress_callback(
                        progress * 0.5, f"collecting_measurements_frame_{frame_number}"
                    )

        # Release video
        cap.release()

        elapsed_time = time.time() - start_time
        logger.info(
            f"Measurement collection complete: {frame_number} frames in {elapsed_time:.1f}s"
        )

        # Log timing breakdown
        logger.info("=" * 60)
        logger.info("TIMING BREAKDOWN (PASS 1):")
        for key, value in timing_stats.items():
            pct = (value / elapsed_time * 100) if elapsed_time > 0 else 0
            logger.info(f"  {key}: {value:.1f}s ({pct:.1f}%)")
        logger.info("=" * 60)

        # Compute transition angles for all PAPI lights
        logger.info("Computing green-channel-based transition angles...")
        transition_angles_data = {}
        for light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
            transition_angles = self.compute_transition_angles_from_chromacity(
                measurements_data, light_name, reference_points
            )
            transition_angles_data[light_name] = transition_angles

            # Safely format transition angles, handle None values
            min_angle = transition_angles.get("transition_angle_min")
            max_angle = transition_angles.get("transition_angle_max")
            middle_angle = transition_angles.get("transition_angle_middle")

            min_str = f"{min_angle:.3f}" if min_angle is not None else "N/A"
            max_str = f"{max_angle:.3f}" if max_angle is not None else "N/A"
            middle_str = f"{middle_angle:.3f}" if middle_angle is not None else "N/A"

            logger.info(f"{light_name}: min={min_str}, max={max_str}, middle={middle_str}")

        # Inject transition angles into all frames
        logger.info("Injecting transition angles into measurements...")
        for frame_data in measurements_data:
            for light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
                light_key = light_name.lower()
                angles = transition_angles_data[light_name]
                frame_data[f"{light_key}_transition_angle_min"] = angles.get("transition_angle_min")
                frame_data[f"{light_key}_transition_angle_middle"] = angles.get(
                    "transition_angle_middle"
                )
                frame_data[f"{light_key}_transition_angle_max"] = angles.get("transition_angle_max")
                frame_data[f"{light_key}_transition_angle"] = angles.get("transition_angle_middle")

        logger.info("=" * 80)
        logger.info(f"PASS 1 COMPLETE: {len(measurements_data)} frames with transition angles")
        logger.info(f"Cached GPS data: {len(gps_cache)} frames")
        logger.info(f"Cached tracking positions: {len(tracked_positions_cache)} frames")
        logger.info("=" * 80)

        return (measurements_data, gps_cache, tracked_positions_cache)

    @staticmethod
    def compute_transition_angles_from_chromacity(
        measurements_data: List[Dict], light_name: str, reference_points: Dict = None
    ) -> Dict:
        """
        Compute transition angles for a PAPI light based on raw Green channel analysis.

        This method uses the raw Green value (G) to find transition angles:
        1. Extract raw Green value for each frame
        2. Find green_min (most red) and green_max (most white)
        3. Compute middle = (max - min) * 0.5
        4. Identify frames where green is in the 20-80% range of the full transition
        5. Extract angles for those frames to determine the transition range
        6. Store min/max/middle transition angles

        Note: Green increases as light transitions from red to white.
        - RED light: low green value
        - WHITE light: high green value

        Args:
            measurements_data: List of frame measurement dictionaries
            light_name: Name of the PAPI light (e.g., "PAPI_A", "PAPI_B")
            reference_points: Optional reference points dict for the light

        Returns:
            Dictionary containing:
                - transition_angle_min: Minimum transition angle
                - transition_angle_max: Maximum transition angle
                - transition_angle_middle: Middle transition angle
                - transition_frames_count: Number of frames in transition zone
        """
        light_key = light_name.lower()

        # Extract green channel data for all frames
        green_values = []
        frame_angles = []
        frame_indices = []

        for idx, frame_data in enumerate(measurements_data):
            rgb_key = f"{light_key}_rgb"
            angle_key = f"{light_key}_angle"

            # Skip if no data for this light
            if rgb_key not in frame_data or angle_key not in frame_data:
                continue

            rgb = frame_data[rgb_key]
            angle = frame_data[angle_key]

            # Skip invalid data
            if not rgb or angle is None or angle == 0.0:
                continue

            # Extract RGB values
            if isinstance(rgb, dict):
                _, g, _ = rgb.get("r", 0), rgb.get("g", 0), rgb.get("b", 0)
            elif isinstance(rgb, list) and len(rgb) >= 3:
                _, g, _ = rgb[0], rgb[1], rgb[2]
            else:
                continue

            # Use raw Green value (not normalized)
            # Green increases as light transitions from red to white
            green_values.append(g)
            frame_angles.append(angle)
            frame_indices.append(idx)

        # Apply trimmed mean filter to smooth the green signal and reject outliers
        # Window of 20 frames before and after, removing top/bottom 10% before averaging
        if len(green_values) > 0:
            raw_green_values = green_values.copy()
            green_values = apply_trimmed_mean_filter(green_values, window_size=20, trim_percent=0.1)
            logger.info(
                f"📊 {light_name} raw green smoothing applied:"
                f" {len(raw_green_values)} values, window=±20, trim=10%"
            )

        # Handle edge case: no valid frames
        if len(green_values) == 0:
            logger.warning(f"No valid green data found for {light_name}")
            return {
                "transition_angle_min": None,
                "transition_angle_max": None,
                "transition_angle_middle": None,
                "transition_frames_count": 0,
            }

        # Find green min and max
        # green_min = most red (low green)
        # green_max = most white (high green)
        green_min = min(green_values)
        green_max = max(green_values)

        # Calculate middle green (50% point between min and max)
        middle_green = green_min + (green_max - green_min) * 0.5

        # Calculate the range
        green_range = green_max - green_min

        # Define transition thresholds: 20% and 80% of the range
        # 20% threshold = closer to red (low green)
        # 80% threshold = closer to white (high green)
        transition_threshold_20 = green_min + green_range * 0.2
        transition_threshold_80 = green_min + green_range * 0.8

        # IMPROVED ALGORITHM: Search from middle point outwards to avoid noise at edges
        # Step 1: Find the frame closest to the middle green (50% point)
        middle_frame_idx = None
        min_diff_to_middle = float("inf")
        for i, green_val in enumerate(green_values):
            diff = abs(green_val - middle_green)
            if diff < min_diff_to_middle:
                min_diff_to_middle = diff
                middle_frame_idx = i

        if middle_frame_idx is None:
            logger.warning(f"Could not find middle frame for {light_name}")
            return {
                "transition_angle_min": None,
                "transition_angle_max": None,
                "transition_angle_middle": None,
                "transition_frames_count": 0,
            }

        middle_angle = frame_angles[middle_frame_idx]
        logger.info(
            f"📐 {light_name} Middle point found at frame index {middle_frame_idx},"
            f" angle={middle_angle:.3f}°, green={green_values[middle_frame_idx]:.4f}"
        )

        # Step 2: Search BACKWARDS from middle to find LAST frame matching ~20% threshold
        # This is the transition START (low green = red, before transition)
        transition_start_angle = None
        for i in range(middle_frame_idx, -1, -1):  # Search backwards from middle to start
            if (
                green_values[i] <= transition_threshold_20
            ):  # Lower green = more red = before transition
                transition_start_angle = frame_angles[i]
                break

        # Step 3: Search FORWARDS from middle to find FIRST frame matching ~80% threshold
        # This is the transition END (high green = white, after transition)
        transition_end_angle = None
        for i in range(middle_frame_idx, len(green_values)):  # Search forwards from middle to end
            if (
                green_values[i] >= transition_threshold_80
            ):  # Higher green = more white = after transition
                transition_end_angle = frame_angles[i]
                break

        # Handle edge cases where thresholds are not crossed
        if transition_start_angle is None:
            # Use the first frame as fallback
            transition_start_angle = frame_angles[0]
            logger.warning(
                f"{light_name}: Could not find transition start, using first frame angle"
            )

        if transition_end_angle is None:
            # Use the last frame as fallback
            transition_end_angle = frame_angles[-1]
            logger.warning(f"{light_name}: Could not find transition end, using last frame angle")

        # Determine min/max based on which angle is smaller
        # (depends on whether drone is approaching or departing)
        transition_angle_min = min(transition_start_angle, transition_end_angle)
        transition_angle_max = max(transition_start_angle, transition_end_angle)

        # Calculate transition angle at configured percentage (default 80%) from min toward max
        transition_pct = settings.PAPI_TRANSITION_ANGLE_PERCENT
        transition_angle_middle = transition_angle_min + transition_pct * (
            transition_angle_max - transition_angle_min
        )

        # Count frames in transition zone for reporting
        transition_frames_count = 0
        for green_val in green_values:
            if transition_threshold_20 <= green_val <= transition_threshold_80:
                transition_frames_count += 1

        logger.info(f"📐 {light_name} TRANSITION ANALYSIS (raw green algorithm):")
        logger.info(
            f"   raw green range: min={green_min:.4f},"
            f" max={green_max:.4f}, middle={middle_green:.4f}"
        )
        logger.info(
            f"   Thresholds: 20%={transition_threshold_20:.4f}, 80%={transition_threshold_80:.4f}"
        )
        logger.info(
            f"   Transition START (search backwards from"
            f" middle): angle={transition_start_angle:.3f}°"
        )
        logger.info(
            f"   Transition END (search forwards from middle): angle={transition_end_angle:.3f}°"
        )
        logger.info(f"   Frames in transition zone: {transition_frames_count} frames")
        logger.info(
            f"   Result: min={transition_angle_min:.3f}°, max={transition_angle_max:.3f}°,"
            f" transition({int(transition_pct * 100)}%)={transition_angle_middle:.3f}°"
        )

        return {
            "transition_angle_min": round(transition_angle_min, 3),
            "transition_angle_max": round(transition_angle_max, 3),
            "transition_angle_middle": round(transition_angle_middle, 3),
            "transition_frames_count": transition_frames_count,
        }
