#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'usage: deploy-and-verify.sh <immutable-image>' >&2
  exit 64
fi

deploy_image=$1
deploy_dir=${MASTERME_DEPLOY_DIR:-/opt/masterme}
compose_file=$deploy_dir/compose.yml
environment_file=$deploy_dir/.env
previous_file=$deploy_dir/.previous-image

cd "$deploy_dir"
previous_container=$(MASTERME_IMAGE=$deploy_image docker compose --env-file "$environment_file" -f "$compose_file" ps -q api)
previous_image=''
if [ -n "$previous_container" ]; then
  previous_image=$(docker inspect --format '{{.Config.Image}}' "$previous_container" 2>/dev/null || true)
fi
if [ -n "$previous_image" ]; then
  umask 077
  printf '%s\n' "$previous_image" > "$previous_file"
fi

MASTERME_IMAGE=$deploy_image docker compose --env-file "$environment_file" -f "$compose_file" pull
MASTERME_IMAGE=$deploy_image docker compose --env-file "$environment_file" -f "$compose_file" run --rm api bun run migrate
MASTERME_IMAGE=$deploy_image docker compose --env-file "$environment_file" -f "$compose_file" up -d --remove-orphans

set +e
curl --fail --silent --show-error --retry 20 --retry-delay 3 --retry-all-errors --connect-timeout 5 --max-time 10 http://127.0.0.1:3333/ready
readiness_status=$?
set -e

if [ "$readiness_status" -eq 0 ]; then
  exit 0
fi

echo "readiness failed with status $readiness_status; attempting automatic rollback" >&2
rollback_status=1
if [ -n "$previous_image" ]; then
  set +e
  MASTERME_IMAGE=$previous_image docker compose --env-file "$environment_file" -f "$compose_file" up -d --remove-orphans
  rollback_status=$?
  set -e
fi
if [ "$rollback_status" -eq 0 ]; then
  echo "previous image restored" >&2
else
  echo "automatic rollback could not restore a previous image; manual intervention required" >&2
fi

# Preserve the readiness failure as the workflow result even when rollback fails.
exit "$readiness_status"
