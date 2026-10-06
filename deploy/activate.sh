#!/bin/bash
# Activates one release on the API instance. Run as root by SSM Run Command, after the
# release bundle has been unpacked to /opt/hireflow/releases/<release-id>:
#
#   bash activate.sh <release-id> [--seed]
#
# In order: write the environment file from SSM and Secrets Manager, run database
# migrations, create the admin account if it is missing, switch the `current` symlink,
# restart the service and wait for /health/ready. If the new release does not become
# healthy, the symlink goes back to the previous one and the script exits non-zero.
#
# Migrations are forward only. A release that needs a destructive schema change should
# ship it in two steps, so the previous release still works against the new schema.
set -euo pipefail

RELEASE_ID="${1:?usage: activate.sh <release-id> [--seed]}"
SEED=false
[[ "${2:-}" == "--seed" ]] && SEED=true

BASE=/opt/hireflow
RELEASE="$BASE/releases/$RELEASE_ID"
ENV_FILE=/etc/hireflow/api.env
LOG=/var/log/hireflow/deploy.log

mkdir -p /var/log/hireflow
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -u +%FT%TZ) activating $RELEASE_ID"

[[ -d "$RELEASE/dist" ]] || { echo "release $RELEASE_ID has no dist/ folder"; exit 1; }

TOKEN="$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
export AWS_DEFAULT_REGION
AWS_DEFAULT_REGION="$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)"

param() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text; }
secret() { aws secretsmanager get-secret-value --secret-id "$(param "/hireflow/secrets/$1")" --query SecretString --output text; }

write_env() {
  local tmp
  tmp="$(mktemp)"
  {
    # Plain settings: every /hireflow/env/NAME parameter becomes NAME=value
    aws ssm get-parameters-by-path --path /hireflow/env --query 'Parameters[].[Name,Value]' --output text |
      awk -F'\t' '{ n = split($1, part, "/"); print part[n] "=" $2 }'
    # The database URL is assembled here so the password is URL-encoded and never stored whole
    # shellcheck disable=SC2016
    DB_JSON="$(secret db)" node -e '
      const s = JSON.parse(process.env.DB_JSON);
      const e = encodeURIComponent;
      console.log(`DATABASE_URL=postgres://${e(s.username)}:${e(s.password)}@${s.host}:${s.port}/${s.dbname}`);
    '
    echo "JWT_SECRET=$(secret jwt)"
    echo "INTERNAL_HMAC_SECRET=$(secret internal-hmac)"
  } >"$tmp"
  install -o root -g hireflow -m 0640 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
}

# Run a Node script from the release as the service user, with the environment file loaded by dotenv
as_app() {
  (cd "$RELEASE" && runuser -u hireflow -- env DOTENV_CONFIG_PATH="$ENV_FILE" "$@")
}

healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

# Code is owned by root and readable by everyone: the app cannot rewrite itself
chown -R root:root "$RELEASE"
chmod -R go+rX "$RELEASE"

write_env
echo "environment written"

echo "running migrations"
as_app /usr/local/bin/node dist/database/migrate.js

ADMIN_JSON="$(secret admin)"
ADMIN_EMAIL="$(echo "$ADMIN_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).email')"
ADMIN_PASSWORD="$(echo "$ADMIN_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).password')"
as_app env ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" /usr/local/bin/node dist/scripts/create-admin.js

if [[ "$SEED" == true ]]; then
  echo "seeding demo jobs"
  as_app /usr/local/bin/node dist/scripts/seed-demo.js
fi

# Switch atomically: build the new link beside the old one, then rename over it
ln -sfn "$RELEASE" "$BASE/current.new"
mv -T "$BASE/current.new" "$BASE/current"
systemctl restart hireflow-api

if healthy; then
  echo "release $RELEASE_ID is healthy"
  # Caddy waits for the first release so it only asks for a certificate once DNS points here
  systemctl is-active --quiet caddy || systemctl start caddy
else
  echo "release $RELEASE_ID did not become healthy, last log lines:"
  tail -n 25 /var/log/hireflow/api.log || true
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    echo "rolling back to $PREVIOUS"
    ln -sfn "$PREVIOUS" "$BASE/current.new"
    mv -T "$BASE/current.new" "$BASE/current"
    systemctl restart hireflow-api
    if healthy; then echo "rolled back, previous release is serving"; else echo "rollback is not healthy either"; fi
  fi
  exit 1
fi

# Keep the five newest releases, and never the one in use
CURRENT="$(readlink -f "$BASE/current")"
find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- |
  while read -r old; do
    [[ "$(readlink -f "$old")" == "$CURRENT" ]] || rm -rf "$old"
  done
echo "=== done"
