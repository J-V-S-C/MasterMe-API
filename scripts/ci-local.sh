#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose --env-file .env --env-file .env.development up -d test-db
bun install --frozen-lockfile
bun run validate
bun run validate:dependencies

DATABASE_URL='postgresql://postgres.project:password@pooler.example.com:5432/postgres?sslmode=require' \
GEMINI_API_KEY=ci-placeholder \
MASTERME_IMAGE=ghcr.io/example/masterme:ci \
SUPABASE_URL=https://example.supabase.co \
  docker compose -f deploy/compose.yml config --quiet

docker build --tag masterme-backend:precommit .

set -a
# The versioned file points only to the dedicated local test database.
source .env.development
set +a

SMOKE_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')" \
  ./scripts/smoke-production-image.sh masterme-backend:precommit
