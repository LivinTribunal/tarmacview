"""
Caching utilities for video processing
"""
import cv2
import numpy as np
from app.core.logging import logger
import threading
from typing import List, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings


class FrameProcessingCache:
    """Cache for expensive operations to avoid recomputation"""

    def __init__(self, max_cache_size: int = None):
        self.gps_cache = {}  # frame_number -> GPSData
        self.processed_frames = {}  # frame_number -> processed_data
        self.max_cache_size = max_cache_size or settings.GPU_CACHE_MAX_SIZE
        self._lock = threading.Lock()

    def get_gps_data(self, frame_number: int) -> Optional['GPSData']:
        """Get cached GPS data for frame"""
        with self._lock:
            return self.gps_cache.get(frame_number)

    def set_gps_data(self, frame_number: int, gps_data: 'GPSData'):
        """Cache GPS data for frame"""
        with self._lock:
            if len(self.gps_cache) >= self.max_cache_size:
                # Remove oldest entry
                oldest = min(self.gps_cache.keys())
                del self.gps_cache[oldest]
            self.gps_cache[frame_number] = gps_data

    def clear(self):
        """Clear all cached data"""
        with self._lock:
            self.gps_cache.clear()
            self.processed_frames.clear()


class BatchFrameProcessor:
    """Process frames in batches for better utilization"""

    def __init__(self, batch_size: int = None, num_workers: int = None):
        self.batch_size = batch_size or settings.VIDEO_GEN_BATCH_SIZE
        self.num_workers = num_workers or settings.VIDEO_GEN_NUM_WORKERS
        self.cache = FrameProcessingCache()

    def preprocess_frames_batch(self, frames: List[np.ndarray]) -> List[Tuple[np.ndarray, np.ndarray]]:
        """Preprocess a batch of frames for light detection"""
        results = []

        # CPU batch processing with threading
        def process_single_frame(frame):
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            value_channel = hsv[:, :, 2]
            _, bright_mask = cv2.threshold(value_channel, settings.GPU_THRESHOLD_VALUE, 255, cv2.THRESH_BINARY)
            return (bright_mask, value_channel)

        with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
            results = list(executor.map(process_single_frame, frames))

        return results
