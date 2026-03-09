"""S3 storage operations for video files."""

import logging
from typing import Optional
import boto3
from botocore.exceptions import ClientError
from config import settings

logger = logging.getLogger(__name__)


class S3Storage:
    """Handle S3 operations for video storage."""

    def __init__(self):
        """Initialize S3 client."""
        self.s3_client = boto3.client('s3', region_name=settings.aws_region)
        self.bucket_name = settings.s3_bucket_name

    def upload_video(self, job_id: str, video_bytes: bytes) -> str:
        """
        Upload video to S3.

        Args:
            job_id: Unique job identifier
            video_bytes: Video file content as bytes

        Returns:
            S3 key of the uploaded video

        Raises:
            Exception: If upload fails
        """
        key = f"videos/{job_id}.mp4"

        try:
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=video_bytes,
                ContentType='video/mp4',
            )
            logger.info(f"Successfully uploaded video to s3://{self.bucket_name}/{key}")
            return key
        except ClientError as e:
            logger.error(f"Failed to upload video to S3: {e}")
            raise Exception(f"Failed to upload video: {str(e)}")

    def generate_presigned_url(self, s3_key: str) -> Optional[str]:
        """
        Generate presigned URL for video access.

        Args:
            s3_key: S3 key of the video

        Returns:
            Presigned URL or None if generation fails
        """
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key,
                },
                ExpiresIn=settings.presigned_url_expiration,
            )
            logger.info(f"Generated presigned URL for {s3_key}")
            return url
        except ClientError as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return None

    def delete_video(self, s3_key: str) -> bool:
        """
        Delete video from S3.

        Args:
            s3_key: S3 key of the video

        Returns:
            True if deletion successful, False otherwise
        """
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=s3_key,
            )
            logger.info(f"Deleted video from S3: {s3_key}")
            return True
        except ClientError as e:
            logger.error(f"Failed to delete video from S3: {e}")
            return False
