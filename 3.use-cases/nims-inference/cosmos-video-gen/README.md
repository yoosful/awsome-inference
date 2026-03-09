# Cosmos NIM Text-to-Video Generation on AWS

This project deploys **NVIDIA Cosmos Predict1 7B Text2World NIM** on AWS to generate videos from text descriptions using AWS CDK.

## Overview

This example includes:

- **Infrastructure**: AWS CDK deployment with EC2 (G5.12xlarge), ECS Fargate, ALB, S3, Route53
- **NIM Container**: Cosmos Predict1 7B Text2World running on 4x A10G GPUs
- **API Server**: FastAPI-based REST API for async job management
- **Storage**: S3 for generated video storage with lifecycle policies and presigned URLs
- **Examples**: Python client, bash script, and web demo

## Architecture

```
User/Browser → ALB (HTTPS) → ECS Fargate (FastAPI) → Internal ALB (HTTPS) → EC2 (Cosmos NIM)
                                         ↓
                                    S3 (Videos)
```

**Components**:

- **VPC**: 3 public subnets across availability zones
- **EC2 Instance**: G5.12xlarge (4x NVIDIA A10G GPUs, 48 vCPUs, 192GB RAM) running Cosmos NIM in Docker
- **ALB #1**: Routes HTTPS traffic to Cosmos NIM (port 8000)
- **ECS Fargate**: Runs FastAPI server for job management and video storage
- **ALB #2**: Routes HTTPS traffic to API server
- **S3 Bucket**: Stores generated videos with automatic deletion after 7 days
- **Route53**: DNS records for both API and NIM endpoints
- **ACM**: SSL/TLS certificates for secure HTTPS communication

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI configured with credentials
- EC2 G5 instance quota (at least 1x G5.12xlarge)
- Route53 hosted zone with a domain name
- NVIDIA NGC account and API key (get from [NGC](https://ngc.nvidia.com/))
- Node.js 18 or later
- Yarn package manager

## Installation

### 1. Clone and Navigate

```bash
cd 3.use-cases/nims-inference/cosmos-video-gen
```

### 2. Install Dependencies

```bash
# Install and build the project
yarn install
yarn build
```

### 3. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

Required environment variables:

```bash
# Domain Configuration
DOMAIN_NAME=example.com              # Your Route53 hosted zone domain
API_HOST_NAME=cosmos-api              # Subdomain for API server
NIM_HOST_NAME=cosmos-nim              # Subdomain for NIM endpoint

# NGC Configuration
NGC_API_KEY=nvapi-xxxxx               # Your NGC API key

# AWS Configuration
AWS_REGION=us-west-2                  # AWS region for deployment

# Instance Configuration (optional)
INSTANCE_TYPE=g5.12xlarge             # EC2 instance type

# Cosmos NIM Configuration (optional)
COSMOS_CONTAINER=nvcr.io/nim/nvidia/cosmos-predict1-7b-text2world
COSMOS_TAG=latest

# Video Storage (optional)
VIDEO_RETENTION_DAYS=7                # Days to keep videos in S3
```

### 4. Upload Secrets to AWS

```bash
yarn upload-secrets
```

This uploads your NGC API key to AWS Secrets Manager.

## Deployment

### Deploy the Stack

```bash
yarn cdk deploy --require-approval never
```

**Deployment Time**: ~40-50 minutes (includes ~25-35 minutes for NIM model download and initialization)

Monitor progress in CloudFormation Console or SSH into the instance:

```bash
# SSH and check logs
aws ssm start-session --target <instance-id>
sudo tail -f /var/log/user-data.log
sudo docker logs -f cosmos-predict1-text2world
```

Verify deployment:

```bash
# Get endpoints from CloudFormation outputs
export API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name CosmosVideoGenStack --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)
export NIM_ENDPOINT=$(aws cloudformation describe-stacks --stack-name CosmosVideoGenStack --query "Stacks[0].Outputs[?OutputKey=='NimEndpoint'].OutputValue" --output text)

# Check health
curl $NIM_ENDPOINT/v1/health/ready
curl $API_ENDPOINT/health
```

## Usage

### Python Client

The Python client provides a complete example:

```bash
cd examples

python generate_video.py \
  --api-endpoint https://cosmos-api.example.com \
  --prompt "A sunset over mountains with birds flying across the sky" \
  --output sunset.mp4
```

Options:
- `--api-endpoint`: Your API endpoint URL (required)
- `--prompt`: Text description of the video (required)
- `--num-frames`: Number of frames to generate (default: 48)
- `--guidance-scale`: Guidance scale (default: 7.5, range: 1.0-20.0)
- `--seed`: Random seed for reproducibility
- `--output`: Output video file path (default: output.mp4)
- `--timeout`: Maximum wait time in seconds (default: 600)

### Bash Script

```bash
cd examples

export API_ENDPOINT=https://cosmos-api.example.com
./generate_video.sh "A sunset over mountains" sunset.mp4
```

### Web Demo

Open `examples/web_demo.html` in your web browser:

1. Enter your API endpoint
2. Write a text prompt
3. Optionally adjust parameters (frames, guidance scale, seed)
4. Click "Generate Video"
5. Wait for completion and watch the video

### Direct API Usage

#### Submit a Job

```bash
curl -X POST https://cosmos-api.example.com/api/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A sunset over mountains",
    "num_frames": 48,
    "guidance_scale": 7.5
  }'
```

Response:
```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending",
  "message": "Video generation job submitted successfully"
}
```

#### Check Job Status

```bash
curl https://cosmos-api.example.com/api/v1/jobs/{job_id}
```

Response:
```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "completed",
  "prompt": "A sunset over mountains",
  "num_frames": 48,
  "guidance_scale": 7.5,
  "seed": null,
  "created_at": "2024-03-09T12:00:00",
  "updated_at": "2024-03-09T12:02:30",
  "video_url": "https://...",
  "error": null
}
```

Status values:
- `pending`: Job queued, not yet started
- `processing`: Video generation in progress
- `completed`: Video generated successfully, URL available
- `failed`: Generation failed, error message available

#### Download Video

Use the `video_url` from the completed job response:

```bash
curl -o video.mp4 "{video_url}"
```

## API Reference

### POST /api/v1/generate

Submit a video generation job.

**Request Body**:
```json
{
  "prompt": "string (required, 1-1000 chars)",
  "num_frames": "integer (optional, 1-121, default: 48)",
  "guidance_scale": "float (optional, 1.0-20.0, default: 7.5)",
  "seed": "integer (optional)"
}
```

**Response**: `GenerateVideoResponse`

### GET /api/v1/jobs/{job_id}

Get job status and results.

**Response**: `JobStatusResponse`

### GET /api/v1/jobs

List all jobs (for debugging).

**Response**: Array of `JobStatusResponse`

### GET /health

Health check endpoint.

**Response**:
```json
{
  "status": "healthy|degraded",
  "cosmos_nim_status": "ready|not_ready"
}
```

## Cost Estimation

### Compute Costs (us-west-2)

- **EC2 G5.12xlarge**: ~$5.67/hour (on-demand)
- **ECS Fargate**: ~$0.15/hour (2 vCPU, 4GB RAM)
- **Application Load Balancers (2)**: ~$0.05/hour each + LCU charges
- **Data Transfer**: $0.09/GB (outbound)

### Storage Costs

- **S3 Storage**: ~$0.023/GB-month
- **Lifecycle Policy**: Automatic deletion after 7 days reduces long-term costs

### Total Estimated Cost

- **Active usage**: ~$6-7/hour
- **Monthly (24/7)**: ~$4,300-5,000/month

## Troubleshooting

### CloudFormation stack creation fails

Check CloudFormation events for error messages. Common issues:
- Insufficient EC2 quota for G5 instances
- Route53 hosted zone not found
- Invalid NGC API key format

### Cosmos NIM container not starting

Debug steps:
```bash
# SSH into EC2 instance
aws ssm start-session --target <instance-id>

# Check container status and logs
sudo docker ps -a
sudo docker logs cosmos-predict1-text2world

# Check GPU and disk
nvidia-smi
df -h
```

Common causes: invalid NGC API key, insufficient disk space (~50GB needed), GPU driver issues.

### Video generation times out

Wait for NIM initialization (25-35 minutes on first start):
```bash
curl http://localhost:8000/v1/health/ready
```

Check NIM logs: `sudo docker logs cosmos-predict1-text2world`

Increase client timeout: `--timeout 900`

### API returns 502 Bad Gateway

```bash
# Check Fargate task health
aws ecs list-tasks --cluster cosmos-video-api-cluster
aws ecs describe-tasks --cluster cosmos-video-api-cluster --tasks <task-arn>

# Check API logs
aws logs tail /aws/ecs/cosmos-video-api --follow
```

### Video URL returns 403 Forbidden

Presigned URLs expire after 1 hour. Fetch job status again to get a fresh URL.

## Advanced Configuration

### Modify Instance Type

To use a different instance type (e.g., G5.48xlarge for more GPUs):

1. Edit `.env`:
   ```bash
   INSTANCE_TYPE=g5.48xlarge
   ```

2. Update GPU allocation in `src/ec2.ts` (search for `--gpus`):
   ```typescript
   '  --gpus \'"device=0,1,2,3,4,5,6,7"\' \\'  // For 8 GPUs
   ```

3. Redeploy:
   ```bash
   yarn cdk deploy
   ```

### Adjust Video Retention

Edit `.env`:
```bash
VIDEO_RETENTION_DAYS=14  # Keep videos for 14 days instead of 7
```

Redeploy to apply changes.

### Enable HTTPS for NIM (Optional)

The NIM endpoint is already secured with HTTPS via ALB. To access NIM directly:

1. Security group allows SSH (port 22) - you can add port 8000 if needed
2. Use HTTPS through the ALB endpoint instead of direct EC2 access

### Scale API Server

To handle more concurrent requests, increase Fargate task count:

Edit `src/ecs.ts`:
```typescript
const service = new FargateService(this, 'ApiService', {
  // ...
  desiredCount: 3,  // Run 3 tasks instead of 1
});
```

## Performance Considerations

### Video Generation Time

Typical generation times (G5.12xlarge, 48 frames):
- **First generation**: 3-5 minutes (cold start)
- **Subsequent generations**: 1-3 minutes (warm)

Factors affecting performance:
- Number of frames (more frames = longer generation)
- GPU count and type
- Model optimization profile
- Concurrent requests

### Throughput

With a single G5.12xlarge instance:
- **Sequential processing**: ~12-20 videos/hour
- **Concurrent requests**: API queues jobs, Cosmos NIM processes one at a time

To increase throughput:
- Use larger instance types (G5.48xlarge with 8 GPUs)
- Deploy multiple EC2 instances behind the load balancer
- Implement request batching in the API server

## Security

- NGC API key stored in AWS Secrets Manager
- All traffic encrypted via HTTPS with ACM certificates
- Private S3 bucket with presigned URLs (1-hour expiration)
- IAM roles with least privilege access
- Restrictive security group rules
- Automatic video deletion after 7 days

## Cleanup

To avoid ongoing charges, delete all resources:

```bash
yarn cdk destroy
```

To also delete the NGC API key secret:

```bash
aws secretsmanager delete-secret --secret-id NGC_API_KEY --force-delete-without-recovery
```

## Additional Resources

- [NVIDIA Cosmos Documentation](https://developer.nvidia.com/cosmos)
- [NVIDIA NIM Documentation](https://docs.nvidia.com/nim/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)

## License

This example is licensed under MIT-0. See the LICENSE file.
