#!/bin/bash
# Builds the API and packs it with its production dependencies into out/<release-id>.tar.gz.
# Everything is pure JavaScript, so a bundle built on any machine runs on the ARM instance.
#
#   scripts/package-release.sh [release-id]     (default: short git commit)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:-$(git -C "$ROOT" rev-parse --short=10 HEAD)}"
STAGE="$ROOT/out/release"
BUNDLE="$ROOT/out/$ID.tar.gz"

rm -rf "$ROOT/out"
mkdir -p "$STAGE"

echo "building the API"
(cd "$ROOT/api" && npm ci --silent && npm run build --silent)

cp -R "$ROOT/api/dist" "$STAGE/dist"
cp "$ROOT/api/package.json" "$ROOT/api/package-lock.json" "$STAGE/"
cp -R "$ROOT/deploy" "$STAGE/deploy"

echo "installing production dependencies"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --silent)

# A native add-on built here would not run on the instance. There should be none.
NATIVE="$(find "$STAGE/node_modules" -name '*.node' | head -5)"
if [[ -n "$NATIVE" ]]; then
  echo "native modules found, the bundle would not be portable:" >&2
  echo "$NATIVE" >&2
  exit 1
fi

printf '{"id":"%s","builtAt":"%s"}\n' "$ID" "$(date -u +%FT%TZ)" >"$STAGE/RELEASE.json"
tar -czf "$BUNDLE" -C "$STAGE" .
echo "built $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
echo "$ID" >"$ROOT/out/RELEASE_ID"
