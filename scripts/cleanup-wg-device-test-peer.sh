#!/bin/bash
set -euo pipefail

DEVICE_ID="${1:-}"
if [[ ! "$DEVICE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid device identifier." >&2
  exit 2
fi

PEER_DIR="/root/dataplus-lab/devices/peers/$DEVICE_ID"
if [[ -s "$PEER_DIR/public.key" ]] && ip link show dev wgdpdev0 >/dev/null 2>&1; then
  wg set wgdpdev0 peer "$(cat "$PEER_DIR/public.key")" remove
fi
for file in private.key public.key address created_at revoked; do
  rm -f -- "$PEER_DIR/$file"
done
if [[ -d "$PEER_DIR" ]]; then
  rmdir -- "$PEER_DIR"
fi
