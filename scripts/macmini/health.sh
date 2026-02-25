#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ensure_env_files
require_docker_compose

compose ps

HOST="$(read_env_value PRODUCTFLOW_BIND "${ROOT_ENV_FILE}")"
PORT="$(read_env_value PRODUCTFLOW_PORT "${ROOT_ENV_FILE}")"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

ok=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "http://${HOST}:${PORT}/" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "${ok}" -eq 1 ]]; then
  echo "HTTP health check OK: http://${HOST}:${PORT}/"
else
  echo "HTTP health check failed after retries: http://${HOST}:${PORT}/"
  exit 1
fi
