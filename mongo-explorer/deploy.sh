#!/usr/bin/env bash
set -euo pipefail

# Simple deploy script for mongo-explorer
# Requires: AWS CLI configured, and `BUCKET` env var set.
# Optional: DISTRIBUTION_ID for CloudFront invalidation, AWS_PROFILE for named profile.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$BASE_DIR"
BUILD_DIR=${BUILD_DIR:-dist}

if [ -z "${BUCKET:-}" ]; then
  echo "ERROR: BUCKET environment variable is not set."
  echo "Usage: BUCKET=my-bucket [DISTRIBUTION_ID=E123..] [AWS_PROFILE=profile] ./deploy.sh"
  exit 2
fi

PROFILE_ARG=""
if [ -n "${AWS_PROFILE:-}" ]; then
  PROFILE_ARG="--profile ${AWS_PROFILE}"
fi

echo "Building mongo-explorer..."
cd "$APP_DIR"
npm install
npm run build

echo "Syncing $BUILD_DIR -> s3://$BUCKET"
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET" --delete $PROFILE_ARG

if [ -n "${DISTRIBUTION_ID:-}" ]; then
  echo "Creating CloudFront invalidation for $DISTRIBUTION_ID"
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" $PROFILE_ARG
fi

echo "Deploy complete."
