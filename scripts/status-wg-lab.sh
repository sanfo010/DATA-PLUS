#!/bin/bash
set -euo pipefail

if ! command -v wg >/dev/null 2>&1 || ! command -v ip >/dev/null 2>&1; then
  echo "available=0"
  exit 0
fi

echo "available=1"
LAB=/root/dataplus-lab
peer_public_key="$(cat "$LAB/client.pub" 2>/dev/null || true)"
server_public_key="$(cat "$LAB/server.pub" 2>/dev/null || true)"
if ! ip link show dev wgdataplus >/dev/null 2>&1; then
  echo "interface_up=0"
  echo "peer_public_key=${peer_public_key}"
  echo "server_public_key=${server_public_key}"
  echo "endpoint=10.88.0.1:51820"
  echo "handshake_seconds=0"
  echo "rx_bytes=0"
  echo "tx_bytes=0"
  exit 0
fi

echo "interface_up=1"
echo "server_public_key=${server_public_key}"
transfer="$(wg show wgdataplus transfer 2>/dev/null | awk 'NR == 1 { print $2 " " $3 }')"
handshake="$(wg show wgdataplus latest-handshakes 2>/dev/null | awk 'NR == 1 { print $2 }')"
read -r rx_bytes tx_bytes <<< "${transfer:-0 0}"

echo "peer_public_key=${peer_public_key}"
echo "endpoint=10.88.0.1:51820"
echo "handshake_seconds=${handshake:-0}"
echo "rx_bytes=${rx_bytes:-0}"
echo "tx_bytes=${tx_bytes:-0}"
