"""
Step Functions task handlers for distributed video processing.

Each task handler corresponds to a state in the Step Functions state machine.
This enables processing large videos by splitting work across multiple Lambda invocations.
"""
import os
import json
import gzip
import cv2
import time
import asyncio
from typing import Dict, List, Any, Optional
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.core.logging import logger
from app.core.config import settings
from app.repositories import MeasurementSessionRepository, ReferencePointRepository
from app.services.s3_storage import S3StorageService


class StepTimer:
    """Helper class to track and log timing of operations."""

    def __init__(self, task_name: str):
        self.task_name = task_name
        self.task_start = time.time()
        self.step_start = time.time()
        self.timings = []

    def step(self, step_name: str):
        """Log completion of a step and start timing the next one."""
        elapsed = time.time() - self.step_start
        self.timings.append((step_name, elapsed))
        logger.info(f"[TIMING] {self.task_name} | {step_name}: {elapsed:.2f}s")
        self.step_start = time.time()

    def summary(self):
        """Log a summary of all step timings."""
        total = time.time() - self.task_start
        logger.info(f"[TIMING] {self.task_name} | === SUMMARY ===")
        for step_name, elapsed in self.timings:
            pct = (elapsed / total * 100) if total > 0 else 0
            logger.info(f"[TIMING] {self.task_name} |   {step_name}: {elapsed:.2f}s ({pct:.1f}%)")
        logger.info(f"[TIMING] {self.task_name} | TOTAL: {total:.2f}s")
        return total


from ..gps import GPSExtractor
from ..tracking import PAPILightTracker
from ..processor import VideoProcessor
from ..generation.measurement_collector import MeasurementCollector
from ..generation.two_pass_processor import TwoPassProcessor
from ..utils import measure_light_dimensions, extract_color_from_brightest_pixels


