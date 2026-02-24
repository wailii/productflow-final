#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.productflow.demo.plist"

DEPLOY_SCRIPT="${REPO_ROOT}/scripts/macmini/deploy.sh"
PUBLIC_ARG=""
if [[ "${1:-}" == "--public" ]]; then
  PUBLIC_ARG="--public"
fi

mkdir -p "${HOME}/Library/LaunchAgents"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.productflow.demo</string>
  <key>ProgramArguments</key>
  <array>
    <string>${DEPLOY_SCRIPT}</string>
$(if [[ -n "${PUBLIC_ARG}" ]]; then echo "    <string>${PUBLIC_ARG}</string>"; fi)
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/productflow-demo.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/productflow-demo.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" com.productflow.demo >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl enable "gui/$(id -u)/com.productflow.demo"
launchctl kickstart -k "gui/$(id -u)/com.productflow.demo"

echo "LaunchAgent installed: ${PLIST_PATH}"
