#!/usr/bin/env bash
# postinstall.sh — adom/hydrogen-bootstrap
#
# Runs (as the workspace user) after every dependency is installed —
# adompkg installs apps/skills first, bootstraps (and their postinstall)
# last. This hook applies the HD *environment configuration* that isn't a
# package: the Claude Code + adom-vscode extensions, and the VS Code / code-server
# settings that make the editor behave like Hydrogen Desktop.
#
# What is NOT here, by design:
#   - the Adom ecosystem (skills hub, distributor search, KiCad/Fusion, pup,
#     adom-cli, adom-vscode binary, ...) — comes from the adom/core dependency
#   - the hd-* runtime skills — the adom/hd-skills dependency
#   - the workspace-updater daemon + the CLIs — their own dependencies
#   - the OS baseline (apt, code-server, systemd, user/linger/pam) — that's
#     the golden image's Dockerfile ("hardware"); a live install assumes a
#     workspace that already has it.
#
# Idempotent + LIVE-INSTALLABLE: this must converge correctly from a cold
# `adompkg install adom/hydrogen-bootstrap` on an already-running workspace (the
# vendor "am I set up?" path), not only inside the golden-image bake. Re-runs
# are safe. The bake runs the exact same command, just earlier.
#
# Mirrors the config sections of hd-wsl2-image/image/bake-hydrogen-setup.sh — keep
# the two in lockstep until the bake is rewritten to just install this.
set -euo pipefail
log() { echo "[hd-bootstrap] $*"; }

CS="$(command -v code-server 2>/dev/null || echo /usr/lib/code-server/bin/code-server)"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 0. Deploy the bundled hydrogen-* runtime skills into ~/.claude/skills/. These
#    ship INSIDE this package (Hydrogen-specific — there is no separate skills
#    package); the package's skills/ dir is the source of truth.
#    NAMING CUTOVER (2026-08): skills renamed hd-* -> hydrogen-*. Deploy EVERY
#    bundled skill dir (no name-prefix glob to go stale again), and purge the
#    old hd-* copies a previous version deployed so the two generations never
#    sit side by side (the ab 2.0.17 lesson, issue #584 sidebar).
if [ -d "$HERE/skills" ]; then
  log "deploying bundled hydrogen skills"
  install -d -m 0755 "$HOME/.claude/skills"
  count=0
  for d in "$HERE"/skills/*/; do
    [ -f "${d}SKILL.md" ] || continue
    name="$(basename "$d")"
    install -d -m 0755 "$HOME/.claude/skills/${name}"
    install -m 0644 "${d}SKILL.md" "$HOME/.claude/skills/${name}/SKILL.md"
    count=$((count + 1))
  done
  log "  deployed ${count} bundled skills"
  purged=0
  for d in "$HOME"/.claude/skills/hd-*/; do
    [ -d "$d" ] || continue
    rm -rf "$d"
    purged=$((purged + 1))
  done
  [ "$purged" -gt 0 ] && log "  purged ${purged} stale hd-* skill dirs (renamed to hydrogen-*)"
fi

# 0b. Purge KNOWN-DEAD sibling module dirs. These are baked v22 leftovers whose
#     packages were renamed in the registry (June slug consolidation + the
#     adom-desktop -> adom-bridge rename): `pkg update` skips them forever with a
#     STALE_INSTALL warning and never deletes the folders, so every fresh install
#     carries dead names in adom_modules (John, 2026-08-09). Fixed allowlist on
#     purpose - a hook must never guess at deleting things the registry merely
#     failed to resolve transiently. Successors all install via the dependency
#     tree, so removing the corpse loses nothing.
MODULES_ADOM="$(cd "$HERE/.." && pwd)"
for dead in adom-desktop step2glb adom-theme-system adom-workspace-control; do
  if [ -d "${MODULES_ADOM}/${dead}" ]; then
    rm -rf "${MODULES_ADOM}/${dead}"
    log "purged dead module dir: adom/${dead} (renamed in the registry; successor installs via the tree)"
  fi
done

# 1. Claude Code CLI — NOT installed here, on purpose. It's not an adompkg/wiki
#    package (it's Anthropic's, from claude.ai), and its installer needs a working
#    systemd user session, which is unreliable in the bake env. HD installs + auths
#    it at runtime via its setup cascade (install-claude-cli + claude-auth), in the
#    real workspace where the user session works. So the bootstrap leaves Claude to
#    HD. Just ensure ~/.local/bin is on PATH (for adompkg + adom-desktop).
grep -q '/.local/bin' "$HOME/.bashrc" 2>/dev/null \
  || printf 'export PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"

# 2. Claude Code extension (Open VSX). (Subsumes install-claude-ext.)
log "registering Claude Code extension"
"$CS" --install-extension anthropic.claude-code --force 2>&1 | tail -3 || true

