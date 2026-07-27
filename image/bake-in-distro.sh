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
VER="${GOLDEN_VERSION:-v23}"
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
# v20: python parity libs. Web Hydrogen (the cloud container) ships requests/yaml/
# bs4/lxml/pil out of the box, so an AI writing Python behaves the same in HD as in
# the cloud (invariant 1). Installed via APT (python3-<lib>), NOT pip, so PEP-668
# (Ubuntu 24.04 externally-managed) never bites and no build toolchain is needed —
# apt ships pre-compiled C-extension builds. Deliberately EXCLUDES numpy (~150 MB
# with BLAS/LAPACK) — no evidence our AIs reach for it; revisit with evidence.
# The long tail is handled by the PEP-668 escape-hatch hint in a skill, not by
# growing this list forever.
# Transient network drops killed two consecutive v22 bakes (one at the gh keyring
# curl, one mid apt fetch). Make every downloader retry instead of dying on a blip.
echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-adom-retries
apt-get update
apt-get install -y --no-install-recommends \
    ca-certificates curl wget git jq unzip zip tar gnupg openssh-client \
    sudo locales \
    nodejs npm python3 python3-pip \
    python3-requests python3-yaml python3-bs4 python3-lxml python3-pil \
    systemd systemd-sysv cron
log "github cli"
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y --no-install-recommends gh
log "code-server ${CSV}"
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "https://github.com/coder/code-server/releases/download/v${CSV}/code-server_${CSV}_$(dpkg --print-architecture).deb" -o /tmp/code-server.deb
dpkg -i /tmp/code-server.deb && rm -f /tmp/code-server.deb
log "locale"
sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen

# ── 2. adom user (uid/gid 1001 = cloud parity) + linger + pam fix ─────────────
log "adom user"
groupadd -g 1001 adom
useradd -m -u 1001 -g 1001 -s /bin/bash adom
echo 'adom ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/adom && chmod 0440 /etc/sudoers.d/adom
# ── STANDARD FOLDER CONTRACT (John 2026-07-26) ───────────────────────────────
# Seed exactly ONE dir: ~/project. It is W (what code-server opens) and it is
# load-bearing (adom_modules lives under it). Nothing else is seeded:
#  - ~/downloads and ~/apps were dropped. With W = ~/project they are OUTSIDE the
#    workspace, so they'd be invisible empty dirs nobody asked for. In the cloud they
#    exist only because they ACCUMULATED. Whatever downloads or installs creates them.
#  - NO SYMLINKS into the workspace (loops in find/rg/watchers, and a link into
#    ~/.local drags 302 MB of extensions into VS Code's index). Browsing ~/.claude and
#    ~/.codex is a file-viewer job, not a filesystem trick.
# Everything else is CREATE-ON-WRITE by its owning tool (verified: `adom-shotlog serve`
# makes its own ./screenshots/shotlog). The per-project type folders live under a
# user-named project (~/project/battery-charger/...) so they cannot be seeded at all.
# Full contract: the `standard-folders` skill in adom/adom.
# ~/project holds MANY named projects (battery-charger/, esp32-sensor/, ...). The
# 12 type folders (libraries symbols footprints 3d-chips schematics 2d-layouts
# 3d-boards gerbers datasheets screenshots videos docs) belong INSIDE each named
# project, so they CANNOT be baked — you cannot seed "battery-charger/" before the
# user names it. Seeding them at ~/project root would declare "the workspace is one
# project" and go ambiguous on the second board. The canonical list lives in the
# adom/adom skill; whatever scaffolds a project (adom-nucleus on delivery,
# chip-fetcher for per-part bundles) creates them under ~/project/<name>/.
# ⚠ PARITY: HD and the Web Hydrogen cloud container must agree on W and on this
# contract (invariant 1). The shared standard lives in the adom/adom skill, read by both.
# Seed the three that are universal on day one. Everything else is create-on-demand by
# the app/AI that needs it, following the `standard-folders` skill (adom/adom@3.2.0):
#   project/      W — what code-server opens; adom_modules/ lives here
#   downloads/    the catch-all; must exist BEFORE anything downloads
#   screenshots/  universally used; shotlog + adom-desktop both write here
for d in project project/downloads project/screenshots; do
    install -d -o adom -g adom -m 0755 "/home/adom/${d}"
