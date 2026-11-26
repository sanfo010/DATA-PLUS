#!/bin/bash
set -euo pipefail

DEVICE_ID="${1:-}"
if [[ ! "$DEVICE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid device identifier." >&2
  exit 2
fi

LAB=/root/dataplus-lab/devices
PEER_DIR="$LAB/peers/$DEVICE_ID"
if [[ ! -d "$LAB/peers" ]]; then
  echo "found=0"
  exit 0
fi
exec 9>"$LAB/peers.lock"
flock -x 9
if [[ ! -s "$PEER_DIR/public.key" ]]; then
  echo "found=0"
  exit 0
fi

public_key="$(cat "$PEER_DIR/public.key")"
if ip link show dev wgdpdev0 >/dev/null 2>&1; then
  wg set wgdpdev0 peer "$public_key" remove
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$PEER_DIR/revoked"
chmod 600 "$PEER_DIR/revoked"
echo "revoked=1"
