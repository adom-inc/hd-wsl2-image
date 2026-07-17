#!/usr/bin/env bash
# bake-in-distro.sh — WSL2-NATIVE golden-image bake (NO docker, NO chroot, NO proot).
#
# Runs as ROOT *inside* a freshly `wsl --import`ed ubuntu-base-24.04 distro
# (the throwaway `golden-build` distro on John's laptop). Because this IS a real
# WSL2 distro, /proc + apt + adompkg postinstalls all work natively — no chroot device
# nodes, no proot /proc-binding, none of build-rootfs.sh's cloud-container hacks.
#
# Derived from scripts/build-rootfs.sh (the proven recipe) but REGISTRY-NATIVE
# (v18+): ONE declarative install via the `adom-wiki` CLI (adompkg is DEPRECATED,
# gallia is never invoked — adom/core is the new gallia):
#   adom-wiki pkg install adom/hd-windows-bootstrap
# pulls adom/core (ecosystem incl. adom-wiki-cli + adom/hook auto-updater) +
# adom/hd-bootstrap (38 generic hd-* skills + editor config) + the WSL2 layer
# (11 WSL2 hd-* skills + workbench seed) + adom-desktop. The workspace-updater
# daemon is RETIRED (auto-update = adom/hook → `adom-wiki pkg update`), so the
# tree is sudo-free — no --allow-sudo anywhere.
#
# The orchestration stages the build context at /tmp/ctx inside the distro:
#   wsl.conf init-host-internal.sh bootstrap.sh adom-wiki (single binary)
# Then: wsl -d golden-build -u root -- bash /tmp/ctx/bake-in-distro.sh
# Then the host runs `wsl --export golden-build adom-golden-vN.tar`.
set -euo pipefail
trap 'echo "[bake-in-distro] FAILED at line ${LINENO} (exit $?)" >&2' ERR
VER="${GOLDEN_VERSION:-v18}"
CSV="${CODE_SERVER_VERSION:-4.124.2}"
CTX="${CTX:-/tmp/ctx}"
export DEBIAN_FRONTEND=noninteractive
log() { echo "[bake-in-distro $(date +%H:%M:%S)] $*"; }

# ── 1. apt baseline — RUNTIME image (deliberately leaner than image/Dockerfile) ─
# The cloud hydrogen-workspace Dockerfile carries build-essential/cmake/pkg-config/
# libssl-dev so Rust/C CLIs can be *compiled* there. The golden image only *runs*
# pre-built binaries (delivered via adompkg) — there's no rustc and nothing compiles
# at runtime — so the ~246 MB C/C++ toolchain is dropped here. (See size analysis:
# every release v1..v14 carried it unused; v15 is the first to shed it.)
log "apt baseline (runtime, no build toolchain)"
apt-get update
apt-get install -y --no-install-recommends \
    ca-certificates curl wget git jq unzip zip tar gnupg openssh-client \
    sudo locales \
    nodejs npm python3 python3-pip \
    systemd systemd-sysv cron
log "github cli"
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y --no-install-recommends gh
log "code-server ${CSV}"
curl -fsSL "https://github.com/coder/code-server/releases/download/v${CSV}/code-server_${CSV}_$(dpkg --print-architecture).deb" -o /tmp/code-server.deb
dpkg -i /tmp/code-server.deb && rm -f /tmp/code-server.deb
log "locale"
sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen

# ── 2. adom user (uid/gid 1001 = cloud parity) + linger + pam fix ─────────────
log "adom user"
groupadd -g 1001 adom
useradd -m -u 1001 -g 1001 -s /bin/bash adom
echo 'adom ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/adom && chmod 0440 /etc/sudoers.d/adom
mkdir -p /home/adom/project && chown adom:adom /home/adom/project
mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/adom
for f in /etc/pam.d/login /etc/pam.d/common-session /etc/pam.d/common-session-noninteractive; do
    [ -f "$f" ] && sed -i 's/^\([[:space:]]*session[[:space:]].*pam_lastlog\.so.*\)$/# \1  # removed: module absent/' "$f" || true
done; true

# ── 3. WSL config + per-boot host alias + non-fatal bootstrap updater ─────────
log "configs"
install -m 0644 "${CTX}/wsl.conf" /etc/wsl.conf
install -m 0755 "${CTX}/init-host-internal.sh" /etc/init-host-internal.sh
install -D -m 0755 "${CTX}/bootstrap.sh" /opt/adom/bootstrap.sh
chown -R adom:adom /opt/adom

# ── 4. adom-desktop — NOT baked. Its wiki package ships no binary, and HD
# injects/refreshes the workspace's adom-desktop CLI at runtime (Claude Desktop
# updates it each AD build). Nothing in the bake needs it, so the golden image
# omits it and HD provides it on first launch.

