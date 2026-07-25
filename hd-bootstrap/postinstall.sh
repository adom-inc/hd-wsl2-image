#!/usr/bin/env bash
# postinstall.sh — adom/hd-bootstrap
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
# `adompkg install adom/hd-bootstrap` on an already-running workspace (the
# vendor "am I set up?" path), not only inside the golden-image bake. Re-runs
# are safe. The bake runs the exact same command, just earlier.
#
# Mirrors the config sections of hd-wsl2-image/image/bake-hd-setup.sh — keep
# the two in lockstep until the bake is rewritten to just install this.
set -euo pipefail
log() { echo "[hd-bootstrap] $*"; }

CS="$(command -v code-server 2>/dev/null || echo /usr/lib/code-server/bin/code-server)"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 0. Deploy the bundled hd-* runtime skills into ~/.claude/skills/. These ship
#    INSIDE this package (HD-specific — there is no separate adom/hd-skills
#    package); the package's skills/ dir is the source of truth.
if [ -d "$HERE/skills" ]; then
  log "deploying bundled hd-* skills"
  install -d -m 0755 "$HOME/.claude/skills"
  count=0
  for d in "$HERE"/skills/hd-*/; do
    [ -f "${d}SKILL.md" ] || continue
    name="$(basename "$d")"
    install -d -m 0755 "$HOME/.claude/skills/${name}"
    install -m 0644 "${d}SKILL.md" "$HOME/.claude/skills/${name}/SKILL.md"
    count=$((count + 1))
  done
  log "  deployed ${count} hd-* skills"
fi

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
  "workbench.colorTheme": "Adom Kickstand",
  "workbench.statusBar.visible": false,
  "workbench.navigationControl.enabled": false,
  "workbench.secondarySideBar.visible": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "claudeCode.allowDangerouslySkipPermissions": true,
  "claudeCode.initialPermissionMode": "bypassPermissions",
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
# it lives in adom/hd-windows-bootstrap, not here. Mac/Ubuntu layers add their own.

# 6. tidy — install.mjs / tooling leave an empty ~/project/.mcp.json; remove it.
rm -f "$HOME/project/.mcp.json" 2>/dev/null || true
log "done"
