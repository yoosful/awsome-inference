#!/usr/bin/env python3
"""
Example Python client for Cosmos Video Generation API.

This script demonstrates how to:
1. Submit a video generation job
2. Poll for job completion
3. Download the generated video
"""

import argparse
import sys
import time
from pathlib import Path
from typing import Optional

import requests


class CosmosVideoClient:
    """Client for Cosmos Video Generation API."""

    def __init__(self, api_endpoint: str):
        """
        Initialize client.

        Args:
            api_endpoint: Base URL of the API (e.g., https://cosmos-api.example.com)
        """
        self.api_endpoint = api_endpoint.rstrip('/')
        self.session = requests.Session()

    def generate_video(
        self,
        prompt: str,
        num_frames: Optional[int] = None,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
    ) -> str:
        """
        Submit a video generation job.

        Args:
            prompt: Text description of the video
            num_frames: Number of frames to generate
            guidance_scale: Guidance scale for generation
            seed: Random seed for reproducibility

        Returns:
            Job ID

        Raises:
            Exception: If request fails
        """
        payload = {"prompt": prompt}

        if num_frames is not None:
            payload["num_frames"] = num_frames

        if guidance_scale is not None:
            payload["guidance_scale"] = guidance_scale

        if seed is not None:
            payload["seed"] = seed

        response = self.session.post(
            f"{self.api_endpoint}/api/v1/generate",
            json=payload,
        )

        if response.status_code != 200:
            raise Exception(f"Failed to submit job: {response.text}")

        data = response.json()
        return data["job_id"]

    def get_job_status(self, job_id: str) -> dict:
        """
        Get job status.

        Args:
            job_id: Job identifier

        Returns:
            Job status information

        Raises:
            Exception: If request fails
        """
        response = self.session.get(
            f"{self.api_endpoint}/api/v1/jobs/{job_id}",
        )

        if response.status_code != 200:
            raise Exception(f"Failed to get job status: {response.text}")

        return response.json()

    def wait_for_completion(
        self,
        job_id: str,
        timeout: int = 600,
        poll_interval: int = 10,
    ) -> dict:
        """
        Wait for job to complete.

        Args:
            job_id: Job identifier
            timeout: Maximum time to wait in seconds
            poll_interval: Time between status checks in seconds

        Returns:
            Final job status

        Raises:
            TimeoutError: If job doesn't complete within timeout
            Exception: If job fails
        """
        start_time = time.time()

        while True:
            status = self.get_job_status(job_id)

            if status["status"] == "completed":
                return status

            if status["status"] == "failed":
                error = status.get("error", "Unknown error")
                raise Exception(f"Job failed: {error}")

            elapsed = time.time() - start_time
            if elapsed > timeout:
                raise TimeoutError(f"Job did not complete within {timeout} seconds")

            print(f"Job status: {status['status']} (elapsed: {int(elapsed)}s)")
            time.sleep(poll_interval)

    def download_video(self, video_url: str, output_path: Path):
        """
        Download video from presigned URL.

        Args:
            video_url: Presigned S3 URL
            output_path: Local path to save video

        Raises:
            Exception: If download fails
        """
        response = self.session.get(video_url, stream=True)

        if response.status_code != 200:
            raise Exception(f"Failed to download video: {response.status_code}")

        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"Video saved to: {output_path}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Generate video using Cosmos NIM",
    )
    parser.add_argument(
        "--api-endpoint",
        required=True,
        help="API endpoint (e.g., https://cosmos-api.example.com)",
    )
    parser.add_argument(
        "--prompt",
        required=True,
        help="Text description of the video to generate",
    )
    parser.add_argument(
        "--num-frames",
        type=int,
        help="Number of frames to generate (default: 48)",
    )
    parser.add_argument(
        "--guidance-scale",
        type=float,
        help="Guidance scale for generation (default: 7.5)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        help="Random seed for reproducibility",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output.mp4"),
        help="Output video file path (default: output.mp4)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Maximum time to wait for completion in seconds (default: 600)",
    )

    args = parser.parse_args()

    try:
        # Create client
        client = CosmosVideoClient(args.api_endpoint)

        # Submit job
        print(f"Submitting job with prompt: {args.prompt}")
        job_id = client.generate_video(
            prompt=args.prompt,
            num_frames=args.num_frames,
            guidance_scale=args.guidance_scale,
            seed=args.seed,
        )
        print(f"Job submitted: {job_id}")

        # Wait for completion
        print("Waiting for video generation to complete...")
        result = client.wait_for_completion(job_id, timeout=args.timeout)

        # Download video
        video_url = result.get("video_url")
        if not video_url:
            raise Exception("No video URL in completed job")

        print(f"Downloading video from: {video_url}")
        client.download_video(video_url, args.output)

        print(f"\n✓ Success! Video generated and saved to: {args.output}")
        return 0

    except KeyboardInterrupt:
        print("\n✗ Interrupted by user")
        return 1
    except Exception as e:
        print(f"\n✗ Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
