"""
Video processing utilities
"""
import os
import subprocess
from app.core.logging import logger
from app.core.config import settings



def convert_to_h264(video_path: str) -> bool:
    """
    Convert video to H.264 using ffmpeg software encoder.
    This works reliably in Docker containers without hardware encoding.

    Args:
        video_path: Path to the video file to convert

    Returns:
        True if conversion successful, False otherwise
    """
    try:
        temp_path = video_path + ".temp.mp4"

        # Use ffmpeg with libx264 software encoder
        cmd = [
            'ffmpeg', '-y',  # Overwrite output
            '-i', video_path,  # Input file
            '-c:v', 'libx264',  # Use H.264 software encoder
            '-preset', settings.FFMPEG_PRESET,  # Encoding speed
            '-crf', settings.FFMPEG_CRF,  # Quality (lower = better)
            '-pix_fmt', settings.FFMPEG_PIX_FMT,  # Pixel format for compatibility
            '-c:a', 'copy',  # Copy audio if exists
            temp_path
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=settings.FFMPEG_TIMEOUT_SECONDS
        )

        if result.returncode == 0 and os.path.exists(temp_path):
            # Replace original with H.264 version
            os.replace(temp_path, video_path)
            logger.info(f"✓ Converted video to H.264: {video_path}")
            return True
        else:
            logger.warning(f"ffmpeg conversion failed: {result.stderr.decode()}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"ffmpeg conversion timed out for {video_path}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return False
    except Exception as e:
        logger.error(f"Error converting video to H.264: {e}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return False
