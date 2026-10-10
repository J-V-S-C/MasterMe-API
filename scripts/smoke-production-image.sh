#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke-production-image.sh IMAGE}"
database_url="${MIGRATION_TEST_DATABASE_URL:?configure MIGRATION_TEST_DATABASE_URL}"
container="masterme-smoke-${GITHUB_RUN_ID:-local}-${RANDOM}"
port="${SMOKE_PORT:-3333}"
metrics_token='ci-metrics-token-at-least-32-characters'

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$container" --network host \
  --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env PORT="$port" \
  --env NODE_ENV=production \
  --env DATABASE_URL="$database_url" \
  --env SUPABASE_URL=https://example.supabase.co \
  --env GEMINI_API_KEY=ci-placeholder \
  --env PUBLIC_APP_URL=https://app.example.com \
  --env MATERIAL_STORAGE_PATH=/tmp/materials \
  --env METRICS_BEARER_TOKEN="$metrics_token" \
  "$image" bun run start >/dev/null

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null \
    && curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/ready" >/dev/null; then
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "http://127.0.0.1:${port}/metrics")"
    test "$status" = 401
    metrics="$(curl --fail --silent --show-error --max-time 2 --header "Authorization: Bearer ${metrics_token}" "http://127.0.0.1:${port}/metrics")"
    grep --quiet '^# HELP masterme_http_requests_total ' <<<"$metrics"
    exit 0
  fi
  if ! docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep --quiet '^true$'; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

docker logs "$container"
exit 1
