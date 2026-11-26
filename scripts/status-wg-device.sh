#!/bin/bash
set -euo pipefail

DEVICE_ID="${1:-}"
if [[ ! "$DEVICE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid device identifier." >&2
  exit 2
fi

PEER_DIR="/root/dataplus-lab/devices/peers/$DEVICE_ID"
if [[ ! -s "$PEER_DIR/public.key" ]]; then
  echo "found=0"
  exit 0
fi

public_key="$(cat "$PEER_DIR/public.key")"
address="$(cat "$PEER_DIR/address")"
created_at="$(cat "$PEER_DIR/created_at")"
status=active
if [[ -f "$PEER_DIR/revoked" ]]; then
  status=revoked
fi

handshake=0
interface_loaded=0
rx_bytes=unavailable
tx_bytes=unavailable
if [[ "$status" == active ]] \
  && ip link show dev wgdpdev0 >/dev/null 2>&1 \
  && wg show wgdpdev0 peers | grep -Fxq "$public_key"; then
  interface_loaded=1
  handshake="$(wg show wgdpdev0 latest-handshakes | awk -v key="$public_key" '$1 == key { print $2 }')"
  read -r rx_bytes tx_bytes < <(
    wg show wgdpdev0 transfer | awk -v key="$public_key" '$1 == key { print $2 " " $3 }'
  ) || true
  rx_bytes="${rx_bytes:-0}"
  tx_bytes="${tx_bytes:-0}"
fi

printf 'found=1\n'
printf 'device_id=%s\n' "$DEVICE_ID"
printf 'public_key=%s\n' "$public_key"
printf 'assigned_ip=%s\n' "$address"
printf 'created_at=%s\n' "$created_at"
printf 'status=%s\n' "$status"
printf 'interface_loaded=%s\n' "$interface_loaded"
server_public_key=""
listen_port=""
if ip link show dev wgdpdev0 >/dev/null 2>&1; then
  server_public_key="$(wg show wgdpdev0 public-key)"
  listen_port="$(wg show wgdpdev0 listen-port)"
fi
printf 'server_public_key=%s\n' "$server_public_key"
printf 'listen_port=%s\n' "$listen_port"
printf 'handshake_seconds=%s\n' "${handshake:-0}"
printf 'rx_bytes=%s\n' "$rx_bytes"
printf 'tx_bytes=%s\n' "$tx_bytes"
