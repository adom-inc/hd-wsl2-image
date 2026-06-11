#!/usr/bin/env bash
# run-rootfs.sh — boot the golden rootfs's code-server under proot for
# browser-based testing, no WSL or docker needed.
#
# This is the TEST harness, not the production runtime: proot approximates
# the distro (no systemd boot, /etc/wsl.conf not exercised, no
# host.docker.internal, syscalls slower). What it DOES faithfully exercise:
# code-server itself, settings.json (theme/layout prefs), installed
# extensions (incl. auto-update against Open VSX), the trusted-domains
# patch, claude CLI on PATH, gallia skills, all baked CLIs — i.e. what a
# user sees when their browser hits code-server.
#
# Usage:
#   scripts/run-rootfs.sh                   # serve the last local build
#   ROOT=/path/to/rootfs scripts/run-rootfs.sh
#   PORT=38082 scripts/run-rootfs.sh
#   scripts/run-rootfs.sh --from v2         # download release v2, unpack, serve
#
# In an Adom container, reach it at https://<slug>.adom.cloud/proxy/<PORT>/
# (NEVER localhost — the browser is outside the container).

set -euo pipefail

PORT="${PORT:-38082}"
ROOT="${ROOT:-/tmp/hd-golden-build/rootfs}"
WORK="${WORK:-/tmp/hd-golden-build}"
PROOT="${PROOT:-${WORK}/proot}"
REPO=adom-inc/hd-wsl2-image

if [[ "${1:-}" == "--from" ]]; then
    VER="${2:?usage: run-rootfs.sh --from vN}"
    ROOT="/tmp/hd-golden-test/rootfs-${VER}"
    if [[ ! -d "${ROOT}/usr" ]]; then
        echo "Downloading + unpacking release ${VER} → ${ROOT} (needs sudo for ownership)..."
        mkdir -p "$(dirname "${ROOT}")"
        curl -fL "https://github.com/${REPO}/releases/download/${VER}/adom-golden-${VER}.tar.gz" \
            -o "/tmp/hd-golden-test/adom-golden-${VER}.tar.gz"
        sudo rm -rf "${ROOT}"; sudo mkdir -p "${ROOT}"
        sudo tar --numeric-owner -xzf "/tmp/hd-golden-test/adom-golden-${VER}.tar.gz" -C "${ROOT}"
    fi
fi

[[ -d "${ROOT}/usr" ]] || { echo "no rootfs at ${ROOT} — build first or use --from vN" >&2; exit 1; }

mkdir -p "${WORK}"
if [[ ! -x "${PROOT}" ]]; then
    curl -fsSL -o "${PROOT}" https://proot.gitlab.io/proot/bin/proot
    chmod +x "${PROOT}"
fi

echo "Serving golden rootfs code-server on 0.0.0.0:${PORT}"
echo "Adom container URL: \${VSCODE_PROXY_URI%/proxy/*}/proxy/${PORT}/ (slug from your env)"
exec "${PROOT}" -r "${ROOT}" -b /proc -b /dev -b /etc/resolv.conf:/etc/resolv.conf -w /home/adom \
    /usr/bin/env -i HOME=/home/adom USER=adom SHELL=/bin/bash TERM=xterm-256color \
    LANG=en_US.UTF-8 \
    PATH=/home/adom/.local/bin:/home/adom/.claude/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
    /usr/bin/code-server --bind-addr "0.0.0.0:${PORT}" --auth none --disable-telemetry --disable-update-check /home/adom/project
