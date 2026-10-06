#!/bin/bash
# Seeds the demo platform on the running instance without redeploying: recruiters, jobs, about 130
# applications and their resumes. The resumes go to S3, so the real screening pipeline (SQS, Lambda,
# Bedrock) scores them over the next few minutes. It sends no email.
#
#   scripts/seed-remote.sh            add the demo data (does nothing if it is already there)
#   scripts/seed-remote.sh --reset    remove the demo data, then add it fresh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_stack.sh
# shellcheck source=scripts/_stack.sh
source "$ROOT/scripts/_stack.sh"
need INSTANCE_ID InstanceId

ARGS=""
case "${1:-}" in
  "") ;;
  --reset) ARGS=" --reset" ;;
  *) echo "unknown option ${1}" >&2; exit 2 ;;
esac

REMOTE="set -euo pipefail
cd /opt/hireflow/current
runuser -u hireflow -- env DOTENV_CONFIG_PATH=/etc/hireflow/api.env /usr/local/bin/node dist/scripts/seed-mock.js$ARGS"

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "hireflow seed demo data" \
  --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c], executionTimeout: ["300"]}')" \
  --query Command.CommandId --output text)"

for _ in $(seq 1 60); do
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success | Failed | Cancelled | TimedOut) break ;;
  esac
  sleep 3
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
[[ "$STATUS" == "Success" ]]