done
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
AWV="$(curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://wiki.adom.inc/api/v1/packages/adom-wiki-cli/manifest | jq -r .version)"
AWURL="$(curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "https://wiki.adom.inc/api/packages/adom-wiki-cli/${AWV}/assets" \
    | jq -r '[.assets[] | select(.platform=="linux" and (.arch=="x64" or .arch=="x86_64" or .arch=="amd64"))][0].download_url')"
case "$AWURL" in http*) ;; *) AWURL="https://wiki.adom.inc${AWURL}";; esac
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "$AWURL" -o /home/adom/.local/bin/adom-wiki
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
# ADOM_THEME_SKIP_SATOSHI=1 must cover the WHOLE install: as of hd-bootstrap@0.2.32 the
# theme system is a DEPENDENCY (so "Adom Studio" is the package default and the pack that
# provides it is always present). Without the flag this dependency install fetches 4
# Satoshi faces from Fontshare — legal on a user's machine, a license violation in a
# public release tarball. The flag is bake-only; user installs still get Satoshi.
runuser -u adom -- bash -lc \
    "ADOM_THEME_SKIP_SATOSHI=1 /home/adom/.local/bin/adom-wiki pkg install adom/hd-windows-bootstrap"

# ── 6b. (removed 2026-07-20) The postinstall shim is GONE. The bootstraps now
# declare scripts.install (hd-bootstrap@0.2.23, hd-windows-bootstrap@0.2.8) and
# adom-wiki executes install.sh in dependency order — verified end-to-end on a
# clean HOME: 51 hd-* skills + settings.json with no intervention.

# ── 6c. (v20, overlay REMOVED) adom-cli 0.5.12 now comes FROM THE REGISTRY ─────
# v19 built adom-cli 0.5.12 from source and overlaid it because the registry
# package (4.0.4) still shipped 0.5.11 (which 404s against real carbon from
# env-less non-login shells — adom-inc/adom-cli PR #9, the `~/.adom/hd-proxy-url`
# base-url fallback). Colby published **adom/adom-cli@4.0.5 shipping the 0.5.12
# binary** (verified 2026-07-20: fresh `adom-wiki pkg install adom/adom-cli` →
# adom 0.5.12, hd-proxy-url PRESENT), so the registry-native install above now
# provides it at /usr/local/bin/adom-cli and no overlay is needed. The adom-cli
# litmus in the smoke section still asserts version ≥ 0.5.12 + the hd-proxy-url
# fallback — now validating the REGISTRY binary, so a registry regression to
# 0.5.11 FAILS the bake.

# ── 6d. systemd units: the container manages its OWN services (John 2026-07-26) ─
# History: HD (a Windows app) used to reach into the distro and babysit the relay and
# shotlog as held wsl.exe children, because the thin tarball had no systemd. The golden
# image boots systemd as PID 1, so the services belong to the container: code-server,
# the AD relay (adom-desktop serve), and adom-shotlog are all plain units, enabled at
# bake. HD's launch-time unit writer stays as the self-heal for legacy distros and
# writes only the tiny *.service.d/hd-env.conf drop-ins (machine ports/env) here.
# Binaries come from the ONE registry install above: adom-desktop via adom/hd-bootstrap,
# adom-shotlog via adom/hd-windows-bootstrap@0.2.9 — both `adom-wiki pkg update`-able.
# ExecStart uses a login shell so services see the same env/PATH as a user shell
# (~/.local/bin, /etc/profile.d/hd-env.sh), matching how code-server children behave.
# WorkingDirectory is explicit: a service with no cwd once resolved shotlog's relative
# data dir under a read-only mount (the 2026-07-24 broken-gallery bug).
log "systemd units (code-server, adom-relay, adom-shotlog)"
cat > /etc/systemd/system/code-server.service <<'UNIT'
[Unit]
Description=Adom code-server (Hydrogen Desktop workspace editor)
After=network-online.target
Wants=network-online.target
# 900s window / 4 attempts: the field report (hd-wsl2-image#1) measured a unit
# restart-looping every ~2 min for 15h (NRestarts=435) — a 60s window never trips
# when the failure cycle is slower than window/burst. 4 failures inside 15 min
# parks even a 2-minute cycle. Parking is the GOAL on a squatted port.
StartLimitIntervalSec=900
StartLimitBurst=4

