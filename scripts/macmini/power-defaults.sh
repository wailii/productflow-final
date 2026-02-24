#!/usr/bin/env bash

set -euo pipefail

echo "Restoring macOS default power settings (requires sudo)..."
sudo pmset restoredefaults
pmset -g
