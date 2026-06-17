---
name: golden-image-test
description: Test/preview the HD golden WSL2 rootfs by importing it into a DISPOSABLE WSL2 distro on the user's Windows laptop via adom-desktop (real systemd PID 1 → exercises the timer + workspace-updater daemon AND gives a real code-server to pup). Use when the user says "test the golden image", "run the golden image", "serve the rootfs", "let me see the golden code-server", "verify the image config", or reports something wrong/missing in a golden image build. Every confirmed gap gets added to image/bake-hd-setup.sh AND a smoke assertion in scripts/build-rootfs.sh — that is the rule.
---

# Golden image testing — the feedback loop

## ⛔ NEVER proot/run code-server in THIS cloud container

Read `cloud-container-safety`. The cloud Docker container runs the boot
code-server as the unsupervised foreground child of PID 1, with no
supervisor — a nested `proot` code-server (or any second `code-server
--bind-addr`) is a real, un-isolated process competing for the same memory,
and it has **bricked the container before** (corrupted boot launcher → admin
rebuild). So: do NOT use `scripts/run-rootfs.sh` here, do NOT `./run-rootfs`,
do NOT start any code-server in this container. Building/inspecting a rootfs
tarball (tar -t, reading files, ownership audits) is fine; *running a server
out of one here is not.* The ONLY place to boot the image + pup its
code-server is a disposable WSL2 distro on the laptop (Method below) or the
Azure VM. `scripts/run-rootfs.sh` is kept for a real Linux host ONLY, never
the cloud container.

## THE test — import into a DISPOSABLE WSL2 distro on the laptop via AD

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
# 5. Browser/pup view: start code-server IN THE DISTRO (on the laptop) and pup
#    to http://localhost:<port> on the laptop — NOT in the cloud container.
#    Use a transient systemd unit or a detached wsl process to keep it alive;
#    if localhost doesn't forward (NAT-mode WSL), pup the distro's WSL IP.
# 6. CLEANUP (always): wsl --unregister golden-test-vN ; remove C:\golden-test-vN
```

This validates everything that matters — including what only real WSL gives:
systemd PID 1, the timer firing, the daemon's first-boot convergence
(installing Codex + writing `~/.adom/workspace-updater-status.json`),
`wsl --import` default-user behavior — AND it gives a real code-server to
show the user in pup. The code-server runs on the LAPTOP, not this container.

### Browser checklist (against the laptop distro's code-server)

- Theme is **Default Dark Modern**, no welcome tab, status bar hidden
- Extensions panel: `anthropic.claude-code` + `adom.adom-vscode` present;
  auto-update enabled (settings `extensions.autoUpdate: true`)
- Terminal: `claude --version`, `which claude` (→ `~/.local/bin/claude`),
  `adom-cli --version`, `adom-desktop --version`, `code-server --version`
- `ls ~/.claude/skills/` shows `adom/` + 30-odd `hd-*` skills
- `cat ~/.claude/settings.json` — has permissions/trust, NO `model` key,
  NO check-updates.sh hook
- No GitHub sign-in prompts anywhere

## Notes on the laptop distro test

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
