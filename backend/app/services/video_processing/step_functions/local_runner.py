"""
Local runner for Step Functions - enables testing without AWS deployment.

This module simulates the Step Functions state machine locally, allowing
developers to test the video processing pipeline without deploying to AWS.
"""
import asyncio
import json
import time
from typing import Dict, Any
from decimal import Decimal

from app.core.logging import logger
from .task_handlers import StepFunctionTaskHandler


class LocalStepFunctionRunner:
    """
    Simulates Step Functions execution locally for testing.

    This runner executes the same task handlers that would run in Lambda,
    but does so synchronously in a single process. Useful for:
    - Local development and testing
    - Debugging processing issues
    - Running in environments without Step Functions (e.g., Docker)
    """

    def __init__(self, max_concurrent_chunks: int = 4):
        """
        Initialize the local runner.

        Args:
            max_concurrent_chunks: Maximum number of chunks to process in parallel.
                                   Set to 1 for sequential processing (easier debugging).
        """
        self.handler = StepFunctionTaskHandler()
        self.max_concurrent_chunks = max_concurrent_chunks

    async def run(self, session_id: str) -> Dict[str, Any]:
        """
        Run the complete video processing pipeline locally.

        This simulates the Step Functions state machine execution.

        Args:
            session_id: The measurement session ID to process

        Returns:
            Final processing result
        """
        logger.info(f"Starting local Step Functions execution for session {session_id}")
        start_time = time.time()

        try:
            # Step 1: Prepare processing
            logger.info("=" * 60)
            logger.info("STEP 1: Prepare Processing")
            logger.info("=" * 60)
            preparation = await self.handler.handle_task('prepare_processing', {
                'session_id': session_id
            })
            logger.info(f"Preparation complete: {preparation['total_frames']} frames, {len(preparation['chunks'])} chunks")

            # Step 2: Process chunks (simulated parallel execution)
            logger.info("=" * 60)
            logger.info(f"STEP 2: Process Chunks ({len(preparation['chunks'])} chunks)")
            logger.info("=" * 60)

            chunk_results = await self._process_chunks_local(
                session_id=session_id,
                chunks=preparation['chunks'],
                preparation=preparation
            )
            logger.info(f"All chunks processed: {sum(r['frames_processed'] for r in chunk_results)} total frames")

            # Step 3: Combine results
            logger.info("=" * 60)
            logger.info("STEP 3: Combine Results")
            logger.info("=" * 60)
            combination = await self.handler.handle_task('combine_results', {
                'session_id': session_id,
                'chunk_results': chunk_results,
                'preparation': preparation
            })
            logger.info(f"Combined {combination['total_measurements']} measurements")

            # Step 4: Generate videos
            logger.info("=" * 60)
            logger.info("STEP 4: Generate Videos")
            logger.info("=" * 60)
            video_generation = await self.handler.handle_task('generate_videos', {
                'session_id': session_id,
                'measurements_key': combination['measurements_key'],
                'preparation': preparation
            })
            logger.info(f"Generated videos: {list(video_generation.get('papi_videos', {}).keys())}")

            # Step 5: Finalize
            logger.info("=" * 60)
            logger.info("STEP 5: Finalize")
            logger.info("=" * 60)
            result = await self.handler.handle_task('finalize', {
                'session_id': session_id,
                'video_generation': video_generation,
                'combination': combination
            })

            elapsed = time.time() - start_time
            logger.info("=" * 60)
            logger.info(f"LOCAL EXECUTION COMPLETE")
            logger.info(f"Total time: {elapsed:.1f}s")
            logger.info(f"Status: {result['status']}")
            logger.info("=" * 60)

            return result

        except Exception as e:
            logger.error(f"Local execution error: {e}")
            import traceback
            logger.error(traceback.format_exc())

            # Handle error
            error_result = await self.handler.handle_task('handle_error', {
                'session_id': session_id,
                'error': {'Cause': str(e)}
            })
            return error_result

    async def _process_chunks_local(self, session_id: str, chunks: list,
                                    preparation: Dict) -> list:
        """
        Process chunks with limited concurrency.

        Args:
            session_id: Session ID
            chunks: List of chunk definitions
            preparation: Preparation data including video path, GPS cache, etc.

        Returns:
            List of chunk results
        """
        if self.max_concurrent_chunks == 1:
            # Sequential processing for easier debugging
            logger.info("Processing chunks sequentially (max_concurrent_chunks=1)")
            results = []
            for chunk in chunks:
                result = await self._process_single_chunk(session_id, chunk, preparation)
                results.append(result)
            return results

        # Parallel processing with semaphore
        logger.info(f"Processing chunks in parallel (max_concurrent={self.max_concurrent_chunks})")
        semaphore = asyncio.Semaphore(self.max_concurrent_chunks)

        async def process_with_semaphore(chunk):
            async with semaphore:
                return await self._process_single_chunk(session_id, chunk, preparation)

        tasks = [process_with_semaphore(chunk) for chunk in chunks]
        results = await asyncio.gather(*tasks)
        return list(results)

    async def _process_single_chunk(self, session_id: str, chunk: Dict,
                                    preparation: Dict) -> Dict:
        """Process a single chunk."""
        return await self.handler.handle_task('process_chunk', {
            'session_id': session_id,
            'chunk': chunk,
            'video_path': preparation['video_path'],
            'gps_cache_key': preparation['gps_cache_key'],
            'light_positions': preparation['light_positions'],
            'reference_points': preparation['reference_points'],
            'runway_heading': preparation['runway_heading'],
            'fps': preparation['fps'],
            'total_frames': preparation['total_frames']
        })


async def run_local_processing(session_id: str, sequential: bool = False) -> Dict[str, Any]:
    """
    Convenience function to run processing locally.

    Args:
        session_id: The measurement session ID to process
        sequential: If True, process chunks one at a time (easier debugging)

    Returns:
        Processing result

    Usage:
        from app.services.video_processing.step_functions import run_local_processing

        # Run with parallel chunk processing
        result = await run_local_processing("session-123")

        # Run sequentially for debugging
        result = await run_local_processing("session-123", sequential=True)
    """
    runner = LocalStepFunctionRunner(max_concurrent_chunks=1 if sequential else 4)
    return await runner.run(session_id)
