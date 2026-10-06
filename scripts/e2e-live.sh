#!/bin/bash
# Walks the whole candidate-to-email journey on a live deployment, with real S3, SQS, Lambda, Bedrock and SES.
# Needs AWS credentials (it reads the admin login from Secrets Manager and the Lambda logs from CloudWatch).
# It leaves two test applications behind and removes them at the end unless KEEP=1.
#
#   scripts/e2e-live.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/_stack.sh
source "$ROOT/scripts/_stack.sh"
need API_URL ApiUrl
need INSTANCE_ID InstanceId
RESUME_BUCKET="$(stack_output ResumeBucket)"
ADMIN_ARN="$(stack_output AdminSecretArn)"
SAMPLE="$ROOT/lambdas/fixtures/resumes/strong.pdf"

FAILS=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
expect() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (wanted $3, got $2)"; fi; }
api() { curl -s -m 30 "$@"; }

STAMP="$(date +%s)"
EMAIL_A="e2e.${STAMP}.a@example.com"
EMAIL_B="e2e.${STAMP}.b@example.com"
echo "Signing in as the admin"
SECRET="$(aws secretsmanager get-secret-value --secret-id "$ADMIN_ARN" --query SecretString --output text)"
TOKEN="$(api -X POST "$API_URL/v1/auth/login" -H 'Content-Type: application/json' -d "$(jq '{email,password}' <<<"$SECRET")" | jq -r .accessToken)"
[[ ${#TOKEN} -gt 100 ]] || { echo "could not sign in"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN")

JOB="$(api "$API_URL/v1/public/jobs?limit=1" | jq -r '.items[0].id')"
echo "Applying to job $JOB as $EMAIL_A"
APPLY="$(api -X POST "$API_URL/v1/public/jobs/$JOB/applications" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_A\",\"fullName\":\"E2E Candidate A\"}")"
APP_A="$(jq -r .application.id <<<"$APPLY")"
expect "a new application is created" "$(jq -r .created <<<"$APPLY")" "true"
expect "a candidate token and an upload ticket are issued" "$(jq -r '(.applicationToken != null) and (.resumeUpload.url != null)' <<<"$APPLY")" "true"

# Post the file to S3 with the ticket's fields, the way the browser does. Fields first, file last.
upload() { # upload <apply-json> <file> [field=value ...]  -> HTTP status
  local json="$1" file="$2"; shift 2
  local args=() k v
  while IFS=$'\t' read -r k v; do
    for o in "$@"; do [[ "${o%%=*}" == "$k" ]] && v="${o#*=}"; done
    args+=(-F "$k=$v")
  done < <(jq -r '.resumeUpload.fields | to_entries[] | "\(.key)\t\(.value)"' <<<"$json")
  curl -s -o /dev/null -m 60 -w '%{http_code}' "${args[@]}" -F "file=@$file;type=application/pdf" "$(jq -r .resumeUpload.url <<<"$json")"
}

echo "Testing the upload rules S3 itself enforces"
head -c $((6 * 1024 * 1024)) /dev/zero > /tmp/e2e-big.pdf
expect "a file over 5 MB is refused by S3" "$(upload "$APPLY" /tmp/e2e-big.pdf)" "400"
expect "a different content type is refused by S3" "$(upload "$APPLY" "$SAMPLE" Content-Type=text/html)" "403"
expect "a different object key is refused by S3" "$(upload "$APPLY" "$SAMPLE" key=resumes/someone-else/resume.pdf)" "403"
rm -f /tmp/e2e-big.pdf

echo "Uploading the real resume"
expect "the upload is accepted" "$(upload "$APPLY" "$SAMPLE")" "204"

echo "Waiting for the pipeline (S3 event, SQS, Lambda, Bedrock, API)"
SCORE=""
for _ in $(seq 1 40); do
  D="$(api "$API_URL/v1/applications/$APP_A" "${AUTH[@]}")"
  if [[ "$(jq -r .screeningStatus <<<"$D")" == "done" ]]; then SCORE="$(jq -r .fitScore <<<"$D")"; break; fi
  sleep 5
done
if [[ -n "$SCORE" ]]; then pass "the resume was screened by Bedrock: fit score $SCORE"; else fail "screening did not finish in 200 seconds"; fi
[[ -n "$SCORE" ]] && echo "        summary: $(jq -r .screeningSummary <<<"$D" | cut -c1-140)"
expect "the resume is recorded against the application" "$(jq -r .hasResume <<<"$D")" "true"

echo "Applying again with the same email"
AGAIN="$(curl -s -m 30 -o /tmp/e2e-again.json -w '%{http_code}' -X POST "$API_URL/v1/public/jobs/$JOB/applications" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_A\",\"fullName\":\"Someone Else\"}")"
expect "a repeat application answers 200, not 201" "$AGAIN" "200"
expect "it names the same application" "$(jq -r .application.id /tmp/e2e-again.json)" "$APP_A"
expect "it hands out no second upload ticket, so the resume cannot be replaced" "$(jq -r '.resumeUpload == null' /tmp/e2e-again.json)" "true"
rm -f /tmp/e2e-again.json

echo "Moving the application as a recruiter"
VERSION="$(jq -r .version <<<"$D")"
MOVED="$(api -X PATCH "$API_URL/v1/applications/$APP_A/status" "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"to\":\"interview\",\"version\":$VERSION,\"note\":\"end to end check\"}")"
expect "the move to interview succeeds" "$(jq -r .status <<<"$MOVED")" "interview"
STALE="$(curl -s -o /dev/null -m 30 -w '%{http_code}' -X PATCH "$API_URL/v1/applications/$APP_A/status" "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"to\":\"offer\",\"version\":$VERSION}")"
expect "a second change using the old version is refused (409)" "$STALE" "409"
ILLEGAL="$(curl -s -o /dev/null -m 30 -w '%{http_code}' -X PATCH "$API_URL/v1/applications/$APP_A/status" "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"to\":\"hired\",\"version\":2}")"
expect "an illegal jump (interview to hired) is refused as a conflict with the current state" "$ILLEGAL" "409"

