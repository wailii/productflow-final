#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ensure_env_files

DATA_DIR="$(read_env_value PRODUCTFLOW_DATA_DIR "${ROOT_ENV_FILE}")"
if [[ -z "${DATA_DIR}" ]]; then
  echo "PRODUCTFLOW_DATA_DIR is missing in ${ROOT_ENV_FILE}"
  exit 1
fi
if [[ ! -d "${DATA_DIR}" ]]; then
  echo "Data directory does not exist: ${DATA_DIR}"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-${HOME}/server-backups/productflow}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/productflow-data-${TIMESTAMP}.tgz"

tar -czf "${ARCHIVE}" -C "${DATA_DIR}" .
find "${BACKUP_DIR}" -type f -name "productflow-data-*.tgz" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup created: ${ARCHIVE}"
