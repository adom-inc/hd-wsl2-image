#!/usr/bin/env bash
# bake-hd-setup.sh — pre-run HD's setup cascade at IMAGE BUILD time.
#
# Run as root inside the rootfs (chroot or docker RUN). Each section names
# the setup step it subsumes in
# hydrogen-desktop/src-tauri/crates/hd-app/src/setup_steps_wsl.rs — keep
# the two in lockstep. With these baked, the runtime cascade reduces to the
# machine/user-specific steps only: ensure-workspace (wsl --import),
# wait-codeserver, set-env-vars (live proxy port), inject-api-key,
# ensure-adom-desktop (host side), start-relay/test-* (relay), claude-auth,
# and welcome.
#
# NOTHING here may require GitHub authentication — this image is public and
# installs on machines with no GitHub identity. Sources used: the local
# gallia snapshot (staged by the builder), the public Adom wiki, Open VSX,
# and claude.ai. install.mjs's `gh release download` attempts fail
# unauthenticated and fall back to wiki URLs by design.

set -euo pipefail
log() { echo "[bake-hd-setup] $*"; }
as_adom() { runuser -u adom -- bash -lc "$1"; }

WIKI_BASE="${WIKI_BASE:-https://wiki-ufypy5dpx93o.adom.cloud}"
CS=/usr/lib/code-server/bin/code-server

# ── step 4: install-gallia ─────────────────────────────────────────────────
# npm install must produce node_modules (hard gate, mirrors the cascade).
# install.mjs is gated on its own "Installation complete" marker, NOT its
# exit code — it exits non-zero even on a fully successful install.
log "step 4: gallia npm install + install.mjs"
test -d /home/adom/gallia || { echo "gallia snapshot missing — builder must stage it first" >&2; exit 1; }
as_adom 'cd ~/gallia && npm install --no-audit --no-fund 2>&1 | tail -3 && test -d node_modules'
as_adom 'node ~/gallia/install.mjs --project ~/project > /tmp/install-mjs.log 2>&1 || true; tail -25 /tmp/install-mjs.log; grep -q "Installation complete" /tmp/install-mjs.log'

# ── step 15: install-claude-cli ────────────────────────────────────────────
# Official installer → ~/.local/bin/claude (symlink to
# ~/.local/share/claude/versions/<ver>). PATH line is idempotent (and
# install.mjs §0 writes it too). The ~235 MB download cache is deleted —
# it would otherwise ship in the image for nothing.
#
# The claude binary (bun-based) REQUIRES /proc and aborts without it. In
# docker (CI) /proc exists and the installer self-completes + verifies.
# In the chroot builder there is no /proc: the installer still downloads
# AND checksum-verifies the binary, but its final `claude install` step
# core-dumps — so we finish the versions/<ver> + symlink layout manually
# (mirroring what `claude install` creates) and scripts/build-rootfs.sh
# functionally verifies the binary afterwards under proot with /proc bound.
log "step 15: claude CLI"
if [ -e /proc/self ]; then
    as_adom 'curl -fsSL --connect-timeout 15 https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh 2>&1 | tail -4; rm -f /tmp/claude-install.sh'
    as_adom '~/.local/bin/claude --version'
else
    log "  no /proc (chroot build) — completing the installer's layout manually"
    as_adom 'curl -fsSL --connect-timeout 15 https://claude.ai/install.sh -o /tmp/claude-install.sh && { bash /tmp/claude-install.sh 2>&1 | tail -4 || true; }; rm -f /tmp/claude-install.sh'
    as_adom 'BIN="$(ls -1 ~/.claude/downloads/claude-*-linux-x64 2>/dev/null | sort -V | tail -1)"; test -s "$BIN"; VER="$(basename "$BIN" | sed "s/^claude-//; s/-linux-x64$//")"; install -D -m 0755 "$BIN" ~/.local/share/claude/versions/"$VER"; mkdir -p ~/.local/bin; ln -sfn ~/.local/share/claude/versions/"$VER" ~/.local/bin/claude'
    as_adom 'test -L ~/.local/bin/claude && test -s "$(readlink -f ~/.local/bin/claude)"'
fi
as_adom 'grep -q "/.local/bin" ~/.bashrc || printf "export PATH=\"\$HOME/.local/bin:\$PATH\"\n" >> ~/.bashrc'
as_adom 'rm -rf ~/.claude/downloads'

