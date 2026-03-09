"""Client for interacting with Cosmos NIM."""

import logging
from typing import Optional
import httpx
from config import settings

logger = logging.getLogger(__name__)


class CosmosClient:
    """Client for Cosmos NIM text-to-video generation."""

    def __init__(self):
        """Initialize Cosmos NIM client."""
        self.endpoint = settings.cosmos_nim_endpoint
        self.timeout = settings.job_timeout_seconds

    async def generate_video(
        self,
        prompt: str,
        num_frames: Optional[int] = None,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
    ) -> bytes:
        """
        Generate video from text prompt using Cosmos NIM.

        Args:
            prompt: Text description of the video to generate
            num_frames: Number of frames to generate (default: 48)
            guidance_scale: Guidance scale for generation (default: 7.5)
            seed: Random seed for reproducibility

        Returns:
            Video content as bytes

        Raises:
            Exception: If video generation fails
        """
        # Prepare request payload
        payload = {
            "prompt": prompt,
            "num_frames": num_frames or settings.default_num_frames,
        }

        if guidance_scale is not None:
            payload["guidance_scale"] = guidance_scale

        if seed is not None:
            payload["seed"] = seed

        logger.info(f"Sending generation request to Cosmos NIM: {payload}")

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Call Cosmos NIM generate endpoint
                response = await client.post(
                    f"{self.endpoint}/v1/generate",
                    json=payload,
                )

                if response.status_code != 200:
                    error_msg = f"Cosmos NIM returned status {response.status_code}: {response.text}"
                    logger.error(error_msg)
                    raise Exception(error_msg)

                # Return video bytes
                video_bytes = response.content
                logger.info(f"Successfully generated video: {len(video_bytes)} bytes")
                return video_bytes

        except httpx.TimeoutException as e:
            logger.error(f"Timeout while calling Cosmos NIM: {e}")
            raise Exception("Video generation timed out")
        except httpx.RequestError as e:
            logger.error(f"Error calling Cosmos NIM: {e}")
            raise Exception(f"Failed to connect to Cosmos NIM: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error during video generation: {e}")
            raise

    async def health_check(self) -> bool:
        """
        Check if Cosmos NIM is healthy and ready.

        Returns:
            True if healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.endpoint}/v1/health/ready")
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Health check failed: {e}")
            return False
