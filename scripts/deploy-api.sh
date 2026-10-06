#!/bin/bash
# Ships the API to the instance: package, upload to S3, activate through SSM Run Command.
# No SSH, no open ports. Needs AWS credentials, or the repository variables CI sets.
#
#   scripts/deploy-api.sh [--seed] [--mock] [--skip-build]
#
#   --seed   three sample jobs
#   --mock   the full demo platform: recruiters, a dozen jobs, ~130 applications with resumes
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_stack.sh
source "$ROOT/scripts/_stack.sh"

FLAGS=""
BUILD=true
for arg in "$@"; do
  case "$arg" in
    --seed) FLAGS="$FLAGS --seed" ;;
    --mock) FLAGS="$FLAGS --mock" ;;
    --skip-build) BUILD=false ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

need ARTIFACTS_BUCKET ArtifactsBucket
need INSTANCE_ID InstanceId

if [[ "$BUILD" == true ]]; then "$ROOT/scripts/package-release.sh"; fi
ID="$(cat "$ROOT/out/RELEASE_ID")"

echo "uploading $ID"
aws s3 cp "$ROOT/out/$ID.tar.gz" "s3://$ARTIFACTS_BUCKET/releases/$ID.tar.gz" --only-show-errors

REMOTE="set -euo pipefail
mkdir -p /opt/hireflow/releases/$ID
aws s3 cp s3://$ARTIFACTS_BUCKET/releases/$ID.tar.gz /tmp/$ID.tar.gz --only-show-errors
tar -xzf /tmp/$ID.tar.gz -C /opt/hireflow/releases/$ID
rm -f /tmp/$ID.tar.gz
bash /opt/hireflow/releases/$ID/deploy/activate.sh $ID$FLAGS"

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "hireflow deploy $ID" \
  --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c], executionTimeout: ["600"]}')" \
  --query Command.CommandId --output text)"
echo "SSM command $COMMAND_ID, waiting"

# The wait command gives up after a while and exits 255 while the command is still running
for _ in $(seq 1 60); do
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success | Failed | Cancelled | TimedOut) break ;;
  esac
  sleep 5
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
echo "deploy status: $STATUS"
[[ "$STATUS" == "Success" ]]
