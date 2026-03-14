#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

cd server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
