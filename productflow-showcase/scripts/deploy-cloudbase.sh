#!/usr/bin/env bash
set -euo pipefail

ENV_ID="${1:-}"
SERVICE_NAME="${2:-productflow-showcase}"
SOURCE_DIR="${3:-.}"

if [[ -z "${ENV_ID}" ]]; then
  cat <<'EOF'
Usage:
  ./scripts/deploy-cloudbase.sh <ENV_ID> [SERVICE_NAME] [SOURCE_DIR]

Example:
  ./scripts/deploy-cloudbase.sh env-xxxx productflow-showcase .
EOF
  exit 1
fi

echo "[1/2] Deploying source to CloudBase CloudRun..."
npx -y -p @cloudbase/cli tcb cloudrun deploy \
  -e "${ENV_ID}" \
  -s "${SERVICE_NAME}" \
  --source "${SOURCE_DIR}" \
  --port 3000 \
  --force

cat <<EOF
[2/2] Deploy finished.

Next in CloudBase Console for service "${SERVICE_NAME}":
1. Set environment variables from .env.cloudbase.example.
2. Mount persistent storage and set LOCAL_STORAGE_ROOT to the mounted path.
3. Keep max instances = 1 when using local-db.json fallback.
EOF
