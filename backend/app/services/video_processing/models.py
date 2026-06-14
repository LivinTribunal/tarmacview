"""
Data models for video processing module
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class DetectedLight:
    """Represents a detected light object"""

    x: float
    y: float
    width: float
    height: float
    confidence: float
    class_name: str
    brightness: float
    r: int
    g: int
    b: int
    frame_num: int = 0
    timestamp_ms: float = 0.0
    intensity: float = 0.0
    # GPS and drone data (all elevations in WGS84)
    drone_latitude: Optional[float] = None
    drone_longitude: Optional[float] = None
    drone_elevation_wgs84: Optional[float] = None
    # PAPI light reference position (all elevations in WGS84)
    papi_latitude: Optional[float] = None
    papi_longitude: Optional[float] = None
    papi_elevation_wgs84: Optional[float] = None


@dataclass
class GPSData:
    """
    Represents GPS data for a specific timestamp/frame.

    IMPORTANT: All elevations are WGS84 ellipsoid heights in meters.
    WGS84 is the GPS coordinate system - NOT MSL (Mean Sea Level).
    """

    timestamp_ms: float
    latitude: float
    longitude: float
    elevation_wgs84: float  # WGS84 ellipsoid height in meters
    speed: Optional[float] = None  # m/s
    heading: Optional[float] = None  # degrees
    satellites: Optional[int] = None
    accuracy: Optional[float] = None  # meters
    frame_number: Optional[int] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            "timestamp_ms": self.timestamp_ms,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "elevation_wgs84": self.elevation_wgs84,
            "speed": self.speed,
            "heading": self.heading,
            "satellites": self.satellites,
            "accuracy": self.accuracy,
            "frame_number": self.frame_number,
        }


@dataclass
class TrackedPAPILight:
    """Represents a PAPI light tracked over multiple frames"""

    light_name: str  # PAPI_A, PAPI_B, PAPI_C, PAPI_D
    positions: List[Tuple[int, int]]  # (x, y) positions over time
    rgb_values: List[Tuple[int, int, int]]  # RGB values over time
    frame_numbers: List[int]  # Frame numbers where detected
    confidence_scores: List[float]  # Detection confidence scores
    sizes: List[int]  # Light sizes over time
    evaluation_area: List[dict]  # RED-channel based evaluation area for each frame

    def get_last_position(self) -> Tuple[int, int]:
        """Get most recent position"""
        return self.positions[-1] if self.positions else (0, 0)

    def get_velocity(self, frame_gap: int = 1) -> Tuple[float, float]:
        """Calculate velocity based on recent positions"""
        if len(self.positions) < 2:
            return 0.0, 0.0

        # Use last few positions for velocity calculation
        recent_positions = self.positions[-min(5, len(self.positions)) :]
        recent_frames = self.frame_numbers[-len(recent_positions) :]

        if len(recent_positions) >= 2:
            dt = recent_frames[-1] - recent_frames[0]
            if dt > 0:
                vx = (recent_positions[-1][0] - recent_positions[0][0]) / dt
                vy = (recent_positions[-1][1] - recent_positions[0][1]) / dt
                return vx, vy

        return 0.0, 0.0

    def predict_position(self, frame_gap: int) -> Tuple[int, int]:
        """Predict position based on motion history"""
        if not self.positions:
            return 0, 0

        last_x, last_y = self.get_last_position()
        vx, vy = self.get_velocity()

        pred_x = int(last_x + vx * frame_gap)
        pred_y = int(last_y + vy * frame_gap)

        return pred_x, pred_y