# Count matching log events since the script started. The API pages its results, so count lines rather than trust a total.
count_logs() {
  aws logs filter-log-events --log-group-name "$1" --start-time $(((STAMP - 5) * 1000)) --filter-pattern "$2" \
    --query 'events[].eventId' --output text | tr '\t' '\n' | grep -c .
}

echo "Waiting for the notification pipeline (outbox relay, SQS, Lambda, SES)"
# shellcheck disable=SC2016 # the backticks are JMESPath literals, not shell
NOTIFIER_LOGS="$(aws logs describe-log-groups --query 'logGroups[?contains(logGroupName,`NotifierLogs`)].logGroupName | [0]' --output text)"
SENT=0
for _ in $(seq 1 24); do
  SENT="$(count_logs "$NOTIFIER_LOGS" '"email sent"')"
  [[ "$SENT" -ge 2 ]] && break
  sleep 5
done
if [[ "$SENT" -ge 2 ]]; then pass "the notifier sent $SENT emails (confirmation and interview), once each"; else fail "expected 2 sent emails, saw $SENT"; fi
DUP="$(count_logs "$NOTIFIER_LOGS" '"already handled"')"
echo "        duplicate deliveries absorbed by the claim: $DUP"

echo "Uploading something that is not a PDF"
APPLY_B="$(api -X POST "$API_URL/v1/public/jobs/$JOB/applications" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_B\",\"fullName\":\"E2E Candidate B\"}")"
APP_B="$(jq -r .application.id <<<"$APPLY_B")"
echo "this is not a pdf, it only claims to be" > /tmp/e2e-fake.pdf
expect "S3 accepts it, because it can only check the declared type" "$(upload "$APPLY_B" /tmp/e2e-fake.pdf)" "204"
rm -f /tmp/e2e-fake.pdf
STATE=""
for _ in $(seq 1 30); do
  DB="$(api "$API_URL/v1/applications/$APP_B" "${AUTH[@]}")"
  STATE="$(jq -r .screeningStatus <<<"$DB")"
  [[ "$STATE" == "failed" || "$STATE" == "done" ]] && break
  sleep 5
done
expect "the worker marks it failed instead of retrying forever" "$STATE" "failed"

# shellcheck disable=SC2016 # the backticks are JMESPath literals, not shell
DLQ="$(aws sqs list-queues --query 'QueueUrls[?contains(@,`ScreeningDlq`)]|[0]' --output text)"
expect "nothing landed in the screening dead-letter queue" "$(aws sqs get-queue-attributes --queue-url "$DLQ" --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages --output text)" "0"

if [[ "${KEEP:-0}" != "1" ]]; then
  echo "Cleaning up the test data"
  aws s3 rm "s3://$RESUME_BUCKET/resumes/$APP_A/resume.pdf" --only-show-errors
  aws s3 rm "s3://$RESUME_BUCKET/resumes/$APP_B/resume.pdf" --only-show-errors
  REMOTE="set -euo pipefail
cd /opt/hireflow/current
runuser -u hireflow -- env DOTENV_CONFIG_PATH=/etc/hireflow/api.env /usr/local/bin/node -e \"
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(\\\"DELETE FROM candidates WHERE email LIKE 'e2e.%@example.com'\\\");
  await c.query(\\\"DELETE FROM outbox WHERE payload->>'candidateEmail' LIKE 'e2e.%@example.com'\\\");
  console.log('removed ' + r.rowCount + ' test candidates');
  await c.end();
})();
\""
  CID="$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c]}')" --query Command.CommandId --output text)"
  sleep 6
  aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent]' --output text | tr '\n' ' '; echo
fi

echo
if ((FAILS > 0)); then echo "$FAILS check(s) failed"; exit 1; fi
echo "The whole journey works"
