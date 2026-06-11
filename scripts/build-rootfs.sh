#!/usr/bin/env bash
# build-rootfs.sh — build the golden WSL2 rootfs WITHOUT docker.
#
# chroot-based translation of image/Dockerfile for environments (like the
# Adom cloud container) that have sudo + chroot + mknod but no docker
# daemon, no mount capability, and no user namespaces. Produces the same
# artifact a `docker build` + `docker export` would: a flat rootfs tarball
# for `wsl --import`.
#
# Keep the steps in lockstep with image/Dockerfile — that file is the
# canonical recipe; this script exists only until CI (with real docker)
# can run it.
#
# Usage:
#   scripts/build-rootfs.sh            # → /tmp/hd-golden-build/adom-golden-v1.tar.gz
#   GOLDEN_VERSION=v2 scripts/build-rootfs.sh

set -euo pipefail
cd "$(dirname "$0")/.."

VER="${GOLDEN_VERSION:-v1}"
CSV="${CODE_SERVER_VERSION:-4.112.0}"
WIKI_BASE="${WIKI_BASE:-https://wiki-ufypy5dpx93o.adom.cloud}"
WORK="${WORK:-/tmp/hd-golden-build}"
ROOT="${WORK}/rootfs"
OUT="${WORK}/adom-golden-${VER}.tar.gz"

mkdir -p "${WORK}"
sudo rm -rf "${ROOT}"
mkdir -p "${ROOT}"

log() { echo "[build-rootfs $(date +%H:%M:%S)] $*"; }

# ── 1. Ubuntu base rootfs (the non-docker equivalent of FROM ubuntu:24.04) ─
BASE_INDEX="https://cdimage.ubuntu.com/ubuntu-base/releases/noble/release/"
BASE="$(curl -fsSL "${BASE_INDEX}" | grep -o 'ubuntu-base-24\.04[.0-9]*-base-amd64\.tar\.gz' | sort -uV | tail -1)"
[[ -n "${BASE}" ]] || { echo "could not discover ubuntu-base tarball at ${BASE_INDEX}" >&2; exit 1; }
if [[ ! -f "${WORK}/${BASE}" ]]; then
    log "downloading ${BASE}"
    curl -fL --retry 3 "${BASE_INDEX}${BASE}" -o "${WORK}/${BASE}.part"
    mv "${WORK}/${BASE}.part" "${WORK}/${BASE}"
fi
log "extracting ${BASE}"
sudo tar -xpf "${WORK}/${BASE}" -C "${ROOT}"

# ── 2. chroot plumbing: device nodes, DNS, no-service-start guard ─────────
# We cannot mount /proc or devtmpfs (no CAP_SYS_ADMIN), so create the
# static device nodes apt/dpkg/gpg need. The package set below is chosen
# to survive a /proc-less chroot; anything that genuinely needs /proc
# belongs in CI, not here.
makedev() { [[ -e "${ROOT}/dev/$1" ]] || sudo mknod -m "$5" "${ROOT}/dev/$1" "$2" "$3" "$4"; }
makedev null    c 1 3 666
makedev zero    c 1 5 666
makedev full    c 1 7 666
makedev random  c 1 8 666
makedev urandom c 1 9 666
makedev tty     c 5 0 666
sudo mkdir -p "${ROOT}/dev/pts" "${ROOT}/dev/shm" "${ROOT}/proc" "${ROOT}/sys"

sudo cp /etc/resolv.conf "${ROOT}/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' | sudo tee "${ROOT}/usr/sbin/policy-rc.d" >/dev/null
sudo chmod +x "${ROOT}/usr/sbin/policy-rc.d"

in_root() {
    sudo chroot "${ROOT}" /usr/bin/env -i \
        HOME=/root TERM=xterm LANG=C.UTF-8 \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        DEBIAN_FRONTEND=noninteractive \
        bash -o pipefail -c "$1"
}

# ── 3. apt baseline — keep identical to image/Dockerfile ──────────────────
log "apt baseline"
in_root "apt-get update"
in_root "apt-get install -y --no-install-recommends \
    ca-certificates curl wget git jq unzip zip tar gnupg openssh-client \
    sudo locales build-essential cmake pkg-config libssl-dev \
    nodejs npm python3 python3-pip"

