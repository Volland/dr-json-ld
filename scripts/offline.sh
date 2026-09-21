#!/usr/bin/env bash
# Runs a CI step with no network: `shell: bash scripts/offline.sh {0}`.
#
# The step gets a fresh network namespace holding only loopback, and runs in it
# as the invoking user. Dropping outbound traffic for the whole machine instead
# (`iptables -P OUTPUT DROP`) also cuts the runner agent off from GitHub, and the
# job then dies as "the hosted runner lost communication with the server" — which
# is what every CI run did while that was the mechanism.
#
# See lat.md/processing#Processing#Context Resolution#Offline by default.
set -euo pipefail

exec sudo unshare --net -- bash -c '
  ip link set lo up
  exec sudo -u "$1" env PATH="$2" HOME="$3" GITHUB_WORKSPACE="$4" LDM_NETWORK_DISABLED=1 \
    bash -eo pipefail "$5"
' _ "$(id -un)" "$PATH" "$HOME" "${GITHUB_WORKSPACE:-$PWD}" "$1"
