#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke-production-image.sh IMAGE}"
database_url="${MIGRATION_TEST_DATABASE_URL:?configure MIGRATION_TEST_DATABASE_URL}"
container="masterme-smoke-${GITHUB_RUN_ID:-local}-${RANDOM}"
port="${SMOKE_PORT:-3333}"

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
  --env INFINITEPAY_HANDLE= \
  "$image" bun run start >/dev/null

for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null \
    && curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/ready" >/dev/null; then
    metrics_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "http://127.0.0.1:${port}/metrics")"
    webhook_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 --request POST "http://127.0.0.1:${port}/api/billing/webhooks/infinitepay")"
    checkout_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 --request POST "http://127.0.0.1:${port}/api/billing/checkouts")"
    reconcile_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 --request POST "http://127.0.0.1:${port}/api/billing/orders/22222222-2222-4222-8222-222222222222/reconcile")"
    catalog="$(curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/api/billing/catalog")"
    test "$metrics_status" = 404
    test "$webhook_status" = 404
    test "$checkout_status" = 404
    test "$reconcile_status" = 404
    if ! grep --quiet '"id":"FREE"' <<<"$catalog" \
      || ! grep --quiet '"dailyCreditLimit":100' <<<"$catalog"; then
      echo 'Smoke test: catálogo gratuito não apresenta o plano Livre com 100 créditos diários.' >&2
      exit 1
    fi
    if grep --quiet '"id":"ESSENTIAL"\|"id":"PRO"' <<<"$catalog"; then
      echo 'paid plans leaked into the free-launch catalog' >&2
      exit 1
    fi
    exit 0
  fi
  if ! docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep --quiet '^true$'; then
    echo 'Smoke test: o contêiner encerrou antes de ficar pronto.' >&2
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

echo 'Smoke test: /health ou /ready não respondeu com sucesso em 30 segundos.' >&2
docker logs "$container"
exit 1
