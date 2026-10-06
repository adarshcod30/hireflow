#!/bin/bash
# Removes everything HireFlow created in AWS, including the database and all uploaded resumes.
# The CDK bootstrap stack is left alone because other projects can use it.
#
#   scripts/teardown.sh --yes
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_stack.sh
source "$ROOT/scripts/_stack.sh"

if [[ "${1:-}" != "--yes" ]]; then
  echo "This deletes the HireFlow stack in $AWS_REGION: database, resumes, queues, Lambdas, the lot."
  echo "Run again with --yes to go ahead."
  exit 1
fi

cd "$ROOT/infra"
npx cdk destroy --force
echo "stack deleted. Secrets Manager keeps deleted secrets for a recovery window, which is free after the first moments."
