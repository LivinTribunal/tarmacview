"""
Optical flow tracking for PAPI lights
"""

import logging
from typing import Dict, Tuple

import cv2
import numpy as np

from app.services.video_processing.config import settings

from ..models import TrackedPAPILight

logger = logging.getLogger(__name__)


class OpticalFlowTracker:
    """Handles optical flow-based tracking of PAPI lights"""

    def __init__(self):
        self.prev_gray = None
        self.use_optical_flow = False  # Disabled - using per-frame detection instead
        self.lk_params = dict(
            winSize=(
                settings.TRACKING_OPTICAL_FLOW_WIN_SIZE,
                settings.TRACKING_OPTICAL_FLOW_WIN_SIZE,
            ),
            maxLevel=settings.TRACKING_OPTICAL_FLOW_MAX_LEVEL,
            criteria=(
                cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
                settings.TRACKING_OPTICAL_FLOW_CRITERIA_COUNT,
                settings.TRACKING_OPTICAL_FLOW_CRITERIA_EPS,
            ),
        )

    def track_with_optical_flow(
        self, frame: np.ndarray, tracked_lights: Dict[str, TrackedPAPILight]
    ) -> Dict[str, Tuple[int, int, float]]:
        """
        Track all PAPI lights using Lucas-Kanade optical flow.

        Returns:
            Dict mapping light_name to (x, y, confidence) tuples
        """
        if self.prev_gray is None:
            return {}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Get previous positions for all lights
        prev_points = []
        light_names = []
        for light_name, tracked_light in tracked_lights.items():
            x, y = tracked_light.get_last_position()
            prev_points.append([x, y])
            light_names.append(light_name)

        if len(prev_points) == 0:
            return {}

        prev_points = np.array(prev_points, dtype=np.float32).reshape(-1, 1, 2)

        # Calculate optical flow
        next_points, status, error = cv2.calcOpticalFlowPyrLK(
            self.prev_gray, gray, prev_points, None, **self.lk_params
        )

        # Process results
        tracked_positions = {}
        for i, light_name in enumerate(light_names):
            if status[i][0] == 1:  # Successfully tracked
                x, y = next_points[i][0]
                x, y = int(x), int(y)

                # Calculate confidence based on error
                conf = max(0.0, 1.0 - error[i][0] / settings.TRACKING_OPTICAL_FLOW_ERROR_DIVISOR)

                tracked_positions[light_name] = (x, y, conf)
                logger.debug(f"Optical flow: {light_name} → ({x},{y}) conf={conf:.2f}")

        self.prev_gray = gray
        return tracked_positions

    def update_prev_gray(self, frame: np.ndarray):
        """Update the previous gray frame for next iteration"""
        self.prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
