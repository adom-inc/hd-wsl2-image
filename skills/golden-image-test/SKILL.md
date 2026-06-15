---
name: golden-image-test
description: Test the HD golden WSL2 rootfs two ways — PRIMARY is importing it into the user's real WSL2 on their Windows laptop via adom-desktop (real systemd PID 1 → exercises the timer + workspace-updater daemon); QUICK is proot + code-server inside this container (browser surface only, no systemd). Use when the user says "test the golden image", "run the golden image", "serve the rootfs", "let me see the golden code-server", "verify the image config", or reports something wrong/missing in a golden image build. Every confirmed gap gets added to image/bake-hd-setup.sh AND a smoke assertion in scripts/build-rootfs.sh — that is the rule.
---

# Golden image testing — two methods + the feedback loop

## METHOD A (PRIMARY, REAL) — import into the laptop's WSL2 via AD

The user's Windows laptop has real WSL2 (it runs HD), so importing the
tarball there boots it as a genuine distro with **systemd as PID 1** — the
ONLY way to actually exercise the timer + workspace-updater daemon short of
the Azure VM. Always import under an **isolated name** (`golden-test-vN`) so
the user's real `Adom-Workspace` distro is never touched, and
`wsl --unregister` it when done.

```bash
# 0. See what distros exist (NEVER touch Adom-Workspace / docker-desktop):
adom-desktop run_script '{"interpreter":"powershell","scriptB64":"<b64: wsl.exe -l -v | Out-String>"}'
# 1. Detached worker on the laptop: download the release tarball from the
#    GitHub URL (public, anonymous — the exact path HD will use), then
#    wsl --import golden-test-vN <dir>\fs <tar> --version 2, write done.txt.
#    Launch via Start-Process -WindowStyle Hidden (download > relay timeout).
# 2. Block on the marker (server-side, no poll loop):
adom-desktop desktop_watch_files '{"path":"C:\\golden-test-vN","glob":"done.txt","timeoutMs":540000,"pollMs":3000}'
# 3. PID 1 must be systemd (this is the whole point):
adom-desktop run_script '{"interpreter":"powershell","scriptB64":"<b64: wsl -d golden-test-vN -- cat /proc/1/comm>"}'   # → systemd
# 4. Daemon: trigger now instead of waiting OnBootSec=2min, then verify:
#    wsl -d golden-test-vN -u root -- systemctl start adom-workspace-updater.service
#    wsl -d golden-test-vN -- cat /home/adom/.adom/workspace-updater-status.json   # updated/pending_reload sane
#    wsl -d golden-test-vN -- /usr/lib/code-server/bin/code-server --list-extensions | grep openai.chatgpt  # Codex INSTALLED BY THE DAEMON
# 5. Browser: start code-server in the distro, pup to http://localhost:<port> on the laptop.
# 6. CLEANUP (always): wsl --unregister golden-test-vN ; remove C:\golden-test-vN
```

This is what validates the things proot can't: systemd PID 1, the timer
firing, the daemon's first-boot convergence (installing Codex + writing
`~/.adom/workspace-updater-status.json`), and `wsl --import` default-user
behavior. **Do NOT report the daemon/timer as "working" from Method B —
only Method A or the VM proves that.**

## METHOD B (QUICK) — proot + code-server in this container

Fast browser-surface check; **cannot boot systemd**. Good for catching
theme/settings/extension/layout/ownership regressions in seconds.

```bash
cd /home/adom/project/hd-wsl2-image
./scripts/run-rootfs.sh                  # serves the last local build on :38082
./scripts/run-rootfs.sh --from v8        # or download + serve a released version
```

Then hand the user the **proxy URL** (never localhost — their browser is
outside the container): `https://<slug>.adom.cloud/proxy/38082/`
(slug from `$VSCODE_PROXY_URI`). Run it in the background; readiness =
HTTP 200/302 on `127.0.0.1:38082`. Drive it with pup for screenshots.

### Browser checklist (Method B, or Method A's code-server)

- Theme is **Default Dark Modern**, no welcome tab, status bar hidden
- Extensions panel: `anthropic.claude-code` + `adom.adom-vscode` present;
  auto-update enabled (settings `extensions.autoUpdate: true`)
- Terminal: `claude --version`, `which claude` (→ `~/.local/bin/claude`),
  `adom-cli --version`, `adom-desktop --version`, `code-server --version`
- `ls ~/.claude/skills/` shows `adom/` + 30-odd `hd-*` skills
- `cat ~/.claude/settings.json` — has permissions/trust, NO `model` key,
  NO check-updates.sh hook
- No GitHub sign-in prompts anywhere

## What Method B (proot) CANNOT test — use Method A or the VM

- systemd boot / PID 1, the workspace-updater timer + daemon convergence,
  `/etc/wsl.conf` (default user, interop), `wsl --import` default-user behavior
- `host.docker.internal` alias (`init-host-internal.sh` runs per boot)
- adom-vscode `:8821` activation under HD's webview + the layout hides
  (sidebars/activity-bar icons — HD applies those at runtime via :8821;
  in this bare proot instance the activity bar may look UNTRIMMED. That
  is expected, not a bake gap.)
- claude-auth / Adom session token flows (per-user)

## The feedback rule

When the user reports a gap ("X isn't installed", "Y setting is wrong"):

1. Fix it in `image/bake-hd-setup.sh` (or Dockerfile/build-rootfs.sh —
   keep all in lockstep).
2. **Add a smoke assertion for it in `scripts/build-rootfs.sh` AND the
   CI workflow's smoke step** — gaps become permanent regression checks;
   a future bake that loses it must fail, not release.
3. Rebake the next version (`golden-image-bake` skill) and re-test.
