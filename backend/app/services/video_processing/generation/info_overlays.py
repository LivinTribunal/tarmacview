"""
Overlay rendering for video frames
"""

import logging
from typing import Dict, List

import cv2
import numpy as np

from ..gps import GPSExtractor
from ..models import GPSData
from ..utils import (
    haversine_distance,
)

logger = logging.getLogger(__name__)


class InfoOverlayRenderer:
    """Handles informational overlay rendering"""

    @staticmethod
    def add_progress_bar(frame: np.ndarray, frame_number: int, total_frames: int):
        """Add progress bar overlay to frame"""
        # Fixed indentation
        height, width = frame.shape[:2]

        # Progress bar settings
        bar_width = 300
        bar_height = 8
        bar_x = width - bar_width - 20
        bar_y = height - 40

        # Background bar
        cv2.rectangle(
            frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), (50, 50, 50), -1
        )

        # Progress bar
        progress = frame_number / max(1, total_frames - 1)
        progress_width = int(bar_width * progress)
        cv2.rectangle(
            frame, (bar_x, bar_y), (bar_x + progress_width, bar_y + bar_height), (0, 255, 0), -1
        )

        # Frame counter
        frame_text = f"{frame_number + 1}/{total_frames}"
        cv2.putText(
            frame,
            frame_text,
            (bar_x, bar_y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
        )

    @staticmethod
    def add_angle_overlay(
        frame: np.ndarray,
        frame_number: int,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
        frame_measurements: Dict = None,
    ):
        """Add professional information panel overlay to frame - EXTENDS CANVAS AT BOTTOM

        Args:
            frame_measurements: Pre-computed measurements for current
            frame (OPTIMIZATION - avoids recalculating angles)
        """
        height, width = frame.shape[:2]

        # EXTEND CANVAS: Create larger frame with panel space at bottom
        panel_height = 350  # Increased from 180 to accommodate all information
        extended_height = height + panel_height
        extended_frame = np.zeros((extended_height, width, 3), dtype=np.uint8)

        # Copy original frame to top portion
        extended_frame[0:height, :] = frame

        # Now work with extended frame
        frame = extended_frame

        # Get real drone data for this frame (same logic as main overlay)
        drone_data = None

        # Priority 1: Use real GPS data extracted from video file
        if real_gps_data:
            gps_extractor = GPSExtractor()
            interpolated_gps = gps_extractor.interpolate_gps_for_frame(
                real_gps_data, frame_number, fps
            )
            if interpolated_gps:
                drone_data = {
                    "latitude": interpolated_gps.latitude,
                    "longitude": interpolated_gps.longitude,
                    "elevation_wgs84": interpolated_gps.elevation_wgs84,
                    "speed": interpolated_gps.speed or 0.0,
                    "heading": interpolated_gps.heading or 0.0,
                }

        # Priority 2: Use provided drone telemetry
        if not drone_data and drone_telemetry and frame_number < len(drone_telemetry):
            drone_data = drone_telemetry[frame_number]

        # Priority 3: Fail if no GPS data is available
        if not drone_data:
            raise ValueError(
                f"No GPS data available for frame {frame_number}."
                f" Video must contain GPS coordinates for processing."
            )

        # Professional panel settings at BOTTOM
        font = cv2.FONT_HERSHEY_SIMPLEX
        panel_y_start = height  # Start at original frame height
        panel_y_end = extended_height

        # Create white panel background at bottom (ALWAYS draw this)
        cv2.rectangle(frame, (0, panel_y_start), (width, panel_y_end), (255, 255, 255), -1)

        # Add top border line
        cv2.line(frame, (0, panel_y_start), (width, panel_y_start), (200, 200, 200), 3)

        # Calculate angles to PAPI lights and touch point if reference points available
        if reference_points:
            try:
                # OPTIMIZATION: Use pre-computed PAPI angles from frame_measurements when available
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
                    # OPTIMIZATION: Try to get pre-computed angle from frame_measurements first
                    angle = None
                    if frame_measurements:
                        light_key = papi_name.lower()
                        angle = frame_measurements.get(f"{light_key}_angle")

                    # Fallback: Calculate if not in measurements (backward compatibility)
                    if angle is None and papi_name in reference_points:
                        papi_point = reference_points[papi_name]
                        # Convert to float to handle Decimal types from DynamoDB
                        ground_dist = haversine_distance(
                            float(drone_data["latitude"]),
                            float(drone_data["longitude"]),
                            float(papi_point.get("latitude", 0)),
                            float(papi_point.get("longitude", 0)),
                        )
                        # Use elevation_wgs84 with fallback to
                        # elevation/altitude for backward compatibility
                        drone_elevation_wgs84 = float(
                            drone_data.get(
                                "elevation_wgs84",
                                drone_data.get("altitude", drone_data.get("elevation", 0)),
                            )
                        )
                        papi_elevation_wgs84 = float(
                            papi_point.get("elevation_wgs84", papi_point.get("elevation", 0))
                        )
                        alt_diff = drone_elevation_wgs84 - papi_elevation_wgs84

                        if ground_dist > 0:
                            angle = np.degrees(np.arctan(alt_diff / ground_dist))
                        else:
                            angle = 90.0 if alt_diff > 0 else -90.0

                    if angle is not None:
                        papi_angles[papi_name] = angle

                # OPTIMIZATION: Use pre-computed touch point angle when available
                touch_angle = None
                # Note: Touch point angle not currently in frame_measurements, so always calculate
                if "TOUCH_POINT" in reference_points:
                    touch_point = reference_points["TOUCH_POINT"]
                    # Convert to float to handle Decimal types from DynamoDB
                    ground_dist = haversine_distance(
                        float(drone_data["latitude"]),
                        float(drone_data["longitude"]),
                        float(touch_point.get("latitude", 0)),
                        float(touch_point.get("longitude", 0)),
                    )
                    # Use elevation_wgs84 with fallback to
                    # elevation/altitude for backward compatibility
                    drone_elevation_wgs84 = float(
                        drone_data.get(
                            "elevation_wgs84",
                            drone_data.get("altitude", drone_data.get("elevation", 0)),
                        )
                    )
                    touch_elevation_wgs84 = float(
                        touch_point.get("elevation_wgs84", touch_point.get("elevation", 0))
                    )
                    alt_diff = drone_elevation_wgs84 - touch_elevation_wgs84

                    if ground_dist > 0:
                        touch_angle = np.degrees(np.arctan(alt_diff / ground_dist))
                    else:
                        touch_angle = 90.0 if alt_diff > 0 else -90.0

                # Layout: 3 columns with better spacing
                col_width = width // 3
                y_base = panel_y_start + 40  # Start position in panel

                # Column 1: GPS Info + Time
                x_col1 = 25
                cv2.putText(frame, "GPS POSITION", (x_col1, y_base), font, 1.0, (80, 80, 80), 2)
                # Convert to float to handle Decimal types from DynamoDB
                cv2.putText(
                    frame,
                    f"Lat: {float(drone_data['latitude']):.6f}",
                    (x_col1, y_base + 45),
                    font,
                    0.8,
                    (60, 60, 60),
                    2,
                )
                cv2.putText(
                    frame,
                    f"Lon: {float(drone_data['longitude']):.6f}",
                    (x_col1, y_base + 85),
                    font,
                    0.8,
                    (60, 60, 60),
                    2,
                )
                # Use elevation_wgs84 with fallback for backward compatibility
                elevation_display = float(
                    drone_data.get(
                        "elevation_wgs84",
                        drone_data.get("altitude", drone_data.get("elevation", 0)),
                    )
                )
                cv2.putText(
                    frame,
                    f"Alt: {elevation_display:.1f}m WGS84",
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
                    frame,
                    f"Frame: {frame_number + 1}",
                    (x_col1, y_base + 205),
                    font,
                    0.8,
                    (60, 60, 60),
                    2,
                )

                # Column 2: PAPI Vertical Angles with all angle details
                x_col2 = col_width + 25
                cv2.putText(frame, "PAPI ANGLES", (x_col2, y_base), font, 1.0, (80, 80, 80), 2)

                y_papi = y_base + 35
                line_spacing = 30
                for papi_name, angle in papi_angles.items():
                    color = papi_colors.get(papi_name, (100, 100, 100))

                    # Get reference point data for nominal and transition angles
                    papi_ref = reference_points.get(papi_name, {})
                    nominal_angle = papi_ref.get("nominal_angle")
                    transition_start = papi_ref.get("transition_angle_min")
                    _transition_mid = papi_ref.get("transition_angle_middle")
                    transition_end = papi_ref.get("transition_angle_max")

                    # Format display - convert to float to handle Decimal types
                    angle_float = float(angle) if angle is not None else 0.0
                    if nominal_angle is not None:
                        nominal_float = float(nominal_angle)
                        angle_text = f"{papi_name}: {angle_float:.2f} (N:{nominal_float:.2f})"
                    else:
                        angle_text = f"{papi_name}: {angle_float:.2f}"

                    cv2.putText(frame, angle_text, (x_col2, y_papi), font, 0.7, color, 2)
                    y_papi += line_spacing

                    # Add transition angles if available
                    if transition_start is not None and transition_end is not None:
                        trans_start_float = float(transition_start)
                        trans_end_float = float(transition_end)
                        trans_text = f"  Trans: {trans_start_float:.2f} - {trans_end_float:.2f}"
                        cv2.putText(
                            frame, trans_text, (x_col2, y_papi), font, 0.6, (100, 100, 100), 1
                        )
                        y_papi += line_spacing

                    if y_papi > panel_y_end - 20:
                        break

                # Column 3: Touch Point & Glide Path Info
                x_col3 = 2 * col_width + 25
                if touch_angle is not None:
                    touch_angle_float = float(touch_angle)
                    cv2.putText(frame, "TOUCH POINT", (x_col3, y_base), font, 1.0, (80, 80, 80), 2)
                    cv2.putText(
                        frame,
                        f"Current Angle: {touch_angle_float:.2f}",
                        (x_col3, y_base + 45),
                        font,
                        0.8,
                        (0, 180, 180),
                        2,
                    )

                    # Get glide path angle from touch point reference - convert to float
                    touch_ref = reference_points.get("TOUCH_POINT", {})
                    glide_path_angle = float(
                        touch_ref.get("nominal_angle", touch_ref.get("glide_path_angle", 3.0))
                        or 3.0
                    )
                    tolerance = float(touch_ref.get("tolerance", 0.1) or 0.1)

                    cv2.putText(
                        frame,
                        f"Nominal GP: {glide_path_angle:.2f} (+/-{tolerance:.2f})",
                        (x_col3, y_base + 85),
                        font,
                        0.8,
                        (0, 150, 0),
                        2,
                    )

                    # Calculate deviation from glide path
                    deviation = touch_angle_float - glide_path_angle
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
                    cv2.putText(
                        frame, status_text, (x_col3, y_base + 165), font, 0.7, status_color, 2
                    )
                else:
                    cv2.putText(frame, "TOUCH POINT", (x_col3, y_base), font, 1.0, (80, 80, 80), 2)
                    cv2.putText(
                        frame, "No data", (x_col3, y_base + 45), font, 0.8, (100, 100, 100), 1
                    )

            except Exception as e:
                import traceback

                error_msg = str(e)
                logger.error(f"Error calculating angles: {error_msg}")
                logger.error(f"Full traceback: {traceback.format_exc()}")
                logger.error(
                    f"reference_points count: {len(reference_points) if reference_points else 0}, "
                    f"frame_measurements present: {frame_measurements is not None}"
                )
                # Render error message on the frame instead of crashing
                cv2.putText(
                    frame,
                    f"ERROR: {error_msg[:80]}",
                    (25, panel_y_start + 50),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 0, 255),
                    2,
                )
        else:
            # Display placeholder when no reference points
            cv2.putText(
                frame,
                "Angles: No ref points",
                (25, panel_y_start + 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (128, 128, 128),
                2,
            )

        # Return the extended frame
        return frame
