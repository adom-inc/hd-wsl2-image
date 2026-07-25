---
name: hd-setup-windows
description: >
  Windows/WSL2-specific details for HD setup — the concrete 16-step WSL2 install
  cascade (setup_steps_wsl.rs), the ensure-workspace `wsl --import` of the golden
  distro, the `wsl --unregister Adom-Workspace` virgin-reset mechanics, the
  setup-steps-wsl.json state file, and the never-touch-global-WSL rule. READ
  alongside the generic [[hd-setup]] skill when you need the exact WSL2 steps,
  commands, or file paths. Trigger words — 16 steps, setup_steps_wsl, wsl import,
  wsl unregister, Adom-Workspace, setup-steps-wsl.json, adom-golden.tar.gz, WSL2
  cascade, ensure-workspace, virgin reset wsl.
---

# Hydrogen Desktop -- Setup (Windows / WSL2 specifics)

This is the Windows companion to the generic [[hd-setup]] skill. Read that
first for the setup-panel UX, Run All / Rollback All, the virgin-reset toggle
panel, the keep-auth testing pattern, and the control-API triggers. This page
carries only the concrete WSL2 cascade, commands, and file paths.

HD runs on Windows (WSL2), Mac, and Ubuntu; on Windows the workspace is the
`Adom-Workspace` WSL2 distro. The legacy 24-step Docker cascade
(`HD_RUNTIME=docker`) is in the docker/ bucket.

## The 16 Install Steps (WSL2)

The WSL cascade is executed by `setup_steps_wsl.rs` (`step_defs_wsl()` /
`run_all_wsl()`). `run_all_wsl` is halt-on-failure, resume-not-restart, with
per-step 3x auto-retry. State is tracked in `setup-steps-wsl.json` (the Docker
flow uses `setup-steps.json`). The Docker-only `pull-image` /
`create-container` / `start-container` steps are SUBSUMED into step 1,
`ensure-workspace`, which imports the golden distro via `wsl --import
Adom-Workspace`.

| # | ID | Label | Rollback? |
|---|---|---|---|
| 1 | ensure-workspace | Install WSL2 if needed (one auto-reboot), import golden distro, create `adom` user, start code-server, verify host loopback (7380) | ✓ |
| 2 | wait-codeserver | Host TCP probe of code-server port (default 7380), 120s | ✗ |
| 3 | install-adom-vscode | "Activate editor extensions" — installs NOTHING (binary+extension baked); waits for Adom sign-in, reloads editor iframe, proves the :8821 editor-control API answers | ✓ |
| 4 | set-env-vars | ADOM_CARBON_URL / ADOM_HYDROGEN_URL / ADOM_HD_CONTROL_URL / VSCODE_PROXY_URI / ADOM_DESKTOP_MODE | ✓ |
| 5 | inject-api-key | Write the Adom session token to `/var/run/adom/api-key` (mode 644) | ✓ |
| 6 | configure-vscode | settings.json / trusted-domains / activity-bar are BAKED; re-assert theme + workbench backstops idempotently; apply per-session layout via :8821 | ✓ |
| 7 | ensure-adom-desktop | Verify the Adom Desktop companion app is running on Windows | ✗ |
| 8 | start-relay | Start the adom-desktop relay inside the workspace (8765/8766) | ✓ |
| 9 | test-direct-connect | Prove the fast container→desktop command path | ✗ |
| 10 | test-relay | Register the relay with Adom Desktop for file streaming | ✗ |
| 11 | test-adom-cli | GATE: carbon path + hydrogen-proxy reachability via adom-cli (6 retries) | ✗ |
| 12 | claude-auth | The single human gate; restore creds or drive in-editor Claude.ai sign-in; runs LAST before payoff | ✓ |
| 13 | ensure-sse | GATE: editor browser SSE session connected so Welcome's webview-open doesn't 409 | ✗ |
| 14 | verify-workspace | GATE: battery confirming the proxy holds a real layout | ✗ |
| 15 | welcome | Opens Claude Code, authenticates if needed, sends the first prompt | ✗ |
| 16 | open-welcome | GATE (final): opens welcome.html in HD's right pane; hard-fails if the Welcome tab doesn't appear | ✗ |

## Step 1 — ensure-workspace (WSL2 import)

Installs WSL2 if needed (one auto-reboot), then `wsl --import Adom-Workspace`
from the full pre-baked golden image `adom-golden.tar.gz` (pulled from the
`adom-inc/hd-wsl2-image` GitHub release — NOT a thin ~30 MB tarball, NOT a
390 MB Docker image), creates the `adom` user, starts code-server, and
verifies host loopback on port 7380. This single step replaces the old Docker
pull-image / create-container / start-container trio.

The distro's DEFAULT user is `adom` (`wsl.conf default=adom`), NOT root;
in-distro exec = `wsl -d Adom-Workspace -u adom --` (root via `-u root`) —
NEVER `docker exec`.

WSL2 auto-forwards code-server's port 7380 to Windows `localhost:7380` —
there is no Docker port-mapping layer, so the port-conflict / stale-mapping
class of bug that affected the Docker runtime does not apply here. Other
services tunnel through the code-server `/proxy/{port}/` path.

## Virgin Reset — WSL2 distro mechanics

The `container` toggle does a PRISTINE `wsl --unregister Adom-Workspace` +
reimport — it deletes the distro AND everything in it, including
`/home/adom/project`. It backs up Claude creds first UNLESS `claude_token` is
checked.

CRITICAL — the WSL virgin reset only ever touches `Adom-Workspace`. It runs
`wsl --unregister Adom-Workspace` — NEVER global `wsl --shutdown` or
`wsl --uninstall`, which would knock out the user's other distros (e.g. a
pre-existing Docker Desktop integration). There are NO Docker actions.

The `tarball` toggle (legacy key `image`) deletes the cached
`adom-golden.tar.gz`, forcing a full-image re-download. The `webview_storage` /
`vscode_state` wipes are queued and flushed at the next HD launch
(restart_required); there is no reboot for the wipe.

## Setup state file

Setup writes its state to
`%APPDATA%\hydrogen-desktop\setup-steps-wsl.json` (one entry per step with
`status: pending|running|done|failed`, output text, percent complete). HD
reads this on launch to decide whether the setup panel auto-opens. (The legacy
Docker runtime uses `setup-steps.json`.)

## Related skills

- [[hd-setup]] — the generic setup-panel UX, buttons, virgin-reset toggles, and control-API triggers
- `hd-golden-image` — what's baked into `adom-golden.tar.gz`
- `hd-workspace-lifecycle` — import/export/unregister/terminate mechanics and the never-touch-global-WSL rule
