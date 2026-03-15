#!/usr/bin/env bash
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
SERVICE_NAME="melody"
REGION="us-central1"

# ── Env checks ───────────────────────────────────────────────────────────────
if [ -z "${GOOGLE_CLOUD_PROJECT:-}" ]; then
  echo "ERROR: GOOGLE_CLOUD_PROJECT is not set." >&2
  exit 1
fi

if [ -z "${GOOGLE_API_KEY:-}" ]; then
  echo "ERROR: GOOGLE_API_KEY is not set." >&2
  exit 1
fi

echo "Project : $GOOGLE_CLOUD_PROJECT"
echo "Service : $SERVICE_NAME"
echo "Region  : $REGION"
echo ""

# ── Enable required APIs ─────────────────────────────────────────────────────
echo "Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  generativelanguage.googleapis.com \
  --project "$GOOGLE_CLOUD_PROJECT"

# ── Deploy ───────────────────────────────────────────────────────────────────
echo ""
echo "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=${GOOGLE_API_KEY},GOOGLE_GENAI_USE_VERTEXAI=0" \
  --memory 512Mi \
  --timeout 3600

# ── Print URL ────────────────────────────────────────────────────────────────
echo ""
URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --format "value(status.url)")
echo "✓ Live at: $URL"
