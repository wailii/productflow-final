#!/usr/bin/env bash

set -euo pipefail

echo "Applying recommended no-sleep settings for server mode (requires sudo)..."
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 womp 1 tcpkeepalive 1 powernap 1
pmset -g