def convert_floats_to_decimal(obj: Any) -> Any:
    """Recursively convert all float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimal(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_floats_to_decimal(item) for item in obj)
    else:
        return obj


class StepFunctionTaskHandler:
    """Handles Step Functions tasks for distributed video processing."""

    # Maximum processing time per chunk (in seconds)
    # Lambda timeout is 15 minutes (900s), we use 10 minutes to have safety margin
    MAX_PROCESSING_TIME = 10 * 60  # 10 minutes

    def __init__(self):
        self.s3_service = S3StorageService()
        self.session_repo = MeasurementSessionRepository()

    async def handle_task(self, task_name: str, payload: Dict) -> Dict:
        """
        Route to the appropriate task handler based on task name.

        Args:
            task_name: Name of the Step Functions task
            payload: Task input payload

        Returns:
            Task output for Step Functions
        """
        handlers = {
            'prepare_processing': self._prepare_processing,
            'process_chunk': self._process_chunk,
            'combine_results': self._combine_results,
            'generate_videos': self._generate_videos,
            'generate_single_video': self._generate_single_video,
            'finalize': self._finalize,
            'handle_error': self._handle_error,
        }

        handler = handlers.get(task_name)
        if not handler:
            raise ValueError(f"Unknown Step Functions task: {task_name}")

        logger.info(f"Executing Step Functions task: {task_name}")
        return await handler(payload)

    async def _prepare_processing(self, payload: Dict) -> Dict:
        """
        Prepare video processing - download video, calculate chunks.

        This is the first step in the pipeline.
        """
        session_id = payload['session_id']
        timer = StepTimer(f"prepare_processing[{session_id[:8]}]")
        logger.info(f"Preparing processing for session {session_id}")

        # Get session data
        session = await self.session_repo.get_by_id(session_id)
        timer.step("get_session")
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Update status
        await self.session_repo.update(session_id, {
            'status': 'processing',
            'current_phase': 'preparing',
            'progress_percentage': Decimal('5')
        })

        # Download video from S3 to /tmp
        # Try both field names - original_video_s3_key is the standard, video_s3_key is fallback
        video_s3_key = session.get('original_video_s3_key') or session.get('video_s3_key')
        if not video_s3_key:
            logger.error(f"Session keys: {list(session.keys())}")
            raise ValueError("No video file associated with session")

        local_video_path = f"/tmp/{session_id}/video.mp4"
        os.makedirs(os.path.dirname(local_video_path), exist_ok=True)

        logger.info(f"Downloading video from S3: {video_s3_key}")
        self.s3_service.download_file(video_s3_key, local_video_path)
        timer.step("download_video_from_s3")

        # Get video properties
        cap = cv2.VideoCapture(local_video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {local_video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        timer.step("get_video_properties")

        logger.info(f"Video: {frame_width}x{frame_height}, {fps}fps, {total_frames} frames")

        # Get processing parameters from session
        light_positions = session.get('light_positions', {})

        # Session uses airport_icao_code and runway_code as top-level fields
        airport_icao = session.get('airport_icao_code', '')
        runway_code = session.get('runway_code', '')

        logger.info(f"Looking up runway and reference points for airport={airport_icao}, runway={runway_code}")

        # Fetch runway heading from database
        from app.repositories import RunwayRepository
        runway_repo = RunwayRepository()
        runways = await runway_repo.get_by_airport(airport_icao)
        runway = None
        for r in runways:
            if r.get('name') == runway_code:
                runway = r
                break

        if not runway:
            raise ValueError(f"Runway {runway_code} not found for airport {airport_icao}")

        runway_heading = float(runway.get('heading', 0))
        logger.info(f"Runway heading: {runway_heading}°")

        # Fetch reference points from database (PAPI light GPS coordinates)
        ref_point_repo = ReferencePointRepository()
        ref_points = await ref_point_repo.get_by_runway(airport_icao, runway_code)
        logger.info(f"Found {len(ref_points)} reference points from database")

        # Create reference points lookup (includes PAPI_A, PAPI_B, PAPI_C, PAPI_D)
        reference_points = {}
        for rp in ref_points:
            point_type = rp.get('point_type')
            elevation_wgs84 = rp.get('elevation_wgs84')
            reference_points[point_type] = {
                "latitude": float(rp.get('latitude')),
                "longitude": float(rp.get('longitude')),
                "elevation_wgs84": float(elevation_wgs84) if elevation_wgs84 is not None else 0.0,
                "elevation": float(elevation_wgs84) if elevation_wgs84 is not None else 0.0,
                "nominal_angle": float(rp.get('nominal_angle')) if rp.get('nominal_angle') is not None else None,
                "tolerance": float(rp.get('tolerance')) if rp.get('tolerance') is not None else None
            }

        # Validate required reference points
        required_points = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"]
        missing_points = [pt for pt in required_points if pt not in reference_points]
        if missing_points:
            raise ValueError(
                f"Missing required reference points: {', '.join(missing_points)}. "
                f"Please configure GPS coordinates for all PAPI lights in the database."
            )

        logger.info(f"Loaded {len(reference_points)} reference points: {list(reference_points.keys())}")
        timer.step("fetch_runway_and_reference_points")

        # Extract GPS data from video
        gps_extractor = GPSExtractor()
        real_gps_data = gps_extractor.extract_gps_data(local_video_path)
        timer.step("extract_gps_data")
        logger.info(f"Extracted {len(real_gps_data)} GPS points from video")

        # VALIDATION: Verify GPS data is adequate for PAPI angle calculations
        # Without proper GPS data, angle measurements would be incorrect
        if not real_gps_data:
            error_msg = (
                "No GPS data found in video. PAPI angle measurements require GPS coordinates "
                "and elevation data embedded in the video file. Please ensure the video was "
                "recorded with GPS enabled on the drone."
            )
            logger.error(error_msg)
            await self.session_repo.update(session_id, {
                'status': 'error',
                'error_message': error_msg,
                'current_phase': 'error'
            })
            raise ValueError(error_msg)

        # Check for per-frame GPS data (not just static location)
        has_frame_numbers = any(gp.frame_number is not None for gp in real_gps_data)
        if not has_frame_numbers and len(real_gps_data) == 1:
            error_msg = (
                "Video contains only static GPS location (no per-frame data). "
                "PAPI angle measurements require per-frame GPS coordinates with varying elevation. "
                "This usually means the video was recorded without embedded GPS metadata. "
                "DJI drones typically embed per-frame GPS data - please verify the video source."
            )
            logger.error(error_msg)
            await self.session_repo.update(session_id, {
                'status': 'error',
                'error_message': error_msg,
                'current_phase': 'error'
            })
            raise ValueError(error_msg)

        # Check for varying elevation (drone must be moving in altitude for valid measurements)
        unique_elevations = set(gp.elevation_wgs84 for gp in real_gps_data if gp.elevation_wgs84 is not None)
        if len(unique_elevations) < 2:
            error_msg = (
                f"GPS data has only {len(unique_elevations)} unique elevation value(s). "
                "PAPI angle measurements require varying drone elevation during the approach. "
                "Please ensure the video captures the full approach with changing altitude."
            )
            logger.error(error_msg)
            await self.session_repo.update(session_id, {
                'status': 'error',
                'error_message': error_msg,
                'current_phase': 'error'
            })
            raise ValueError(error_msg)

        # Log GPS data quality metrics
        min_elev = min(unique_elevations)
        max_elev = max(unique_elevations)
        logger.info(f"GPS validation passed: {len(real_gps_data)} points, "
                   f"{len(unique_elevations)} unique elevations ({min_elev:.1f}m - {max_elev:.1f}m), "
                   f"has_frame_numbers={has_frame_numbers}")

        # Save raw GPS data to S3 - chunks will interpolate on demand
        # This is much more memory efficient than pre-computing for all frames
        raw_gps_data = []
        for gps_point in real_gps_data:
            raw_gps_data.append({
                "timestamp_ms": gps_point.timestamp_ms,
                "latitude": gps_point.latitude,
                "longitude": gps_point.longitude,
                "elevation_wgs84": gps_point.elevation_wgs84,
                "speed": gps_point.speed,
                "heading": gps_point.heading,
                "frame_number": gps_point.frame_number
            })

        gps_cache_key = f"processing/{session_id}/gps_data.json"
        gps_data_json = json.dumps(raw_gps_data, default=str)
        self.s3_service.upload_content(gps_cache_key, gps_data_json.encode(), 'application/json')
        timer.step("upload_gps_to_s3")
        logger.info(f"Uploaded raw GPS data ({len(raw_gps_data)} points) to S3: {gps_cache_key}")

        # Clean up memory
        del real_gps_data
        del raw_gps_data
        import gc
        gc.collect()
        timer.step("cleanup_memory")

        logger.info(f"Prepared video with {total_frames} frames for dynamic time-based processing")

        # Update progress
        await self.session_repo.update(session_id, {
            'current_phase': 'processing_chunks',
            'progress_percentage': Decimal('10'),
            'total_frames': total_frames
        })
        timer.step("update_progress")
        timer.summary()

        return {
            'total_frames': total_frames,
            'video_path': video_s3_key,
            'gps_cache_key': gps_cache_key,
            'light_positions': light_positions,
            'reference_points': reference_points,
            'runway_heading': runway_heading,
            'fps': fps
        }

    async def _process_chunk(self, payload: Dict) -> Dict:
        """
        Process frames dynamically until timeout or completion.

        This uses time-based chunking - processes as many frames as possible
        within MAX_PROCESSING_TIME, then returns for next chunk to continue.
        """
        session_id = payload['session_id']
        chunk_id = payload.get('chunk_id', 0)
        start_frame = payload.get('start_frame', 0)
        total_frames = payload['total_frames']
        timer = StepTimer(f"process_chunk[{session_id[:8]}][chunk_{chunk_id}]")

        logger.info(f"Processing chunk {chunk_id}: starting from frame {start_frame}, total {total_frames}")

        # Download video
        video_s3_key = payload['video_path']
        local_video_path = f"/tmp/{session_id}/video.mp4"
        os.makedirs(os.path.dirname(local_video_path), exist_ok=True)

        if not os.path.exists(local_video_path):
            self.s3_service.download_file(video_s3_key, local_video_path)
        timer.step("download_video")

        # Download raw GPS data and reconstruct GPSData objects
        gps_cache_key = payload['gps_cache_key']
        gps_data_json = self.s3_service.download_content(gps_cache_key)
        raw_gps_list = json.loads(gps_data_json)

        # Import GPSData model and reconstruct objects
        from ..models import GPSData
        gps_data = []
        for item in raw_gps_list:
            # IMPORTANT: Use explicit None check (not truthiness) because 0 is a valid value
            gps_data.append(GPSData(
                timestamp_ms=float(item['timestamp_ms']) if item.get('timestamp_ms') is not None else 0,
                latitude=float(item['latitude']),
                longitude=float(item['longitude']),
                elevation_wgs84=float(item['elevation_wgs84']) if item.get('elevation_wgs84') is not None else 0,
                speed=float(item['speed']) if item.get('speed') is not None else None,
                heading=float(item['heading']) if item.get('heading') is not None else None,
                frame_number=int(item['frame_number']) if item.get('frame_number') is not None else None
            ))
        del raw_gps_list  # Free memory
        timer.step("download_and_parse_gps")

        # Get processing parameters
        light_positions = payload['light_positions']
        reference_points = payload['reference_points']
        runway_heading = payload['runway_heading']
        fps = payload['fps']

        # Create GPS extractor for interpolation
        gps_extractor = GPSExtractor()

        # Open video and seek to start frame
        cap = cv2.VideoCapture(local_video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {local_video_path}")

        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Seek to start frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        # For chunks after the first, load previous chunk's final positions
        # This ensures tracking continuity across chunk boundaries
        tracker_positions = light_positions  # Default to original positions
        if chunk_id > 0:
            prev_positions_key = f"processing/{session_id}/positions/chunk_{chunk_id - 1:04d}.json"
            try:
                prev_positions_json = self.s3_service.download_content(prev_positions_key)
                prev_positions = json.loads(prev_positions_json)
                # Convert pixel positions back to percentage for tracker initialization
                tracker_positions = {}
                for light_name, pos_data in prev_positions.items():
                    tracker_positions[light_name] = {
                        'x': (pos_data['x'] / frame_width) * 100,
                        'y': (pos_data['y'] / frame_height) * 100,
                        'size': (pos_data['size'] / frame_width) * 100
                    }
                logger.info(f"Chunk {chunk_id}: Loaded positions from previous chunk: {prev_positions}")
            except Exception as e:
                logger.warning(f"Chunk {chunk_id}: Could not load previous positions, using original: {e}")
        timer.step("load_previous_positions")

        # Initialize tracker with positions (from previous chunk or original)
        light_tracker = PAPILightTracker(tracker_positions, frame_width, frame_height)
        timer.step("initialize_tracker")

        # Process frames with time-based limit
        measurements = []
        frame_number = start_frame
        processing_start_time = time.time()
        timeout_reached = False

        while frame_number < total_frames:
            # Check if approaching timeout
            elapsed_time = time.time() - processing_start_time
            if elapsed_time >= self.MAX_PROCESSING_TIME:
                logger.info(f"Chunk {chunk_id}: Timeout reached after {elapsed_time:.1f}s at frame {frame_number}")
                timeout_reached = True
                break

            ret, frame = cap.read()
            if not ret:
                break

            # Interpolate GPS for this frame on-demand (memory efficient)
            interpolated = gps_extractor.interpolate_gps_for_frame(gps_data, frame_number, fps)
            if not interpolated:
                frame_number += 1
                continue

            drone_data = {
                "elevation_wgs84": interpolated.elevation_wgs84,
                "latitude": interpolated.latitude,
                "longitude": interpolated.longitude,
                "speed": interpolated.speed or 0.0,
                "heading": interpolated.heading or 0.0,
                "ref_points": reference_points,
                "runway_heading": runway_heading
            }

            # Track light positions (ROI-only mode - fast)
            tracked_positions = light_tracker.update_frame(frame, frame_number)

            # Measure light dimensions (single call per light - optimized)
            light_dimensions = {}
            for light_name in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
                tracked_pos = tracked_positions.get(light_name)
                if tracked_pos:
                    tracker_x, tracker_y = tracked_pos['x'], tracked_pos['y']
                    size = tracked_pos['size']
                    search_size = int(size * 1.5)

                    final_center_x, final_center_y, measured_width, measured_height = measure_light_dimensions(
                        frame, tracker_x, tracker_y, search_size, brightness_threshold=0.10
                    )

                    light_dimensions[light_name] = {
                        'center_x': final_center_x,
                        'center_y': final_center_y,
                        'width': measured_width,
                        'height': measured_height
                    }

                    # Extract RGB
                    roi_size = max(measured_width, measured_height)
                    half_roi_size = roi_size // 2
                    # Ensure integers for array slicing
                    cx, cy = int(final_center_x), int(final_center_y)
                    x1 = int(max(0, cx - half_roi_size))
                    y1 = int(max(0, cy - half_roi_size))
                    x2 = int(min(frame_width, cx + half_roi_size))
                    y2 = int(min(frame_height, cy + half_roi_size))
                    light_roi = frame[y1:y2, x1:x2]

                    if light_roi.size > 0:
                        r, g, b = extract_color_from_brightest_pixels(light_roi)
                        tracked_positions[light_name]['rgb'] = [r, g, b]

            # Compute measurements
            frame_measurements = VideoProcessor.process_frame(
                frame, tracked_positions, drone_data, reference_points
            )

            # Store measurements
            frame_data = {
                "session_id": session_id,
                "frame_number": frame_number,
                "timestamp": frame_number / fps,
                "drone_latitude": float(drone_data["latitude"]),
                "drone_longitude": float(drone_data["longitude"]),
                "drone_elevation_wgs84": drone_data["elevation_wgs84"]
            }

            for light_name in ["papi_a", "papi_b", "papi_c", "papi_d"]:
                light_key = light_name.upper().replace("_", "_")
                if light_key in frame_measurements:
                    data = frame_measurements[light_key]
                    frame_data[f"{light_name}_status"] = data["status"]
                    frame_data[f"{light_name}_rgb"] = data["rgb"]
                    frame_data[f"{light_name}_intensity"] = float(data["intensity"])
                    frame_data[f"{light_name}_angle"] = float(data["angle"]) if data["angle"] else None
                    frame_data[f"{light_name}_horizontal_angle"] = data.get("horizontal_angle")
                    frame_data[f"{light_name}_distance_ground"] = data["distance_ground"]

                    # Compute area_pixels from light dimensions (width × height)
                    if light_key in light_dimensions:
                        dims = light_dimensions[light_key]
                        area_pixels = int(dims.get('width', 0) * dims.get('height', 0))
                        frame_data[f"{light_name}_area_pixels"] = area_pixels
                    else:
                        frame_data[f"{light_name}_area_pixels"] = 0

            measurements.append(frame_data)
            frame_number += 1

            # Update progress every 1% (minimum every 10 frames for small videos)
            update_interval = max(10, total_frames // 100)
            if frame_number % update_interval == 0:
                # Progress range: 10% (prepare) to 55% (before combine at 56%)
                # Scale frame progress to 10-55% range
                frame_progress = (frame_number / total_frames)
                overall_progress = 10 + (frame_progress * 45)  # 10% + up to 45% = 55% max
                elapsed = time.time() - processing_start_time
                logger.info(f"Chunk {chunk_id}: frame {frame_number}/{total_frames} ({overall_progress:.1f}%), elapsed {elapsed:.1f}s")

                # Update DynamoDB with progress (async but don't block on it)
                asyncio.create_task(self.session_repo.update(session_id, {
                    'progress_percentage': Decimal(str(round(overall_progress, 1))),
                    'processed_frames': frame_number
                }))

        cap.release()
        timer.step(f"frame_processing_loop ({len(measurements)} frames)")

        # Save final tracked positions for next chunk to use
        # This ensures tracking continuity across chunk boundaries
        final_positions = {}
        for light_name, tracked_light in light_tracker.tracked_lights.items():
            last_x, last_y = tracked_light.get_last_position()
            last_size = tracked_light.sizes[-1] if tracked_light.sizes else 300
            final_positions[light_name] = {
                'x': last_x,
                'y': last_y,
                'size': last_size
            }

        positions_key = f"processing/{session_id}/positions/chunk_{chunk_id:04d}.json"
        positions_json = json.dumps(final_positions)
        self.s3_service.upload_content(positions_key, positions_json.encode(), 'application/json')
        timer.step("save_positions_to_s3")
        logger.info(f"Chunk {chunk_id}: Saved final positions to S3: {final_positions}")

        # Save chunk measurements to S3 with gzip compression
        measurements_key = f"processing/{session_id}/chunks/chunk_{chunk_id:04d}.json.gz"
        measurements_json = json.dumps(measurements, default=str)
        compressed_data = gzip.compress(measurements_json.encode('utf-8'))
        self.s3_service.upload_content(measurements_key, compressed_data, 'application/gzip')
        timer.step("compress_and_upload_measurements")
        logger.info(f"Chunk {chunk_id}: Saved {len(measurements_json)} bytes -> {len(compressed_data)} bytes compressed ({100-len(compressed_data)*100//len(measurements_json)}% reduction)")

        frames_processed = len(measurements)
        is_complete = frame_number >= total_frames
        next_frame = frame_number if not is_complete else total_frames

        elapsed_total = time.time() - processing_start_time
        logger.info(f"Chunk {chunk_id} finished: {frames_processed} frames processed in {elapsed_total:.1f}s, "
                   f"next_frame={next_frame}, is_complete={is_complete}")

        # Clean up memory
        del gps_data
        del measurements
        import gc
        gc.collect()
        timer.step("cleanup_memory")
        timer.summary()

        return {
            'chunk_id': chunk_id,
            'measurements_key': measurements_key,
            'frames_processed': frames_processed,
            'next_frame': next_frame,
            'is_complete': is_complete
        }

    def _download_chunk(self, session_id: str, chunk_id: int) -> Optional[List[Dict]]:
        """Download and decompress a single chunk file. Returns None if chunk doesn't exist."""
        from app.core.config import settings

        # Try gzip compressed file first (new format)
        measurements_key = f"processing/{session_id}/chunks/chunk_{chunk_id:04d}.json.gz"
        try:
            # Use S3 client directly to get raw bytes for gzip files
            response = self.s3_service.s3_client.get_object(
                Bucket=settings.S3_BUCKET,
                Key=measurements_key
            )
            compressed_data = response['Body'].read()  # bytes, not string
            decompressed = gzip.decompress(compressed_data)
            return json.loads(decompressed.decode('utf-8'))
        except Exception as e:
            logger.debug(f"Failed to download gzipped chunk {chunk_id}: {e}")

        # Fallback to uncompressed file (old format)
        measurements_key = f"processing/{session_id}/chunks/chunk_{chunk_id:04d}.json"
        try:
            measurements_json = self.s3_service.download_content(measurements_key)
            return json.loads(measurements_json)
        except Exception as e:
            logger.debug(f"Failed to download uncompressed chunk {chunk_id}: {e}")
            return None

    async def _combine_results(self, payload: Dict) -> Dict:
        """
        Combine results from all chunks by downloading in parallel.
        """
        session_id = payload['session_id']
        preparation = payload['preparation']
        final_chunk_id = payload.get('final_chunk_id', 0)
        timer = StepTimer(f"combine_results[{session_id[:8]}]")

        logger.info(f"Combining results for session {session_id}, final_chunk_id={final_chunk_id}")

        # Update status
        await self.session_repo.update(session_id, {
            'current_phase': 'combining_results',
            'progress_percentage': Decimal('56')
        })

        # First, determine how many chunks exist (we know final_chunk_id from Step Functions)
        # Add 1 because chunk_id is 0-indexed
        total_chunks = final_chunk_id + 1
        logger.info(f"Downloading {total_chunks} chunks in parallel...")

        # Download all chunks in parallel using ThreadPoolExecutor
        download_start = time.time()
        chunk_results = {}

        with ThreadPoolExecutor(max_workers=min(10, total_chunks)) as executor:
            # Submit all download tasks
            future_to_chunk = {
                executor.submit(self._download_chunk, session_id, chunk_id): chunk_id
                for chunk_id in range(total_chunks)
            }

            # Collect results as they complete
            for future in as_completed(future_to_chunk):
                chunk_id = future_to_chunk[future]
                try:
                    result = future.result()
                    if result is not None:
                        chunk_results[chunk_id] = result
                        logger.info(f"Downloaded chunk {chunk_id}: {len(result)} measurements")
                except Exception as e:
                    logger.warning(f"Failed to download chunk {chunk_id}: {e}")

        download_elapsed = time.time() - download_start
        logger.info(f"Downloaded {len(chunk_results)} chunks in {download_elapsed:.1f}s")
        timer.step(f"parallel_download_chunks ({len(chunk_results)} chunks)")

        # Update progress: 57%
        await self.session_repo.update(session_id, {'progress_percentage': Decimal('57')})

        # Combine measurements in order
        all_measurements = []
        for chunk_id in sorted(chunk_results.keys()):
            all_measurements.extend(chunk_results[chunk_id])
        timer.step(f"combine_measurements ({len(all_measurements)} total)")

        logger.info(f"Combined {len(all_measurements)} measurements from {len(chunk_results)} chunks")

        # Update progress: 58%
        await self.session_repo.update(session_id, {'progress_percentage': Decimal('58')})

        # Compute transition angles
        logger.info("Computing transition angles...")
        transition_angles_data = {}
        for light_name in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
            transition_angles = MeasurementCollector.compute_transition_angles_from_chromacity(
                all_measurements, light_name, preparation.get('reference_points')
            )
            transition_angles_data[light_name] = transition_angles
        timer.step("compute_transition_angles")

        # Update progress: 59%
        await self.session_repo.update(session_id, {'progress_percentage': Decimal('59')})

        # Inject transition angles into all frames
        for frame_data in all_measurements:
            for light_name in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
                light_key = light_name.lower()
                angles = transition_angles_data[light_name]
                frame_data[f'{light_key}_transition_angle_min'] = angles.get('transition_angle_min')
                frame_data[f'{light_key}_transition_angle_middle'] = angles.get('transition_angle_middle')
                frame_data[f'{light_key}_transition_angle_max'] = angles.get('transition_angle_max')
                frame_data[f'{light_key}_transition_angle'] = angles.get('transition_angle_middle')
        timer.step("inject_transition_angles")

        # Save combined measurements to S3
        combined_key = f"processing/{session_id}/measurements_combined.json"
        combined_json = json.dumps(all_measurements, default=str)
        self.s3_service.upload_content(combined_key, combined_json.encode(), 'application/json')
        timer.step("upload_combined_measurements")

        logger.info(f"Saved combined measurements to S3: {combined_key}")

        # Update progress: 60%
        await self.session_repo.update(session_id, {'progress_percentage': Decimal('60')})

        # Update session with transition angles (convert floats to Decimal for DynamoDB)
        await self.session_repo.update(session_id, convert_floats_to_decimal({
            'video_metadata': {
                'transition_angles': transition_angles_data
            }
        }))
        timer.step("update_session_metadata")
        timer.summary()

        return {
            'measurements_key': combined_key,
            'total_measurements': len(all_measurements)
        }

    async def _generate_videos(self, payload: Dict) -> Dict:
        """
        Generate final videos with overlays.
        """
        session_id = payload['session_id']
        measurements_key = payload['measurements_key']
        preparation = payload['preparation']

        logger.info(f"Generating videos for session {session_id}")

        # Update status
        await self.session_repo.update(session_id, {
            'current_phase': 'generating_videos',
            'progress_percentage': Decimal('70')
        })

        # Download video
        video_s3_key = preparation['video_path']
        local_video_path = f"/tmp/{session_id}/video.mp4"
        os.makedirs(os.path.dirname(local_video_path), exist_ok=True)

        if not os.path.exists(local_video_path):
            self.s3_service.download_file(video_s3_key, local_video_path)

        # Download measurements
        measurements_json = self.s3_service.download_content(measurements_key)
        measurements_data = json.loads(measurements_json)

        # Download raw GPS data and reconstruct GPSData objects
        gps_data_json = self.s3_service.download_content(preparation['gps_cache_key'])
        raw_gps_list = json.loads(gps_data_json)

        from ..models import GPSData
        real_gps_data = []
        for item in raw_gps_list:
            # IMPORTANT: Use explicit None check (not truthiness) because 0 is a valid value
            real_gps_data.append(GPSData(
                timestamp_ms=float(item['timestamp_ms']) if item.get('timestamp_ms') is not None else 0,
                latitude=float(item['latitude']),
                longitude=float(item['longitude']),
                elevation_wgs84=float(item['elevation_wgs84']) if item.get('elevation_wgs84') is not None else 0,
                speed=float(item['speed']) if item.get('speed') is not None else None,
                heading=float(item['heading']) if item.get('heading') is not None else None,
                frame_number=int(item['frame_number']) if item.get('frame_number') is not None else None
            ))
        del raw_gps_list  # Free memory

        # Build gps_cache dict for video generation - interpolate for each frame
        gps_extractor = GPSExtractor()
        fps = preparation['fps']
        total_frames = preparation['total_frames']
        reference_points = preparation['reference_points']
        runway_heading = preparation['runway_heading']

        gps_cache = {}
        for frame_num in range(total_frames):
            interpolated = gps_extractor.interpolate_gps_for_frame(real_gps_data, frame_num, fps)
            if interpolated:
                gps_cache[frame_num] = {
                    "elevation_wgs84": interpolated.elevation_wgs84,
                    "latitude": interpolated.latitude,
                    "longitude": interpolated.longitude,
                    "speed": interpolated.speed or 0.0,
                    "heading": interpolated.heading or 0.0,
                    "ref_points": reference_points,
                    "runway_heading": runway_heading
                }

        # Create output directory
        output_dir = f"/tmp/{session_id}/output"
        os.makedirs(output_dir, exist_ok=True)

        # Generate videos using TwoPassProcessor (Pass 2 only - measurements already collected)
        processor = TwoPassProcessor(output_dir)

        papi_paths, enhanced_path, all_papi_lights_path = processor.generate_videos_from_measurements(
            video_path=local_video_path,
            session_id=session_id,
            light_positions=preparation['light_positions'],
            measurements_data=measurements_data,
            real_gps_data=real_gps_data,
            reference_points=preparation['reference_points'],
            runway_heading=preparation['runway_heading'],
            fps=preparation['fps'],
            gps_cache=gps_cache
        )

        # Upload generated videos to S3
        video_keys = {}

        if enhanced_path and os.path.exists(enhanced_path):
            enhanced_key = f"measurements/{session_id}/enhanced_video.mp4"
            self.s3_service.upload_file(enhanced_path, enhanced_key, 'video/mp4')
            video_keys['enhanced_video'] = enhanced_key

        for papi_name, papi_path in papi_paths.items():
            if os.path.exists(papi_path):
                papi_key = f"measurements/{session_id}/{papi_name.lower()}_video.mp4"
                self.s3_service.upload_file(papi_path, papi_key, 'video/mp4')
                video_keys[papi_name.lower()] = papi_key

        if all_papi_lights_path and os.path.exists(all_papi_lights_path):
            all_papi_key = f"measurements/{session_id}/all_papi_lights.mp4"
            self.s3_service.upload_file(all_papi_lights_path, all_papi_key, 'video/mp4')
            video_keys['all_papi_lights'] = all_papi_key

        logger.info(f"Uploaded {len(video_keys)} videos to S3")

        return {
            'enhanced_video_key': video_keys.get('enhanced_video'),
            'papi_videos': video_keys
        }

    async def _generate_single_video(self, payload: Dict) -> Dict:
        """
        Generate a single video type (enhanced or individual PAPI).

        This enables parallel video generation across multiple Lambda invocations.
        """
        import numpy as np
        from ..generation.two_pass_processor import convert_to_h264
        from ..generation.optimized_overlays import OptimizedOverlayRenderer
        from ..tracking import PAPILightTracker
        from app.core.config import settings

        session_id = payload['session_id']
        measurements_key = payload['measurements_key']
        preparation = payload['preparation']
        video_type = payload['video_type']
        video_name = payload['video_name']
        timer = StepTimer(f"generate_video[{session_id[:8]}][{video_type}]")

        logger.info(f"Generating {video_name} video for session {session_id}")

        # Download video
        video_s3_key = preparation['video_path']
        local_video_path = f"/tmp/{session_id}/video.mp4"
        os.makedirs(os.path.dirname(local_video_path), exist_ok=True)

        if not os.path.exists(local_video_path):
            self.s3_service.download_file(video_s3_key, local_video_path)
        timer.step("download_video")

        # Download measurements (with local cache to avoid re-downloading for each video type)
        measurements_cache_path = f"/tmp/{session_id}/measurements_cache.json"
        if os.path.exists(measurements_cache_path):
            with open(measurements_cache_path, 'r') as f:
                measurements_data = json.load(f)
            timer.step("load_measurements_from_cache")
        else:
            measurements_json = self.s3_service.download_content(measurements_key)
            measurements_data = json.loads(measurements_json)
            with open(measurements_cache_path, 'w') as f:
                json.dump(measurements_data, f)
            timer.step("download_measurements")

        # Load GPS cache from local file (built once, reused for all video types)
        gps_cache_path = f"/tmp/{session_id}/gps_interpolated_cache.json"
        reference_points = preparation['reference_points']
        runway_heading = preparation['runway_heading']
        light_positions = preparation['light_positions']
        fps = preparation['fps']
        total_frames = preparation['total_frames']

        if os.path.exists(gps_cache_path):
            with open(gps_cache_path, 'r') as f:
                gps_cache = json.load(f)
            # Convert string keys back to int (JSON serialization converts int keys to strings)
            gps_cache = {int(k): v for k, v in gps_cache.items()}
            timer.step(f"load_gps_cache_from_file ({len(gps_cache)} frames)")
        else:
            # Download raw GPS data and reconstruct GPSData objects
            gps_data_json = self.s3_service.download_content(preparation['gps_cache_key'])
            raw_gps_list = json.loads(gps_data_json)

            from ..models import GPSData
            real_gps_data = []
            for item in raw_gps_list:
                # IMPORTANT: Use explicit None check (not truthiness) because 0 is a valid value
                real_gps_data.append(GPSData(
                    timestamp_ms=float(item['timestamp_ms']) if item.get('timestamp_ms') is not None else 0,
                    latitude=float(item['latitude']),
                    longitude=float(item['longitude']),
                    elevation_wgs84=float(item['elevation_wgs84']) if item.get('elevation_wgs84') is not None else 0,
                    speed=float(item['speed']) if item.get('speed') is not None else None,
                    heading=float(item['heading']) if item.get('heading') is not None else None,
                    frame_number=int(item['frame_number']) if item.get('frame_number') is not None else None
                ))
            del raw_gps_list
            timer.step("download_and_parse_gps")

            # Build gps_cache for video generation
            gps_extractor = GPSExtractor()

            gps_cache = {}
            for frame_num in range(total_frames):
                interpolated = gps_extractor.interpolate_gps_for_frame(real_gps_data, frame_num, fps)
                if interpolated:
                    gps_cache[frame_num] = {
                        "elevation_wgs84": interpolated.elevation_wgs84,
                        "latitude": interpolated.latitude,
                        "longitude": interpolated.longitude,
                        "speed": interpolated.speed or 0.0,
                        "heading": interpolated.heading or 0.0,
                        "ref_points": reference_points,
                        "runway_heading": runway_heading
                    }

            # Save GPS cache to file for subsequent video generations
            with open(gps_cache_path, 'w') as f:
                json.dump(gps_cache, f)
            timer.step(f"build_gps_cache ({len(gps_cache)} frames)")

        # Open video
        cap = cv2.VideoCapture(local_video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {local_video_path}")

        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_fps = int(cap.get(cv2.CAP_PROP_FPS)) or fps

        # Create output directory
        output_dir = f"/tmp/{session_id}/output"
        os.makedirs(output_dir, exist_ok=True)

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        output_path = None
        video_writer = None

        # Initialize tracker for tracking positions
        light_tracker = PAPILightTracker(light_positions, frame_width, frame_height)

        if video_type == 'enhanced':
            # Enhanced video with panel
            panel_height = 350
            extended_height = frame_height + panel_height
            output_path = os.path.join(output_dir, f"{session_id}_enhanced_video.mp4")
            video_writer = cv2.VideoWriter(output_path, fourcc, video_fps, (frame_width, extended_height))
            logger.info(f"Creating enhanced video: {frame_width}x{extended_height}")
        else:
            # Individual PAPI video
            papi_name = video_type.upper()  # papi_a -> PAPI_A
            output_path = os.path.join(output_dir, f"{session_id}_{papi_name}_video.mp4")
            video_writer = cv2.VideoWriter(output_path, fourcc, video_fps,
                                          (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_HEIGHT))
            logger.info(f"Creating {papi_name} video: {settings.VIDEO_GEN_PAPI_WIDTH}x{settings.VIDEO_GEN_PAPI_HEIGHT}")

        if not video_writer.isOpened():
            raise ValueError(f"Failed to create video writer: {output_path}")

        # Generate video frames
        frame_number = 0
        start_time = time.time()
        last_progress_pct = 0

        # Progress range for video generation: 60-95% (35% range for all 5 videos)
        # Each video gets ~7% of progress range
        video_type_offsets = {'enhanced': 0, 'papi_a': 7, 'papi_b': 14, 'papi_c': 21, 'papi_d': 28}
        base_offset = video_type_offsets.get(video_type, 0)

        # Update phase to show which video is being generated
        await self.session_repo.update(session_id, {
            'current_phase': f'generating_{video_type}'
        })

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            drone_data = gps_cache.get(frame_number)
            if not drone_data:
                frame_number += 1
                continue

            tracked_positions = light_tracker.update_frame(frame, frame_number)

            if video_type == 'enhanced':
                # Generate enhanced frame with overlays
                enhanced_frame = OptimizedOverlayRenderer.add_overlays_to_frame_with_tracking(
                    frame.copy(), tracked_positions, frame_number, total_frames,
                    measurements_data, None, reference_points, real_gps_data, fps
                )
                video_writer.write(enhanced_frame)
            else:
                # Generate individual PAPI frame
                papi_name = video_type.upper()
                self._write_papi_frame(
                    video_writer, frame, papi_name, tracked_positions,
                    measurements_data, frame_number, total_frames,
                    reference_points, frame_width, frame_height, settings
                )

            frame_number += 1

            # Update progress every 1% (within this video's allocated 7% range)
            current_pct = int((frame_number / total_frames) * 7)
            if current_pct > last_progress_pct:
                last_progress_pct = current_pct
                overall_progress = 60 + base_offset + current_pct
                logger.info(f"{video_name}: {frame_number}/{total_frames} frames ({overall_progress}%)")
                await self.session_repo.update(session_id, {
                    'progress_percentage': Decimal(str(overall_progress))
                })

        cap.release()
        video_writer.release()
        timer.step(f"generate_frames ({frame_number} frames)")

        # Convert to H.264
        convert_to_h264(output_path)
        timer.step("convert_to_h264")

        # Upload to S3
        if video_type == 'enhanced':
            s3_key = f"measurements/{session_id}/enhanced_video.mp4"
        else:
            s3_key = f"measurements/{session_id}/{video_type}_video.mp4"

        self.s3_service.upload_file(output_path, s3_key, 'video/mp4')
        timer.step("upload_to_s3")

        elapsed = time.time() - start_time
        logger.info(f"{video_name} complete: {frame_number} frames in {elapsed:.1f}s, uploaded to {s3_key}")

        # Cleanup
        import gc
        del gps_cache
        del measurements_data
        gc.collect()
        timer.step("cleanup")
        timer.summary()

        return {
            'video_type': video_type,
            'video_key': s3_key,
            'success': True
        }

    def _write_papi_frame(self, writer, frame, papi_name, tracked_positions,
                          measurements_data, frame_number, total_frames,
                          reference_points, frame_width, frame_height, settings):
        """Write a single PAPI frame to the video writer."""
        import numpy as np

        tracked_pos = tracked_positions.get(papi_name)
        if not tracked_pos:
            blank_frame = np.zeros((settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3), dtype=np.uint8)
            writer.write(blank_frame)
            return

        light_key = papi_name.lower()

        # Get dimensions from measurements or tracker
        if frame_number < len(measurements_data):
            measurement_data = measurements_data[frame_number]
            x = measurement_data.get(f'{light_key}_center_x', tracked_pos['x'])
            y = measurement_data.get(f'{light_key}_center_y', tracked_pos['y'])
            measured_width = measurement_data.get(f'{light_key}_width', tracked_pos['size'])
            measured_height = measurement_data.get(f'{light_key}_height', tracked_pos['size'])
        else:
            x, y = tracked_pos['x'], tracked_pos['y']
            measured_width = measured_height = tracked_pos['size']

        # Calculate ROI
        roi_size = max(int(measured_width * 1.5), int(measured_height * 1.5))
        half_roi = roi_size // 2

        # Ensure integers for array slicing
        xi, yi = int(x), int(y)
        x1 = int(max(0, xi - half_roi))
        y1 = int(max(0, yi - half_roi))
        x2 = int(min(frame_width, xi + half_roi))
        y2 = int(min(frame_height, yi + half_roi))

        light_frame = frame[y1:y2, x1:x2]

        if light_frame.size == 0:
            blank_frame = np.zeros((settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3), dtype=np.uint8)
            writer.write(blank_frame)
            return

        rgb = tracked_pos.get('rgb', [255, 255, 255])

        # Create red mask
        red_channel = light_frame[:, :, 2]
        max_red = np.max(red_channel)
        red_mask = None
        if max_red > 0:
            threshold_value = max_red * settings.COLOR_RED_THRESHOLD
            red_mask = (red_channel >= threshold_value).astype(np.uint8) * 255

        # Resize
        light_frame_resized = cv2.resize(light_frame, (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT))

        # Draw contours
        if red_mask is not None:
            red_mask_resized = cv2.resize(red_mask, (settings.VIDEO_GEN_PAPI_WIDTH, settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT), interpolation=cv2.INTER_NEAREST)
            contours, _ = cv2.findContours(red_mask_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(light_frame_resized, contours, -1,
                           (settings.VIDEO_GEN_CONTOUR_COLOR_R, settings.VIDEO_GEN_CONTOUR_COLOR_G, settings.VIDEO_GEN_CONTOUR_COLOR_B),
                           settings.VIDEO_GEN_CONTOUR_THICKNESS)

        # Create final frame with footer
        final_frame = np.zeros((settings.VIDEO_GEN_PAPI_HEIGHT, settings.VIDEO_GEN_PAPI_WIDTH, 3), dtype=np.uint8)
        final_frame[0:settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT, 0:settings.VIDEO_GEN_PAPI_WIDTH] = light_frame_resized
        final_frame[settings.VIDEO_GEN_PAPI_DISPLAY_HEIGHT:settings.VIDEO_GEN_PAPI_HEIGHT, 0:settings.VIDEO_GEN_PAPI_WIDTH] = [
            settings.VIDEO_GEN_FOOTER_COLOR_B, settings.VIDEO_GEN_FOOTER_COLOR_G, settings.VIDEO_GEN_FOOTER_COLOR_R
        ]

        # Get angle information
        nominal_angle = None
        transition_angle_min = None
        transition_angle_middle = None
        transition_angle_max = None
        current_angle = None

        if frame_number < len(measurements_data):
            measurement_data = measurements_data[frame_number]
            current_angle = measurement_data.get(f'{light_key}_angle')
            transition_angle_min = measurement_data.get(f'{light_key}_transition_angle_min')
            transition_angle_middle = measurement_data.get(f'{light_key}_transition_angle_middle')
            transition_angle_max = measurement_data.get(f'{light_key}_transition_angle_max')

        if reference_points and papi_name in reference_points:
            nominal_angle = reference_points[papi_name].get('nominal_angle')

        # Add footer text
        font = cv2.FONT_HERSHEY_SIMPLEX

        header_text = f"{papi_name}  |  Frame {frame_number + 1}/{total_frames}"
        cv2.putText(final_frame, header_text, (10, 310), font, 0.38, (50, 50, 50), 1)
        cv2.line(final_frame, (10, 315), (290, 315), (200, 200, 200), 1)

        y_base = 330
        col_width = 100

        # Nominal angle
        cv2.putText(final_frame, "Nominal", (10, y_base), font, 0.38, (100, 100, 100), 1)
        if nominal_angle is not None:
            cv2.putText(final_frame, f"{nominal_angle:.2f}", (10, y_base + 18), font, 0.55, (70, 130, 180), 2)
        else:
            cv2.putText(final_frame, "N/A", (10, y_base + 18), font, 0.5, (150, 150, 150), 1)

        # Transition angles
        cv2.putText(final_frame, "Transition", (col_width, y_base), font, 0.38, (100, 100, 100), 1)
        if transition_angle_middle is not None:
            cv2.putText(final_frame, f"S:{transition_angle_min:.2f}", (col_width, y_base + 14), font, 0.35, (218, 165, 32), 1)
            cv2.putText(final_frame, f"M:{transition_angle_middle:.2f}", (col_width, y_base + 28), font, 0.45, (218, 165, 32), 2)
            cv2.putText(final_frame, f"E:{transition_angle_max:.2f}", (col_width, y_base + 42), font, 0.35, (218, 165, 32), 1)
        else:
            cv2.putText(final_frame, "N/A", (col_width, y_base + 18), font, 0.5, (150, 150, 150), 1)

        # Current angle
        cv2.putText(final_frame, "Current", (col_width * 2, y_base), font, 0.38, (100, 100, 100), 1)
        if current_angle is not None:
            cv2.putText(final_frame, f"{current_angle:.2f}", (col_width * 2, y_base + 18), font, 0.55, (34, 139, 34), 2)
        else:
            cv2.putText(final_frame, "N/A", (col_width * 2, y_base + 18), font, 0.5, (150, 150, 150), 1)

        # Transition bar
        if transition_angle_min is not None and transition_angle_max is not None and current_angle is not None:
            bar_y = 375
            bar_x_start = 10
            bar_width = 280
            bar_height = 12

            angle_range_start = max(0, transition_angle_min - 0.5)
            angle_range_end = transition_angle_max + 0.5
            angle_range = angle_range_end - angle_range_start

            if angle_range > 0:
                def angle_to_x(angle):
                    return bar_x_start + int((angle - angle_range_start) / angle_range * bar_width)

                trans_start_x = angle_to_x(transition_angle_min)
                trans_end_x = angle_to_x(transition_angle_max)
                current_x = angle_to_x(current_angle)

                # Draw bar sections
                cv2.rectangle(final_frame, (bar_x_start, bar_y), (trans_start_x, bar_y + bar_height), (0, 0, 180), -1)
                cv2.rectangle(final_frame, (trans_start_x, bar_y), (trans_end_x, bar_y + bar_height), (128, 128, 128), -1)
                cv2.rectangle(final_frame, (trans_end_x, bar_y), (bar_x_start + bar_width, bar_y + bar_height), (240, 240, 240), -1)
                cv2.rectangle(final_frame, (bar_x_start, bar_y), (bar_x_start + bar_width, bar_y + bar_height), (100, 100, 100), 1)

                current_x = max(bar_x_start, min(bar_x_start + bar_width, current_x))
                cv2.line(final_frame, (current_x, bar_y - 2), (current_x, bar_y + bar_height + 2), (0, 255, 0), 2)
                cv2.circle(final_frame, (current_x, bar_y + bar_height // 2), 3, (0, 255, 0), -1)

        # RGB info
        info_y = 410
        txt = f"R:{rgb[0]:.0f}, G:{rgb[1]:.0f}, B:{rgb[2]:.0f}"
        cv2.putText(final_frame, txt, (10, info_y), font, 0.4, (0, 0, 200), 1)

        writer.write(final_frame)

    async def _finalize(self, payload: Dict) -> Dict:
        """
        Finalize processing - update session status, save measurements to DynamoDB.

        Also generates the combined all_papi_lights video from individual PAPI videos.
        """
        import gzip
        from ..generation.two_pass_processor import TwoPassProcessor, convert_to_h264

        session_id = payload['session_id']
        video_results = payload.get('video_results', [])  # List from parallel video generation
        combination = payload['combination']
        preparation = payload.get('preparation', {})
        timer = StepTimer(f"finalize[{session_id[:8]}]")

        logger.info(f"Finalizing session {session_id}")

        # Update progress: 95%
        await self.session_repo.update(session_id, {
            'current_phase': 'finalizing',
            'progress_percentage': Decimal('95')
        })
        logger.info(f"Video results from parallel generation: {video_results}")

        # Process video results into a dict
        video_keys = {}
        papi_video_keys = {}

        for result in video_results:
            video_type = result.get('video_type')
            video_key = result.get('video_key')
            if video_type and video_key:
                video_keys[video_type] = video_key
                if video_type.startswith('papi_'):
                    papi_video_keys[video_type.upper()] = video_key  # papi_a -> PAPI_A

        logger.info(f"Processed video keys: {video_keys}")

        # Download measurements for saving to session
        measurements_json = self.s3_service.download_content(combination['measurements_key'])
        measurements_data = json.loads(measurements_json)
        timer.step("download_measurements")

        # Get session to retrieve transition angles from video_metadata (set in _combine_results)
        session = await self.session_repo.get_by_id(session_id)
        video_metadata = session.get('video_metadata', {}) if session else {}
        transition_angles = video_metadata.get('transition_angles', {})

        # Prepare metadata for the measurements file
        metadata = {}
        if transition_angles:
            metadata['transition_angles'] = transition_angles
            logger.info(f"Including transition_angles metadata for {len(transition_angles)} lights")

        # Save measurements to S3 using proper format (gzip compressed with metadata)
        # This matches the format expected by get_frame_measurements()
        from app.core.config import settings
        final_measurements_key = f"{settings.S3_FRAMES_PREFIX}/{session_id}/{settings.S3_FRAMES_FILENAME}"

        # Create JSON structure with frames and metadata
        json_data = {
            "frames": measurements_data,
            "metadata": metadata
        }
        json_str = json.dumps(json_data, default=str)
        compressed_data = gzip.compress(json_str.encode('utf-8'))

        # Upload to S3
        self.s3_service.s3_client.put_object(
            Bucket=settings.S3_BUCKET,
            Key=final_measurements_key,
            Body=compressed_data,
            ContentType='application/json',
            ContentEncoding='gzip',
            ServerSideEncryption=settings.S3_ENCRYPTION_TYPE
        )
        logger.info(f"Uploaded {len(measurements_data)} frame measurements with metadata to S3: {final_measurements_key}")
        timer.step("upload_measurements_to_s3")

        # Update progress: 97%
        await self.session_repo.update(session_id, {'progress_percentage': Decimal('97')})

        # Generate combined all_papi_lights video from individual PAPI videos
        all_papi_lights_key = None
        if len(papi_video_keys) == 4:  # All 4 PAPI videos exist
            logger.info("Generating combined all_papi_lights video...")
            try:
                # Download individual PAPI videos
                output_dir = f"/tmp/{session_id}/combine"
                os.makedirs(output_dir, exist_ok=True)

                papi_paths = {}
                for papi_name, s3_key in papi_video_keys.items():
                    local_path = os.path.join(output_dir, f"{papi_name}.mp4")
                    self.s3_service.download_file(s3_key, local_path)
                    papi_paths[papi_name] = local_path

                # Get video fps from one of the videos
                cap = cv2.VideoCapture(list(papi_paths.values())[0])
                video_fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
                cap.release()

                # Create combined video
                processor = TwoPassProcessor(output_dir)
                combined_path = os.path.join(output_dir, f"{session_id}_all_papi_lights.mp4")
                all_papi_lights_path = processor.create_combined_papi_video(papi_paths, combined_path, video_fps)

                if all_papi_lights_path and os.path.exists(all_papi_lights_path):
                    convert_to_h264(all_papi_lights_path)
                    all_papi_lights_key = f"measurements/{session_id}/all_papi_lights.mp4"
                    self.s3_service.upload_file(all_papi_lights_path, all_papi_lights_key, 'video/mp4')
                    logger.info(f"Uploaded all_papi_lights video: {all_papi_lights_key}")
                    timer.step("create_combined_papi_video")
            except Exception as e:
                logger.error(f"Failed to create all_papi_lights video: {e}")

        # Update session with results
        update_data = {
            'status': 'completed',
            'current_phase': 'completed',
            'progress_percentage': Decimal('100'),
            'processed_frames': len(measurements_data),
            'frame_measurements_s3_key': final_measurements_key,
        }

        # Add enhanced video key
        if 'enhanced' in video_keys:
            update_data['enhanced_video_s3_key'] = video_keys['enhanced']

        # Add individual PAPI video keys
        for papi_name in ['papi_a', 'papi_b', 'papi_c', 'papi_d']:
            if papi_name in video_keys:
                update_data[f'{papi_name}_video_s3_key'] = video_keys[papi_name]

        # Add all_papi_lights video key
        if all_papi_lights_key:
            update_data['all_papi_lights_video_s3_key'] = all_papi_lights_key

        await self.session_repo.update(session_id, update_data)
        timer.step("update_session_status")

        # Cleanup temporary files
        import shutil
        temp_dir = f"/tmp/{session_id}"
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        # Cleanup processing chunks from S3
        self.s3_service.delete_prefix(f"processing/{session_id}/")
        timer.step("cleanup_temp_files_and_s3")
        timer.summary()

        logger.info(f"Session {session_id} finalized successfully")

        return {'status': 'completed'}

    async def _handle_error(self, payload: Dict) -> Dict:
        """
        Handle errors from the pipeline.
        """
        session_id = payload['session_id']
        error = payload.get('error', {})

        error_message = str(error.get('Cause', error.get('Error', 'Unknown error')))
        logger.error(f"Processing error for session {session_id}: {error_message}")

        await self.session_repo.update(session_id, {
            'status': 'error',
            'error_message': error_message,
            'current_phase': 'error'
        })

        # Cleanup temporary files
        import shutil
        temp_dir = f"/tmp/{session_id}"
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        return {'status': 'error', 'message': error_message}
