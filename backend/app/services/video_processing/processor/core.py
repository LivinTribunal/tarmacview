"""
Core video processor for PAPI measurements
"""
import cv2
import numpy as np
from app.core.logging import logger
from typing import Dict

from app.core.config import settings
from ..utils import (
    extract_color_from_brightest_pixels,
    calculate_angle,
    calculate_ground_distance,
    calculate_horizontal_angle,
    classify_light_status,
    convert_to_h264
)
from .metadata import extract_recording_date, extract_first_frame
from .detection import detect_lights



class VideoProcessor:
    """Process drone videos for PAPI light measurements"""

    @staticmethod
    def extract_recording_date(video_path: str):
        """Extract recording date from video metadata"""
        return extract_recording_date(video_path)

    @staticmethod
    def extract_first_frame(video_path: str, output_path: str) -> Dict:
        """Extract first frame from video and get metadata"""
        return extract_first_frame(video_path, output_path)

    @staticmethod
    def detect_lights(image_path: str, reference_points: list) -> Dict[str, Dict]:
        """Detect PAPI lights in image"""
        return detect_lights(image_path, reference_points)

    @staticmethod
    def process_frame(frame: np.ndarray, light_positions: Dict,
                     drone_data: Dict, reference_points: Dict = None) -> Dict:
        """Process single frame for light measurements using actual tracked positions"""
        measurements = {}

        height, width = frame.shape[:2]

        for light_name, pos in light_positions.items():
            if light_name not in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
                continue

            # Determine pixel coordinates
            if 'x' in pos and 'y' in pos and pos['x'] > 100 and pos['y'] > 100:
                # Use tracked position directly (already in pixel coordinates)
                pixel_x = int(pos['x'])
                pixel_y = int(pos['y'])
                pixel_size = int(pos.get('size', 300))
                # Check if RGB values are provided from tracking
                rgb_values = pos.get('rgb', None)
            else:
                # Treat as percentage coordinates (most common case)
                x, y = pos.get("x", 50), pos.get("y", 50)
                size = pos.get("size", pos.get("width", 8))

                pixel_x = int((x / 100) * width)
                pixel_y = int((y / 100) * height)
                # Use fixed pixel size for ROI extraction instead of percentage-based
                pixel_size = settings.FRAME_ROI_SIZE_FIXED
                rgb_values = None  # Force RGB extraction

            # Extract RGB from frame if not provided by tracking
            if rgb_values is None:
                half_size = pixel_size // 2
                # Ensure integers for array slicing
                px, py = int(pixel_x), int(pixel_y)
                x1 = int(max(0, px - half_size))
                y1 = int(max(0, py - half_size))
                x2 = int(min(width, px + half_size))
                y2 = int(min(height, py + half_size))

                roi = frame[y1:y2, x1:x2]
                if roi.size > 0:
                    # Extract color using RED threshold
                    r, g, b = extract_color_from_brightest_pixels(roi)
                    rgb_values = [r, g, b]
                else:
                    rgb_values = [settings.COLOR_DEFAULT_R, settings.COLOR_DEFAULT_G, settings.COLOR_DEFAULT_B]

            # Use RGB values from tracking if available
            if isinstance(rgb_values, (list, tuple)) and len(rgb_values) >= 3:
                r, g, b = rgb_values[0], rgb_values[1], rgb_values[2]
            else:
                r, g, b = settings.COLOR_DEFAULT_R, settings.COLOR_DEFAULT_G, settings.COLOR_DEFAULT_B

            # Calculate intensity
            intensity = np.mean([r, g, b])

            # Determine light status using enhanced classification
            status = classify_light_status(r, g, b, intensity)

            # Get reference point GPS coordinates for this PAPI light
            papi_gps = None
            if "ref_points" in drone_data and light_name in drone_data["ref_points"]:
                papi_gps = drone_data["ref_points"][light_name]
            elif reference_points and light_name in reference_points:
                papi_gps = reference_points[light_name]
            else:
                raise ValueError(
                    f"Reference point coordinates for {light_name} are required for measurements. "
                    f"Please ensure PAPI light GPS coordinates are configured in the database for this runway."
                )

            # Calculate angles and distances using GPS coordinates
            angle = calculate_angle(drone_data, papi_gps)
            distance_ground = calculate_ground_distance(drone_data, papi_gps)

            # Calculate horizontal angle (deviation from runway centerline)
            runway_heading = drone_data.get("runway_heading", 0.0)
            horizontal_angle = calculate_horizontal_angle(
                papi_gps.get("latitude", 0.0),
                papi_gps.get("longitude", 0.0),
                drone_data.get("latitude", 0.0),
                drone_data.get("longitude", 0.0),
                runway_heading
            )

            measurements[light_name] = {
                "status": status,
                "rgb": {"r": r, "g": g, "b": b},
                "intensity": intensity,
                "angle": angle,
                "horizontal_angle": horizontal_angle,
                "distance_ground": distance_ground
            }

        return measurements

    @staticmethod
    def create_light_video(video_path: str, light_position: Dict,
                          output_path: str):
        """Create cropped video for single PAPI light"""
        cap = cv2.VideoCapture(video_path)

        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)

        # Handle both old format (width/height) and new format (size)
        if "width" in light_position and "height" in light_position:
            x, y, w, h = light_position["x"], light_position["y"], \
                        light_position["width"], light_position["height"]
        else:
            # Convert from percentage-based position and size to pixel coordinates
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            # Convert percentage to pixels
            x_pct = light_position["x"]
            y_pct = light_position["y"]
            size_pct = light_position["size"]

            x = int((x_pct / 100) * frame_width)
            y = int((y_pct / 100) * frame_height)
            w = h = int((size_pct / 100) * frame_width)  # Square region

        # Create video writer with mp4v codec (reliable in Docker)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

        if not out.isOpened():
            logger.error(f"Failed to create video writer for {output_path}")
            cap.release()
            return

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Extract and write ROI
            roi = frame[y:y+h, x:x+w]
            out.write(roi)

        cap.release()
        out.release()

        # Convert to H.264 for better browser support
        convert_to_h264(output_path)
