#!/bin/bash
#
# Example bash script to generate video using Cosmos Video Generation API
#
# Requirements: curl, jq
#
# Usage:
#   ./generate_video.sh "A sunset over mountains"
#

set -e

# Configuration
API_ENDPOINT="${API_ENDPOINT:-https://cosmos-api.example.com}"
PROMPT="$1"
OUTPUT_FILE="${2:-output.mp4}"
POLL_INTERVAL=10
MAX_WAIT=600

# Check requirements
if ! command -v curl &> /dev/null; then
    echo "Error: curl is required but not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

if [ -z "$PROMPT" ]; then
    echo "Usage: $0 <prompt> [output_file]"
    echo "Example: $0 'A sunset over mountains' output.mp4"
    exit 1
fi

echo "=== Cosmos Video Generation ==="
echo "API Endpoint: $API_ENDPOINT"
echo "Prompt: $PROMPT"
echo ""

# Submit job
echo "Submitting video generation job..."
RESPONSE=$(curl -s -X POST "$API_ENDPOINT/api/v1/generate" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": \"$PROMPT\"}")

JOB_ID=$(echo "$RESPONSE" | jq -r '.job_id')

if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
    echo "Error: Failed to submit job"
    echo "Response: $RESPONSE"
    exit 1
fi

echo "Job submitted: $JOB_ID"
echo ""

# Poll for completion
echo "Waiting for video generation to complete..."
START_TIME=$(date +%s)

while true; do
    # Get job status
    STATUS_RESPONSE=$(curl -s "$API_ENDPOINT/api/v1/jobs/$JOB_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')

    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    echo "Status: $STATUS (elapsed: ${ELAPSED}s)"

    # Check if completed
    if [ "$STATUS" = "completed" ]; then
        echo ""
        echo "✓ Video generation completed!"
        break
    fi

    # Check if failed
    if [ "$STATUS" = "failed" ]; then
        ERROR=$(echo "$STATUS_RESPONSE" | jq -r '.error')
        echo ""
        echo "✗ Video generation failed: $ERROR"
        exit 1
    fi

    # Check timeout
    if [ $ELAPSED -gt $MAX_WAIT ]; then
        echo ""
        echo "✗ Timeout: Video generation did not complete within ${MAX_WAIT}s"
        exit 1
    fi

    # Wait before next poll
    sleep $POLL_INTERVAL
done

# Get video URL
VIDEO_URL=$(echo "$STATUS_RESPONSE" | jq -r '.video_url')

if [ -z "$VIDEO_URL" ] || [ "$VIDEO_URL" = "null" ]; then
    echo "✗ Error: No video URL found in response"
    exit 1
fi

echo "Video URL: $VIDEO_URL"
echo ""

# Download video
echo "Downloading video to: $OUTPUT_FILE"
curl -s -o "$OUTPUT_FILE" "$VIDEO_URL"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Success! Video saved to: $OUTPUT_FILE"
    exit 0
else
    echo ""
    echo "✗ Error: Failed to download video"
    exit 1
fi
