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

VER="${GOLDEN_VERSION:-v2}"
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
    nodejs npm python3 python3-pip \
    systemd systemd-sysv"

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

# ── 7. stage gallia snapshot + HD skills, then bake the HD setup steps ────
# gallia: the local working tree, NO .git — the public image must not
# carry the private remote or require GitHub auth. Updates ship as new
# image versions (monthly bake), not as in-place git pulls.
GALLIA_SRC="${GALLIA_SRC:-${HOME}/gallia}"
log "staging gallia from ${GALLIA_SRC}"
[[ -d "${GALLIA_SRC}/skills" ]] || { echo "gallia working tree not found at ${GALLIA_SRC}" >&2; exit 1; }
sudo rm -rf "${ROOT}/home/adom/gallia"
sudo mkdir -p "${ROOT}/home/adom/gallia"
sudo tar -C "${GALLIA_SRC}" --exclude=.git --exclude=node_modules -cf - . | sudo tar -C "${ROOT}/home/adom/gallia" -xf -
in_root "chown -R adom:adom /home/adom/gallia"

# HD self-awareness skills (shared/ + wsl2/ buckets) staged for step 8.
HD_SKILLS_SRC="${HD_SKILLS_SRC:-${HOME}/project/hydrogen-desktop/skills/public-facing}"
log "staging HD skills from ${HD_SKILLS_SRC}"
[[ -d "${HD_SKILLS_SRC}/shared" ]] || { echo "HD skills not found at ${HD_SKILLS_SRC}" >&2; exit 1; }
sudo rm -rf "${ROOT}/tmp/hd-skills"
sudo mkdir -p "${ROOT}/tmp/hd-skills"
sudo cp -r "${HD_SKILLS_SRC}/shared" "${HD_SKILLS_SRC}/wsl2" "${ROOT}/tmp/hd-skills/"

# HD workspace-updater daemon (HD auto-update Part B) — staged for the daemon
# step in bake-hd-setup.sh. GUARDED: only present once feature/hd-auto-update
# is merged to hydrogen-desktop main (path absent pre-merge → bake skips).
HD_UPDATER_SRC="${HD_UPDATER_SRC:-${HOME}/project/hydrogen-desktop/src-tauri/crates/hd-app/resources/workspace-updater}"
if [[ -f "${HD_UPDATER_SRC}/adom-workspace-updater.sh" ]]; then
    log "staging workspace-updater daemon from ${HD_UPDATER_SRC}"
    sudo rm -rf "${ROOT}/tmp/workspace-updater"
    sudo mkdir -p "${ROOT}/tmp/workspace-updater"
    sudo cp "${HD_UPDATER_SRC}/adom-workspace-updater.sh" \
            "${HD_UPDATER_SRC}/adom-workspace-updater.service" \
            "${HD_UPDATER_SRC}/adom-workspace-updater.timer" \
            "${ROOT}/tmp/workspace-updater/"
else
    log "workspace-updater source absent (pre-merge) — daemon bake will skip"
fi

# bake-hd-setup.sh pre-runs the HD setup cascade (gallia install.mjs,
# claude CLI, Claude Code + adom-vscode extensions, VS Code settings,
# trusted domains, HD skills, adom-desktop CLI) — shared with Dockerfile.
log "bake HD setup steps"
sudo install -m 0755 image/bake-hd-setup.sh "${ROOT}/tmp/bake-hd-setup.sh"
in_root "bash /tmp/bake-hd-setup.sh && rm -f /tmp/bake-hd-setup.sh"

# ── 7e. functional claude verification (proot, host side) ─────────────────
# The bun-based claude binary needs /proc, which the chroot lacks — verify
# it with proot binding the host /proc. Then remove any state files the
# run generated: a baked ~/.claude.json would ship one shared anonymous
# telemetry/user ID to every install.
PROOT="${WORK}/proot"
if [[ ! -x "${PROOT}" ]]; then
    curl -fsSL -o "${PROOT}" https://proot.gitlab.io/proot/bin/proot
    chmod +x "${PROOT}"
fi
log "verify claude CLI under proot"
CLAUDE_V="$("${PROOT}" -r "${ROOT}" -b /proc -b /dev -w /home/adom \
    /usr/bin/env HOME=/home/adom USER=adom PATH=/usr/local/bin:/usr/bin:/bin \
    /home/adom/.local/bin/claude --version 2>/dev/null | head -1)"
echo "  claude --version → ${CLAUDE_V}"
[[ "${CLAUDE_V}" == *"Claude Code"* ]] || { echo "claude CLI failed proot verification" >&2; exit 1; }
sudo rm -rf "${ROOT}/home/adom/.claude.json" "${ROOT}/home/adom/.claude.json.backup" \
    "${ROOT}/home/adom/.claude/statsig" "${ROOT}/home/adom/.cache"