# ── 5. adom-wiki CLI (the registry-native installer the bake calls) ───────────
# v18: adompkg is DEPRECATED. The bake stages a bootstrap copy of the single-binary
# `adom-wiki` CLI just to run the one install; adom/core then lands its own canonical
# copy via the adom/adom-wiki-cli dependency. Default registry is wiki.adom.inc
# (no env needed; verified anonymous/token-less install works for the whole tree).
log "adom-wiki CLI"
install -d -o adom -g adom -m 0755 /home/adom/.local /home/adom/.local/bin
install -o adom -g adom -m 0755 "${CTX}/adom-wiki" /home/adom/.local/bin/adom-wiki

# ── 6. THE BOOTSTRAP INSTALL — pulls core + hd-bootstrap + WSL2 layer ─────────
# Real distro → /proc exists → postinstalls (settings, extensions, seeds) run fine.
# ONE declarative install: core@^4.13 ← hd-bootstrap@0.2.10 ← hd-windows-bootstrap@0.2.6
# (+ adom-desktop). NO --allow-sudo: the updater is retired, the whole tree is
# sudo-free — if a needs_sudo package ever sneaks back in, this install FAILS,
# which is exactly the guard we want.
log "adom-wiki pkg install adom/hd-windows-bootstrap"
chown -R adom:adom /home/adom
runuser -u adom -- bash -lc \
    "/home/adom/.local/bin/adom-wiki pkg install adom/hd-windows-bootstrap"

# ── 6b. TEMPORARY WORKAROUND (remove when adom-wiki runs scripts.postinstall) ──
# adom-wiki@1.0.41 BUG (issue filed on adom/adom-wiki-cli): `pkg install` runs
# packages' install.sh but never executes `scripts.postinstall` — verified in
# isolation 2026-07-16 (root install of adom/hd-bootstrap → module dir has
# postinstall.sh, 0 hd-* skills deployed, no settings.json). Both HD bootstraps
# deliver ALL their payload via postinstall. Until the CLI is fixed, run the two
# postinstalls explicitly, in dependency order, AS ADOM, from each module dir —
# guarded so this becomes a no-op the moment the CLI starts doing it itself.
if ! ls -d /home/adom/.claude/skills/hd-* >/dev/null 2>&1; then
    log "WORKAROUND: adom-wiki skipped scripts.postinstall — running bootstrap postinstalls explicitly"
    for b in hd-bootstrap hd-windows-bootstrap; do
        runuser -u adom -- bash -lc \
            "cd /home/adom/project/adom_modules/adom/${b} && bash ./postinstall.sh"
    done
else
    log "adom-wiki ran bootstrap postinstalls itself — workaround skipped (CLI fixed; remove 6b)"
fi

# ── 7. sentinel + version stamp ───────────────────────────────────────────────
mkdir -p /var/lib/adom-bootstrap
date -Iseconds > /var/lib/adom-bootstrap/phase-a-done
echo "${VER}" > /etc/adom-golden-version

# ── 8. scrub per-install state + ownership sweep ──────────────────────────────
rm -f /home/adom/.claude.json /home/adom/.claude.json.backup 2>/dev/null || true
rm -rf /home/adom/.claude/statsig /home/adom/.cache 2>/dev/null || true
rm -f /home/adom/project/.mcp.json 2>/dev/null || true
chown -Rh adom:adom /home/adom

# ── 9. smoke test (bootstrap variant) ─────────────────────────────────────────
log "smoke"
code-server --version >/dev/null; node --version >/dev/null; git --version >/dev/null
test -f /etc/wsl.conf; test -x /etc/init-host-internal.sh; test -x /opt/adom/bootstrap.sh
test -f /var/lib/adom-bootstrap/phase-a-done; cat /etc/adom-golden-version
id adom | grep -q uid=1001
# v18: registry-native — adom-wiki CLI present + runnable (adompkg is GONE)
test -x /home/adom/.local/bin/adom-wiki || { echo "MISSING adom-wiki CLI"; exit 1; }
runuser -u adom -- /home/adom/.local/bin/adom-wiki --version >/dev/null || { echo "adom-wiki --version failed"; exit 1; }
! test -e /home/adom/.local/bin/adompkg || { echo "STALE adompkg still present"; exit 1; }
# module tree: updater is RETIRED — assert present set AND absent set
for p in core hd-bootstrap hd-windows-bootstrap adom-desktop adom-wiki-cli hook; do
    test -d "/home/adom/project/adom_modules/adom/${p}" || { echo "MISSING module adom/${p}"; exit 1; }
done
for p in adom-workspace-updater hd-skillpack; do
    ! test -d "/home/adom/project/adom_modules/adom/${p}" || { echo "RETIRED package adom/${p} present"; exit 1; }