# ── step 16: install-claude-ext ────────────────────────────────────────────
log "step 16: Claude Code extension (Open VSX)"
as_adom "$CS --install-extension anthropic.claude-code --force 2>&1 | tail -3"
as_adom "$CS --list-extensions 2>/dev/null | grep -qi claude"

# ── step 3: install-adom-vscode (extension half; binary baked earlier) ────
# `adom-vscode install` drops the .vsix at /tmp + skill + completions but
# does NOT register with code-server (proven 2026-05-31) — register the
# .vsix explicitly, then verify, exactly like the cascade.
log "step 3: adom-vscode extension"
as_adom '/usr/local/bin/adom-vscode install 2>&1 | sed "s/\x1b\[[0-9;]*m//g" | tail -6 || true'
as_adom 'V=$(ls -1 /tmp/adom-vscode-*.vsix 2>/dev/null | head -1); test -n "$V" && '"$CS"' --install-extension "$V" --force 2>&1 | tail -3'
as_adom "$CS --list-extensions 2>/dev/null | grep -qi adom"

# ── step configure-vscode: settings.json ──────────────────────────────────
# setup_steps_wsl.rs "configure-vscode" payload PLUS the chat/UI disables
# the cloud reference container carries (chat.agent, navigationControl,
# secondary sidebar, copilot/git auth off) — without these the baked
# editor opens VS Code's built-in "Build with Agent" chat panel (caught
# by pup visual test 2026-06-11). Note: NO model pin — Claude Code picks
# the default model itself.
# ⚠ If HD's runtime configure-vscode step still rewrites settings.json,
# its payload in setup_steps_wsl.rs must gain these keys too, or first
# launch resurrects the chat panel.
log "configure-vscode: settings.json"
install -d -o adom -g adom -m 0755 /home/adom/.local/share/code-server/User
cat > /home/adom/.local/share/code-server/User/settings.json <<'SETTINGS'
{
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.untrustedFiles": "open",
  "workbench.startupEditor": "none",
  "workbench.activityBar.location": "default",
  "workbench.activityBar.iconClickBehavior": "toggle",
  "workbench.colorTheme": "Default Dark Modern",
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
  "extensions.autoUpdate": true,
  "extensions.autoCheckUpdates": true
}
SETTINGS
chown adom:adom /home/adom/.local/share/code-server/User/settings.json

# code-server's own update-check nags ("v4.x has been released!") —
# disable via config.yaml (caught by pup visual test 2026-06-11). HD's
# code-server start command should also pass --disable-update-check.
install -d -o adom -g adom -m 0755 /home/adom/.config/code-server
cat > /home/adom/.config/code-server/config.yaml <<'CSCONF'
bind-addr: 0.0.0.0:8080
auth: none
disable-telemetry: true
disable-update-check: true
CSCONF
chown adom:adom /home/adom/.config/code-server/config.yaml

# ── step configure-vscode: workbench.html IndexedDB state seed ────────────
# One injected script, runs on every page load, seeds VS Code's per-origin
# IndexedDB state:
#   1. trusted domains "*" — suppresses the 'open external website?' dialog
#      (same as the cascade's patch)
#   2. activity bar: unpin Search/SCM/Run-and-Debug via
#      workbench.activity.pinnedViewlets2 — replaces the cascade's
#      interactive :8821 hide-activitybar step. Seeded ONCE per profile
#      (adom.activityBarSeeded marker) so a user who deliberately re-pins
#      them is never fought. First-ever paint can race VS Code's startup
#      read — any reload (HD's setup reloads the iframe anyway) applies it.
log "configure-vscode: workbench.html state seed (trusted domains + activity bar)"
WB=/usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.html
python3 - "$WB" <<'PY'
import sys
wb = sys.argv[1]
html = open(wb).read()
SCRIPT = ('<script>(function(){try{var r=indexedDB.open("vscode-web-state-db-global",1);'
 'r.onsuccess=function(e){var d=e.target.result;'
 'try{var t=d.transaction("ItemTable","readwrite");t.objectStore("ItemTable").put(JSON.stringify(["*"]),"http.linkProtectionTrustedDomains")}catch(_){}'
 'try{var t1=d.transaction("ItemTable","readonly");var os1=t1.objectStore("ItemTable");'
 'var sg=os1.get("adom.activityBarSeeded");sg.onsuccess=function(){if(sg.result)return;'
 'var pg=os1.get("workbench.activity.pinnedViewlets2");pg.onsuccess=function(){'
 'var arr=[];try{if(pg.result)arr=JSON.parse(pg.result)}catch(_){}'
 'var ids=["workbench.view.search","workbench.view.scm","workbench.view.debug"];'
 'ids.forEach(function(id){var f=null;for(var i=0;i<arr.length;i++){if(arr[i].id===id)f=arr[i]}'
 'if(f){f.pinned=false}else{arr.push({id:id,pinned:false,visible:false})}});'
 'try{var t2=d.transaction("ItemTable","readwrite");var o2=t2.objectStore("ItemTable");'
 'o2.put(JSON.stringify(arr),"workbench.activity.pinnedViewlets2");o2.put("1","adom.activityBarSeeded")}catch(_){}}}}catch(_){}};'
 'window.__hdTrustedDomains=1;window.__hdAbSeed=1}catch(_){}})();</script>')