[Service]
Type=exec
User=adom
Environment=HOME=/home/adom
# W = the workspace root. LOCKED to /home/adom/project (John 2026-07-26, "we can never
# go back"). It is what the Web Hydrogen cloud container opens, so terminals, relative
# paths, shotlog's ./screenshots/shotlog default and adom-desktop's hardcoded
# ~/project/screenshots/adom-desktop all resolve IDENTICALLY in both runtimes.
# It is also where `git clone` / `adom-wiki repo clone` land by default (they use cwd),
# so W must be the place where accumulation is ALLOWED — pointing it at $HOME would make
# "nothing else at the top of $HOME" unenforceable by construction.
ExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:7380 --auth none --disable-telemetry --disable-update-check /home/adom/project
# on-failure, NOT always: these services deliberately exit 0 when they detect a peer
# already holding their port (a second workspace on the same host sees the production
# instance through WSL2 mirrored networking and defers). Restart=always turned that clean
# defer into a spin (45 restarts observed). The start limit caps a genuine crash loop too.
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/adom-relay.service <<'UNIT'
[Unit]
Description=Adom Desktop relay (adom-desktop serve) - the bridge AD/HD connect back to
After=network-online.target
Wants=network-online.target
# 900s window / 4 attempts: the field report (hd-wsl2-image#1) measured a unit
# restart-looping every ~2 min for 15h (NRestarts=435) — a 60s window never trips
# when the failure cycle is slower than window/burst. 4 failures inside 15 min
# parks even a 2-minute cycle. Parking is the GOAL on a squatted port.
StartLimitIntervalSec=900
StartLimitBurst=4

[Service]
Type=exec
User=adom
Environment=HOME=/home/adom
WorkingDirectory=/home/adom
ExecStart=/bin/bash -lc 'exec adom-desktop serve'
# on-failure, NOT always: these services deliberately exit 0 when they detect a peer
# already holding their port (a second workspace on the same host sees the production
# instance through WSL2 mirrored networking and defers). Restart=always turned that clean
# defer into a spin (45 restarts observed). The start limit caps a genuine crash loop too.
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/adom-shotlog.service <<'UNIT'
[Unit]
Description=Adom Shotlog (screenshot log viewer, port 8820)
After=network-online.target
Wants=network-online.target
# 900s window / 4 attempts: the field report (hd-wsl2-image#1) measured a unit
# restart-looping every ~2 min for 15h (NRestarts=435) — a 60s window never trips
# when the failure cycle is slower than window/burst. 4 failures inside 15 min
# parks even a 2-minute cycle. Parking is the GOAL on a squatted port.
StartLimitIntervalSec=900
StartLimitBurst=4

[Service]
Type=exec
User=adom
Environment=HOME=/home/adom
# cwd MUST be ~/project: shotlog's --data-dir defaults to ./screenshots/shotlog, and the
# cloud container resolves that to ~/project/screenshots/shotlog. Using /home/adom here
# would put HD's shots one level up = a parity divergence from Web Hydrogen (invariant 1)
# and a split from adom-desktop, which writes ~/project/screenshots/adom-desktop/.
WorkingDirectory=/home/adom/project
ExecStart=/bin/bash -lc 'exec adom-shotlog serve'
# on-failure, NOT always: these services deliberately exit 0 when they detect a peer
# already holding their port (a second workspace on the same host sees the production
# instance through WSL2 mirrored networking and defers). Restart=always turned that clean
# defer into a spin (45 restarts observed). The start limit caps a genuine crash loop too.
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
# Drop-in dirs: HD writes <unit>.d/hd-env.conf with the live machine env at setup.
mkdir -p /etc/systemd/system/code-server.service.d \
         /etc/systemd/system/adom-relay.service.d \
         /etc/systemd/system/adom-shotlog.service.d
# Enable by symlink (systemd is not PID 1 inside the bake distro, so no `systemctl
# enable`): this is exactly what enable does for WantedBy=multi-user.target.
mkdir -p /etc/systemd/system/multi-user.target.wants
for u in code-server adom-relay adom-shotlog; do
    ln -sf "/etc/systemd/system/${u}.service" "/etc/systemd/system/multi-user.target.wants/${u}.service"
done

# ── 6d-bis. per-import distro identity (v22, hd-wsl2-image#1 item 4) ─────────────
# /etc/adom-distro-id must be UNIQUE PER IMPORT, so it CANNOT be baked into the tar
# (every import would share it). A oneshot generates it on first boot; the cleanup
# pass deletes any id the bake distro itself generated, and the tar gate asserts the
# marker is ABSENT from the artifact. HD verifies "the editor I reached is MY distro"
# by reading this via the adom-vscode :8821 API (client side is HD's to wire).
cat > /etc/systemd/system/adom-distro-id.service <<'UNIT'
[Unit]
Description=Generate the per-import Adom distro identity marker
ConditionPathExists=!/etc/adom-distro-id
Before=multi-user.target code-server.service adom-relay.service adom-shotlog.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'cat /proc/sys/kernel/random/uuid > /etc/adom-distro-id && chmod 0644 /etc/adom-distro-id'

