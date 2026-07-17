#!/usr/bin/env bash
# bake-via-bootstrap.sh — the REGISTRY-NATIVE golden-image bake (v18+).
#
# Replaces bake-hd-setup.sh's hand-rolled cascade (gallia install.mjs + claude
# CLI + extensions + settings + skill copy + adompkg-managed CLIs) with ONE
# declarative install of the layered bootstrap via the `adom-wiki` CLI
# (adompkg is DEPRECATED; gallia is never invoked — adom/core is the new gallia):
#
#     adom-wiki pkg install adom/hd-windows-bootstrap
#       → pulls adom/core             (the Adom ecosystem: skills hub, adom-cli,
#                                       adom-vscode, adom-wiki-cli, adom/hook)
#       → pulls adom/hd-bootstrap      (platform-generic HD: 38 skills + editor config)
#       → installs adom/hd-windows-bootstrap (WSL2: 11 skills + workbench seed)
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

log "installing adom/hd-windows-bootstrap (resolves the full layered tree, sudo-free)"
as_adom "/home/adom/.local/bin/adom-wiki pkg install adom/hd-windows-bootstrap"

# TEMPORARY WORKAROUND (remove when adom-wiki runs scripts.postinstall):
# adom-wiki@1.0.41 runs install.sh but never executes scripts.postinstall (bug
# filed on adom/adom-wiki-cli). Both HD bootstraps deliver their payload via
# postinstall — run them explicitly, in dependency order, guarded so this is a
# no-op once the CLI is fixed.
if ! as_adom 'ls -d ~/.claude/skills/hd-* >/dev/null 2>&1'; then
  log "WORKAROUND: adom-wiki skipped scripts.postinstall — running bootstrap postinstalls explicitly"
  for b in hd-bootstrap hd-windows-bootstrap; do
    as_adom "cd ~/project/adom_modules/adom/${b} && bash ./postinstall.sh"
  done
fi

# ── hard gates — the bake must FAIL loudly if the tree didn't fully land ─────
log "verifying the bootstrap tree installed"
for p in core hd-bootstrap hd-windows-bootstrap adom-desktop adom-wiki-cli hook; do
  as_adom "test -d ~/project/adom_modules/adom/${p}" \
    || { echo "MISSING module: adom/${p}" >&2; exit 1; }
done
for p in adom-workspace-updater hd-skillpack; do
  as_adom "test ! -d ~/project/adom_modules/adom/${p}" \
    || { echo "RETIRED package present: adom/${p}" >&2; exit 1; }
done
# the adom skills hub (from core) + the HD runtime skills must be deployed
as_adom 'test -f ~/.claude/skills/adom/SKILL.md' || { echo "adom skills hub not deployed" >&2; exit 1; }
SKILLS="$(as_adom 'ls -d ~/.claude/skills/hd-* 2>/dev/null | wc -l')"
log "hd-* skills deployed: ${SKILLS}"
[ "${SKILLS}" -ge 45 ] || { echo "expected >=45 hd-* skills (38 generic + 11 windows), got ${SKILLS}" >&2; exit 1; }
# spot-check bundle contents incl. the hd-workspace-updater → hd-staying-current rename
for s in hd-webview hd-pup hd-golden-image hd-staying-current; do
  as_adom "test -f ~/.claude/skills/${s}/SKILL.md" || { echo "MISSING skill: ${s}" >&2; exit 1; }
done
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
