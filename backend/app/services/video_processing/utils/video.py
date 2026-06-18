"""
Video processing utilities
"""

import logging
import os
import subprocess

import cv2

from app.services.video_processing.config import settings

logger = logging.getLogger(__name__)


class FfmpegH264Writer:
    """drop-in replacement for cv2.VideoWriter that pipes raw BGR frames straight into a
    single libx264 encode, skipping the write-mp4v-then-re-encode double pass.

    mirrors the cv2.VideoWriter surface this engine uses: isOpened / write / release.
    """

    def __init__(self, output_path: str, fps: float, width: int, height: int):
        """spawn the ffmpeg encoder reading rawvideo from stdin."""
        self.output_path = output_path
        self.width = int(width)
        self.height = int(height)
        self._proc = None
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{self.width}x{self.height}",
            "-r",
            str(fps or 30),
            "-i",
            "-",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            settings.FFMPEG_PRESET,
            "-crf",
            settings.FFMPEG_CRF,
            "-pix_fmt",
            settings.FFMPEG_PIX_FMT,
            output_path,
        ]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            logger.error(f"Failed to start ffmpeg writer for {output_path}: {e}")
            self._proc = None

    def isOpened(self) -> bool:
        """true while the ffmpeg subprocess is running with a writable stdin."""
        return self._proc is not None and self._proc.stdin is not None

    def write(self, frame) -> None:
        """encode one BGR frame (resized to the writer's dims if it doesn't match)."""
        if self._proc is None or self._proc.stdin is None:
            return
        if frame.shape[0] != self.height or frame.shape[1] != self.width:
            frame = cv2.resize(frame, (self.width, self.height))
        try:
            self._proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, ValueError):
            logger.error(f"ffmpeg writer pipe closed early for {self.output_path}")
            self._proc = None

    def release(self) -> bool:
        """flush + close stdin and wait for the encode to finish."""
        if self._proc is None:
            return False
        ok = False
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
            self._proc.wait(timeout=settings.FFMPEG_TIMEOUT_SECONDS)
            ok = self._proc.returncode == 0
            if not ok:
                logger.warning(
                    f"ffmpeg writer exited {self._proc.returncode} for {self.output_path}"
                )
        except subprocess.TimeoutExpired:
            logger.error(f"ffmpeg writer timed out for {self.output_path}")
            self._proc.kill()
        finally:
            self._proc = None
        return ok


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
            "ffmpeg",
            "-y",  # Overwrite output
            "-i",
            video_path,  # Input file
            "-c:v",
            "libx264",  # Use H.264 software encoder
            "-preset",
            settings.FFMPEG_PRESET,  # Encoding speed
            "-crf",
            settings.FFMPEG_CRF,  # Quality (lower = better)
            "-pix_fmt",
            settings.FFMPEG_PIX_FMT,  # Pixel format for compatibility
            "-c:a",
            "copy",  # Copy audio if exists
            temp_path,
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=settings.FFMPEG_TIMEOUT_SECONDS,
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
