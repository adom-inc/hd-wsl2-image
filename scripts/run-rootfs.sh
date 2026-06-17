#!/usr/bin/env bash
# run-rootfs.sh — boot the golden rootfs's code-server under proot for a quick
# browser preview. FOR A REAL LINUX HOST ONLY (your own box / a throwaway VM).
#
# ⛔ NEVER RUN THIS IN AN ADOM CLOUD CONTAINER. See cloud-container-safety:
# the cloud container's boot code-server is the unsupervised foreground child
# of PID 1 with no supervisor; a nested proot code-server competes for the same
# memory and HAS BRICKED THE CONTAINER (corrupted boot launcher → admin
# rebuild). To preview a golden image, import it into a disposable WSL2 distro
# on the laptop and run code-server THERE (golden-image-test skill). This guard
# below hard-refuses to start in the cloud container.

set -euo pipefail

# ── cloud-container guard ──────────────────────────────────────────────────
# Refuse to run where a boot code-server is PID 1's child (the Adom cloud
# container). Override only on a genuine throwaway host with ALLOW_PROOT_HERE=1.
if [[ "${ALLOW_PROOT_HERE:-}" != "1" ]]; then
    if pgrep -f code-server-entrypoint >/dev/null 2>&1 \
       || [[ -e /usr/local/bin/code-server-entrypoint.sh ]] \
       || [[ -n "${VSCODE_PROXY_URI:-}" ]]; then
        echo "REFUSING: this looks like an Adom cloud container (boot code-server detected)." >&2
        echo "Running a nested proot code-server here can brick it — see cloud-container-safety." >&2
        echo "Preview the image in a disposable laptop WSL2 distro instead (golden-image-test)." >&2
        echo "If this is genuinely a throwaway Linux host, re-run with ALLOW_PROOT_HERE=1." >&2
        exit 1
    fi
fi

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
