#!/bin/bash
set -euo pipefail

LAB=/root/dataplus-lab/devices
PEERS="$LAB/peers"
umask 077
mkdir -p "$PEERS"
chmod 700 "$LAB" "$PEERS"
exec 9>"$LAB/peers.lock"
flock -x 9

if [[ ! -s "$LAB/server.key" ]]; then
  wg genkey > "$LAB/server.key"
fi
chmod 600 "$LAB/server.key"

if ! ip link show dev wgdpdev0 >/dev/null 2>&1; then
  ip link add dev wgdpdev0 type wireguard
fi
wg set wgdpdev0 listen-port 51821 private-key "$LAB/server.key"
if ! ip -o -4 addr show dev wgdpdev0 | grep -Fq '10.78.0.1/24'; then
  ip addr add 10.78.0.1/24 dev wgdpdev0
fi
ip link set wgdpdev0 up

shopt -s nullglob
for peer_dir in "$PEERS"/*; do
  [[ -d "$peer_dir" && -s "$peer_dir/public.key" && -s "$peer_dir/address" ]] || continue
  [[ -f "$peer_dir/revoked" ]] && continue
  public_key="$(cat "$peer_dir/public.key")"
  address="$(cat "$peer_dir/address")"
  wg set wgdpdev0 peer "$public_key" allowed-ips "$address/32"
done

echo "DATAPLUS_WG_DEVICE_GATEWAY_READY"