log "github cli"
in_root "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh"

log "code-server ${CSV}"
in_root "curl -fsSL \"https://github.com/coder/code-server/releases/download/v${CSV}/code-server_${CSV}_\$(dpkg --print-architecture).deb\" -o /tmp/code-server.deb \
  && dpkg -i /tmp/code-server.deb && rm -f /tmp/code-server.deb"

log "locale"
in_root "sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen"

# ── 4. adom user (uid/gid 1001 = cloud container parity) ──────────────────
log "adom user"
in_root "groupadd -g 1001 adom \
  && useradd -m -u 1001 -g 1001 -s /bin/bash adom \
  && echo 'adom ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/adom \
  && chmod 0440 /etc/sudoers.d/adom \
  && mkdir -p /home/adom/project && chown adom:adom /home/adom/project"

# ── 5. Adom CLIs from the public wiki static path ──────────────────────────
log "adom CLIs"
in_root "set -e; curl -fsSL '${WIKI_BASE}/static/skills/adom-cli/adom-cli' -o /usr/local/bin/adom-cli; \
  for b in adom-wiki adom-vscode adom-mouser adom-digikey adom-jlcpcb adom-parts-search adom-gchat; do \
      curl -fsSL \"${WIKI_BASE}/static/apps/\${b}/\${b}\" -o \"/usr/local/bin/\${b}\"; \
  done; chmod 0755 /usr/local/bin/adom-*"

# ── 6. WSL config + bootstrap updater ──────────────────────────────────────
log "configs"
sudo install -m 0644 image/wsl.conf "${ROOT}/etc/wsl.conf"
sudo install -m 0755 image/init-host-internal.sh "${ROOT}/etc/init-host-internal.sh"
sudo install -D -m 0755 image/bootstrap.sh "${ROOT}/opt/adom/bootstrap.sh"
in_root "chown -R adom:adom /opt/adom"

# ── 7. skill payloads as the adom user (best-effort, same as Dockerfile) ──
log "skill payloads"
in_root "runuser -u adom -- bash -lc ' \
    adom-cli skills install || echo \"bake: adom-cli skills install deferred to first run\"; \
    adom-wiki install --bin-dir /tmp/adom-wiki-scratch || echo \"bake: adom-wiki install deferred\"; \
    rm -rf /tmp/adom-wiki-scratch; \
    for b in adom-mouser adom-digikey adom-jlcpcb adom-parts-search adom-gchat; do \
        \$b install || echo \"bake: \$b install deferred to first run\"; \
    done; exit 0'"

# ── 8. sentinel + version stamp ────────────────────────────────────────────
in_root "mkdir -p /var/lib/adom-bootstrap \
  && date -Iseconds > /var/lib/adom-bootstrap/phase-a-done \
  && echo '${VER}' > /etc/adom-golden-version"

# ── 9. smoke test (chroot analog of the CI smoke step) ────────────────────
log "smoke test"
in_root "set -e; code-server --version; node --version; git --version; \
  test -f /etc/wsl.conf; test -x /etc/init-host-internal.sh; test -x /opt/adom/bootstrap.sh; \
  test -f /var/lib/adom-bootstrap/phase-a-done; cat /etc/adom-golden-version; \
  for b in adom-cli adom-wiki adom-vscode adom-mouser adom-digikey adom-jlcpcb adom-parts-search adom-gchat; do \
      test -x /usr/local/bin/\$b || { echo \"MISSING \$b\"; exit 1; }; done; \
  id adom | grep -q uid=1001; echo SMOKE-OK"

# ── 10. cleanup + pack ─────────────────────────────────────────────────────
log "cleanup"
in_root "apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*"
sudo rm -f "${ROOT}/usr/sbin/policy-rc.d" "${ROOT}/etc/resolv.conf"

log "packing ${OUT}"
sudo tar --numeric-owner -C "${ROOT}" -cf - . | gzip -9 > "${OUT}"
sha256sum "${OUT}" | tee "${OUT}.sha256"
du -h "${OUT}"
log "done"
