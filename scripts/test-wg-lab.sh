#!/bin/bash
set -euo pipefail

trap 'bash /mnt/c/Users/hp/Downloads/DATAPLUS/scripts/stop-wg-lab.sh >/dev/null 2>&1 || true' EXIT

bash /mnt/c/Users/hp/Downloads/DATAPLUS/scripts/setup-wg-lab.sh
sleep 3

echo "--- tunnel ping ---"
set +e
ip netns exec dataplus-client ping -c 3 -W 2 10.77.0.1
PING_STATUS=$?
set -e
echo "PING_STATUS=$PING_STATUS"

echo "--- server counters ---"
wg show wgdataplus

echo "--- client counters ---"
ip netns exec dataplus-client wg show wgclient
