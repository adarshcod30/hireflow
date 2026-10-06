#!/bin/bash
# Builds the web app against the live API and publishes it: sync to S3, then invalidate CloudFront.
#
#   scripts/deploy-web.sh [--skip-build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_stack.sh
source "$ROOT/scripts/_stack.sh"

need WEB_BUCKET WebBucket
need DISTRIBUTION_ID DistributionId
need API_URL ApiUrl

if [[ "${1:-}" != "--skip-build" ]]; then
  (cd "$ROOT/web" && npm ci --silent && VITE_API_URL="$API_URL" npm run build --silent)
fi

# Hashed assets can be cached for a year. index.html must always be fetched fresh.
aws s3 sync "$ROOT/web/dist" "s3://$WEB_BUCKET" --delete --only-show-errors \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp "$ROOT/web/dist/index.html" "s3://$WEB_BUCKET/index.html" --only-show-errors \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' \
  --query Invalidation.Id --output text
echo "web app published"
