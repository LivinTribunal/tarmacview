"""
Video metadata extraction functions
"""

import logging
import os
import subprocess
from datetime import datetime
from typing import Dict, Optional

import cv2

logger = logging.getLogger(__name__)


def extract_recording_date(video_path: str) -> Optional[datetime]:
    """Extract recording date from video metadata"""
    try:
        # Try exiftool first (most reliable for DJI videos)
        try:
            cmd = ["exiftool", "-CreateDate", "-s", "-s", "-s", video_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip():
                date_str = result.stdout.strip()
                # Parse exiftool date format: "YYYY:MM:DD HH:MM:SS"
                return datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
        except (
            subprocess.TimeoutExpired,
            subprocess.SubprocessError,
            ValueError,
            FileNotFoundError,
        ):
            pass

        # Try ffprobe as fallback
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                import json

                data = json.loads(result.stdout)
                if "format" in data and "tags" in data["format"]:
                    tags = data["format"]["tags"]
                    # Try different date tag names
                    for tag_name in ["creation_time", "date", "com.apple.quicktime.creationdate"]:
                        if tag_name in tags:
                            date_str = tags[tag_name]
                            # Parse ISO format: "2024-01-15T14:30:45.000000Z"
                            try:
                                return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                            except ValueError:
                                pass
        except (
            subprocess.TimeoutExpired,
            subprocess.SubprocessError,
            ValueError,
            FileNotFoundError,
        ):
            pass

        # Fallback to file creation time
        file_stat = os.stat(video_path)
        return datetime.fromtimestamp(file_stat.st_ctime)

    except Exception as e:
        logger.warning(f"Could not extract recording date: {e}")
        return None


def extract_first_frame(video_path: str, output_path: str) -> Dict:
    """Extract first frame from video and get metadata"""
    try:
        cap = cv2.VideoCapture(video_path)
        ret, frame = cap.read()

        if ret:
            cv2.imwrite(output_path, frame)

            # Extract metadata
            metadata = {
                "frame_width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                "frame_height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                "fps": cap.get(cv2.CAP_PROP_FPS),
                "total_frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            }

            cap.release()
            return metadata

        cap.release()
        return {}

    except Exception as e:
        logger.error(f"Error extracting first frame: {e}")
        return {}
