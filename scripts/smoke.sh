#!/bin/bash
# Checks a live deployment from the outside, the way a stranger on the internet would see it.
# No AWS credentials needed. Exits non-zero if anything fails, so CI can run it after a deploy.
#
#   API_URL=https://api.example.com WEB_URL=https://dxxxx.cloudfront.net scripts/smoke.sh
#
# Optional: RESUME_BUCKET_URL=https://bucket.s3.region.amazonaws.com to check the bucket is private,
#           SERVER_IP=1.2.3.4 to check that SSH and the app port are closed.
set -uo pipefail

API_URL="${API_URL:?set API_URL}"
WEB_URL="${WEB_URL:?set WEB_URL}"
FAILS=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { # check "<description>" <command that succeeds when the check passes>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}
# Retry only when the connection itself fails (DNS, reset, timeout). A real HTTP answer, even a 500, is final.
CURL=(curl --retry 3 --retry-delay 2 --retry-connrefused --retry-all-errors)
status() { "${CURL[@]}" -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
headers() { "${CURL[@]}" -s -D - -o /dev/null -m 15 "$@" | tr -d '\r'; }
has_header() { grep -qi "^$1:" <<<"$2"; }

echo "API: $API_URL"
check "liveness answers 200" test "$(status "$API_URL/health")" = 200
check "readiness answers 200 and reports the database up" bash -c "curl --retry 3 --retry-delay 2 --retry-all-errors -sf -m 15 '$API_URL/health/ready' | grep -q '\"status\":\"ok\"'"
check "the certificate is valid (curl verifies it)" curl -sf -m 15 -o /dev/null "$API_URL/health"
check "plain HTTP is redirected to HTTPS" bash -c "curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}' '${API_URL/https:/http:}/health' | grep -Eq '^30[78] https://'"
check "the public job list answers with JSON and an items array" bash -c "curl -sf -m 15 '$API_URL/v1/public/jobs?limit=1' | grep -q '\"items\"'"

H="$(headers "$API_URL/health")"
check "responses are not sniffable (x-content-type-options)" has_header x-content-type-options "$H"
check "HSTS is sent" has_header strict-transport-security "$H"
check "the framework is not advertised (no x-powered-by)" bash -c "! grep -qi '^x-powered-by:' <<<\"\$1\"" _ "$H"

check "recruiter routes refuse an anonymous caller (401)" test "$(status "$API_URL/v1/jobs")" = 401
check "the overview refuses an anonymous caller (401)" test "$(status "$API_URL/v1/stats/overview")" = 401
check "internal routes refuse an unsigned request (401)" test "$(status "$API_URL/v1/internal/reports/stale-applications?days=7")" = 401
check "a malformed id is rejected, not a server error (400)" test "$(status "$API_URL/v1/public/jobs/not-a-uuid")" = 400
check "an unknown job is a clean 404" test "$(status "$API_URL/v1/public/jobs/00000000-0000-0000-0000-000000000000")" = 404

echo "Cross-origin rules"
ALLOWED="$WEB_URL"
PRE="$(headers -X OPTIONS "$API_URL/v1/public/jobs" -H "Origin: $ALLOWED" -H 'Access-Control-Request-Method: GET')"
check "the web app's origin is allowed" grep -qiF "access-control-allow-origin: $ALLOWED" <<<"$PRE"
EVIL="$(headers -X OPTIONS "$API_URL/v1/public/jobs" -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET')"
check "another origin is not allowed" bash -c "! grep -qi '^access-control-allow-origin:' <<<\"\$1\"" _ "$EVIL"

echo "Web: $WEB_URL"
check "the app is served (200)" test "$(status "$WEB_URL/")" = 200
check "a deep link falls back to the app (200)" test "$(status "$WEB_URL/jobs/anything")" = 200
W="$(headers "$WEB_URL/")"
check "a content security policy is set" has_header content-security-policy "$W"
check "the page cannot be framed (frame-ancestors none)" grep -qi "frame-ancestors 'none'" <<<"$W"
check "the CSP allows the API and nothing broader for connections" bash -c "grep -i '^content-security-policy:' <<<\"\$1\" | grep -qF \"${API_URL#https://}\"" _ "$W"
check "HSTS is sent" has_header strict-transport-security "$W"
check "HTTP is redirected to HTTPS" bash -c "curl -s -o /dev/null -m 15 -w '%{http_code}' '${WEB_URL/https:/http:}/' | grep -Eq '^30[1278]'"
ASSET="$(curl -sf -m 15 "$WEB_URL/" | grep -o '/assets/[^"]*\.js' | head -1)"
check "built assets are cached for a year" bash -c "curl -s -D - -o /dev/null -m 15 '$WEB_URL$ASSET' | grep -qi 'cache-control:.*max-age=31536000'"

if [[ -n "${RESUME_BUCKET_URL:-}" ]]; then
  echo "Storage"
  check "the resume bucket cannot be listed anonymously" test "$(status "$RESUME_BUCKET_URL/")" = 403
  check "a resume cannot be fetched anonymously" test "$(status "$RESUME_BUCKET_URL/resumes/00000000-0000-0000-0000-000000000000/resume.pdf")" = 403
fi

if [[ -n "${SERVER_IP:-}" ]]; then
  echo "Network"
  check "SSH (22) is closed" bash -c "! nc -z -w 4 $SERVER_IP 22"
  check "the app port (3000) is not reachable from outside" bash -c "! nc -z -w 4 $SERVER_IP 3000"
  check "HTTPS (443) is open" nc -z -w 6 "$SERVER_IP" 443
fi

echo
if ((FAILS > 0)); then echo "$FAILS check(s) failed"; exit 1; fi
echo "All checks passed"
