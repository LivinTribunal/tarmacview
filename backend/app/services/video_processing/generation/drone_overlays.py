"""
Overlay rendering for video frames
"""

import logging
import math
from typing import Dict, List

import cv2
import numpy as np

from ..gps import GPSExtractor
from ..models import GPSData
from ..utils import (
    calculate_horizontal_angle,
    haversine_distance,
)

logger = logging.getLogger(__name__)


class DroneOverlayRenderer:
    """Handles drone position and angle overlay rendering"""

    @staticmethod
    def add_drone_position_overlay(
        frame: np.ndarray,
        frame_number: int,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
    ):
        """Add drone position information overlay with angles to PAPI lights and touch point"""
        height, width = frame.shape[:2]

        # Create semi-transparent overlay box - expanded for more data
        overlay = frame.copy()
        box_height = 220  # Increased height for angle data
        box_width = 420  # Increased width for angle data

        # Position in top-left corner
        cv2.rectangle(overlay, (10, 10), (box_width, box_height), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

        # Get real drone data for this frame
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
                    "satellites": interpolated_gps.satellites,
                    "accuracy": interpolated_gps.accuracy,
                }
                logger.debug(
                    f"Frame {frame_number}: Using real GPS data - "
                    f"Lat: {interpolated_gps.latitude:.6f}, "
                    f"Lon: {interpolated_gps.longitude:.6f}, "
                    f"Elevation (WGS84): {interpolated_gps.elevation_wgs84:.1f}m"
                )

        # Priority 2: Use provided drone telemetry
        if not drone_data and drone_telemetry and frame_number < len(drone_telemetry):
            drone_data = drone_telemetry[frame_number]
            logger.debug(f"Frame {frame_number}: Using provided telemetry data")

        # Priority 3: Fail if no GPS data is available
        if not drone_data:
            raise ValueError(
                f"No GPS data available for frame {frame_number}."
                f" Video must contain GPS coordinates for processing."
            )

        # Calculate angles to PAPI lights and touch point
        angles_data = DroneOverlayRenderer.calculate_angles_to_targets(drone_data, reference_points)

        # Draw drone position information
        text_color = (255, 255, 255)
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.5
        line_height = 20

        # Basic drone data with GPS quality indicators
        gps_source = "REAL GPS" if real_gps_data else "FALLBACK"
        gps_quality = ""
        if drone_data.get("satellites"):
            gps_quality = f" ({drone_data['satellites']} sats)"
        if drone_data.get("accuracy"):
            gps_quality += f" ±{drone_data['accuracy']:.1f}m"

        basic_texts = [
            "",
            f"Frame: {frame_number + 1} | {gps_source}{gps_quality}",
            f"Lat: {drone_data.get('latitude', 0):.6f}",
            f"Lon: {drone_data.get('longitude', 0):.6f}",
            f"Alt: {drone_data.get('elevation_wgs84', drone_data.get('elevation', 0)):.1f}m WGS84",
            f"Heading: {drone_data.get('heading', 0):.2f}",
            "",  # Empty line separator
            "📐 Angles to Targets:",
        ]

        # Add basic information
        y_offset = 20
        for i, text in enumerate(basic_texts):
            y_pos = y_offset + i * line_height
            cv2.putText(frame, text, (20, y_pos), font, font_scale, text_color, 1)

        # Add angle information with color coding
        y_offset += len(basic_texts) * line_height + 5

        # PAPI light angles
        papi_colors = {
            "PAPI_A": (0, 255, 255),  # Yellow
            "PAPI_B": (255, 165, 0),  # Orange
            "PAPI_C": (255, 0, 255),  # Magenta
            "PAPI_D": (0, 255, 0),  # Green
        }

        for i, (papi_id, angle_data) in enumerate(angles_data.items()):
            if papi_id.startswith("PAPI_"):
                color = papi_colors.get(papi_id, (255, 255, 255))
                angle_text = f"{papi_id}: {angle_data['angle']:.2f} ({angle_data['distance']:.0f}m)"
                y_pos = y_offset + i * line_height
                cv2.putText(frame, angle_text, (25, y_pos), font, font_scale, color, 1)

        # Touch point angle (if available)
        if "touch_point" in angles_data:
            touch_data = angles_data["touch_point"]
            touch_text = f"Touch Pt: {touch_data['angle']:.2f} ({touch_data['distance']:.0f}m)"
            y_pos = (
                y_offset
                + len([k for k in angles_data.keys() if k.startswith("PAPI_")]) * line_height
            )
            cv2.putText(frame, touch_text, (25, y_pos), font, font_scale, (255, 255, 255), 1)

    @staticmethod
    def calculate_angles_to_targets(drone_data: Dict, reference_points: Dict = None) -> Dict:
        """
        Calculate angles from drone to all target points (PAPI lights and touch point).

        All elevations use WGS84 ellipsoid height from drone GPS - no conversions are performed.
        """
        angles_data = {}

        if not reference_points:
            raise ValueError(
                "Reference points are required for angle calculations. "
                "Please ensure PAPI light and touch point coordinates"
                " are configured in the database for this runway."
            )

        drone_lat = drone_data.get("latitude")
        drone_lon = drone_data.get("longitude")
        drone_elevation_wgs84 = drone_data.get("elevation_wgs84", drone_data.get("elevation"))
        runway_heading = drone_data.get("runway_heading")

        # Validate that all required coordinates are present
        if drone_lat is None or drone_lon is None or drone_elevation_wgs84 is None:
            raise ValueError(
                "Incomplete GPS data. Missing: "
                + f"{'latitude ' if drone_lat is None else ''}"
                + f"{'longitude ' if drone_lon is None else ''}"
                + f"{'elevation_wgs84' if drone_elevation_wgs84 is None else ''}"
            )

        # Log drone elevation for debugging
        logger.debug(f"Calculating angles with drone elevation_wgs84: {drone_elevation_wgs84:.1f}m")

        for target_id, target_pos in reference_points.items():
            target_lat = target_pos.get("latitude")
            target_lon = target_pos.get("longitude")
            target_elevation_wgs84 = target_pos.get(
                "elevation_wgs84", target_pos.get("elevation", 0)
            )

            # Validate target elevation
            if target_elevation_wgs84 == 0 or target_elevation_wgs84 is None:
                logger.warning(
                    f"{target_id} has elevation_wgs84={target_elevation_wgs84}m. "
                    f"This may cause incorrect angle calculations! "
                    f"Ensure WGS84 elevation is properly configured for this reference point."
                )

            if target_lat is not None and target_lon is not None:
                # Calculate ground distance using Haversine formula
                ground_dist = haversine_distance(drone_lat, drone_lon, target_lat, target_lon)

                # Calculate height difference (both elevations in WGS84)
                height_diff = drone_elevation_wgs84 - target_elevation_wgs84

                # Log height difference for debugging angle issues
                logger.debug(
                    f"{target_id}: drone_elevation_wgs84={drone_elevation_wgs84:.1f}m,"
                    f" target_elevation_wgs84={target_elevation_wgs84:.1f}m, "
                    f"height_diff={height_diff:.1f}m, ground_dist={ground_dist:.1f}m"
                )

                # Calculate vertical angle (elevation angle from horizontal)
                if ground_dist > 0:
                    vertical_angle = np.degrees(np.arctan(height_diff / ground_dist))
                else:
                    vertical_angle = 90.0 if height_diff > 0 else -90.0

                # Round to 3 decimal places for consistent precision
                vertical_angle = round(vertical_angle, 3)

                logger.debug(f"{target_id}: calculated vertical angle = {vertical_angle:.3f}°")

                # Calculate horizontal angle (deviation from runway centerline)
                horizontal_angle = None
                if runway_heading is not None:
                    horizontal_angle = calculate_horizontal_angle(
                        target_lat, target_lon, drone_lat, drone_lon, runway_heading
                    )

                # Calculate direct distance
                direct_distance = math.sqrt(ground_dist**2 + height_diff**2)

                angles_data[target_id] = {
                    "angle": vertical_angle,
                    "horizontal_angle": horizontal_angle,
                    "distance": direct_distance,
                    "ground_distance": ground_dist,
                    "height_diff": height_diff,
                }
            else:
                # Raise error if coordinates are not available - no fallback data
                raise ValueError(
                    f"Reference point coordinates for '{target_id}' are missing or incomplete. "
                    f"Required: latitude and longitude. Please ensure"
                    f" all reference points are properly configured."
                )

        return angles_data
