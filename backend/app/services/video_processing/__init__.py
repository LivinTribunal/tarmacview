"""
Video Processing Module

Provides video processing capabilities for PAPI measurement analysis.
"""

from .gps import GPSExtractor
from .models import DetectedLight, GPSData, TrackedPAPILight

# VideoProcessor is not exported to avoid loading processor module at init time
# Import directly from app.services.video_processing.processor.core if needed

__all__ = [
    # Models
    "GPSData",
    "DetectedLight",
    "TrackedPAPILight",
    # Classes
    "GPSExtractor",
]
