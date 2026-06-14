"""
GPU acceleration utilities for video processing
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Tuple

import cv2
import numpy as np

from app.services.video_processing.config import settings

from ..models import GPSData

logger = logging.getLogger(__name__)


class GPUAccelerator:
    """GPU acceleration utilities for OpenCV operations"""

    def __init__(self):
        self.gpu_enabled = False
        self.opencl_available = False
        self._initialize_gpu()

    def _initialize_gpu(self):
        """Initialize GPU acceleration if available"""
        try:
            # Check OpenCL availability (works on M1/M2/M3 Macs)
            if hasattr(cv2.ocl, "haveOpenCL") and cv2.ocl.haveOpenCL():
                cv2.ocl.setUseOpenCL(True)
                self.opencl_available = cv2.ocl.useOpenCL()
                if self.opencl_available:
                    device = cv2.ocl.Device.getDefault()
                    logger.info(
                        f"OpenCL GPU acceleration enabled: {device.name()}"
                        f" ({device.maxComputeUnits()} cores)"
                    )
                    self.gpu_enabled = True
                else:
                    logger.warning("OpenCL available but failed to enable")
            else:
                logger.info("OpenCL not available - using CPU processing")

        except Exception as e:
            logger.warning(f"GPU initialization failed: {e}")
            self.gpu_enabled = False

    def is_enabled(self) -> bool:
        """Check if GPU acceleration is enabled"""
        return self.gpu_enabled

    def cvtColor_gpu(self, src, code):
        """GPU-accelerated color space conversion"""
        if self.gpu_enabled:
            try:
                # Upload to GPU, process, download
                gpu_src = cv2.UMat(src)
                gpu_dst = cv2.cvtColor(gpu_src, code)
                return gpu_dst.get()
            except Exception:
                pass
        # Fallback to CPU
        return cv2.cvtColor(src, code)

    def threshold_gpu(self, src, thresh, maxval, type):
        """GPU-accelerated thresholding"""
        if self.gpu_enabled:
            try:
                gpu_src = cv2.UMat(src)
                _, gpu_dst = cv2.threshold(gpu_src, thresh, maxval, type)
                return gpu_dst.get()
            except Exception:
                pass
        # Fallback to CPU
        _, dst = cv2.threshold(src, thresh, maxval, type)
        return dst

    def morphologyEx_gpu(self, src, op, kernel, iterations=1):
        """GPU-accelerated morphological operations"""
        if self.gpu_enabled:
            try:
                gpu_src = cv2.UMat(src)
                gpu_dst = cv2.morphologyEx(gpu_src, op, kernel, iterations=iterations)
                return gpu_dst.get()
            except Exception:
                pass
        # Fallback to CPU
        return cv2.morphologyEx(src, op, kernel, iterations=iterations)

    def bitwise_or_gpu(self, src1, src2):
        """GPU-accelerated bitwise OR"""
        if self.gpu_enabled:
            try:
                gpu_src1 = cv2.UMat(src1)
                gpu_src2 = cv2.UMat(src2)
                gpu_dst = cv2.bitwise_or(gpu_src1, gpu_src2)
                return gpu_dst.get()
            except Exception:
                pass
        # Fallback to CPU
        return cv2.bitwise_or(src1, src2)

    def resize_gpu(self, src, size, interpolation=cv2.INTER_LINEAR):
        """GPU-accelerated resize"""
        if self.gpu_enabled:
            try:
                gpu_src = cv2.UMat(src)
                gpu_dst = cv2.resize(gpu_src, size, interpolation=interpolation)
                return gpu_dst.get()
            except Exception:
                pass
        # Fallback to CPU
        return cv2.resize(src, size, interpolation=interpolation)


class FrameProcessingCache:
    """Cache for expensive operations to avoid recomputation"""

    def __init__(self, max_cache_size: int = None):
        self.gps_cache = {}  # frame_number -> GPSData
        self.processed_frames = {}  # frame_number -> processed_data
        self.max_cache_size = max_cache_size or settings.GPU_CACHE_MAX_SIZE
        self._lock = threading.Lock()

    def get_gps_data(self, frame_number: int) -> Optional["GPSData"]:
        """Get cached GPS data for frame"""
        with self._lock:
            return self.gps_cache.get(frame_number)

    def set_gps_data(self, frame_number: int, gps_data: "GPSData"):
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
    """Process frames in batches for better GPU utilization"""

    def __init__(self, batch_size: int = None, num_workers: int = None):
        self.batch_size = batch_size or settings.VIDEO_GEN_BATCH_SIZE
        self.num_workers = num_workers or settings.VIDEO_GEN_NUM_WORKERS
        self.gpu_accelerator = GPUAccelerator()
        self.cache = FrameProcessingCache()

    def preprocess_frames_batch(
        self, frames: List[np.ndarray]
    ) -> List[Tuple[np.ndarray, np.ndarray]]:
        """Preprocess a batch of frames for light detection"""
        results = []

        if self.gpu_accelerator.is_enabled():
            # GPU batch processing
            for frame in frames:
                # Convert to HSV using GPU
                hsv = self.gpu_accelerator.cvtColor_gpu(frame, cv2.COLOR_BGR2HSV)
                value_channel = hsv[:, :, 2]

                # Create brightness mask using GPU
                bright_mask = self.gpu_accelerator.threshold_gpu(
                    value_channel, settings.GPU_THRESHOLD_VALUE, 255, cv2.THRESH_BINARY
                )

                results.append((bright_mask, value_channel))
        else:
            # CPU batch processing with threading
            def process_single_frame(frame):
                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                value_channel = hsv[:, :, 2]
                _, bright_mask = cv2.threshold(
                    value_channel, settings.GPU_THRESHOLD_VALUE, 255, cv2.THRESH_BINARY
                )
                return (bright_mask, value_channel)

            with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
                results = list(executor.map(process_single_frame, frames))

        return results