if '__hdAbSeed' not in html:
    html = html.replace('</head>', SCRIPT + '</head>')
    open(wb, 'w').write(html)
PY
grep -q __hdTrustedDomains "$WB"
grep -q adom.activityBarSeeded "$WB"

# ── step 8: install-hd-skills ──────────────────────────────────────────────
# Builder stages hydrogen-desktop/skills/public-facing/{shared,wsl2} at
# /tmp/hd-skills. Flat install, shared + wsl2 buckets only (never docker/).
log "step 8: HD self-awareness skills"
if [ -d /tmp/hd-skills ]; then
    count=0
    for bucket in shared wsl2; do
        for d in /tmp/hd-skills/${bucket}/hd-*/; do
            [ -f "${d}SKILL.md" ] || continue
            name="$(basename "$d")"
            # NOTE: `install -D -o adom -g adom` applies the owner to the FILE
            # only — the parent dir it auto-creates lands root:root (this bake
            # runs as root), leaving adom unable to delete/rename the skill dir.
            # Create the dir explicitly as adom, THEN install the file.
            install -d -o adom -g adom -m 0755 "/home/adom/.claude/skills/${name}"
            install -o adom -g adom -m 0644 "${d}SKILL.md" "/home/adom/.claude/skills/${name}/SKILL.md"
            count=$((count + 1))
        done
    done
    rm -rf /tmp/hd-skills
    log "  installed ${count} HD skills"
    [ "$count" -gt 0 ]
else
    log "  /tmp/hd-skills not staged — skipping (non-fatal, mirrors the cascade)"
fi

# ── step 10: verify-adom-desktop (CLI half) ───────────────────────────────
# Latest published AD CLI via version.json (wiki v2 → v1 mirror fallback),
# same resolution order as ad_install::resolve_latest_ad.
log "step 10: adom-desktop CLI"
VJ="$(curl -fsSL https://git-wiki-ktqxite5iglh.adom.cloud/api/v1/pages/adom-desktop/files/version.json 2>/dev/null \
   || curl -fsSL "${WIKI_BASE}/static/apps/adom-desktop/version.json")"
AD_URL="$(echo "$VJ" | jq -r '.cli.linux_x86_64.binary_url')"
[ -n "$AD_URL" ] && [ "$AD_URL" != "null" ]
curl -fsSL "$AD_URL" -o /usr/local/bin/adom-desktop
chmod 0755 /usr/local/bin/adom-desktop
# A stale ~/.local/bin/adom-desktop (occasionally created by older gallia
# install.mjs runs) would shadow /usr/local/bin in PATH — remove it.
rm -f /home/adom/.local/bin/adom-desktop
as_adom 'adom-desktop --version'

