#!/usr/bin/env bash

set -euo pipefail

PLIST_PATH="${HOME}/Library/LaunchAgents/com.productflow.demo.plist"
launchctl bootout "gui/$(id -u)" com.productflow.demo >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"
echo "LaunchAgent removed."
