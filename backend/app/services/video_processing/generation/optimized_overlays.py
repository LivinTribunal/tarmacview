"""
Overlay rendering for video frames
"""

import logging
from typing import Dict, List

import cv2
import numpy as np

from ..models import GPSData
from ..utils import (
    haversine_distance,
)

# Import sibling classes for cross-references
from .info_overlays import InfoOverlayRenderer

logger = logging.getLogger(__name__)


class OptimizedOverlayRenderer:
    """Handles optimized overlay rendering methods"""

    @staticmethod
    def add_drone_position_overlay_optimized(
        frame: np.ndarray,
        frame_number: int,
        cached_drone_data: Dict = None,
        reference_points: Dict = None,
        fps: float = 30.0,
    ):
        """Optimized overlay using pre-computed GPS data - EXTENDS CANVAS AT BOTTOM"""
        height, width = frame.shape[:2]

        # Use cached drone data or fallback
        if cached_drone_data:
            drone_data = cached_drone_data
        else:
            raise ValueError(
                f"No GPS data available for frame {frame_number}."
                f" Video must contain GPS coordinates for processing."
            )

        # EXTEND CANVAS: Create larger frame with panel space at bottom
        panel_height = 350  # Match info_overlays.py
        extended_height = height + panel_height
        extended_frame = np.zeros((extended_height, width, 3), dtype=np.uint8)

        # Copy original frame to top portion
        extended_frame[0:height, :] = frame

        # Now work with extended frame
        frame = extended_frame

        # Professional panel settings at BOTTOM
        font = cv2.FONT_HERSHEY_SIMPLEX
        panel_y_start = height  # Start at original frame height
        panel_y_end = extended_height

        # Create white panel background at bottom
        cv2.rectangle(frame, (0, panel_y_start), (width, panel_y_end), (255, 255, 255), -1)

        # Add top border line
        cv2.line(frame, (0, panel_y_start), (width, panel_y_start), (200, 200, 200), 3)

        # Calculate PAPI angles
        papi_colors = {
            "PAPI_A": (180, 130, 70),  # Steel blue (BGR)
            "PAPI_B": (34, 139, 34),  # Forest green
            "PAPI_C": (32, 165, 218),  # Goldenrod
            "PAPI_D": (34, 34, 178),  # Firebrick
            "PAPI_E": (147, 20, 255),  # Pink
            "PAPI_F": (128, 128, 0),  # Teal
            "PAPI_G": (130, 0, 75),  # Indigo
            "PAPI_H": (0, 0, 255),  # Red
        }

        papi_angles = {}
        if reference_points:
            for papi_name in [
                "PAPI_A",
                "PAPI_B",
                "PAPI_C",
                "PAPI_D",
                "PAPI_E",
                "PAPI_F",
                "PAPI_G",
                "PAPI_H",
            ]:
                if papi_name in reference_points:
                    try:
                        papi_point = reference_points[papi_name]
                        ground_dist = haversine_distance(
                            drone_data["latitude"],
                            drone_data["longitude"],
                            papi_point.get("latitude"),
                            papi_point.get("longitude"),
                        )
                        # Use elevation_wgs84 with fallback to elevation for backward compatibility
                        drone_elevation_wgs84 = drone_data.get(
                            "elevation_wgs84", drone_data.get("elevation", 0)
                        )
                        papi_elevation_wgs84 = papi_point.get(
                            "elevation_wgs84", papi_point.get("elevation", 0)
                        )
                        alt_diff = drone_elevation_wgs84 - papi_elevation_wgs84

                        if ground_dist > 0:
                            angle = np.degrees(np.arctan(alt_diff / ground_dist))
                        else:
                            angle = 90.0 if alt_diff > 0 else -90.0

                        papi_angles[papi_name] = angle
                    except Exception as e:
                        logger.debug(f"Failed to calculate angle for {papi_name}: {e}")

        # Touch point angle if available
        touch_angle = None
        if reference_points and "TOUCH_POINT" in reference_points:
            try:
                touch_point = reference_points["TOUCH_POINT"]
                ground_dist = haversine_distance(
                    drone_data["latitude"],
                    drone_data["longitude"],
                    touch_point.get("latitude"),
                    touch_point.get("longitude"),
                )
                # Use elevation_wgs84 with fallback to elevation for backward compatibility
                drone_elevation_wgs84 = drone_data.get(
                    "elevation_wgs84", drone_data.get("elevation", 0)
                )
                touch_elevation_wgs84 = touch_point.get(
                    "elevation_wgs84", touch_point.get("elevation", 0)
                )
                alt_diff = drone_elevation_wgs84 - touch_elevation_wgs84

                if ground_dist > 0:
                    touch_angle = np.degrees(np.arctan(alt_diff / ground_dist))
                else:
                    touch_angle = 90.0 if alt_diff > 0 else -90.0
            except Exception as e:
                logger.debug(f"Failed to calculate touch point angle: {e}")

        # Layout: 3 columns with better spacing
        col_width = width // 3
        y_base = panel_y_start + 40  # Start position in panel

        # Column 1: GPS Info + Time
        x_col1 = 25
        cv2.putText(frame, "GPS POSITION", (x_col1, y_base), font, 1.0, (80, 80, 80), 2)
        cv2.putText(
            frame,
            f"Lat: {drone_data.get('latitude', 0):.6f}",
            (x_col1, y_base + 45),
            font,
            0.8,
            (60, 60, 60),
            2,
        )
        cv2.putText(
            frame,
            f"Lon: {drone_data.get('longitude', 0):.6f}",
            (x_col1, y_base + 85),
            font,
            0.8,
            (60, 60, 60),
            2,
        )
        cv2.putText(
            frame,
            f"Alt: {drone_data.get('elevation_wgs84', drone_data.get('elevation', 0)):.1f}m WGS84",
            (x_col1, y_base + 125),
            font,
            0.8,
            (60, 60, 60),
            2,
        )

        # Calculate time from start
        time_from_start = frame_number / fps
        minutes = int(time_from_start // 60)
        seconds = time_from_start % 60
        cv2.putText(
            frame,
            f"Time: {minutes:02d}:{seconds:05.2f}",
            (x_col1, y_base + 165),
            font,
            0.8,
            (60, 60, 60),
            2,
        )
        cv2.putText(
            frame, f"Frame: {frame_number + 1}", (x_col1, y_base + 205), font, 0.8, (60, 60, 60), 2
        )

        # Column 2: PAPI Angles with all angle details
        x_col2 = col_width + 25
        cv2.putText(frame, "PAPI ANGLES", (x_col2, y_base), font, 1.0, (80, 80, 80), 2)

        y_papi = y_base + 35
        line_spacing = 30
        for papi_name, angle in papi_angles.items():
            color = papi_colors.get(papi_name, (100, 100, 100))

            # Get reference point data for nominal and transition angles
            papi_ref = reference_points.get(papi_name, {}) if reference_points else {}
            nominal_angle = papi_ref.get("nominal_angle", "N/A")
            transition_start = papi_ref.get("transition_angle_min", "N/A")
            _transition_mid = papi_ref.get("transition_angle_middle", "N/A")
            transition_end = papi_ref.get("transition_angle_max", "N/A")

            # Format display
            if isinstance(nominal_angle, (int, float)):
                angle_text = f"{papi_name}: {angle:.2f} (N:{nominal_angle:.2f})"
            else:
                angle_text = f"{papi_name}: {angle:.2f}"

            cv2.putText(frame, angle_text, (x_col2, y_papi), font, 0.7, color, 2)
            y_papi += line_spacing

            # Add transition angles if available
            if isinstance(transition_start, (int, float)) and isinstance(
                transition_end, (int, float)
            ):
                trans_text = f"  Trans: {transition_start:.2f} - {transition_end:.2f}"
                cv2.putText(frame, trans_text, (x_col2, y_papi), font, 0.6, (100, 100, 100), 1)
                y_papi += line_spacing

            if y_papi > panel_y_end - 20:
                break

        # Column 3: Touch Point & Glide Path Info
        x_col3 = 2 * col_width + 25
        if touch_angle is not None:
            cv2.putText(frame, "TOUCH POINT", (x_col3, y_base), font, 1.0, (80, 80, 80), 2)
            cv2.putText(
                frame,
                f"Current Angle: {touch_angle:.2f}",
                (x_col3, y_base + 45),
                font,
                0.8,
                (0, 180, 180),
                2,
            )

            # Get glide path angle from touch point reference
            touch_ref = reference_points.get("TOUCH_POINT", {}) if reference_points else {}
            glide_path_angle = touch_ref.get(
                "nominal_angle", touch_ref.get("glide_path_angle", 3.0)
            )
            tolerance = touch_ref.get("tolerance", 0.1)

            cv2.putText(
                frame,
                f"Nominal GP: {glide_path_angle:.2f} (±{tolerance:.2f})",
                (x_col3, y_base + 85),
                font,
                0.8,
                (0, 150, 0),
                2,
            )

            # Calculate deviation from glide path
            deviation = touch_angle - glide_path_angle
            dev_color = (
                (0, 255, 0)
                if abs(deviation) <= tolerance
                else (0, 165, 255)
                if abs(deviation) <= tolerance * 2
                else (0, 0, 255)
            )
            cv2.putText(
                frame,
                f"Deviation: {deviation:+.2f}",
                (x_col3, y_base + 125),
                font,
                0.8,
                dev_color,
                2,
            )

            # Show tolerance evaluation
            within_tolerance = abs(deviation) <= tolerance
            status_text = "WITHIN TOLERANCE" if within_tolerance else "OUT OF TOLERANCE"
            status_color = (0, 255, 0) if within_tolerance else (0, 0, 255)
            cv2.putText(frame, status_text, (x_col3, y_base + 165), font, 0.7, status_color, 2)
        else:
            cv2.putText(frame, "TOUCH POINT", (x_col3, y_base), font, 1.0, (80, 80, 80), 2)
            cv2.putText(frame, "No data", (x_col3, y_base + 45), font, 0.8, (100, 100, 100), 1)

        # Return the extended frame
        return frame

    @staticmethod
    def add_overlays_to_frame_with_tracking(
        frame: np.ndarray,
        tracked_positions: Dict,
        frame_number: int,
        total_frames: int,
        measurements_data: List[Dict] = None,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
    ) -> np.ndarray:
        """Add drone position overlay and tracked PAPI light rectangles to frame"""
        enhanced_frame = frame.copy()
        height, width = frame.shape[:2]

        # Draw tracked PAPI light rectangles with current RGB values
        for light_name, pos in tracked_positions.items():
            if light_name not in ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]:
                continue

            # Skip if position data is incomplete
            if not isinstance(pos, dict) or "x" not in pos or "y" not in pos:
                logger.warning(f"Skipping {light_name}: incomplete position data: {pos}")
                continue

            # Use cached measurements from PASS 1 (more stable than tracker positions)
            light_key = light_name.lower()
            if measurements_data and frame_number < len(measurements_data):
                measurement_data = measurements_data[frame_number]
                pixel_x = int(measurement_data.get(f"{light_key}_center_x", pos["x"]))
                pixel_y = int(measurement_data.get(f"{light_key}_center_y", pos["y"]))
                measured_width = int(
                    measurement_data.get(f"{light_key}_width", pos.get("size", 20))
                )
                measured_height = int(
                    measurement_data.get(f"{light_key}_height", pos.get("size", 20))
                )
                pixel_size = max(20, max(measured_width, measured_height))
            else:
                # Fallback to tracker if no cached data
                pixel_x = int(pos["x"])
                pixel_y = int(pos["y"])
                pixel_size = max(20, int(pos.get("size", 20)))

            # Calculate rectangle bounds (ensure all values are integers for OpenCV)
            half_size = int(pixel_size // 2)
            x1 = int(max(0, pixel_x - half_size))
            y1 = int(max(0, pixel_y - half_size))
            x2 = int(min(width, pixel_x + half_size))
            y2 = int(min(height, pixel_y + half_size))

            # Use actual RGB values from detection for rectangle color
            _rgb = pos.get("rgb", [255, 255, 255])
            _confidence = pos.get("confidence", 0.0)

            # Draw rectangle around PAPI light (green color for visibility)
            rect_color = (0, 255, 0)  # Green in BGR format
            thickness = 2
            cv2.rectangle(enhanced_frame, (x1, y1), (x2, y2), rect_color, thickness)

            # Draw light name label
            label = f"{light_name}"
            # Confidence removed - not needed for user

            # Calculate text position (above the rectangle)
            text_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
            text_x = int(max(0, x1))
            text_y = int(max(text_size[1] + 5, y1 - 5))

            # Draw text background (ensure all coordinates are integers)
            cv2.rectangle(
                enhanced_frame,
                (int(text_x), int(text_y - text_size[1] - 5)),
                (int(text_x + text_size[0] + 5), int(text_y + 5)),
                (0, 0, 0),
                -1,
            )

            # Draw text
            cv2.putText(
                enhanced_frame,
                label,
                (int(text_x + 2), int(text_y)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
            )

        # Extract current frame's measurements to pass pre-computed angles to overlay
        frame_measurements = None
        if measurements_data and frame_number < len(measurements_data):
            frame_measurements = measurements_data[frame_number]

        # Add overlay methods - angle_overlay now extends the canvas
        InfoOverlayRenderer.add_progress_bar(enhanced_frame, frame_number, total_frames)
        enhanced_frame = InfoOverlayRenderer.add_angle_overlay(
            enhanced_frame,
            frame_number,
            drone_telemetry,
            reference_points,
            real_gps_data,
            fps,
            frame_measurements,
        )

        return enhanced_frame
