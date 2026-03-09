"""Configuration management for the video generation API."""

import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Cosmos NIM endpoint
    cosmos_nim_endpoint: str = os.getenv('COSMOS_NIM_ENDPOINT', 'http://localhost:8000')

    # S3 configuration
    s3_bucket_name: str = os.getenv('S3_BUCKET_NAME', 'cosmos-videos')
    aws_region: str = os.getenv('AWS_REGION', 'us-west-2')

    # Video generation settings
    max_video_length_seconds: int = 30
    default_num_frames: int = 48
    default_fps: int = 16

    # API settings
    max_concurrent_jobs: int = 10
    job_timeout_seconds: int = 600  # 10 minutes
    presigned_url_expiration: int = 3600  # 1 hour

    class Config:
        case_sensitive = False


# Global settings instance
settings = Settings()
