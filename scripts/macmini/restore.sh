#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-tar.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ensure_env_files
require_docker_compose

DATA_DIR="$(read_env_value PRODUCTFLOW_DATA_DIR "${ROOT_ENV_FILE}")"
if [[ -z "${DATA_DIR}" ]]; then
  echo "PRODUCTFLOW_DATA_DIR is missing in ${ROOT_ENV_FILE}"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
CURRENT_BACKUP="${DATA_DIR}.before-restore.${TIMESTAMP}"

mkdir -p "$(dirname "${DATA_DIR}")"

if [[ -d "${DATA_DIR}" ]]; then
  mv "${DATA_DIR}" "${CURRENT_BACKUP}"
fi
mkdir -p "${DATA_DIR}"

compose stop app || true
tar -xzf "${BACKUP_FILE}" -C "${DATA_DIR}"
compose up -d app

echo "Restore complete from: ${BACKUP_FILE}"
if [[ -d "${CURRENT_BACKUP}" ]]; then
  echo "Previous data moved to: ${CURRENT_BACKUP}"
fi
