#!/bin/bash
set -euo pipefail

if ip link show dev wgdpdev0 >/dev/null 2>&1; then
  ip link set dev wgdpdev0 down
  ip link delete dev wgdpdev0
fi

echo "DATAPLUS_WG_DEVICE_GATEWAY_STOPPED"
