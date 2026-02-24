#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${REPO_ROOT}/docker-compose.macmini.yml"
ROOT_ENV_FILE="${REPO_ROOT}/.env.macmini"
ROOT_ENV_EXAMPLE="${REPO_ROOT}/.env.macmini.example"
APP_ENV_FILE="${REPO_ROOT}/productflow-showcase/.env.macmini"
APP_ENV_EXAMPLE="${REPO_ROOT}/productflow-showcase/.env.macmini.example"

read_env_value() {
  local key="$1"
  local file="$2"
  local line value
  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf "%s" "${value}"
}

ensure_env_files() {
  local created=0
  if [[ ! -f "${ROOT_ENV_FILE}" ]]; then
    cp "${ROOT_ENV_EXAMPLE}" "${ROOT_ENV_FILE}"
    echo "Created ${ROOT_ENV_FILE}"
    created=1
  fi
  if [[ ! -f "${APP_ENV_FILE}" ]]; then
    cp "${APP_ENV_EXAMPLE}" "${APP_ENV_FILE}"
    echo "Created ${APP_ENV_FILE}"
    created=1
  fi
  if [[ "${created}" -eq 1 ]]; then
    echo "Please edit the generated env files, then rerun this command."
    exit 1
  fi
}

require_docker_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed."
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is not available."
    exit 1
  fi
}

compose() {
  docker compose --env-file "${ROOT_ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}