done
# whole tree sudo-free (updater was the only needs_sudo package)
! grep -rl '"needs_sudo": *true' /home/adom/project/adom_modules/*/*/package.json 2>/dev/null | grep -q . || { echo "SUDO package in tree"; exit 1; }
# no private-infra phone-home: no gallia checkout, no check-updates.sh hook
! test -e /home/adom/gallia || { echo "GALLIA checkout present"; exit 1; }
! find /home/adom/.claude -name "check-updates.sh" 2>/dev/null | grep -q . || { echo "PRIVATE check-updates.sh hook present"; exit 1; }
test -f /home/adom/.claude/skills/adom/SKILL.md || { echo "MISSING adom skills hub"; exit 1; }
N=$(ls -d /home/adom/.claude/skills/hd-* 2>/dev/null | wc -l); echo "hd-* skills deployed: ${N}"
[ "${N}" -ge 45 ] || { echo "too few hd-* skills (${N}; expect 38 generic + 11 wsl2)"; exit 1; }
# spot-check bundled skills incl. the hd-workspace-updater→hd-staying-current rename
for s in hd-webview hd-pup hd-golden-image hd-staying-current; do
    test -f "/home/adom/.claude/skills/${s}/SKILL.md" || { echo "MISSING skill ${s}"; exit 1; }
done
! test -d /home/adom/.claude/skills/hd-workspace-updater || { echo "STALE hd-workspace-updater skill (renamed hd-staying-current)"; exit 1; }
test -f /home/adom/.local/share/code-server/User/settings.json || { echo "MISSING settings.json"; exit 1; }
jq -e '."chat.agent.enabled" == false' /home/adom/.local/share/code-server/User/settings.json >/dev/null || { echo "MISSING chat-agent disable"; exit 1; }
# v16: CLEAN-LAYOUT litmus — the golden image must open to an empty editor.
# settings: no welcome page; workbench.html: the seeds that unpin the activity bar
# AND collapse the sidebar once-per-profile must both be injected. (Rendered look
# is validated separately by booting code-server + a browser; this guarantees the
# config that produces it is present, failing the build if it ever drops out.)
jq -e '."workbench.startupEditor" == "none"' /home/adom/.local/share/code-server/User/settings.json >/dev/null || { echo "LAYOUT: startupEditor not none (welcome page would show)"; exit 1; }
jq -e '."remote.autoForwardPortsSource" == "hybrid"' /home/adom/.local/share/code-server/User/settings.json >/dev/null || { echo "PORTS: autoForwardPortsSource != hybrid (Web Hydrogen parity; pins source so the >20-ports mode-switch popup never fires)"; exit 1; }
WBHTML=/usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.html
grep -q '__hdAbSeed' "$WBHTML" || { echo "LAYOUT: activity-bar/trusted-domains seed missing from workbench.html"; exit 1; }
grep -q 'adom.sidebarSeeded' "$WBHTML" || { echo "LAYOUT: sidebar collapse-once seed missing from workbench.html"; exit 1; }
runuser -u adom -- /usr/lib/code-server/bin/code-server --list-extensions 2>/dev/null | grep -qi '^anthropic.claude-code' || { echo "MISSING claude-code extension"; exit 1; }
# v18: updater daemon RETIRED — auto-update is adom/hook → `adom-wiki pkg update`
! test -e /usr/local/bin/adom-workspace-updater || { echo "RETIRED updater daemon present"; exit 1; }
! systemctl list-unit-files 2>/dev/null | grep -q adom-workspace-updater || { echo "RETIRED updater systemd units present"; exit 1; }
test -x /home/adom/.local/bin/adom-desktop || { echo "MISSING adom-desktop CLI"; exit 1; }
test -x /usr/lib/systemd/systemd && test -e /sbin/init || { echo "MISSING systemd"; exit 1; }
test -e /var/lib/systemd/linger/adom || { echo "MISSING adom linger"; exit 1; }
test -z "$(find /home/adom ! -user adom -print -quit)" || { echo "OWNERSHIP leak: $(find /home/adom ! -user adom -print -quit)"; exit 1; }
# v15: confirm the build toolchain really is gone (it was dead weight in v1..v14)
! dpkg -l gcc-13 g++-13 cmake build-essential 2>/dev/null | grep -q '^ii' || { echo "TOOLCHAIN still present"; exit 1; }
echo SMOKE-OK

# ── 10. cleanup + slim pass ───────────────────────────────────────────────────
# Sweep any orphaned deps (e.g. toolchain libs no longer pulled), then strip the
# documentation / man pages / non-English locale catalogs that nothing at runtime
# reads. This is the second lever the lean v1 image used; it compresses away cheaply.
log "cleanup + slim"
apt-get autoremove -y --purge || true
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/code-server.deb
rm -rf /usr/share/doc/* /usr/share/doc-base/* /usr/share/man/* /usr/share/info/* \
       /usr/share/groff/* /usr/share/lintian/* 2>/dev/null || true
# keep only English locale message catalogs
find /usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' -exec rm -rf {} + 2>/dev/null || true
rm -rf /var/cache/apt/* /var/log/* /tmp/* 2>/dev/null || true
log "bake done (${VER})"
