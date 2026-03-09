"""FastAPI server for Cosmos video generation API."""

import logging
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from job_manager import job_manager, JobStatus
from config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)


# Request/Response models
class GenerateVideoRequest(BaseModel):
    """Request model for video generation."""
    prompt: str = Field(..., description="Text description of the video to generate", min_length=1, max_length=1000)
    num_frames: Optional[int] = Field(None, description="Number of frames to generate (default: 48)", ge=1, le=121)
    guidance_scale: Optional[float] = Field(None, description="Guidance scale for generation (default: 7.5)", ge=1.0, le=20.0)
    seed: Optional[int] = Field(None, description="Random seed for reproducibility")


class GenerateVideoResponse(BaseModel):
    """Response model for video generation request."""
    job_id: str
    status: str
    message: str


class JobStatusResponse(BaseModel):
    """Response model for job status."""
    job_id: str
    status: str
    prompt: str
    num_frames: int
    guidance_scale: Optional[float]
    seed: Optional[int]
    created_at: str
    updated_at: str
    video_url: Optional[str]
    error: Optional[str]


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    cosmos_nim_status: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events."""
    # Startup
    logger.info("Starting Cosmos Video Generation API")
    job_manager.start_cleanup_task()
    yield
    # Shutdown
    logger.info("Shutting down Cosmos Video Generation API")


# Create FastAPI app
app = FastAPI(
    title="Cosmos Video Generation API",
    description="API for generating videos from text using NVIDIA Cosmos NIM",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "Cosmos Video Generation API",
        "version": "1.0.0",
        "endpoints": {
            "generate": "POST /api/v1/generate",
            "job_status": "GET /api/v1/jobs/{job_id}",
            "health": "GET /health",
        },
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    cosmos_nim_healthy = await job_manager.cosmos_client.health_check()

    return HealthResponse(
        status="healthy" if cosmos_nim_healthy else "degraded",
        cosmos_nim_status="ready" if cosmos_nim_healthy else "not_ready",
    )


@app.post("/api/v1/generate", response_model=GenerateVideoResponse)
async def generate_video(request: GenerateVideoRequest):
    """
    Submit a video generation job.

    Args:
        request: Video generation request

    Returns:
        Job information including job ID
    """
    try:
        # Validate and set defaults
        num_frames = request.num_frames or settings.default_num_frames

        # Create job
        job_id = job_manager.create_job(
            prompt=request.prompt,
            num_frames=num_frames,
            guidance_scale=request.guidance_scale,
            seed=request.seed,
        )

        logger.info(f"Created job {job_id} for prompt: {request.prompt[:50]}...")

        return GenerateVideoResponse(
            job_id=job_id,
            status=JobStatus.PENDING.value,
            message="Video generation job submitted successfully",
        )

    except Exception as e:
        logger.error(f"Error creating job: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """
    Get the status of a video generation job.

    Args:
        job_id: Job identifier

    Returns:
        Job status information
    """
    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return JobStatusResponse(**job.to_dict())


@app.get("/api/v1/jobs")
async def list_jobs():
    """
    List all jobs.

    Returns:
        List of all jobs
    """
    jobs = job_manager.get_all_jobs()
    return {
        "total": len(jobs),
        "jobs": [job.to_dict() for job in jobs],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
