#!/usr/bin/env bash
# init-host-internal.sh — write `host.docker.internal` into /etc/hosts so
# Adom code that talks to the Windows host via that alias keeps working
# under WSL2 (where Docker Desktop's host-gateway magic doesn't exist).
#
# Idempotent: removes any prior line we wrote and rewrites against the
# current resolv.conf nameserver. WSL2's default NAT mode puts the host
# at the nameserver IP; under `networkingMode=mirrored` (newer WSL) the
# alias resolves natively and our line still won't hurt anything.
#
# Called by WslDistroRuntime::setup_and_start at distro start. Also safe
# to run manually for diagnostics.

set -euo pipefail

MARKER="# adom-host-internal"
HOSTS=/etc/hosts

# Pull the first nameserver from /etc/resolv.conf. On default-NAT WSL2
# this is the Windows host's loopback gateway.
HOST_IP="$(awk '/^nameserver / { print $2; exit }' /etc/resolv.conf || true)"

if [[ -z "${HOST_IP:-}" ]]; then
    echo "init-host-internal: no nameserver in /etc/resolv.conf, skipping" >&2
    exit 0
fi

# Remove any prior line we wrote, then append the fresh one. `sudo` so
# this runs cleanly under the default `adom` user too — passwordless
# sudo is granted in the Dockerfile.
sudo sed -i "/${MARKER}\$/d" "${HOSTS}"
echo "${HOST_IP} host.docker.internal ${MARKER}" | sudo tee -a "${HOSTS}" >/dev/null

echo "init-host-internal: host.docker.internal -> ${HOST_IP}"