# 3. adom-vscode extension. The BINARY comes from the adom/core → adom/adom-vscode
#    dependency; `adom-vscode install` only drops the .vsix + skill, it does NOT
#    register with code-server (proven 2026-05-31) — register it explicitly.
if command -v adom-vscode >/dev/null 2>&1; then
  log "registering adom-vscode extension"
  adom-vscode install 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -6 || true
  V="$(ls -1 /tmp/adom-vscode-*.vsix 2>/dev/null | head -1 || true)"
  [ -n "$V" ] && "$CS" --install-extension "$V" --force 2>&1 | tail -3 || true
  rm -f /tmp/adom-vscode-*.vsix 2>/dev/null || true
fi

# 4. code-server settings.json — the configure-vscode payload PLUS the chat/UI
#    disables (without these the editor opens VS Code's built-in agent chat
#    panel). NO model pin — Claude Code picks the default model itself.
log "writing code-server settings.json"
install -d -m 0755 "$HOME/.local/share/code-server/User"
cat > "$HOME/.local/share/code-server/User/settings.json" <<'SETTINGS'
{
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.untrustedFiles": "open",
  "workbench.startupEditor": "none",
  "workbench.activityBar.location": "default",
  "workbench.activityBar.iconClickBehavior": "toggle",
  "workbench.colorTheme": "Default Dark Modern",
  "editor.fontSize": 15,
  "workbench.statusBar.visible": false,
  "workbench.navigationControl.enabled": false,
  "workbench.secondarySideBar.visible": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "claudeCode.allowDangerouslySkipPermissions": false,
  "claudeCode.initialPermissionMode": "auto",
  "claudeCode.preferredLocation": "panel",
  "chat.agent.enabled": false,
  "chat.commandCenter.enabled": false,
  "chat.agentsControl.enabled": false,
  "chat.unifiedAgentsBar.enabled": false,
  "github.copilot.chat.enabled": false,
  "github.copilot.enable": { "*": false },
  "github.gitAuthentication": false,
  "git.autofetch": false,
  "scm.defaultViewMode": "tree",
  "security.trustedDomains": ["*"],
  "workbench.trustedDomains.promptInTrustedWorkspace": false,
  "remote.portsAttributes": { "8821": { "onAutoForward": "silent" } },
  "remote.otherPortsAttributes": { "onAutoForward": "silent" },
  "remote.autoForwardPortsSource": "hybrid",
  "extensions.autoUpdate": true,
  "extensions.autoCheckUpdates": true
}
SETTINGS

# 5. code-server config.yaml — silence code-server's own update nags.
install -d -m 0755 "$HOME/.config/code-server"
cat > "$HOME/.config/code-server/config.yaml" <<'CSCONF'
bind-addr: 0.0.0.0:8080
auth: none
disable-telemetry: true
disable-update-check: true
CSCONF

# NOTE: the workbench.html IndexedDB seed (trusted domains + activity-bar unpin)
# patches the WSL2 code-server install path and is therefore PLATFORM-SPECIFIC —
# it lives in adom/hydrogen-windows-bootstrap, not here. Mac/Ubuntu layers add their own.

# 6. API-KEY PERSISTENCE (2026-08-04). /var/run is tmpfs — wiped on EVERY distro
#    boot — and HD's launch-time re-injection missed every other boot path, so
#    /var/run/adom/api-key vanished and all in-workspace tools 401'd against
#    carbon/wiki. Fix is DAEMONLESS: systemd-tmpfiles (declarative, runs during
#    sysinit, before code-server) re-materializes the tmpfs key from a persistent
#    copy at /home/adom/.adom/api-key on every boot. HD writes both copies when
#    it has the token (write-through); this section installs the machinery and,
#    if a live key exists but no persistent copy yet, migrates it — so a plain
#    `adom-wiki pkg update` retrofits running workspaces. No key material ships
#    in this package; only the plumbing.
log "api-key persistence: tmpfiles machinery + persistent-copy migration"
install -d -m 0700 "$HOME/.adom"
if [ -s /var/run/adom/api-key ] && [ ! -s "$HOME/.adom/api-key" ]; then
  cp /var/run/adom/api-key "$HOME/.adom/api-key" && chmod 600 "$HOME/.adom/api-key"
  log "  migrated live key to persistent copy"
fi
printf 'd /run/adom 0755 root root -
C /run/adom/api-key 0644 root root - /home/adom/.adom/api-key
'   | sudo tee /etc/tmpfiles.d/adom-api-key.conf >/dev/null   && log "  tmpfiles.d/adom-api-key.conf installed (boot-time re-materialization)"   || log "  WARN: could not install tmpfiles snippet (no sudo?) — HD self-heal will retry"

# 7. tidy — install.mjs / tooling leave an empty ~/project/.mcp.json; remove it.
rm -f "$HOME/project/.mcp.json" 2>/dev/null || true
log "done"
