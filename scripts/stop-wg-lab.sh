#!/bin/bash
set -euo pipefail

ip netns del dataplus-client 2>/dev/null || true
ip link del dpveth0 2>/dev/null || true
ip link del wgdataplus 2>/dev/null || true

echo "DATAPLUS_WG_LAB_STOPPED"