[Install]
WantedBy=multi-user.target
UNIT
ln -sf /etc/systemd/system/adom-distro-id.service /etc/systemd/system/multi-user.target.wants/adom-distro-id.service

# ── 6e. Adom theme system + editor default theme (v21) ────────────────────────
# LICENSE-CRITICAL: ADOM_THEME_SKIP_SATOSHI=1. Satoshi's Fontshare EULA forbids
# distributing the files "in a public server"; this tarball IS a public GitHub release
# asset, so Satoshi must never be baked. The flag ships the VS Code theme pack + the two
# OFL faces (JetBrains Mono, Familjen Grotesk, with their OFL.txt) and fetches NOTHING
# from Fontshare. Satoshi is installed per-machine INTO WINDOWS at setup (the Claude chat
# webview can't use container webfonts anyway), so skipping it here loses nothing.
# ORDER MATTERS: this must run AFTER the bootstrap install, because the theme pack only
# lands if ~/.local/share/code-server/extensions exists — otherwise install.sh logs
# "extensions dir not found" and silently skips (the smoke gate below catches that).
log "adom theme system (license-safe: no Satoshi)"
runuser -u adom -- bash -lc \
    "ADOM_THEME_SKIP_SATOSHI=1 /home/adom/.local/bin/adom-wiki pkg install adom/adom-theme-system"

# Editor default theme = "Adom Studio" (theme-system contract default, slug `studio`;
# what HD's name guards expect). NOTE: the published adom/hd-bootstrap currently seeds
# "Default Dark Modern", so we set it here at image level — a later `adom-wiki pkg update`
# that rewrites settings.json could revert it until hd-bootstrap seeds Studio itself.
SETTINGS=/home/adom/.local/share/code-server/User/settings.json
runuser -u adom -- bash -lc \
    "jq '.\"workbench.colorTheme\" = \"Adom Studio\"' '${SETTINGS}' > /tmp/s.json && mv /tmp/s.json '${SETTINGS}'"

# Headless distro: boot straight to multi-user.target. Ubuntu's default.target symlinks
# to graphical.target, which Wants= a display-manager that does not exist here; multi-user
# is what our units are WantedBy and what cron already relies on.
ln -sf /lib/systemd/system/multi-user.target /etc/systemd/system/default.target

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
# v20: the `definitions` skill must ship — adom/core used to NOT depend on it (fixed:
# core@4.13.4 declares adom/definitions), but assert it so a future core that drops
# the dep FAILS the bake instead of silently shipping an image without definitions.
test -f /home/adom/.claude/skills/definitions/SKILL.md || { echo "MISSING definitions skill (adom/core must depend on adom/definitions)"; exit 1; }
# v20: python parity libs must import (installed via apt, not pip — no PEP-668 dance)
for m in requests yaml bs4 lxml PIL; do
    python3 -c "import ${m}" 2>/dev/null || { echo "PYTHON: 'import ${m}' failed — parity lib missing from the apt baseline"; exit 1; }
done
echo "python parity libs: requests+yaml+bs4+lxml+PIL all import ✓"
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
# ── adom-cli LITMUS: must carry the HD-local proxy fallback (≥0.5.12) ──────────
# (1) version >= 0.5.12, (2) the fallback is really compiled into the binary.
# As of v20 this validates the REGISTRY binary (adom/adom-cli@4.0.5 ships 0.5.12);
# no more source overlay. A registry regression to 0.5.11 FAILS the bake here.
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
# v21: the container manages its own services — units present AND enabled, cron alive.
for u in code-server adom-relay adom-shotlog; do
    test -f "/etc/systemd/system/${u}.service" || { echo "MISSING unit ${u}.service"; exit 1; }
    test -L "/etc/systemd/system/multi-user.target.wants/${u}.service" || { echo "UNIT ${u} not enabled"; exit 1; }
