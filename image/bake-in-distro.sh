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
VER="${GOLDEN_VERSION:-v19}"
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
# v18: adompkg is DEPRECATED. The bake needs a bootstrap copy of the single-binary
# `adom-wiki` CLI just to run the one install; adom/core then lands its own canonical
# copy via the adom/adom-wiki-cli dependency. Default registry is wiki.adom.inc
# (no env needed; anonymous/token-less install works for the whole tree).
#
# ⚠ ALWAYS FETCH IT FRESH — never reuse a staged/pinned copy. Burned 2026-07-19:
# a stale 1.0.41 binary sat in ctx from the v18 bake, so v19 was built by an old CLI
# and hit an ALREADY-FIXED bug (postinstall execution), which got mis-reported as a
# live ecosystem problem. A pinned CLI silently ages out; the registry is the truth.
log "adom-wiki CLI (fetching current release)"
install -d -o adom -g adom -m 0755 /home/adom/.local /home/adom/.local/bin
AWV="$(curl -fsSL https://wiki.adom.inc/api/v1/packages/adom-wiki-cli/manifest | jq -r .version)"
AWURL="$(curl -fsSL "https://wiki.adom.inc/api/packages/adom-wiki-cli/${AWV}/assets" \
    | jq -r '[.assets[] | select(.platform=="linux" and (.arch=="x64" or .arch=="x86_64" or .arch=="amd64"))][0].download_url')"
case "$AWURL" in http*) ;; *) AWURL="https://wiki.adom.inc${AWURL}";; esac
curl -fsSL "$AWURL" -o /home/adom/.local/bin/adom-wiki
chmod 0755 /home/adom/.local/bin/adom-wiki && chown adom:adom /home/adom/.local/bin/adom-wiki
log "adom-wiki CLI = $(runuser -u adom -- /home/adom/.local/bin/adom-wiki --version) (fetched ${AWV})"

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

# ── 6b. (removed 2026-07-20) The postinstall shim is GONE. The bootstraps now
# declare scripts.install (hd-bootstrap@0.2.23, hd-windows-bootstrap@0.2.8) and
# adom-wiki executes install.sh in dependency order — verified end-to-end on a
# clean HOME: 51 hd-* skills + settings.json with no intervention.

# ── 6c. v19: adom-cli 0.5.12+ overlay (TEMPORARY — until the registry ships it) ─
# WHY: 0.5.12 adds the ~/.adom/hd-proxy-url base-url fallback (adom-inc/adom-cli
# PR #9) so adom-cli works in env-less non-login shells inside HD local workspaces.
# v18 shipped 0.5.11, which falls back to the real carbon.adom.inc and 404s.
# The registry's adom/adom-cli package (4.0.4) still ships 0.5.11, so the bake
# overlays a binary built from branch fix/hd-local-proxy-discovery (cargo build
# --release, Ubuntu 24.04 / glibc 2.39 — same as this image).
# ⚠ REMOVE THIS BLOCK once Colby publishes an adom/adom-cli package shipping
# 0.5.12+; then the registry-native install provides it and this is dead weight.
# NOTE: the overlay is NOT registry-tracked (.installed.json still records the
# package version), so a later `adom-wiki pkg update` that bumps adom-cli WILL
# replace this binary with the registry's — which is correct/desired once the
# published package carries 0.5.12+.
if [ -f "${CTX}/adom-cli" ]; then
    log "overlaying adom-cli 0.5.12+ (built from source; registry still ships 0.5.11)"
    install -m 0755 -o root -g root "${CTX}/adom-cli" /usr/local/bin/adom-cli
else
    echo "MISSING ${CTX}/adom-cli — v19 requires the 0.5.12+ binary staged in ctx"; exit 1
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
# ── v19 LITMUS: adom-cli must carry the HD-local proxy fallback ───────────────
# (1) version >= 0.5.12, (2) the fallback is really compiled into the binary.
test -x /usr/local/bin/adom-cli || { echo "MISSING /usr/local/bin/adom-cli"; exit 1; }
ACLI_V="$(/usr/local/bin/adom-cli --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
echo "adom-cli version: ${ACLI_V:-unknown}"
[ -n "$ACLI_V" ] || { echo "ADOM-CLI: could not parse --version"; exit 1; }
printf '%s\n%s\n' "0.5.12" "$ACLI_V" | sort -V -C || { echo "ADOM-CLI: ${ACLI_V} < 0.5.12 (needs the hd-proxy-url fallback)"; exit 1; }
# NOTE: use `grep -a` (+ C locale). Plain `grep -q` FALSE-NEGATIVES on this binary —
# it bails on invalid multibyte sequences in a UTF-8 locale and reports no match even
# though the literal is present (verified 2026-07-19: grep -a / strings both match).
LC_ALL=C grep -qa 'hd-proxy-url' /usr/local/bin/adom-cli || { echo "ADOM-CLI: 'hd-proxy-url' string ABSENT from the binary — the base-url fallback is not compiled in"; exit 1; }
echo "adom-cli: >=0.5.12 + hd-proxy-url fallback present ✓"
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