# ── 7c. public scrub (shared with image/Dockerfile) ────────────────────────
log "public scrub"
sudo install -m 0755 image/public-scrub.sh "${ROOT}/tmp/public-scrub.sh"
in_root "bash /tmp/public-scrub.sh && rm -f /tmp/public-scrub.sh"

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
  id adom | grep -q uid=1001; \
  test -f /home/adom/.claude/skills/adom/SKILL.md || { echo 'MISSING gallia skills'; exit 1; }; \
  test -d /home/adom/gallia/node_modules || { echo 'MISSING gallia node_modules'; exit 1; }; \
  test ! -e /home/adom/gallia/.git || { echo 'LEAK: gallia .git in image'; exit 1; }; \
  test -L /home/adom/.local/bin/claude && test -s \"\$(readlink -f /home/adom/.local/bin/claude)\" \
      || { echo 'MISSING claude CLI'; exit 1; }; \
  runuser -u adom -- /usr/lib/code-server/bin/code-server --list-extensions 2>/dev/null | grep -qi '^anthropic.claude-code' \
      || { echo 'MISSING claude-code extension'; exit 1; }; \
  runuser -u adom -- /usr/lib/code-server/bin/code-server --list-extensions 2>/dev/null | grep -qi '^adom' \
      || { echo 'MISSING adom-vscode extension'; exit 1; }; \
  jq -e '.\"workbench.colorTheme\" == \"Default Dark Modern\"' /home/adom/.local/share/code-server/User/settings.json >/dev/null \
      || { echo 'MISSING dark-mode settings.json'; exit 1; }; \
  jq -e 'has(\"claudeCode.selectedModel\") | not' /home/adom/.local/share/code-server/User/settings.json >/dev/null \
      || { echo 'LEAK: vscode settings pin a model'; exit 1; }; \
  jq -e '.\"chat.agent.enabled\" == false and .\"workbench.navigationControl.enabled\" == false' \
      /home/adom/.local/share/code-server/User/settings.json >/dev/null \
      || { echo 'MISSING chat/agent-UI disables in vscode settings'; exit 1; }; \
  grep -q 'disable-update-check: true' /home/adom/.config/code-server/config.yaml \
      || { echo 'MISSING code-server disable-update-check'; exit 1; }; \
  test -x /usr/lib/systemd/systemd && test -e /sbin/init \
      || { echo 'MISSING systemd (wsl.conf says systemd=true but no systemd binary → PID 1 falls back to /init, timer never fires)'; exit 1; }; \
  jq -e '.\"extensions.autoUpdate\" == true and .\"extensions.autoCheckUpdates\" == true' \
      /home/adom/.local/share/code-server/User/settings.json >/dev/null \
      || { echo 'MISSING extensions.autoUpdate/autoCheckUpdates'; exit 1; }; \
  if [ -e /usr/local/bin/adom-workspace-updater ]; then \
      test -x /usr/local/bin/adom-workspace-updater || { echo 'workspace-updater not executable'; exit 1; }; \
      [ \"\$(/usr/local/bin/adom-workspace-updater --version 2>/dev/null)\" = 'adom-workspace-updater 0.1.2' ] \
          || { echo \"workspace-updater version != 0.1.2: \$(/usr/local/bin/adom-workspace-updater --version 2>/dev/null)\"; exit 1; }; \
      test -L /etc/systemd/system/timers.target.wants/adom-workspace-updater.timer \
          || { echo 'workspace-updater timer not enabled'; exit 1; }; \
      echo 'workspace-updater daemon: baked + timer enabled'; \
  else echo 'workspace-updater: not baked (pre-merge)'; fi; \
  test ! -e /home/adom/project/.mcp.json || { echo 'LEAK: bake debris .mcp.json in project'; exit 1; }; \
  test -z \"\$(find /home/adom ! -user adom -print -quit)\" \
      || { echo \"OWNERSHIP: non-adom path under /home/adom: \$(find /home/adom ! -user adom -print -quit)\"; exit 1; }; \
  grep -q adom.activityBarSeeded /usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.html \
      || { echo 'MISSING trusted-domains patch'; exit 1; }; \
  ls /home/adom/.claude/skills/ | grep -q '^hd-' || { echo 'MISSING hd skills'; exit 1; }; \
  test -x /usr/local/bin/adom-desktop || { echo 'MISSING adom-desktop CLI'; exit 1; }; \
  jq -e 'has(\"model\") | not' /home/adom/.claude/settings.json >/dev/null \
      || { echo 'LEAK: settings.json pins a model'; exit 1; }; \
  jq -e '[(.hooks.UserPromptSubmit // [])[] | (.hooks // [])[] | .command // \"\"] \
          | any(contains(\"check-updates\")) | not' /home/adom/.claude/settings.json >/dev/null \
      || { echo 'LEAK: gallia update hook still registered'; exit 1; }; \
  echo SMOKE-OK"

# ── 10. cleanup + pack ─────────────────────────────────────────────────────
log "cleanup"
in_root "apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*"
sudo rm -f "${ROOT}/usr/sbin/policy-rc.d" "${ROOT}/etc/resolv.conf"

log "packing ${OUT}"
sudo tar --numeric-owner -C "${ROOT}" -cf - . | gzip -9 > "${OUT}"
sha256sum "${OUT}" | tee "${OUT}.sha256"
du -h "${OUT}"
log "done"
