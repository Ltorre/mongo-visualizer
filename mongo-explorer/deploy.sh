
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

# WAF settings (only used with CloudFront)
# Set CREATE_WAF=true to create a WAF Web ACL that allows only the IPs in ALLOWED_IPS
CREATE_WAF="${CREATE_WAF:-false}"
ALLOWED_IPS="${ALLOWED_IPS:-}"
WAF_NAME="${WAF_NAME:-mongo-explorer-web-acl}"
IPSET_NAME="${IPSET_NAME:-mongo-explorer-allowed-ips}"

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
    echo "Preparing CloudFront distribution for origin: $BUCKET.s3.amazonaws.com"

    # Optionally create an Origin Access Identity (OAI) so the bucket can remain private
    if [ "${CREATE_OAI:-true}" = "true" ]; then
      echo "Creating CloudFront Origin Access Identity (OAI)"
      OAI_JSON=$(aws cloudfront create-cloud-front-origin-access-identity \
        --cloud-front-origin-access-identity-config CallerReference="$(date +%s)-$$",Comment="OAI for $BUCKET" $PROFILE_ARG \
        --output json 2>/dev/null || true)
      if [ -n "$OAI_JSON" ]; then
        OAI_ID=$(echo "$OAI_JSON" | awk -F '"' '/Id/ {print $4; exit}')
        OAI_S3CANON=$(echo "$OAI_JSON" | awk -F '"' '/S3CanonicalUserId/ {print $4; exit}')
        echo "Created OAI: $OAI_ID (s3 canonical id: ${OAI_S3CANON:-unknown})"
      else
        echo "Failed to create OAI or it already exists; attempting to continue"
      fi
    fi

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
        "S3OriginConfig": { "OriginAccessIdentity": "origin-access-identity/cloudfront/$OAI_ID" }
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

    if [ -n "${CERT_ARN:-}" ]; then
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

    # If we created an OAI, set a restrictive bucket policy granting access only to that canonical user
    if [ -n "${OAI_S3CANON:-}" ]; then
      echo "Applying bucket policy to allow access from OAI canonical user"
      POLICY_JSON=$(cat <<POLICY
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"AllowCloudFrontServicePrincipal",
      "Effect":"Allow",
      "Principal": { "CanonicalUser": "$OAI_S3CANON" },
      "Action":["s3:GetObject"],
      "Resource":["arn:aws:s3:::$BUCKET/*"]
    }
  ]
}
POLICY
)
      aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$POLICY_JSON" $PROFILE_ARG
    fi

    # Optionally create a WAF Web ACL and associate it with the CloudFront distribution
    if [ "${CREATE_WAF}" = "true" ]; then
      if [ -z "${ALLOWED_IPS}" ]; then
        echo "ERROR: CREATE_WAF=true but ALLOWED_IPS is empty. Set ALLOWED_IPS='88.1.2.3/32 4.5.6.7/32'"
        exit 3
      fi

      echo "Creating WAF IP set and Web ACL in us-east-1 for CloudFront"
      AWS_WAF_REGION=us-east-1
      ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text $PROFILE_ARG)

      # create ip set
      IP_ADDR_LIST=($ALLOWED_IPS)
      echo "IP set addresses: ${IP_ADDR_LIST[*]}"
      IPSET_ARN=$(aws wafv2 create-ip-set --name "$IPSET_NAME" --scope CLOUDFRONT --ip-address-version IPV4 --addresses ${IP_ADDR_LIST[*]} --description "Allowed IPs for mongo-explorer" --region $AWS_WAF_REGION $PROFILE_ARG --query 'Summary.ARN' --output text)
      echo "Created IP set: $IPSET_ARN"

      # create web ACL with a single allow rule referencing the ip set, default block
      WEB_ACL_JSON=$(cat <<WACL
{
  "Name": "$WAF_NAME",
  "Scope": "CLOUDFRONT",
  "DefaultAction": {"Block": {}},
  "VisibilityConfig": {"SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "$WAF_NAME"},
  "Rules": [
    {
      "Name": "AllowSpecificIPs",
      "Priority": 0,
      "Statement": {"IPSetReferenceStatement": {"ARN": "$IPSET_ARN"}},
      "Action": {"Allow": {}},
      "VisibilityConfig": {"SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "AllowSpecificIPs"}
    }
  ]
}
WACL
)

      WEB_ACL_ARN=$(aws wafv2 create-web-acl --cli-input-json "$WEB_ACL_JSON" --region $AWS_WAF_REGION $PROFILE_ARG --query 'Summary.ARN' --output text)
      echo "Created Web ACL: $WEB_ACL_ARN"

      # associate web acl with the distribution
      CF_RESOURCE_ARN="arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DISTRIBUTION_ID"
      aws wafv2 associate-web-acl --web-acl-arn "$WEB_ACL_ARN" --resource-arn "$CF_RESOURCE_ARN" --region $AWS_WAF_REGION $PROFILE_ARG
      echo "Associated Web ACL with CloudFront distribution $DISTRIBUTION_ID"
    fi

    rm -f "$TMP_JSON"
  fi

  if [ -n "${DISTRIBUTION_ID:-}" ]; then
    echo "Creating CloudFront invalidation for $DISTRIBUTION_ID"
    aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" $PROFILE_ARG
  fi
fi

echo "Deploy complete."