done
dpkg -l cron 2>/dev/null | grep -q '^ii' || { echo "MISSING cron package"; exit 1; }
test -x /usr/bin/crontab || { echo "MISSING crontab"; exit 1; }
# adom-shotlog: registry-tracked (hd-windows-bootstrap>=0.2.9 dependency), binary + alias.
test -d /home/adom/project/adom_modules/adom/adom-shotlog || { echo "MISSING module adom/adom-shotlog (bootstrap dep not resolved?)"; exit 1; }
test -x /home/adom/.local/bin/adom-shotlog || { echo "MISSING adom-shotlog binary"; exit 1; }
test -e /home/adom/.local/bin/shotlog || { echo "MISSING shotlog alias"; exit 1; }
test -z "$(find /home/adom ! -user adom -print -quit)" || { echo "OWNERSHIP leak: $(find /home/adom ! -user adom -print -quit)"; exit 1; }
# v15: confirm the build toolchain really is gone (it was dead weight in v1..v14)
! dpkg -l gcc-13 g++-13 cmake build-essential 2>/dev/null | grep -q '^ii' || { echo "TOOLCHAIN still present"; exit 1; }
# ── v21 GATES ─────────────────────────────────────────────────────────────────
# LICENSE (hard fail): zero Satoshi bytes may ship in a public tarball.
# Match font BINARIES only. `-iname 'Satoshi*'` also matched the package's docs dir
# fonts/satoshi/ (a README pointing at Fontshare, zero font bytes) = false positive.
! find /home/adom -type f \( -iname 'Satoshi*.woff2' -o -iname 'Satoshi*.woff' -o -iname 'Satoshi*.otf' -o -iname 'Satoshi*.ttf' \) 2>/dev/null | grep -q . || { echo "LICENSE VIOLATION: Satoshi font binaries in the image (public tarball) — bake with ADOM_THEME_SKIP_SATOSHI=1"; exit 1; }
# theme pack actually landed (its install.sh SILENTLY skips if the extensions dir is missing)
ls -d /home/adom/.local/share/code-server/extensions/adom.adom-themes-* >/dev/null 2>&1 || { echo "MISSING Adom theme pack (install ran before code-server extensions dir existed?)"; exit 1; }
# ...AND is REGISTERED. A folder on disk is NOT an installed extension: code-server prunes
# anything missing from extensions.json on its next launch. v21-rc shipped a pack that
# passed the ls check above and was deleted at first boot, leaving the picker with zero
# "Adom ..." themes and the editor falling back to stock Light. Registration is the litmus.
jq -e '[.[] | select(.identifier.id == "adom.adom-themes")] | length == 1' \
    /home/adom/.local/share/code-server/extensions/extensions.json >/dev/null 2>&1 \
    || { echo "THEME PACK NOT REGISTERED: adom.adom-themes absent from extensions.json — code-server will prune it on first launch (adom-theme-system must install via 'code-server --install-extension', not cp -r; needs adom/adom-theme-system >= 1.1.2)"; exit 1; }
jq -e '."workbench.colorTheme" == "Adom Studio"' /home/adom/.local/share/code-server/User/settings.json >/dev/null || { echo "THEME: default colorTheme is not 'Adom Studio'"; exit 1; }
# OFL compliance: the license text must travel beside the fonts we DO ship
test -e /home/adom/.local/share/fonts/adom-theme-system/JetBrainsMono-OFL.txt || { echo "OFL: JetBrains Mono license text missing beside the fonts"; exit 1; }
# standard folder contract (seeded, adom-owned)
for d in project project/downloads project/screenshots; do
    test -d "/home/adom/${d}" || { echo "MISSING seeded folder ~/${d}"; exit 1; }
done
# headless boot target (our units are WantedBy=multi-user.target)
# compare the BASENAME: /lib is a symlink to /usr/lib (usr-merge), so `readlink -f`
# returns /usr/lib/... and a literal /lib/... comparison always fails.
test "$(basename "$(readlink -f /etc/systemd/system/default.target)")" = "multi-user.target" || { echo "default.target is not multi-user (got $(readlink -f /etc/systemd/system/default.target))"; exit 1; }
echo "v21: theme pack + Adom Studio + OFL ok, no Satoshi, folder contract seeded ✓"
# ── v22 GATES (theme standard v2 + hd-wsl2-image#1 unit fixes) ────────────────
PACK_DIR="$(ls -d /home/adom/.local/share/code-server/extensions/adom.adom-themes-* | head -1)"
# exactly five themes contributed
test "$(jq '.contributes.themes | length' "$PACK_DIR/package.json")" = "5" || { echo "THEME: pack does not contribute exactly five themes"; exit 1; }
# the NEW Adom Studio (Dark-2026-derived): #1f2125 is the 2026 chrome value and does not
# exist in the old template projection — its presence proves gen-adom-studio-v2 output.
grep -q '#1f2125' "$PACK_DIR/themes/adom-studio-color-theme.json" || { echo "THEME: adom-studio-color-theme.json lacks #1f2125 — this is the OLD Studio, need adom-theme-system >= 1.3.1"; exit 1; }
# unit opens W, not $HOME (field report item 2)
grep -q 'ExecStart=.*code-server.*/home/adom/project$' /etc/systemd/system/code-server.service || { echo "UNIT: code-server ExecStart does not open /home/adom/project"; exit 1; }
# parking directives present in every unit (field report item 1)
for u in code-server adom-relay adom-shotlog; do
    grep -q 'StartLimitIntervalSec=900' "/etc/systemd/system/${u}.service" || { echo "UNIT ${u}: missing StartLimitIntervalSec=900"; exit 1; }
    grep -q 'StartLimitBurst=4' "/etc/systemd/system/${u}.service" || { echo "UNIT ${u}: missing StartLimitBurst=4"; exit 1; }
