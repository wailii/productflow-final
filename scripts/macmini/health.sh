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

if curl -fsS --max-time 10 "http://${HOST}:${PORT}/" >/dev/null; then
  echo "HTTP health check OK: http://${HOST}:${PORT}/"
else
  echo "HTTP health check failed: http://${HOST}:${PORT}/"
  exit 1
fi