# ── HD in-distro workspace-updater daemon (Part B of HD auto-update) ───────
# Staged at /tmp/workspace-updater by the builder (CI sparse-checkout / chroot
# cp from hydrogen-desktop main). GUARDED: if absent (pre-merge of
# feature/hd-auto-update), skip cleanly so the monthly cron never breaks; once
# the files are on main, the bake installs the daemon so a FRESH image has it
# before HD's first launch. HD also bootstraps it into EXISTING distros via
# ensure_workspace_updater every launch — so this bake is purely first-install.
# The daemon's FIRST run installs the Codex VS Code extension, then converges
# the workspace to the wiki manifest (SHA-verified, never-downgrade, surgical).
# Codex is NOT baked — the daemon adds it at runtime.
if [ -f /tmp/workspace-updater/adom-workspace-updater.sh ]; then
    log "workspace-updater daemon (HD auto-update)"
    # LF-only (source is LF; install preserves bytes). chmod +x the script.
    install -m 0755 /tmp/workspace-updater/adom-workspace-updater.sh /usr/local/bin/adom-workspace-updater
    install -m 0644 /tmp/workspace-updater/adom-workspace-updater.service /etc/systemd/system/adom-workspace-updater.service
    install -m 0644 /tmp/workspace-updater/adom-workspace-updater.timer   /etc/systemd/system/adom-workspace-updater.timer
    # README.md intentionally NOT shipped.
    # HARDEN the timer at bake time so the image is correct regardless of which HD branch the
    # builder pulled the source from (John 2026-06-15): the updater MUST NOT run during boot.
    # Persistent=true made systemd treat the never-run timer as "missed" on a fresh import and fire
    # it IMMEDIATELY at boot (dpkg -i code-server + ext installs in the core boot path → is-system-
    # running --wait blocked for minutes). Strip any Persistent= and force a 5-min OnBootSec delay.
    sed -i '/^[[:space:]]*Persistent[[:space:]]*=/d' /etc/systemd/system/adom-workspace-updater.timer
    grep -qiE '^[[:space:]]*OnBootSec' /etc/systemd/system/adom-workspace-updater.timer \
        && sed -i 's/^[[:space:]]*OnBootSec[[:space:]]*=.*/OnBootSec=5min/' /etc/systemd/system/adom-workspace-updater.timer \
        || sed -i '/^\[Timer\]/a OnBootSec=5min' /etc/systemd/system/adom-workspace-updater.timer
    # Enable the timer so it fires on first systemd boot (wsl.conf has
    # systemd=true). `systemctl enable` just writes the wants-symlink (works
    # offline); fall back to the symlink directly if systemctl is absent in
    # the minimal rootfs.
    systemctl enable adom-workspace-updater.timer 2>/dev/null || {
        mkdir -p /etc/systemd/system/timers.target.wants
        ln -sf /etc/systemd/system/adom-workspace-updater.timer \
               /etc/systemd/system/timers.target.wants/adom-workspace-updater.timer
    }
    rm -rf /tmp/workspace-updater
    log "  daemon $(/usr/local/bin/adom-workspace-updater --version 2>/dev/null) installed + timer enabled"
else
    log "workspace-updater not staged — skipping (pre-merge of feature/hd-auto-update)"
fi

# ── cron: a first-class scheduling service for anyone in this distro ──────────
# John 2026-06-15: make crontab available to every workspace user out of the box. The `cron`
# package is in the apt baseline; ENABLE cron.service so the daemon runs at boot (systemd=true),
# so `crontab -e` / `crontab -l` and per-user jobs Just Work. `systemctl enable` writes the
# wants-symlink offline; fall back to the symlink directly if systemctl is absent in the chroot.
log "enabling cron.service (crontab available to all distro users)"
systemctl enable cron.service 2>/dev/null || {
    mkdir -p /etc/systemd/system/multi-user.target.wants
    ln -sf /lib/systemd/system/cron.service \
           /etc/systemd/system/multi-user.target.wants/cron.service 2>/dev/null \
    || ln -sf /usr/lib/systemd/system/cron.service \
              /etc/systemd/system/multi-user.target.wants/cron.service 2>/dev/null || true
}

# ── tidy ───────────────────────────────────────────────────────────────────
# install.mjs leaves an empty {"mcpServers":{}} at ~/project/.mcp.json —
# visible bake debris in a fresh user's explorer (pup visual test
# 2026-06-11). project-content/{schematics,screenshots} stays: that's the
# intentional Adom workspace convention tools save into.
rm -f /home/adom/project/.mcp.json
rm -f /tmp/adom-vscode-*.vsix /tmp/install-mjs.log
as_adom 'npm cache clean --force >/dev/null 2>&1 || true'

# ── ownership sweep (belt + suspenders) ────────────────────────────────────
# Definitive guarantee that the user's entire home tree is adom-owned. The
# bake runs as root and mixes as_adom / root-side file creation; any tool
# (now or future) that writes a root-owned path under /home/adom would
# silently leave the user unable to delete it (the 'install -D' skill-dir
# trap that shipped in v1-v5 was exactly this). One sweep closes the whole
# class. /home/adom is a user home — nothing in it should be root-owned.
# -h so symlinks (e.g. ~/.local/bin/claude) get their own ownership set,
# not their targets'.
chown -Rh adom:adom /home/adom
log "done"