done
# per-import identity: generator enabled, marker NOT baked (uniqueness requires first-boot generation)
test -L /etc/systemd/system/multi-user.target.wants/adom-distro-id.service || { echo "UNIT: adom-distro-id not enabled"; exit 1; }
# the bake distro boots systemd, so the oneshot may have fired IN THE BAKE — that id must
# not ship (every import would share it). Clear it now; the gate then guards regressions.
rm -f /etc/adom-distro-id
test ! -e /etc/adom-distro-id || { echo "IDENTITY: /etc/adom-distro-id must NOT be baked (would be shared by every import)"; exit 1; }
echo "v22: five themes + new Studio (#1f2125) + unit parking 900/4 + W root + distro-id generator ✓"
# ── v23 GATES (fresh adom-vscode) ─────────────────────────────────────────────
# adom-vscode < 1.0.17 bundled its own contributes.themes, which puts DUPLICATE
# "Adom Studio" entries in the picker beside the real adom-themes pack (hit live
# 2026-07-27). 1.0.16+ also serves POST /exec on :8821 (the HD dock launch path).
AVX_DIR="$(ls -d /home/adom/.local/share/code-server/extensions/adom.adom-vscode-* | sort -V | tail -1)"
AVX_VER="$(jq -r .version "$AVX_DIR/package.json")"
printf '%s\n%s\n' "1.0.17" "$AVX_VER" | sort -V -C || { echo "ADOM-VSCODE too old: $AVX_VER < 1.0.17 (need adom/adom-vscode >= 4.0.11)"; exit 1; }
test "$(jq '.contributes.themes | length' "$AVX_DIR/package.json" 2>/dev/null || echo 0)" = "0" || { echo "ADOM-VSCODE $AVX_VER still bundles contributes.themes — duplicate picker entries"; exit 1; }
# only ONE adom-vscode extension dir may ship (two = duplicate everything)
test "$(ls -d /home/adom/.local/share/code-server/extensions/adom.adom-vscode-* | wc -l)" = "1" || { echo "MULTIPLE adom-vscode extension dirs baked"; exit 1; }
echo "v23: adom-vscode $AVX_VER (>=1.0.17, no bundled themes) ✓"
echo SMOKE-OK

# ── 10. cleanup + slim pass ───────────────────────────────────────────────────
# Sweep any orphaned deps (e.g. toolchain libs no longer pulled), then strip the
# documentation / man pages / non-English locale catalogs that nothing at runtime
# reads. This is the second lever the lean v1 image used; it compresses away cheaply.
log "cleanup + slim"
# the bake distro itself boots systemd, so the distro-id oneshot may have fired here —
# a baked id would be SHARED by every import. Delete it; imports regenerate at first boot.
rm -f /etc/adom-distro-id
apt-get autoremove -y --purge || true
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/code-server.deb
rm -rf /usr/share/doc/* /usr/share/doc-base/* /usr/share/man/* /usr/share/info/* \
       /usr/share/groff/* /usr/share/lintian/* 2>/dev/null || true
# keep only English locale message catalogs
find /usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' -exec rm -rf {} + 2>/dev/null || true
# adom-wiki leaves a package download/extract cache in adom_modules/.cache (~28 MB,
# ~10 MB compressed) — it is NOT needed at runtime (installed modules are separate).
# adompkg never left one, so the slim pass didn't clean it; drop it (measured v20).
rm -rf /home/adom/project/adom_modules/.cache 2>/dev/null || true
rm -rf /var/cache/apt/* /var/log/* /tmp/* 2>/dev/null || true
log "bake done (${VER})"
