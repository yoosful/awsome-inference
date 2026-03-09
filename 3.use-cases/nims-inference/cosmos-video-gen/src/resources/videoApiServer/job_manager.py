"""Job management for video generation tasks."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional
from enum import Enum
import uuid

from cosmos_client import CosmosClient
from s3_storage import S3Storage

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    """Job status enumeration."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobInfo:
    """Information about a video generation job."""

    def __init__(
        self,
        job_id: str,
        prompt: str,
        num_frames: int,
        guidance_scale: Optional[float],
        seed: Optional[int],
    ):
        """Initialize job info."""
        self.job_id = job_id
        self.prompt = prompt
        self.num_frames = num_frames
        self.guidance_scale = guidance_scale
        self.seed = seed
        self.status = JobStatus.PENDING
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
        self.video_url: Optional[str] = None
        self.s3_key: Optional[str] = None
        self.error: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary representation."""
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "prompt": self.prompt,
            "num_frames": self.num_frames,
            "guidance_scale": self.guidance_scale,
            "seed": self.seed,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "video_url": self.video_url,
            "error": self.error,
        }


class JobManager:
    """Manage video generation jobs."""

    def __init__(self):
        """Initialize job manager."""
        self.jobs: Dict[str, JobInfo] = {}
        self.cosmos_client = CosmosClient()
        self.s3_storage = S3Storage()
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_cleanup_task(self):
        """Start background task to cleanup old jobs."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_old_jobs())

    async def _cleanup_old_jobs(self):
        """Periodically cleanup jobs older than 24 hours."""
        while True:
            try:
                await asyncio.sleep(3600)  # Run every hour
                cutoff_time = datetime.utcnow() - timedelta(hours=24)

                jobs_to_remove = [
                    job_id
                    for job_id, job in self.jobs.items()
                    if job.created_at < cutoff_time
                ]

                for job_id in jobs_to_remove:
                    logger.info(f"Cleaning up old job: {job_id}")
                    del self.jobs[job_id]

                if jobs_to_remove:
                    logger.info(f"Cleaned up {len(jobs_to_remove)} old jobs")

            except Exception as e:
                logger.error(f"Error during cleanup: {e}")

    def create_job(
        self,
        prompt: str,
        num_frames: int,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
    ) -> str:
        """
        Create a new video generation job.

        Args:
            prompt: Text prompt for video generation
            num_frames: Number of frames to generate
            guidance_scale: Guidance scale for generation
            seed: Random seed

        Returns:
            Job ID
        """
        job_id = str(uuid.uuid4())
        job = JobInfo(job_id, prompt, num_frames, guidance_scale, seed)
        self.jobs[job_id] = job

        # Start processing in background
        asyncio.create_task(self._process_job(job_id))

        logger.info(f"Created job {job_id} for prompt: {prompt[:50]}...")
        return job_id

    async def _process_job(self, job_id: str):
        """
        Process a video generation job.

        Args:
            job_id: Job identifier
        """
        job = self.jobs.get(job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        try:
            # Update status to processing
            job.status = JobStatus.PROCESSING
            job.updated_at = datetime.utcnow()
            logger.info(f"Starting processing for job {job_id}")

            # Generate video using Cosmos NIM
            video_bytes = await self.cosmos_client.generate_video(
                prompt=job.prompt,
                num_frames=job.num_frames,
                guidance_scale=job.guidance_scale,
                seed=job.seed,
            )

            # Upload to S3
            s3_key = self.s3_storage.upload_video(job_id, video_bytes)
            job.s3_key = s3_key

            # Generate presigned URL
            video_url = self.s3_storage.generate_presigned_url(s3_key)
            job.video_url = video_url

            # Update status to completed
            job.status = JobStatus.COMPLETED
            job.updated_at = datetime.utcnow()
            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.updated_at = datetime.utcnow()

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        """
        Get job information.

        Args:
            job_id: Job identifier

        Returns:
            Job info or None if not found
        """
        return self.jobs.get(job_id)

    def get_all_jobs(self) -> list[JobInfo]:
        """Get all jobs."""
        return list(self.jobs.values())


# Global job manager instance
job_manager = JobManager()
