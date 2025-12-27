
#!/usr/bin/env bash
set -euo pipefail

# Enhanced deploy script for mongo-explorer
# - Builds the app, optionally creates an S3 bucket, optionally creates a
#   CloudFront distribution, syncs the `dist/` output and invalidates CloudFront.
#
# Environment variables (defaults shown):
#   BUCKET (required unless --no-sync)
#   REGION=${REGION:-us-east-1}
#   CREATE_BUCKET=${CREATE_BUCKET:-false}   # set to 'true' to create the S3 bucket if missing
#   CREATE_CF=${CREATE_CF:-false}           # set to 'true' to create a CloudFront distribution
#   DISTRIBUTION_ID (optional)              # if set, invalidation will use this id
#   CERT_ARN (optional)                     # ACM certificate ARN to use for CloudFront (recommended for custom domain)
#   AWS_PROFILE (optional)                  # forwarded to aws CLI via --profile
#   BUILD_DIR=${BUILD_DIR:-dist}
#
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$BASE_DIR"
REGION="${REGION:-us-east-1}"
BUILD_DIR="${BUILD_DIR:-dist}"

PROFILE_ARG=""
if [ -n "${AWS_PROFILE:-}" ]; then
  PROFILE_ARG="--profile ${AWS_PROFILE}"
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found in PATH"
  exit 2
fi

echo "Building mongo-explorer..."
cd "$APP_DIR"
npm install
npm run build

if [ -z "${BUCKET:-}" ] && [ "${CREATE_BUCKET:-false}" != "true" ] && [ -z "${DISTRIBUTION_ID:-}" ]; then
  echo "ERROR: BUCKET env var is required unless you're only creating a distribution with an existing origin."
  echo "Set BUCKET=your-bucket or set CREATE_BUCKET=true to create one."
  exit 2
fi

if [ "${CREATE_BUCKET:-false}" = "true" ]; then
  echo "Ensuring S3 bucket exists: $BUCKET (region: $REGION)"
  if aws s3api head-bucket --bucket "$BUCKET" $PROFILE_ARG 2>/dev/null; then
    echo "Bucket $BUCKET already exists"
  else
    echo "Creating bucket $BUCKET"
    if [ "$REGION" = "us-east-1" ]; then
      aws s3api create-bucket --bucket "$BUCKET" $PROFILE_ARG
    else
      aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint=$REGION $PROFILE_ARG
    fi
    echo "Setting public read policy for objects (if you prefer private bucket + CloudFront OAC, update manually)"
    read -r -d '' POLICY_JSON <<POLICY || true
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"PublicReadGetObject",
      "Effect":"Allow",
      "Principal":"*",
      "Action":["s3:GetObject"],
      "Resource":["arn:aws:s3:::$BUCKET/*"]
    }
  ]
}
POLICY
    aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$POLICY_JSON" $PROFILE_ARG
  fi
fi

if [ -n "${BUCKET:-}" ]; then
  echo "Syncing $BUILD_DIR -> s3://$BUCKET"
  aws s3 sync "$BUILD_DIR/" "s3://$BUCKET" --delete $PROFILE_ARG
fi

if [ "${CREATE_CF:-false}" = "true" ] || [ -n "${DISTRIBUTION_ID:-}" ]; then
  # Create distribution if requested and not provided
  if [ -z "${DISTRIBUTION_ID:-}" ] && [ "${CREATE_CF:-false}" = "true" ]; then
    echo "Creating CloudFront distribution for origin: $BUCKET.s3.amazonaws.com"
    TMP_JSON="/tmp/cf-distribution-$$.json"

    cat > "$TMP_JSON" <<EOF
{
  "CallerReference": "mongo-explorer-$(date +%s)-$$",
  "Comment": "CloudFront distribution for $BUCKET",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "$BUCKET-origin",
        "DomainName": "$BUCKET.s3.amazonaws.com",
        "S3OriginConfig": { "OriginAccessIdentity": "" }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "$BUCKET-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] , "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "ForwardedValues": { "QueryString": false, "Cookies": { "Forward": "none" } }
  },
  "DefaultRootObject": "index.html"
}
EOF

    # If CERT_ARN provided, patch the viewer certificate into a separate file and call create-distribution with it.
    if [ -n "${CERT_ARN:-}" ]; then
      # Use temporary jq-free approach: create a wrapper JSON with ViewerCertificate and merge using aws cli parameter
      # aws cli expects full distribution-config; we'll append ViewerCertificate by inserting before final }
      TMP_JSON2="/tmp/cf-distribution-cert-$$.json"
      head -n -1 "$TMP_JSON" > "$TMP_JSON2"
      cat >> "$TMP_JSON2" <<EOF
  ,"ViewerCertificate": {
    "ACMCertificateArn": "$CERT_ARN",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2019"
  }
}
EOF
      mv "$TMP_JSON2" "$TMP_JSON"
    fi

    DIST_ID=$(aws cloudfront create-distribution --distribution-config file://"$TMP_JSON" $PROFILE_ARG --query 'Distribution.Id' --output text)
    DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" $PROFILE_ARG --query 'Distribution.DomainName' --output text)
    echo "Created CloudFront distribution: $DIST_ID ($DIST_DOMAIN)"
    DISTRIBUTION_ID="$DIST_ID"
    rm -f "$TMP_JSON"
  fi

  if [ -n "${DISTRIBUTION_ID:-}" ]; then
    echo "Creating CloudFront invalidation for $DISTRIBUTION_ID"
    aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" $PROFILE_ARG
  fi
fi

echo "Deploy complete."

