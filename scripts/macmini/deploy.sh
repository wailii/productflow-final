#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

"${SCRIPT_DIR}/prepare.sh"

PUBLIC_FLAG="${1:-}"
COMPOSE_ARGS=(up -d --build)
if [[ "${PUBLIC_FLAG}" == "--public" ]]; then
  TOKEN="$(read_env_value CF_TUNNEL_TOKEN "${ROOT_ENV_FILE}")"
  if [[ -z "${TOKEN}" ]]; then
    echo "CF_TUNNEL_TOKEN is empty in ${ROOT_ENV_FILE}"
    exit 1
  fi
  COMPOSE_ARGS=(--profile public "${COMPOSE_ARGS[@]}")
fi

compose "${COMPOSE_ARGS[@]}"
echo "Deploy complete."
echo "Run ./scripts/macmini/health.sh for health verification."
