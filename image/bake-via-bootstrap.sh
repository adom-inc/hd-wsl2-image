#!/usr/bin/env bash
# bake-via-bootstrap.sh — the REGISTRY-NATIVE golden-image bake (v18+).
#
# Replaces bake-hydrogen-setup.sh's hand-rolled cascade (gallia install.mjs + claude
# CLI + extensions + settings + skill copy + adompkg-managed CLIs) with ONE
# declarative install of the layered bootstrap via the `adom-wiki` CLI
# (adompkg is DEPRECATED; gallia is never invoked — adom/core is the new gallia):
#
#     adom-wiki pkg install adom/hydrogen-windows-bootstrap
#       → pulls adom/core             (the Adom ecosystem: skills hub, adom-cli,
#                                       adom-vscode, adom-wiki-cli, adom/hook)
#       → pulls adom/hydrogen-bootstrap      (platform-generic HD: 38 skills + editor config)
#       → installs adom/hydrogen-windows-bootstrap (WSL2: 11 skills + workbench seed)
#       → runs each package's install.sh / postinstall (deploy skills, write
#         settings.json, install extensions, seed workbench.html)
#
# RETIRED as of v18 — must NOT appear anywhere in the tree:
#   • adom/adom-workspace-updater (systemd updater daemon; auto-update is now
#     adom/hook → `adom-wiki pkg update` against the PUBLIC registry)
#   • adom/hd-skillpack (skills ship bundled inside the bootstraps)
# Dropping the updater removed the only needs_sudo package → the whole tree is
# sudo-free; there is deliberately NO --allow-sudo here so a sudo package
# sneaking back in FAILS the bake.
#
# The OS "hardware" (apt baseline, code-server, systemd, cron, user/linger/pam)
# stays in the Dockerfile. This script is the "config" half.
#
# ── WHERE THIS RUNS ─────────────────────────────────────────────────────────
# Build ONLY on John's laptop via AD (WSL2-native, bake-in-distro.sh mirrors
# this), or in CI — NEVER in the cloud container. Runs as root inside the
# rootfs during that laptop/CI build.
#
# ── AUTH ────────────────────────────────────────────────────────────────────
# None. The whole tree is PUBLIC and installs anonymously (verified token-less).
set -euo pipefail
log() { echo "[bake-via-bootstrap] $*"; }
as_adom() { runuser -u adom -- bash -lc "$1"; }

test -x /home/adom/.local/bin/adom-wiki \
  || { echo "adom-wiki CLI not installed — the Dockerfile must stage it before this script" >&2; exit 1; }

# Normalize home ownership BEFORE the as-adom install (intermediate dirs the
# Dockerfile creates can be root-owned, which blocks as-adom postinstalls).
chown -R adom:adom /home/adom

log "installing adom/hydrogen-windows-bootstrap (resolves the full layered tree, sudo-free)"
as_adom "/home/adom/.local/bin/adom-wiki pkg install adom/hydrogen-windows-bootstrap"

# v25-fat: bake the Claude Code CLI too (John 2026-08-24). Headless-safe — verified on
# the v25 build distro: install.sh writes ~/.local/bin/claude with nobody signed in.
# Kept in lockstep with bake-in-distro.sh section 6a.
log "installing the Claude Code CLI (headless, unpinned)"
as_adom "curl -fsSL --connect-timeout 20 https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh"
rm -f /tmp/claude-install.sh

# (2026-07-20) postinstall shim removed: the bootstraps now declare scripts.install
# (hd-bootstrap@0.2.23 / hydrogen-windows-bootstrap@0.2.8) and adom-wiki runs install.sh
# in dependency order. Verified on a clean HOME: 51 skills + settings.json, no shim.

# ── hard gates — the bake must FAIL loudly if the tree didn't fully land ─────
log "verifying the bootstrap tree installed"
# v25-fat: current registry names (hd-bootstrap -> hydrogen-bootstrap, adom-desktop ->
# adom-bridge). Both retired slugs are asserted absent so a resurrection fails the bake.
for p in core hydrogen-bootstrap hydrogen-windows-bootstrap adom-bridge adom-wiki-cli hook; do
  as_adom "test -d ~/project/adom_modules/adom/${p}" \
    || { echo "MISSING module: adom/${p}" >&2; exit 1; }
done
for p in adom-workspace-updater hd-skillpack hd-bootstrap adom-desktop; do
  as_adom "test ! -d ~/project/adom_modules/adom/${p}" \
    || { echo "RETIRED package present: adom/${p}" >&2; exit 1; }
done
# the adom skills hub (from core) + the HD runtime skills must be deployed
as_adom 'test -f ~/.claude/skills/adom/SKILL.md' || { echo "adom skills hub not deployed" >&2; exit 1; }
# v25-fat: count the whole tree — the hd-* -> hydrogen-* rename is mid-flight, so a
# prefix count measures the rename, not the install.
SKILLS="$(as_adom 'ls -d ~/.claude/skills/*/ 2>/dev/null | wc -l')"
log "skills deployed: ${SKILLS}"
[ "${SKILLS}" -ge 150 ] || { echo "expected >=150 skills (the bootstrap tree deploys ~197), got ${SKILLS}" >&2; exit 1; }
# spot-check bundle contents by CURRENT name, across both eras of the rename
for s in hydrogen-webview hydrogen-pup hydrogen-golden-image hydrogen-staying-current hd-golden-image; do
  as_adom "test -f ~/.claude/skills/${s}/SKILL.md" || { echo "MISSING skill: ${s}" >&2; exit 1; }
done
# v25-fat: the Claude Code CLI is baked (headless install, verified 2026-08-25)
as_adom 'test -x ~/.local/bin/claude' || { echo "MISSING baked claude CLI" >&2; exit 1; }
as_adom 'export PATH=$HOME/.local/bin:$PATH; claude --version' || { echo "baked claude CLI not runnable" >&2; exit 1; }
# generic editor config the hd-bootstrap postinstall writes
as_adom 'test -f ~/.local/share/code-server/User/settings.json' || { echo "settings.json not written by hd-bootstrap postinstall" >&2; exit 1; }
# the retired updater daemon must NOT exist
test ! -e /usr/local/bin/adom-workspace-updater || { echo "RETIRED workspace-updater daemon present" >&2; exit 1; }
# whole tree sudo-free
! grep -rl '"needs_sudo": *true' /home/adom/project/adom_modules/*/*/package.json 2>/dev/null | grep -q . \
  || { echo "needs_sudo package in the tree — v18 must be sudo-free" >&2; exit 1; }

# ── ownership sweep (bake runs as root; mixes as_adom + root writes) ─────────
chown -Rh adom:adom /home/adom
log "done"
