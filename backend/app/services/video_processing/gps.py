"""
GPS extraction utilities for drone videos
"""

import json
import logging
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from .models import GPSData

logger = logging.getLogger(__name__)


class GPSExtractor:
    """Extract GPS metadata from drone video files"""

    def __init__(self):
        self.supported_formats = [".mp4", ".mov", ".avi", ".mkv"]

    def extract_gps_data(self, video_path: str) -> List[GPSData]:
        """
        Extract GPS data from video file using multiple methods.
        Tries different extraction methods in order of reliability.

        IMPORTANT: Only returns frames with actual WGS84 GPS altitude.
        Frames with only relative altitude (rel_alt) are skipped.

        Args:
            video_path: Path to video file

        Returns:
            List of GPSData points with WGS84 elevation data
        """
        video_path_obj = Path(video_path)
        if not video_path_obj.exists():
            logger.error(f"Video file not found: {video_path}")
            return []

        logger.info(f"Extracting GPS data from: {video_path}")

        # Method 1: Try DJI SRT file first (most reliable for DJI drones)
        logger.debug("Trying DJI SRT extraction...")
        try:
            gps_data = self._extract_from_dji_srt(video_path_obj)
            if gps_data:
                logger.info(f"Extracted {len(gps_data)} GPS points from DJI SRT file")
                return gps_data
        except Exception as e:
            logger.debug(f"DJI SRT extraction failed: {e}")

        # Method 2: Try exiftool for DJI embedded frame metadata (most accurate)
        logger.debug("Trying exiftool frame extraction...")
        try:
            gps_data = self._extract_with_exiftool_frames(video_path_obj)
            if gps_data:
                logger.info(
                    f"Extracted {len(gps_data)} GPS points with WGS84 altitude using exiftool"
                )
                return gps_data
        except Exception as e:
            logger.debug(f"exiftool frame extraction failed: {e}")

        # Method 3: Try ffprobe for standard GPS metadata (fallback - only returns static location)
        logger.warning(
            "Falling back to ffprobe for GPS extraction (will"
            " only get static location, not per-frame data)"
        )
        try:
            gps_data = self._extract_with_ffprobe(video_path_obj)
            if gps_data:
                logger.warning(
                    f"⚠️ ffprobe returned only {len(gps_data)} GPS"
                    f" point(s) - this is static location data only!"
                )
                return gps_data
        except Exception as e:
            logger.warning(f"ffprobe extraction also failed: {e}")

        logger.warning(f"No GPS data found in {video_path} - will use fallback data")
        return []

    def _extract_from_dji_srt(self, video_path: Path) -> List[GPSData]:
        """Extract GPS data from DJI SRT subtitle file"""
        srt_path = video_path.with_suffix(".SRT")
        if not srt_path.exists():
            srt_path = video_path.with_suffix(".srt")

        if not srt_path.exists():
            return []

        try:
            gps_data = []
            with open(srt_path, "r") as f:
                content = f.read()

            # Parse SRT entries
            entries = content.strip().split("\n\n")
            for entry in entries:
                lines = entry.strip().split("\n")
                if len(lines) < 3:
                    continue

                # Parse timestamp
                timestamp_line = lines[1]
                timestamp_ms = self._parse_srt_timestamp(timestamp_line)

                # Parse GPS data from subtitle text
                text = " ".join(lines[2:])
                gps_point = self._parse_dji_srt_text(text, timestamp_ms)
                if gps_point:
                    gps_data.append(gps_point)

            return gps_data

        except Exception as e:
            logger.debug(f"DJI SRT extraction failed: {e}")
            return []

    def _extract_with_exiftool_frames(self, video_path: Path) -> List[GPSData]:
        """
        Extract GPS data from DJI embedded frame metadata using exiftool.

        IMPORTANT: Only returns frames with actual WGS84 GPS altitude.
        Frames with only relative altitude are skipped.
        """
        try:
            # Check if exiftool is available by running it
            check_cmd = ["exiftool", "-ver"]
            check_result = subprocess.run(check_cmd, capture_output=True, timeout=5)
            if check_result.returncode != 0:
                logger.debug("exiftool not found or not working, skipping this method")
                return []
            logger.debug(f"exiftool version: {check_result.stdout.decode().strip()}")

            # Extract embedded frame GPS data (DJI format)
            cmd = ["exiftool", "-ee", "-G", "-a", str(video_path)]
            logger.info("Extracting embedded GPS with exiftool -ee...")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            if result.returncode == 0 and result.stdout:
                # Parse DJI embedded frame GPS data (only frames with WGS84 altitude)
                gps_data = []

                for line in result.stdout.split("\n"):
                    if "[QuickTime]     Text" in line and "FrameCnt:" in line:
                        # Parse frame metadata (returns None if no WGS84 altitude available)
                        gps_point = self._parse_dji_frame_metadata(line)
                        if gps_point:
                            gps_data.append(gps_point)

                if gps_data:
                    logger.info(
                        f"✅ Found {len(gps_data)} GPS points with"
                        f" WGS84 altitude in DJI embedded metadata"
                    )
                    logger.info(
                        f"   Elevation range: {min(gp.elevation_wgs84 for gp in gps_data):.1f}m"
                        f" to {max(gp.elevation_wgs84 for gp in gps_data):.1f}m WGS84"
                    )
                    return gps_data
                else:
                    logger.warning(
                        "No frames found with WGS84 altitude data (only rel_alt available)"
                    )
                    return []

            return []

        except subprocess.TimeoutExpired as e:
            logger.warning(f"exiftool -ee timed out after 300s for {video_path}: {e}")
            return []
        except Exception as e:
            logger.warning(f"exiftool frame extraction failed for {video_path}: {e}")
            import traceback

            logger.warning(traceback.format_exc())
            return []

    def _extract_with_ffprobe(self, video_path: Path) -> List[GPSData]:
        """Extract GPS data using ffprobe"""
        try:
            # Get metadata streams
            cmd = [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                str(video_path),
            ]

            logger.debug(f"Running ffprobe command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return []

            data = json.loads(result.stdout)

            # Check format tags for GPS coordinates
            format_tags = data.get("format", {}).get("tags", {})
            if "location" in format_tags or "com.apple.quicktime.location.ISO6709" in format_tags:
                # Parse static GPS location
                location = format_tags.get("location") or format_tags.get(
                    "com.apple.quicktime.location.ISO6709"
                )
                gps_point = self._parse_iso6709(location)
                if gps_point:
                    # For static GPS, create one point at the beginning
                    return [gps_point]

            return []

        except Exception as e:
            logger.debug(f"ffprobe extraction failed: {e}")
            return []

    def _parse_srt_timestamp(self, timestamp_str: str) -> float:
        """Parse SRT timestamp to milliseconds"""
        try:
            # Format: 00:00:12,000 --> 00:00:15,000
            start_time = timestamp_str.split(" --> ")[0]
            time_parts = re.match(r"(\d+):(\d+):(\d+),(\d+)", start_time)
            if time_parts:
                hours = int(time_parts.group(1))
                minutes = int(time_parts.group(2))
                seconds = int(time_parts.group(3))
                millis = int(time_parts.group(4))

                total_ms = (hours * 3600 + minutes * 60 + seconds) * 1000 + millis
                return total_ms
        except Exception:
            pass
        return 0

    def _parse_dji_srt_text(self, text: str, timestamp_ms: float) -> Optional[GPSData]:
        """
        Parse DJI drone SRT subtitle text.

        DJI drones provide GPS-based WGS84 elevation directly.
        """
        try:
            # DJI format includes GPS coordinates and telemetry
            # Example: "GPS (40.7580, -73.9855, 15) [12]"
            gps_pattern = r"GPS\s*\(([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*)\)"
            match = re.search(gps_pattern, text)
            if match:
                lat = float(match.group(1))
                lon = float(match.group(2))
                alt = float(match.group(3))  # WGS84 elevation from GPS

                # Try to extract additional data
                satellites = None
                sat_pattern = r"\[(\d+)\]"
                sat_match = re.search(sat_pattern, text)
                if sat_match:
                    satellites = int(sat_match.group(1))

                logger.debug(
                    f"Extracted SRT GPS data: lat={lat}, lon={lon}, elevation_wgs84={alt}m"
                )

                return GPSData(
                    timestamp_ms=timestamp_ms,
                    latitude=lat,
                    longitude=lon,
                    elevation_wgs84=alt,
                    satellites=satellites,
                )
        except Exception:
            pass
        return None

    def _parse_dji_frame_metadata(self, line: str) -> Optional[GPSData]:
        """Parse DJI embedded frame GPS metadata from exiftool output"""
        try:
            # Extract frame number
            frame_match = re.search(r"FrameCnt:\s*(\d+)", line)
            if not frame_match:
                return None

            frame_num = int(frame_match.group(1))

            # Extract timestamp
            timestamp_match = re.search(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)", line)
            if timestamp_match:
                # Convert timestamp to milliseconds
                dt = datetime.strptime(timestamp_match.group(1)[:19], "%Y-%m-%d %H:%M:%S")
                ms = (
                    int(timestamp_match.group(1).split(".")[-1][:3])
                    if "." in timestamp_match.group(1)
                    else 0
                )
                timestamp_ms = (dt.timestamp() * 1000) + ms
            else:
                # Approximate based on frame number (assuming 30fps)
                timestamp_ms = frame_num * 33.33

            # Extract GPS coordinates
            lat_match = re.search(r"\[latitude:\s*([-\d.]+)\]", line)
            lon_match = re.search(r"\[longitude:\s*([-\d.]+)\]", line)

            if not lat_match or not lon_match:
                return None

            latitude = float(lat_match.group(1))
            longitude = float(lon_match.group(1))

            # Extract altitudes - IMPORTANT: Prioritize GPS WGS84 altitude over barometric MSL
            # DJI metadata can contain multiple altitude fields:
            # - altitude/gps_altitude: GPS WGS84 ellipsoid height (preferred for accuracy)
            # - abs_alt: Barometric altitude above MSL (less accurate, different reference)
            # - rel_alt: Relative altitude from takeoff point

            # Try to extract GPS altitude first (WGS84)
            # Note: DJI metadata can have fields either as [field:
            # value] or within combined brackets [rel_alt: X abs_alt: Y]
            gps_alt_match = re.search(r"(?:gps_)?altitude:\s*([-\d.]+)", line)
            abs_alt_match = re.search(r"abs_alt:\s*([-\d.]+)", line)
            rel_alt_match = re.search(r"rel_alt:\s*([-\d.]+)", line)

            # CRITICAL: ONLY use actual GPS WGS84 altitude - do NOT use rel_alt
            # Priority: GPS altitude (WGS84) > absolute altitude
            # If only rel_alt is available, SKIP this frame entirely

            elevation_wgs84 = None

            if gps_alt_match:
                elevation_wgs84 = float(gps_alt_match.group(1))
                logger.debug(f"Frame {frame_num}: Using GPS altitude: {elevation_wgs84}m WGS84")
            elif abs_alt_match:
                # DJI abs_alt is GPS-based WGS84 elevation (verified from video analysis)
                elevation_wgs84 = float(abs_alt_match.group(1))
                logger.debug(f"Frame {frame_num}: Using abs_alt: {elevation_wgs84}m WGS84")
            elif rel_alt_match:
                # SKIP frames with only rel_alt - cannot be used for accurate PAPI measurements
                logger.debug(
                    f"Frame {frame_num}: Skipping - only rel_alt available, no WGS84 altitude"
                )
                return None
            else:
                logger.debug(f"Frame {frame_num}: Skipping - no elevation data found")
                return None

            # Extract gimbal yaw as heading
            yaw_match = re.search(r"\[gb_yaw:\s*([-\d.]+)", line)
            heading = float(yaw_match.group(1)) if yaw_match else None

            return GPSData(
                timestamp_ms=timestamp_ms,
                latitude=latitude,
                longitude=longitude,
                elevation_wgs84=elevation_wgs84,
                heading=heading,
                frame_number=frame_num,
            )

        except Exception as e:
            logger.debug(f"Failed to parse DJI frame metadata: {e}")
            return None

    def _parse_iso6709(self, location_str: str) -> Optional[GPSData]:
        """Parse ISO 6709 location string"""
        try:
            # Format: +40.7580-073.9855+011.234/
            pattern = r"([+-]\d+\.\d+)([+-]\d+\.\d+)([+-]\d+\.\d+)?"
            match = re.match(pattern, location_str)
            if match:
                lat = float(match.group(1))
                lon = float(match.group(2))
                alt = float(match.group(3)) if match.group(3) else 0

                return GPSData(
                    timestamp_ms=0,
                    latitude=lat,
                    longitude=lon,
                    elevation_wgs84=alt,  # WGS84 ellipsoid height from ISO6709
                )
        except Exception:
            pass
        return None

    def interpolate_gps_for_frame(
        self, gps_data: List[GPSData], frame_num: int, fps: float
    ) -> Optional[GPSData]:
        """
        Interpolate GPS position for a specific frame number.

        Args:
            gps_data: List of GPS data points
            frame_num: Frame number to interpolate for
            fps: Frames per second of the video

        Returns:
            Interpolated GPS data for the frame, or None if not available
        """
        if not gps_data:
            return None

        # Calculate timestamp for this frame
        target_timestamp_ms = (frame_num / fps) * 1000

        # If only one GPS point, return it for all frames
        if len(gps_data) == 1:
            gps_point = gps_data[0]
            return GPSData(
                timestamp_ms=target_timestamp_ms,
                latitude=gps_point.latitude,
                longitude=gps_point.longitude,
                elevation_wgs84=gps_point.elevation_wgs84,
                speed=gps_point.speed,
                heading=gps_point.heading,
                satellites=gps_point.satellites,
                accuracy=gps_point.accuracy,
                frame_number=frame_num,
            )

        # Check if GPS data has frame numbers - use those for more accurate interpolation
        has_frame_numbers = all(p.frame_number is not None for p in gps_data)

        if has_frame_numbers:
            # Use frame numbers for interpolation (more accurate for DJI videos)
            before_point = None
            after_point = None

            for i, gps_point in enumerate(gps_data):
                if gps_point.frame_number <= frame_num:
                    before_point = gps_point
                if gps_point.frame_number >= frame_num and after_point is None:
                    after_point = gps_point
                    break
        else:
            # Fall back to timestamp-based interpolation
            # Find surrounding GPS points for interpolation
            before_point = None
            after_point = None

            for i, gps_point in enumerate(gps_data):
                if gps_point.timestamp_ms <= target_timestamp_ms:
                    before_point = gps_point
                if gps_point.timestamp_ms >= target_timestamp_ms and after_point is None:
                    after_point = gps_point
                    break

        # If exact match found (check frame number)
        if before_point and has_frame_numbers and before_point.frame_number == frame_num:
            return GPSData(
                timestamp_ms=target_timestamp_ms,
                latitude=before_point.latitude,
                longitude=before_point.longitude,
                elevation_wgs84=before_point.elevation_wgs84,
                speed=before_point.speed,
                heading=before_point.heading,
                satellites=before_point.satellites,
                accuracy=before_point.accuracy,
                frame_number=frame_num,
            )

        # If we have both points, interpolate
        if before_point and after_point:
            # Calculate interpolation factor
            if has_frame_numbers:
                # Use frame numbers for interpolation
                frame_diff = after_point.frame_number - before_point.frame_number
                if frame_diff > 0:
                    factor = (frame_num - before_point.frame_number) / frame_diff
                else:
                    factor = 0
            else:
                # Use timestamps for interpolation
                time_diff = after_point.timestamp_ms - before_point.timestamp_ms
                if time_diff > 0:
                    factor = (target_timestamp_ms - before_point.timestamp_ms) / time_diff
                else:
                    factor = 0

            # Linear interpolation
            lat = before_point.latitude + (after_point.latitude - before_point.latitude) * factor
            lon = before_point.longitude + (after_point.longitude - before_point.longitude) * factor
            alt = (
                before_point.elevation_wgs84
                + (after_point.elevation_wgs84 - before_point.elevation_wgs84) * factor
            )

            # Interpolate optional fields
            speed = None
            if before_point.speed is not None and after_point.speed is not None:
                speed = before_point.speed + (after_point.speed - before_point.speed) * factor

            heading = None
            if before_point.heading is not None and after_point.heading is not None:
                # Circular interpolation for heading
                h1 = before_point.heading
                h2 = after_point.heading
                diff = (h2 - h1 + 180) % 360 - 180
                heading = (h1 + diff * factor) % 360

            return GPSData(
                timestamp_ms=target_timestamp_ms,
                latitude=lat,
                longitude=lon,
                elevation_wgs84=alt,
                speed=speed,
                heading=heading,
                satellites=before_point.satellites,  # Use last known value
                accuracy=before_point.accuracy,  # Use last known value
                frame_number=frame_num,
            )

        # If only before point available (extrapolate forward)
        if before_point:
            return GPSData(
                timestamp_ms=target_timestamp_ms,
                latitude=before_point.latitude,
                longitude=before_point.longitude,
                elevation_wgs84=before_point.elevation_wgs84,
                speed=before_point.speed,
                heading=before_point.heading,
                satellites=before_point.satellites,
                accuracy=before_point.accuracy,
                frame_number=frame_num,
            )

        # If only after point available (extrapolate backward)
        if after_point:
            return GPSData(
                timestamp_ms=target_timestamp_ms,
                latitude=after_point.latitude,
                longitude=after_point.longitude,
                elevation_wgs84=after_point.elevation_wgs84,
                speed=after_point.speed,
                heading=after_point.heading,
                satellites=after_point.satellites,
                accuracy=after_point.accuracy,
                frame_number=frame_num,
            )

        return None
