---
name: hd-setup-steps-windows
description: >
  Windows/WSL2-specific details for what HD's setup did — the concrete 16-step
  `setup_steps_wsl.rs` cascade, the `wsl --import Adom-Workspace` provisioning
  step, the `wsl --unregister` virgin-reset mechanics, `setup-steps-wsl.json`,
  and the golden `adom-golden.tar.gz` tarball. READ alongside the generic
  [[hd-setup-steps]] skill when you need the exact WSL2 steps or file paths.
  Trigger words — setup_steps_wsl, 16 steps wsl, wsl import, wsl unregister,
  Adom-Workspace, setup-steps-wsl.json, adom-golden.tar.gz, golden distro,
  ensure-workspace.
---

# HD Setup Steps (Windows / WSL2 specifics)

This is the Windows companion to the generic [[hd-setup-steps]] skill. Read
that first for the user-facing Q&A ("what did setup do", "why is X installed",
re-running steps, the virgin reset, and the setup-panel APIs). This page
carries only the concrete WSL2 cascade, commands, and file paths.

HD runs on Windows (WSL2), Mac, and Ubuntu; on Windows the workspace is the
`Adom-Workspace` WSL2 distro. The legacy 24-step Docker cascade
(`HD_RUNTIME=docker`) is in the docker/ bucket.

The cascade is executed by `setup_steps_wsl.rs` (`step_defs_wsl()` /
`run_all_wsl()`). `run_all_wsl` is halt-on-failure, resume-not-restart, with
per-step 3x auto-retry. In-distro work runs via
`wsl -d Adom-Workspace -u adom -- <cmd>` (the distro's DEFAULT user is `adom`
per `wsl.conf default=adom`, home `/home/adom`; root via `-u root`). There is
NO `docker exec` and NO Docker image anywhere in this flow.

## The 16 steps (in order)

| # | Step | Purpose |
|---|---|---|
| 1 | ensure-workspace | Install WSL2 if needed (one auto-reboot), `wsl --import Adom-Workspace` from the golden image `adom-golden.tar.gz` (full pre-baked image from the `adom-inc/hd-wsl2-image` GitHub release), create the `adom` user, start code-server, verify host loopback on 7380. SUBSUMES the old Docker pull-image / create-container / start-container steps. |
| 2 | wait-codeserver | Host TCP probe of the code-server port (default 7380), 120s |
| 3 | install-adom-vscode | "Activate editor extensions" — installs NOTHING (binary + extension are baked); waits for Adom sign-in, reloads the editor iframe, and proves the :8821 editor-control API answers |
| 4 | set-env-vars | Set `ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`, `ADOM_HD_CONTROL_URL`, `VSCODE_PROXY_URI`, `ADOM_DESKTOP_MODE` |
| 5 | inject-api-key | Write the Adom session token into the distro at `/var/run/adom/api-key` (mode 644) so adom-cli works |
| 6 | configure-vscode | settings.json / trusted-domains / activity-bar are BAKED; re-asserts theme + workbench backstops idempotently, and applies the per-session layout via :8821 |
| 7 | ensure-adom-desktop | Verify the Adom Desktop companion app is running on Windows (the relay's desktop bridge) |
| 8 | start-relay | Start the adom-desktop relay inside the workspace (ports 8765 WS / 8766 HTTP) |
| 9 | test-direct-connect | Prove the fast container→desktop command path |
| 10 | test-relay | Register the relay with Adom Desktop for file streaming (file transfer + shell exec) |
| 11 | test-adom-cli | GATE: carbon path + hydrogen-proxy reachability via adom-cli (6 retries) |
| 12 | claude-auth | The single human gate — restore Claude creds or drive the in-editor Claude.ai sign-in via the native browser Browser Picker; runs LAST before the payoff steps |
| 13 | ensure-sse | GATE: confirm the editor browser SSE session is connected so Welcome's webview-open doesn't 409 |
| 14 | verify-workspace | GATE: battery confirming the proxy holds a real layout |
| 15 | welcome | Open Claude Code, authenticate if needed, send the first prompt |
| 16 | open-welcome | GATE (final): open welcome.html in HD's right pane; hard-fails if the Welcome tab doesn't appear |

## The WSL import step (step 1)

`ensure-workspace` installs WSL2 if needed (one auto-reboot), then
`wsl --import Adom-Workspace` from the full pre-baked golden image
`adom-golden.tar.gz` (pulled from the `adom-inc/hd-wsl2-image` GitHub release).
It creates the `adom` user, starts code-server, and verifies host loopback on
port 7380. This single step replaces the old Docker pull-image /
create-container / start-container trio.

## Platform-specific failure causes

Most common WSL2 failures:
- **Step 1** — WSL2 unavailable / the Virtual Machine Platform feature is off,
  or the `adom-golden.tar.gz` download failed.
- **Step 11** (test-adom-cli) — carbon / hydrogen-proxy not reachable yet.
- **Step 12** (claude-auth) — Claude credentials expired.

## Virgin reset — WSL distro wipe

The `container` toggle does a PRISTINE `wsl --unregister Adom-Workspace` +
reimport — it deletes the distro AND everything in it, including
`/home/adom/project`. It backs up Claude creds first UNLESS `claude_token` is
checked.

CRITICAL: the WSL reset ONLY ever runs `wsl --unregister Adom-Workspace`
(+ reimport). It never runs global `wsl --shutdown` or `wsl --uninstall`
(those would kill the user's other distros, including any Docker Desktop WSL
integration), and it performs NO Docker actions and NO reboot for the wipe.

The `tarball` toggle (legacy key `image`) deletes the cached
`adom-golden.tar.gz` (full-image re-download). The `webview_storage` /
`vscode_state` wipes are queued and flushed at the next HD launch
(restart_required), not immediate.

## Setup state file

Setup writes its state to
`%APPDATA%\hydrogen-desktop\setup-steps-wsl.json` (one entry per step with
`status: pending|running|done|failed`, output text, percent complete). HD reads
this on launch to decide whether the setup panel auto-opens. (The legacy Docker
runtime uses `setup-steps.json`.)

## Related skills

- [[hd-setup-steps]] — the generic user-facing setup-steps Q&A and APIs
- `hd-golden-image` — what's baked into `adom-golden.tar.gz` vs. what setup does
- `hd-workspace-lifecycle` — import/export/unregister/terminate, the never-touch-global-WSL rule
- `hd-networking` — port 7380 code-server, how the distro reaches the host, port forwarding
- `hd-volume` — where files live in the distro and what survives a virgin reset
