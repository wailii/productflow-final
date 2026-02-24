#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_docker_compose
ensure_env_files

DATA_DIR="$(read_env_value PRODUCTFLOW_DATA_DIR "${ROOT_ENV_FILE}")"
if [[ -z "${DATA_DIR}" ]]; then
  echo "PRODUCTFLOW_DATA_DIR is missing in ${ROOT_ENV_FILE}"
  exit 1
fi

mkdir -p "${DATA_DIR}"
echo "Data directory ready: ${DATA_DIR}"
echo "Preparation complete."
