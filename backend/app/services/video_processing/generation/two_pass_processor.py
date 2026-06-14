"""
Single-pass and two-pass video processing handlers
"""

import logging
import os
import time
from typing import Dict, List

import cv2
import numpy as np

from app.services.video_processing.config import settings

from ..gps import GPSExtractor
from ..tracking import PAPILightTracker
from ..utils import (
    BatchFrameProcessor,
    FrameProcessingCache,
    convert_to_h264,
)
from .measurement_collector import MeasurementCollector

# Import overlay renderers
from .optimized_overlays import OptimizedOverlayRenderer

logger = logging.getLogger(__name__)


class TwoPassProcessor:
    """Handles two-pass video processing"""

    def __init__(self, output_dir: str, batch_size: int = None, progress_callback=None):
        self.output_dir = output_dir
        self.batch_size = batch_size or settings.VIDEO_GEN_BATCH_SIZE
        self.progress_callback = progress_callback
        os.makedirs(output_dir, exist_ok=True)

        # Initialize batch processor
        self.batch_processor = BatchFrameProcessor(batch_size=batch_size)
        self.frame_cache = FrameProcessingCache()

        # Initialize measurement collector for two-pass processing
        # (pass progress callback for cancellation support)
        self.measurement_collector = MeasurementCollector(progress_callback=progress_callback)

        logger.info(f"Video processor initialized (batch size: {batch_size})")

    @staticmethod
    def create_combined_papi_video(
        papi_video_paths: Dict[str, str], output_path: str, fps: int = 30
    ):
        """
        Combine all 4 PAPI light videos into a single video with 1x4 row layout.

        Layout:
        ┌─────────┬─────────┬─────────┬─────────┐
        │ PAPI_A  │ PAPI_B  │ PAPI_C  │ PAPI_D  │
        └─────────┴─────────┴─────────┴─────────┘
        """
        logger.info("Creating combined all_papi_lights video (1x4 row layout)...")

        # Open all 4 PAPI videos
        papi_order = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]
        caps = {}

        for papi_name in papi_order:
            if papi_name not in papi_video_paths:
                logger.error(f"Missing video for {papi_name}")
                return None

            cap = cv2.VideoCapture(papi_video_paths[papi_name])
            if not cap.isOpened():
                logger.error(f"Failed to open {papi_name} video: {papi_video_paths[papi_name]}")
                return None
            caps[papi_name] = cap

        # Get video properties from first video
        first_cap = caps["PAPI_A"]
        frame_count = int(first_cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Combined video dimensions: 1x4 row (all lights side by side)
        # Each PAPI video is 300x420, so combined is 1200x420
        combined_width = settings.VIDEO_GEN_PAPI_WIDTH * 4
        combined_height = settings.VIDEO_GEN_PAPI_HEIGHT

        # Create video writer
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(output_path, fourcc, fps, (combined_width, combined_height))

        if not out.isOpened():
            logger.error(f"Failed to create combined video writer: {output_path}")
            for cap in caps.values():
                cap.release()
            return None

        logger.info(f"Combined video: {combined_width}x{combined_height}, {frame_count} frames")

        # Process frames
        frame_idx = 0
        while True:
            # Read frame from each video
            frames = {}
            all_success = True

            for papi_name in papi_order:
                ret, frame = caps[papi_name].read()
                if not ret:
                    all_success = False
                    break
                frames[papi_name] = frame

            if not all_success:
                break

            # Create combined frame with 1x4 row layout
            combined_frame = np.zeros((combined_height, combined_width, 3), dtype=np.uint8)

            # PAPI_A: leftmost
            combined_frame[
                0 : settings.VIDEO_GEN_PAPI_HEIGHT, 0 : settings.VIDEO_GEN_PAPI_WIDTH
            ] = frames["PAPI_A"]

            # PAPI_B: second from left
            combined_frame[
                0 : settings.VIDEO_GEN_PAPI_HEIGHT,
                settings.VIDEO_GEN_PAPI_WIDTH : settings.VIDEO_GEN_PAPI_WIDTH * 2,
            ] = frames["PAPI_B"]

            # PAPI_C: second from right
            combined_frame[
                0 : settings.VIDEO_GEN_PAPI_HEIGHT,
                settings.VIDEO_GEN_PAPI_WIDTH * 2 : settings.VIDEO_GEN_PAPI_WIDTH * 3,
            ] = frames["PAPI_C"]

            # PAPI_D: rightmost
            combined_frame[
                0 : settings.VIDEO_GEN_PAPI_HEIGHT,
                settings.VIDEO_GEN_PAPI_WIDTH * 3 : combined_width,
            ] = frames["PAPI_D"]

            # Write combined frame
            out.write(combined_frame)

            frame_idx += 1
            if frame_idx % 100 == 0:
                logger.info(f"Combined video progress: {frame_idx}/{frame_count}")

        # Release resources
        for cap in caps.values():
            cap.release()
        out.release()

        logger.info(f"Combined video created: {frame_idx} frames")
        return output_path

    def generate_videos_from_measurements(
        self,
        video_path: str,
        session_id: str,
        light_positions: Dict,
        measurements_data: List[Dict],
        real_gps_data: List,
        reference_points: Dict,
        runway_heading: float,
        fps: int = 30,
        gps_cache: Dict = None,
        tracked_positions_cache: Dict = None,
    ) -> tuple:
        """
        PASS 2: Generate videos using pre-computed measurements with transition angles.

        Generate enhanced main video and 4 individual PAPI videos using the complete
        measurements data that includes transition angles.

        Returns: (papi_paths, enhanced_path)
        """
        logger.info("=" * 80)
        logger.info("PASS 2: GENERATING VIDEOS FROM MEASUREMENTS")
        logger.info(f"Video: {video_path}")
        logger.info(f"Session: {session_id}")
        logger.info(f"Measurements: {len(measurements_data)} frames")
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

        # Initialize tracker (needed for visual tracking boxes) - only if cache not provided
        if tracked_positions_cache is None:
            light_tracker = PAPILightTracker(light_positions, frame_width, frame_height)
            if not light_tracker.tracked_lights:
                raise ValueError("No PAPI lights initialized for tracking")
            logger.info("Will compute tracking positions on-the-fly (no cache provided)")
        else:
            light_tracker = None  # Not needed when using cache
            logger.info(f"Using cached tracking positions: {len(tracked_positions_cache)} frames")

        # Use cached GPS data or compute if not provided (for overlay data)
        if gps_cache is None:
            logger.info("Pre-computing GPS data cache (not provided from Pass 1)...")
            gps_extractor = GPSExtractor()
            gps_cache = {}
            for frame_num in range(total_frames):
                interpolated = gps_extractor.interpolate_gps_for_frame(
                    real_gps_data, frame_num, video_fps
                )
                if interpolated:
                    gps_cache[frame_num] = {
                        "elevation_wgs84": interpolated.elevation_wgs84,
                        "elevation": interpolated.elevation_wgs84,  # Backward compatibility
                        "latitude": interpolated.latitude,
                        "longitude": interpolated.longitude,
                        "speed": interpolated.speed or 0.0,
                        "heading": interpolated.heading or 0.0,
                        "ref_points": reference_points,
                        "runway_heading": runway_heading,
                    }
            logger.info(f"Pre-computed GPS for {len(gps_cache)} frames")
        else:
            logger.info(
                f"Using cached GPS data from Pass 1: {len(gps_cache)} frames (OPTIMIZATION)"
            )

        # Initialize video writers
        # Enhanced main video - Extended height for panel at bottom
        panel_height = 350  # Must match panel_height in InfoOverlayRenderer.add_angle_overlay
        extended_height = frame_height + panel_height
        enhanced_path = os.path.join(self.output_dir, f"{session_id}_enhanced_main_video.mp4")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        enhanced_writer = cv2.VideoWriter(
            enhanced_path, fourcc, video_fps, (frame_width, extended_height)
        )

        if not enhanced_writer.isOpened():
            raise ValueError(f"Failed to create enhanced video writer: {enhanced_path}")

        logger.info(
            f"Enhanced video: {frame_width}x{extended_height} (original:"
            f" {frame_width}x{frame_height}, panel: {panel_height}px)"
        )

        # Individual PAPI video writers (300x420 frames)
        papi_writers = {}
        papi_paths = {}
        for light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
            papi_path = os.path.join(self.output_dir, f"{session_id}_{light_name}_video.mp4")
            papi_writer = cv2.VideoWriter(
                papi_path,
                fourcc,
                video_fps,
                (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_HEIGHT),
            )
            if papi_writer.isOpened():
                papi_writers[light_name] = papi_writer
                papi_paths[light_name] = papi_path
                logger.info(f"Created {light_name} video writer: {papi_path}")

        # VIDEO GENERATION LOOP
        frame_number = 0
        start_time = time.time()

        logger.info("Generating videos with transition angle data...")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Get GPS data for this frame
            drone_data = gps_cache.get(frame_number)
            if not drone_data:
                logger.warning(f"No GPS data for frame {frame_number}, skipping")
                frame_number += 1
                continue

            # Get tracked positions from cache or compute on-the-fly
            if tracked_positions_cache is not None:
                tracked_positions = tracked_positions_cache.get(frame_number, {})
            else:
                # Track light positions (for visual tracking boxes in videos)
                tracked_positions = light_tracker.update_frame(frame, frame_number)

            # Get frame measurements from pre-computed data (WITH transition angles!)
            frame_measurements = {}
            if frame_number < len(measurements_data):
                measurement_data = measurements_data[frame_number]

                # Reconstruct frame_measurements dict from flat measurement data
                for light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
                    light_key = light_name.lower()
                    if f"{light_key}_angle" in measurement_data:
                        frame_measurements[light_name] = {
                            "angle": measurement_data.get(f"{light_key}_angle"),
                            "rgb": measurement_data.get(f"{light_key}_rgb"),
                            "intensity": measurement_data.get(f"{light_key}_intensity"),
                            "status": measurement_data.get(f"{light_key}_status"),
                            "horizontal_angle": measurement_data.get(
                                f"{light_key}_horizontal_angle"
                            ),
                            "distance_ground": measurement_data.get(f"{light_key}_distance_ground"),
                        }
                        # Add transition angles to frame_measurements (for video footer rendering)
                        frame_measurements[f"{light_key}_transition_angle_min"] = (
                            measurement_data.get(f"{light_key}_transition_angle_min")
                        )
                        frame_measurements[f"{light_key}_transition_angle_middle"] = (
                            measurement_data.get(f"{light_key}_transition_angle_middle")
                        )
                        frame_measurements[f"{light_key}_transition_angle_max"] = (
                            measurement_data.get(f"{light_key}_transition_angle_max")
                        )

            # Generate enhanced main video frame
            enhanced_frame = OptimizedOverlayRenderer.add_overlays_to_frame_with_tracking(
                frame.copy(),
                tracked_positions,
                frame_number,
                total_frames,
                measurements_data,
                None,
                reference_points,
                real_gps_data,
                fps,
            )
            enhanced_writer.write(enhanced_frame)

            # Generate individual PAPI video frames
            for light_name in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
                if light_name not in papi_writers:
                    continue

                tracked_pos = tracked_positions.get(light_name)
                if not tracked_pos:
                    # Write blank frame
                    blank_frame = np.zeros(
                        (settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3),
                        dtype=np.uint8,
                    )
                    papi_writers[light_name].write(blank_frame)
                    continue

                # Use cached light dimensions from PASS 1 (avoid duplicate computation)
                light_key = light_name.lower()
                if frame_number < len(measurements_data):
                    measurement_data = measurements_data[frame_number]
                    x = measurement_data.get(f"{light_key}_center_x", tracked_pos["x"])
                    y = measurement_data.get(f"{light_key}_center_y", tracked_pos["y"])
                    measured_width = measurement_data.get(f"{light_key}_width", tracked_pos["size"])
                    measured_height = measurement_data.get(
                        f"{light_key}_height", tracked_pos["size"]
                    )
                else:
                    # Fallback to tracker if no cached data (shouldn't happen in normal flow)
                    logger.warning(
                        f"No cached dimensions for {light_name} frame {frame_number}, using tracker"
                    )
                    x, y = tracked_pos["x"], tracked_pos["y"]
                    measured_width = measured_height = tracked_pos["size"]

                # Calculate ROI size so light covers ~33% of final video width
                roi_width = int(measured_width * 1.5)
                roi_height = int(measured_height * 1.5)

                # Make ROI square by using the larger dimension
                roi_size = max(roi_width, roi_height)
                half_roi_size = int(roi_size // 2)

                # Define region bounds using stable center (ensure integers for array slicing)
                xi, yi = int(x), int(y)
                x1 = int(max(0, xi - half_roi_size))
                y1 = int(max(0, yi - half_roi_size))
                x2 = int(min(frame_width, xi + half_roi_size))
                y2 = int(min(frame_height, yi + half_roi_size))

                # Extract region
                light_frame = frame[y1:y2, x1:x2]

                if light_frame.size > 0:
                    # Get RGB values and evaluation area
                    rgb = tracked_pos.get("rgb", [255, 255, 255])
                    eval_area = tracked_pos.get("evaluation_area")

                    # Calculate original region dimensions
                    original_region_width = x2 - x1
                    original_region_height = y2 - y1
                    _scale_x = (
                        float(settings.VIDEO_GEN_PAPI_WIDTH) / original_region_width
                        if original_region_width > 0
                        else 1.0
                    )
                    _scale_y = (
                        float(settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT) / original_region_height
                        if original_region_height > 0
                        else 1.0
                    )

                    # Create RED channel mask BEFORE resizing
                    red_mask = None
                    if light_frame.size > 0:
                        red_channel = light_frame[:, :, 2]  # BGR format
                        max_red = np.max(red_channel)
                        if max_red > 0:
                            threshold_value = max_red * settings.COLOR_RED_THRESHOLD
                            red_mask = (red_channel >= threshold_value).astype(np.uint8) * 255

                    # Resize light frame
                    light_frame_resized = cv2.resize(
                        light_frame,
                        (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT),
                    )

                    # Draw evaluation area contours (green)
                    if red_mask is not None and red_mask.size > 0:
                        red_mask_resized = cv2.resize(
                            red_mask,
                            (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT),
                            interpolation=cv2.INTER_NEAREST,
                        )
                        contours, _ = cv2.findContours(
                            red_mask_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
                        )
                        cv2.drawContours(
                            light_frame_resized,
                            contours,
                            -1,
                            (
                                settings.VIDEO_GEN_CONTOUR_COLOR_R,
                                settings.VIDEO_GEN_CONTOUR_COLOR_G,
                                settings.VIDEO_GEN_CONTOUR_COLOR_B,
                            ),
                            settings.VIDEO_GEN_CONTOUR_THICKNESS,
                        )

                    # Create final frame with footer
                    final_frame = np.zeros(
                        (settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3),
                        dtype=np.uint8,
                    )
                    final_frame[
                        0 : settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT,
                        0 : settings.VIDEO_GEN_PAPI_WIDTH,
                    ] = light_frame_resized
                    final_frame[
                        settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT : settings.VIDEO_GEN_PAPI_HEIGHT,
                        0 : settings.VIDEO_GEN_PAPI_WIDTH,
                    ] = [
                        settings.VIDEO_GEN_FOOTER_COLOR_B,
                        settings.VIDEO_GEN_FOOTER_COLOR_G,
                        settings.VIDEO_GEN_FOOTER_COLOR_R,
                    ]

                    # Get angle information (NOW WITH TRANSITION ANGLES!)
                    nominal_angle = None
                    transition_angle_min = None
                    transition_angle_middle = None
                    transition_angle_max = None
                    current_angle = None

                    # Extract current angle and transition angles from measurements
                    if frame_measurements and light_name in frame_measurements:
                        current_angle = frame_measurements[light_name].get("angle")
                        # Extract chromacity-based transition angles (NOW AVAILABLE!)
                        light_key = light_name.lower()
                        transition_angle_min = frame_measurements.get(
                            f"{light_key}_transition_angle_min"
                        )
                        transition_angle_middle = frame_measurements.get(
                            f"{light_key}_transition_angle_middle"
                        )
                        transition_angle_max = frame_measurements.get(
                            f"{light_key}_transition_angle_max"
                        )

                    # Extract nominal angle from reference points
                    if reference_points and light_name in reference_points:
                        ref_point = reference_points[light_name]
                        nominal_angle = ref_point.get("nominal_angle")

                    # Add footer information
                    font = cv2.FONT_HERSHEY_SIMPLEX

                    # Header: Light name and frame number
                    header_text = f"{light_name}  |  Frame {frame_number + 1}/{total_frames}"
                    cv2.putText(final_frame, header_text, (10, 310), font, 0.38, (50, 50, 50), 1)

                    # Add separator line
                    cv2.line(final_frame, (10, 315), (290, 315), (200, 200, 200), 1)

                    # Angle information grid (3 columns)
                    y_base = 330
                    col_width = 100

                    # Column 1: Nominal Angle
                    cv2.putText(
                        final_frame, "Nominal", (10, y_base), font, 0.38, (100, 100, 100), 1
                    )
                    if nominal_angle is not None:
                        cv2.putText(
                            final_frame,
                            f"{nominal_angle:.2f}",
                            (10, y_base + 18),
                            font,
                            0.55,
                            (70, 130, 180),
                            2,
                        )
                    else:
                        cv2.putText(
                            final_frame, "N/A", (10, y_base + 18), font, 0.5, (150, 150, 150), 1
                        )

                    # Column 2: Transition Angles (min/middle/max)
                    cv2.putText(
                        final_frame,
                        "Transition",
                        (col_width, y_base),
                        font,
                        0.38,
                        (100, 100, 100),
                        1,
                    )
                    if transition_angle_middle is not None:
                        # Display all three values on separate lines
                        cv2.putText(
                            final_frame,
                            f"S:{transition_angle_min:.2f}",
                            (col_width, y_base + 14),
                            font,
                            0.35,
                            (218, 165, 32),
                            1,
                        )
                        cv2.putText(
                            final_frame,
                            f"M:{transition_angle_middle:.2f}",
                            (col_width, y_base + 28),
                            font,
                            0.45,
                            (218, 165, 32),
                            2,
                        )
                        cv2.putText(
                            final_frame,
                            f"E:{transition_angle_max:.2f}",
                            (col_width, y_base + 42),
                            font,
                            0.35,
                            (218, 165, 32),
                            1,
                        )
                    else:
                        cv2.putText(
                            final_frame,
                            "N/A",
                            (col_width, y_base + 18),
                            font,
                            0.5,
                            (150, 150, 150),
                            1,
                        )

                    # Column 3: Current Angle
                    cv2.putText(
                        final_frame,
                        "Current",
                        (col_width * 2, y_base),
                        font,
                        0.38,
                        (100, 100, 100),
                        1,
                    )
                    if current_angle is not None:
                        cv2.putText(
                            final_frame,
                            f"{current_angle:.2f}",
                            (col_width * 2, y_base + 18),
                            font,
                            0.55,
                            (34, 139, 34),
                            2,
                        )
                    else:
                        cv2.putText(
                            final_frame,
                            "N/A",
                            (col_width * 2, y_base + 18),
                            font,
                            0.5,
                            (150, 150, 150),
                            1,
                        )

                    # Draw transition visualization bar (NOW WITH DATA!)
                    if (
                        transition_angle_min is not None
                        and transition_angle_max is not None
                        and current_angle is not None
                    ):
                        bar_y = 375
                        bar_x_start = 10
                        bar_width = 280
                        bar_height = 12

                        # Define angle range for the bar
                        angle_range_start = max(0, transition_angle_min - 0.5)
                        angle_range_end = transition_angle_max + 0.5
                        angle_range = angle_range_end - angle_range_start

                        if angle_range > 0:
                            # Calculate positions on the bar
                            def angle_to_x(angle):
                                return bar_x_start + int(
                                    (angle - angle_range_start) / angle_range * bar_width
                                )

                            transition_start_x = angle_to_x(transition_angle_min)
                            transition_end_x = angle_to_x(transition_angle_max)
                            current_x = angle_to_x(current_angle)

                            # Draw bar sections
                            # Red section (before transition start)
                            cv2.rectangle(
                                final_frame,
                                (bar_x_start, bar_y),
                                (transition_start_x, bar_y + bar_height),
                                (0, 0, 180),
                                -1,
                            )  # Red

                            # Gray section (transition zone)
                            cv2.rectangle(
                                final_frame,
                                (transition_start_x, bar_y),
                                (transition_end_x, bar_y + bar_height),
                                (128, 128, 128),
                                -1,
                            )  # Gray

                            # White section (after transition end)
                            cv2.rectangle(
                                final_frame,
                                (transition_end_x, bar_y),
                                (bar_x_start + bar_width, bar_y + bar_height),
                                (240, 240, 240),
                                -1,
                            )  # White

                            # Draw border around entire bar
                            cv2.rectangle(
                                final_frame,
                                (bar_x_start, bar_y),
                                (bar_x_start + bar_width, bar_y + bar_height),
                                (100, 100, 100),
                                1,
                            )

                            # Draw current position indicator (vertical line with circle)
                            current_x = max(bar_x_start, min(bar_x_start + bar_width, current_x))
                            cv2.line(
                                final_frame,
                                (current_x, bar_y - 2),
                                (current_x, bar_y + bar_height + 2),
                                (0, 255, 0),
                                2,
                            )  # Green line
                            cv2.circle(
                                final_frame,
                                (current_x, bar_y + bar_height // 2),
                                3,
                                (0, 255, 0),
                                -1,
                            )  # Green circle

                            # Add angle labels at key points
                            label_font_scale = 0.25
                            label_color = (80, 80, 80)
                            # Start angle label
                            cv2.putText(
                                final_frame,
                                f"{angle_range_start:.1f}",
                                (bar_x_start - 5, bar_y - 2),
                                font,
                                label_font_scale,
                                label_color,
                                1,
                            )
                            # End angle label
                            cv2.putText(
                                final_frame,
                                f"{angle_range_end:.1f}",
                                (bar_x_start + bar_width - 15, bar_y - 2),
                                font,
                                label_font_scale,
                                label_color,
                                1,
                            )

                    # RGB values and Evaluation area on the same line (compact, color-coded)
                    info_y = 410
                    txt = f"R:{rgb[0]:.0f}, G:{rgb[1]:.0f}, B:{rgb[2]:.0f}"
                    if eval_area and eval_area.get("area_pixels", 0) > 0:
                        txt += f" | Eval Area: {eval_area['area_pixels']}px"
                    cv2.putText(final_frame, txt, (10, info_y), font, 0.4, (0, 0, 200), 1)

                    papi_writers[light_name].write(final_frame)
                else:
                    # Write blank frame
                    blank_frame = np.zeros(
                        (settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3),
                        dtype=np.uint8,
                    )
                    papi_writers[light_name].write(blank_frame)

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
                        50 + progress * 0.5, f"generating_videos_frame_{frame_number}"
                    )

        # Release all resources
        cap.release()
        enhanced_writer.release()
        for writer in papi_writers.values():
            writer.release()

        elapsed_time = time.time() - start_time
        logger.info(f"Video generation complete: {frame_number} frames in {elapsed_time:.1f}s")
        logger.info(f"Average FPS: {frame_number / elapsed_time:.1f}")

        # Convert videos to H.264
        logger.info("Converting videos to H.264...")
        convert_to_h264(enhanced_path)
        for papi_path in papi_paths.values():
            convert_to_h264(papi_path)

        # Create combined all_papi_lights video
        logger.info("Creating combined PAPI lights video...")
        combined_papi_path = os.path.join(self.output_dir, f"{session_id}_all_papi_lights.mp4")
        all_papi_lights_path = self.create_combined_papi_video(
            papi_paths, combined_papi_path, video_fps
        )

        if all_papi_lights_path:
            convert_to_h264(all_papi_lights_path)
            logger.info(f"Combined PAPI video: {all_papi_lights_path}")
        else:
            logger.warning("Failed to create combined PAPI video")
            all_papi_lights_path = None

        logger.info("=" * 80)
        logger.info("PASS 2 COMPLETE: Videos generated with transition bars visible")
        logger.info(f"Enhanced video: {enhanced_path}")
        logger.info(f"PAPI videos: {list(papi_paths.keys())}")
        logger.info(f"Combined PAPI video: {all_papi_lights_path}")
        logger.info("=" * 80)

        return (papi_paths, enhanced_path, all_papi_lights_path)

    def process_video_two_pass(
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
        TWO-PASS VIDEO PROCESSING ARCHITECTURE

        PASS 1: Collect measurements and compute transition angles
        PASS 2: Generate videos with complete measurement data

        This solves the architectural limitation where transition bars didn't appear
        in initial video generation because transition angles were computed after
        video generation in the single-pass approach.

        Returns: (measurements_data, papi_video_paths, enhanced_video_path, all_papi_lights_path)
        """
        logger.info("=" * 80)
        logger.info("STARTING TWO-PASS VIDEO PROCESSING")
        logger.info(f"Video: {video_path}")
        logger.info(f"Session: {session_id}")
        logger.info("=" * 80)

        # PASS 1: Collect measurements with transition angles
        logger.info("PASS 1: Collecting measurements and computing transition angles...")
        measurements_data, gps_cache, tracked_positions_cache = (
            self.measurement_collector.collect_measurements_only(
                video_path=video_path,
                session_id=session_id,
                light_positions=light_positions,
                real_gps_data=real_gps_data,
                reference_points=reference_points,
                runway_heading=runway_heading,
                fps=fps,
            )
        )
        logger.info(f"PASS 1 COMPLETE: {len(measurements_data)} frames with transition angles")
        logger.info(f"Using cached GPS data: {len(gps_cache)} frames")
        logger.info(f"Using cached tracking positions: {len(tracked_positions_cache)} frames")

        # PASS 2: Generate videos with complete measurements
        logger.info("PASS 2: Generating videos with transition angle data...")
        papi_paths, enhanced_path, all_papi_lights_path = self.generate_videos_from_measurements(
            video_path=video_path,
            session_id=session_id,
            light_positions=light_positions,
            measurements_data=measurements_data,
            real_gps_data=real_gps_data,
            reference_points=reference_points,
            runway_heading=runway_heading,
            fps=fps,
            gps_cache=gps_cache,  # Pass cached GPS data to avoid recomputation
            tracked_positions_cache=tracked_positions_cache,  # Pass cached tracking positions
        )
        logger.info("PASS 2 COMPLETE: Videos generated with transition bars visible")

        logger.info("=" * 80)
        logger.info("TWO-PASS PROCESSING COMPLETE")
        logger.info(f"Enhanced video: {enhanced_path}")
        logger.info(f"PAPI videos: {list(papi_paths.keys())}")
        logger.info(f"Combined PAPI video: {all_papi_lights_path}")
        logger.info(f"Measurements: {len(measurements_data)} frames")
        logger.info("=" * 80)

        return (measurements_data, papi_paths, enhanced_path, all_papi_lights_path)
