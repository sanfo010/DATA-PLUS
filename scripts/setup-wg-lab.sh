#!/bin/bash
set -euo pipefail

LAB=/root/dataplus-lab
mkdir -p "$LAB"
chmod 700 "$LAB"
umask 077

if [[ ! -s "$LAB/server.key" ]]; then
  wg genkey | tee "$LAB/server.key" >/dev/null
fi
if [[ ! -s "$LAB/client.key" ]]; then
  wg genkey | tee "$LAB/client.key" >/dev/null
fi

wg pubkey < "$LAB/server.key" > "$LAB/server.pub"
wg pubkey < "$LAB/client.key" > "$LAB/client.pub"
chmod 600 "$LAB/server.key" "$LAB/client.key"

ip netns del dataplus-client 2>/dev/null || true
ip link del dpveth0 2>/dev/null || true
ip link del wgdataplus 2>/dev/null || true

ip netns add dataplus-client
ip link add dpveth0 type veth peer name dpveth1
ip link set dpveth1 netns dataplus-client

ip addr add 10.88.0.1/30 dev dpveth0
ip link set dpveth0 up
ip netns exec dataplus-client ip addr add 10.88.0.2/30 dev dpveth1
ip netns exec dataplus-client ip link set dpveth1 up
ip netns exec dataplus-client ip link set lo up

ip link add wgdataplus type wireguard
ip addr add 10.77.0.1/24 dev wgdataplus
wg set wgdataplus \
  listen-port 51820 \
  private-key "$LAB/server.key"
wg set wgdataplus peer "$(cat "$LAB/client.pub")" allowed-ips 10.77.0.2/32
ip link set wgdataplus up

ip netns exec dataplus-client ip link add wgclient type wireguard
ip netns exec dataplus-client ip addr add 10.77.0.2/24 dev wgclient
ip netns exec dataplus-client wg set wgclient \
  listen-port 0 \
  private-key "$LAB/client.key"
ip netns exec dataplus-client wg set wgclient \
  peer "$(cat "$LAB/server.pub")" \
  endpoint 10.88.0.1:51820 \
  allowed-ips 10.77.0.1/32 \
  persistent-keepalive 25
ip netns exec dataplus-client ip link set wgclient up

# Generate a real handshake and verify only the private lab route.
ip netns exec dataplus-client ping -c 1 -W 3 10.77.0.1 >/dev/null

echo "DATAPLUS_WG_LAB_READY"
