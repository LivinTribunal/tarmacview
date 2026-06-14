"""
Video generation and processing module

This module provides a unified interface to the two-pass video generation functionality.
"""

import logging
import os
from typing import Dict, List

import numpy as np

from app.services.video_processing.config import settings

# Import from generation submodules
from .generation import (
    DroneOverlayRenderer,
    InfoOverlayRenderer,
    MeasurementCollector,
    OptimizedOverlayRenderer,
    TwoPassProcessor,
)
from .models import GPSData
from .utils import BatchFrameProcessor, FrameProcessingCache

logger = logging.getLogger(__name__)


class PAPIVideoGenerator:
    """
    Generate PAPI light videos using two-pass processing.

    This class serves as a facade that delegates to specialized submodules for:
    - Two-pass video processing
    - Measurement collection and transition angle computation
    - Frame overlay rendering
    """

    def __init__(self, output_dir: str, batch_size: int = None, progress_callback=None):
        """
        Initialize the PAPI video generator.

        Args:
            output_dir: Directory to save generated videos
            batch_size: Batch size for frame processing
            progress_callback: Optional callback for progress updates
        """
        self.output_dir = output_dir
        self.batch_size = batch_size or settings.VIDEO_GEN_BATCH_SIZE
        self.progress_callback = progress_callback
        os.makedirs(output_dir, exist_ok=True)

        # Initialize batch processor
        self.batch_processor = BatchFrameProcessor(batch_size=batch_size)
        self.frame_cache = FrameProcessingCache()

        # Initialize submodule processors
        self._two_pass = TwoPassProcessor(output_dir, batch_size, progress_callback)
        self._measurement_collector = MeasurementCollector()

        logger.info(f"Video generator initialized (batch size: {batch_size})")

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

        Returns: (measurements_data, papi_video_paths, enhanced_video_path)

        Delegates to: TwoPassProcessor
        """
        return self._two_pass.process_video_two_pass(
            video_path,
            session_id,
            light_positions,
            real_gps_data,
            reference_points,
            runway_heading,
            fps,
        )

    def collect_measurements_only(
        self,
        video_path: str,
        session_id: str,
        light_positions: Dict,
        real_gps_data: List,
        reference_points: Dict,
        runway_heading: float,
        fps: int = 30,
    ) -> List[Dict]:
        """
        PASS 1: Collect measurements and compute transition angles.

        Process video to collect all frame measurements, then compute transition
        angles and inject them into the measurements data.

        Returns: measurements_data (List[Dict]) with transition angles included

        Delegates to: MeasurementCollector
        """
        return self._measurement_collector.collect_measurements_only(
            video_path,
            session_id,
            light_positions,
            real_gps_data,
            reference_points,
            runway_heading,
            fps,
        )

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
    ) -> tuple:
        """
        PASS 2: Generate videos from pre-computed measurements.

        This method reads the video and generates:
        1. Enhanced main video with all overlays and transition bars
        2. Individual PAPI videos for each light

        Returns: (papi_video_paths, enhanced_video_path)

        Delegates to: TwoPassProcessor
        """
        return self._two_pass.generate_videos_from_measurements(
            video_path,
            session_id,
            light_positions,
            measurements_data,
            real_gps_data,
            reference_points,
            runway_heading,
            fps,
        )

    @staticmethod
    def compute_transition_angles_from_chromacity(
        measurements_data: List[Dict], light_name: str, reference_points: Dict = None
    ) -> Dict:
        """
        Compute transition angles for a PAPI light based on chromacity analysis.

        Delegates to: MeasurementCollector
        """
        return MeasurementCollector.compute_transition_angles_from_chromacity(
            measurements_data, light_name, reference_points
        )

    # Overlay rendering methods - delegates to overlay renderers

    def _add_overlays_to_frame_with_tracking_optimized(
        self,
        frame: np.ndarray,
        tracked_positions: Dict,
        frame_number: int,
        total_frames: int,
        measurements_data: List[Dict] = None,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        cached_drone_data: Dict = None,
        original_light_positions: Dict = None,
    ):
        """Add optimized overlays to frame. Delegates to: OptimizedOverlayRenderer"""
        return OptimizedOverlayRenderer.add_overlays_to_frame_with_tracking_optimized(
            frame,
            tracked_positions,
            frame_number,
            total_frames,
            measurements_data,
            drone_telemetry,
            reference_points,
            cached_drone_data,
            original_light_positions,
        )

    def _add_drone_position_overlay_optimized(
        self,
        frame: np.ndarray,
        frame_number: int,
        tracked_positions: Dict,
        measurements_data: List[Dict] = None,
        reference_points: Dict = None,
        cached_drone_data: Dict = None,
    ):
        """Add optimized drone overlay. Delegates to: OptimizedOverlayRenderer"""
        return OptimizedOverlayRenderer.add_drone_position_overlay_optimized(
            frame,
            frame_number,
            tracked_positions,
            measurements_data,
            reference_points,
            cached_drone_data,
        )

    def _add_overlays_to_frame_with_tracking(
        self,
        frame: np.ndarray,
        tracked_positions: Dict,
        frame_number: int,
        total_frames: int,
        measurements_data: List[Dict] = None,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
    ):
        """Add overlays with tracking. Delegates to: OptimizedOverlayRenderer"""
        return OptimizedOverlayRenderer.add_overlays_to_frame_with_tracking(
            frame,
            tracked_positions,
            frame_number,
            total_frames,
            measurements_data,
            drone_telemetry,
            reference_points,
            real_gps_data,
            fps,
        )

    def _add_drone_position_overlay(
        self,
        frame: np.ndarray,
        frame_number: int,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
    ):
        """Add drone position overlay. Delegates to: DroneOverlayRenderer"""
        return DroneOverlayRenderer.add_drone_position_overlay(
            frame, frame_number, drone_telemetry, reference_points, real_gps_data, fps
        )

    def _calculate_angles_to_targets(self, drone_data: Dict, reference_points: Dict = None) -> Dict:
        """Calculate angles to targets. Delegates to: DroneOverlayRenderer"""
        return DroneOverlayRenderer.calculate_angles_to_targets(drone_data, reference_points)

    def _add_frame_info_overlay(self, frame: np.ndarray, frame_number: int, total_frames: int):
        """Add frame info overlay. Delegates to: InfoOverlayRenderer"""
        return InfoOverlayRenderer.add_frame_info_overlay(frame, frame_number, total_frames)

    def _add_progress_bar(self, frame: np.ndarray, frame_number: int, total_frames: int):
        """Add progress bar overlay. Delegates to: InfoOverlayRenderer"""
        return InfoOverlayRenderer.add_progress_bar(frame, frame_number, total_frames)

    def _add_angle_overlay(
        self,
        frame: np.ndarray,
        frame_number: int,
        drone_telemetry: List[Dict] = None,
        reference_points: Dict = None,
        real_gps_data: List[GPSData] = None,
        fps: float = 30.0,
    ):
        """Add angle overlay. Delegates to: InfoOverlayRenderer"""
        return InfoOverlayRenderer.add_angle_overlay(
            frame, frame_number, drone_telemetry, reference_points, real_gps_data, fps
        )
