#!/bin/bash
set -euo pipefail

DEVICE_ID="${1:-}"
PUBLIC_KEY="${2:-}"
if [[ ! "$DEVICE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid device identifier." >&2
  exit 2
fi
if [[ ! "$PUBLIC_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
  echo "Invalid WireGuard public key." >&2
  exit 3
fi

LAB=/root/dataplus-lab/devices
PEERS="$LAB/peers"
PEER_DIR="$PEERS/$DEVICE_ID"
umask 077
mkdir -p "$PEERS"
chmod 700 "$LAB" "$PEERS"
exec 9>"$LAB/peers.lock"
flock -x 9

if [[ -f "$PEER_DIR/revoked" ]]; then
  echo "This device peer is revoked and requires key rotation." >&2
  exit 4
fi

mkdir -m 700 -p "$PEER_DIR"
chmod 700 "$PEER_DIR"

if [[ -s "$PEER_DIR/public.key" ]] && [[ "$(cat "$PEER_DIR/public.key")" != "$PUBLIC_KEY" ]]; then
  echo "The stored public key differs from the enrollment key." >&2
  exit 5
fi

if [[ ! -s "$PEER_DIR/address" ]]; then
  assigned_ip=""
  for host in $(seq 10 254); do
    candidate="10.78.0.$host"
    used=0
    for existing in "$PEERS"/*/address; do
      [[ -f "$existing" ]] || continue
      if [[ "$(cat "$existing")" == "$candidate" ]]; then
        used=1
        break
      fi
    done
    if [[ "$used" == 0 ]]; then
      assigned_ip="$candidate"
      break
    fi
  done
  if [[ -z "$assigned_ip" ]]; then
    echo "No private lab address is available." >&2
    exit 6
  fi
  printf '%s\n' "$assigned_ip" > "$PEER_DIR/address"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$PEER_DIR/created_at"
fi

printf '%s\n' "$PUBLIC_KEY" > "$PEER_DIR/public.key"
chmod 644 "$PEER_DIR/public.key"
wg set wgdpdev0 peer "$PUBLIC_KEY" allowed-ips "$(cat "$PEER_DIR/address")/32"

printf 'device_id=%s\n' "$DEVICE_ID"
printf 'public_key=%s\n' "$PUBLIC_KEY"
printf 'assigned_ip=%s\n' "$(cat "$PEER_DIR/address")"
printf 'created_at=%s\n' "$(cat "$PEER_DIR/created_at")"
printf 'status=active\n'
