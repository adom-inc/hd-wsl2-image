---
name: hydrogen-setup
description: >
  Hydrogen setup panel: 27 install steps, Run All, Rollback All, Virgin Reset with
  toggles, and automated testing patterns. MUST READ before running setup,
  testing steps, or doing virgin resets. Covers the step list, the virgin
  reset toggle panel, how to keep auth during resets, and how Run All handles
  failures. Trigger words — setup panel, install steps, run all, virgin reset,
  rollback, step failed, 28 steps, wipe, reset workspace, keep auth, test setup.
---

# Hydrogen — Setup Panel & Virgin Reset

WSL2-runtime version (default). The legacy 24-step Docker cascade
(`HD_RUNTIME=docker`) is in the docker/ bucket.

## Zero-Click Goal

The Hydrogen setup process targets ZERO manual clicks for the user. The heavy
lifting is already done at image-build time: the `Adom-Workspace` golden
image ships with code-server, gallia, the 8 Adom CLIs, the claude CLI + Code
extension, VS Code settings, and all `hd-*` skills BAKED IN. Setup just
imports that image, injects the user's session, wires up the relay, and walks
the single human auth gate. If something is missing, Hydrogen downloads it — never
tell the user to install something manually. See the `hydrogen-golden-image` skill
for the baked-image model.

## The 27 Install Steps

The WSL cascade is executed by `setup_steps_wsl.rs` (`step_defs_wsl()` /
`run_all_wsl()`). `run_all_wsl` is halt-on-failure, resume-not-restart, with
per-step 3× auto-retry. State is tracked in `setup-steps-wsl.json`
(the Docker flow uses `setup-steps.json`). The Docker-only `pull-image` /
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
| 7 | ensure-adom-bridge-cli | Verify the Adom Bridge companion app is running on Windows | ✗ |
| 8 | start-relay | Start the adom-bridge-cli relay inside the workspace (8765/8766) | ✓ |
| 9 | test-direct-connect | Prove the fast container→desktop command path | ✗ |
| 10 | test-relay | Register the relay with Adom Bridge for file streaming | ✗ |
| 11 | test-adom-cli | GATE: carbon path + hydrogen-proxy reachability via adom-cli (6 retries) | ✗ |
| 12 | install-claude-cli | Install the `claude` CLI into the distro at RUNTIME (NOT baked — its self-setup needs a live session). Idempotent | ✗ |
| 13 | claude-auth | The single human gate; restore creds or drive in-editor Claude.ai sign-in; runs just before payoff | ✓ |
| 14 | ensure-sse | GATE: editor browser SSE session connected so Welcome's webview-open doesn't 409 | ✗ |
| 15 | verify-workspace | GATE: battery confirming the proxy holds a real layout | ✗ |
| 16 | welcome | Opens Claude Code, authenticates if needed, human-types the first prompt | ✗ |
| 17-25 | thread-* (9) | Nine FRESH Claude conversations, one at a time: parts-search, kicad, fusion360, altium, pup, native-browser, google, chip-fetcher, adom-tsci. Replaced the old eda-discovery + instapcb-quote steps | ✗ |
| 26 | verify-setup | GATE (catch-all): independently re-verifies the whole workspace end-to-end; HALTS naming any missing artifact | ✗ |
| 27 | open-welcome | GATE (final): opens welcome.html in Hydrogen's right pane; hard-fails if the Welcome tab doesn't appear | ✗ |

### Steps that NO LONGER EXIST (baked into the golden image)

These are NOT setup steps anymore — they are baked at image-build time and
must not be listed or "run": `install-gallia`, `install-hd-skills`,
`verify-adom-bridge-cli`, `install-claude-ext`,
`write-vscode-settings`, `set-trusted-domains`, `clean-layout`. gallia, the 8
Adom CLIs, the Claude Code VS Code extension (the claude CLI is runtime step 12, NOT baked), code-server, settings, and all
`hd-*` skills are baked into the golden image. See
`hydrogen-golden-image`.

## Panel Buttons

- **Run All** — executes all pending steps sequentially. STOPS on first failure.
- **Rollback All** — rolls back all completed steps in reverse order.
- **Virgin Reset ▾** — opens the toggle panel (see below).
- **Run** (per-step) — runs a single step.
- **Rollback** (per-step) — rolls back a single step.

## CRITICAL: Run All Stops on Failure

If any step fails, Run All ABORTS (halt-on-failure in `run_all_wsl()`, after
the per-step 3× auto-retry is exhausted). Remaining steps are NOT executed.
`run_all_wsl` resumes — it does NOT restart from step 1 — so to recover after
a failure: fix the issue, then either:
- Click "Run All" again (it resumes from the first not-done step)
- Click "Run" on the failed step to retry just that one

## Virgin Reset Toggle Panel

Click "Virgin Reset ▾" to expand the wipe options. Each toggle has a
live status badge showing the current state. The ONLY programmatic trigger is
`POST /setup/panel/run-virgin-reset` (see below).

| Toggle (option key) | What it wipes | Status badges |
|---|---|---|
| Install step state (`install_state`) | Resets all 28 steps to pending (`setup-steps-wsl.json`) | CLEAN / EXISTS |
| WSL2 distro (`container`) | PRISTINE `wsl --unregister Adom-Workspace` + reimport (ONLY that distro) | GONE / RUNNING / EXISTS |
| Distro tarball (`tarball`, legacy `image`) | Deletes cached `adom-golden.tar.gz` (full image re-download) | CACHED / GONE |
| Webview storage (`webview_storage`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | CLEAN / EXISTS |
| VS Code state (`vscode_state`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | CLEAN / EXISTS |
| Adom session token (`adom_token`) | Deletes `hydrogen-session.txt` | CLEAN / EXISTS |
| Claude credentials (`claude_token`) | Deletes the host-side Claude creds backup | CLEAN / EXISTS |

`confirmed_destructive` must be set for the reset to proceed. **"Wipe
Selected"** at the bottom executes the reset for all checked toggles.

The distro reset is a PRISTINE `wsl --unregister` + reimport — it backs up
Claude creds first UNLESS `claude_token` is checked. The `webview_storage` /
`vscode_state` wipes are queued and flushed at the next Hydrogen launch
(restart_required), NOT immediate; there is no reboot for the wipe.

CRITICAL — the WSL virgin reset only ever touches `Adom-Workspace`. It runs
`wsl --unregister Adom-Workspace` — NEVER global `wsl --shutdown` or
`wsl --uninstall`, which would knock out the user's other distros (e.g. a
pre-existing Docker Desktop integration). There is NO Docker actions.

## Automated Testing Pattern

For AI-driven ralph loop testing, keep auth tokens so steps don't fail:

```
Checked:   install_state, container
Unchecked: tarball (cached, saves the full-image re-download),
           adom_token, claude_token
```

This gives a freshly-imported distro while keeping auth working — step 5
(inject-api-key) and step 12 (claude-auth) won't fail.

### Programmatic triggers (the ONLY supported headless paths)

```bash
# Virgin reset — the ONE allowed programmatic trigger
curl -X POST http://127.0.0.1:47084/setup/panel/run-virgin-reset \
  -H Content-Type:application/json \
  -d '{"confirmed_destructive":true,"install_state":true,"container":true,
       "tarball":false,"webview_storage":false,"vscode_state":false,
       "adom_token":false,"claude_token":false}'

# Re-run a single step (optional continue_after to keep going)
curl -X POST http://127.0.0.1:47084/setup/step/test-direct-connect \
  -H Content-Type:application/json -d '{"continue_after":true}'
```

DEPRECATED — do NOT use these; they are now REFUSED (deprecated headless
triggers): `POST /wsl/unregister`, `POST /setup/virgin-reset`,
`POST /setup/run-all`, `POST /setup/run-step`.

## Key Steps Explained

### Step 1 — ensure-workspace
The big one. Installs WSL2 if needed (one auto-reboot), then `wsl --import
Adom-Workspace` from the full pre-baked golden image `adom-golden.tar.gz`
(pulled from the `adom-inc/hd-wsl2-image` GitHub release — NOT a thin ~30 MB
tarball, NOT a 390 MB Docker image), creates the `adom` user, starts
code-server, and verifies host loopback on port 7380. This single step
replaces the old Docker pull-image / create-container / start-container trio.
The distro's DEFAULT user is `adom` (`wsl.conf default=adom`), NOT root;
in-distro exec = `wsl -d Adom-Workspace -u adom --` (root via `-u root`) —
NEVER `docker exec`.

### Step 5 — inject-api-key
Writes the Adom session token into the distro at `/var/run/adom/api-key`
(mode 644) so adom-cli works. Requires the user to be signed in. Keep the
`adom_token` toggle UNCHECKED during automated test resets.

### Step 9 — test-direct-connect
Proves the fast container→desktop command path. The CLI auto-probes the host
control API (wired to the WSL gateway IP by `/etc/init-host-internal.sh`) and
routes through Adom Bridge's direct connect API.

### Step 10 — test-relay (register relay)
Registers the relay (started by step 8, `start-relay`) with Adom Bridge for
file streaming via the code-server proxy path. This enables `pull_file`,
`send_files`, and `shell_execute`.

### Step 12 — claude-auth
The single human gate. Restores / validates Claude creds in the distro
(backed up host-side) and, when needed, drives the in-editor Claude.ai sign-in
via the native browser Browser Picker. Runs LAST before the payoff steps.

### Steps 13-16 — the final gates
`ensure-sse` confirms the editor browser SSE session is connected (so the
Welcome webview-open doesn't 409); `verify-workspace` confirms the proxy holds
a real layout; `welcome` opens Claude Code and sends the first prompt; the
final `open-welcome` gate opens welcome.html in Hydrogen's right pane and HARD-FAILS
if the Welcome tab doesn't appear.

> Note: gallia, the Adom CLIs, the claude CLI + Code extension, VS Code
> settings, and `hd-*` skills are NOT setup steps — they are baked into
> `adom-golden.tar.gz`. See `hydrogen-golden-image`.

## Distro Recreation

When the distro is unregistered and re-imported (step 1), the new distro is a
fully pre-baked Ubuntu from `adom-golden.tar.gz`. WSL2 auto-forwards
code-server's port 7380 to Windows `localhost:7380` — there is no Docker
port-mapping layer, so the port-conflict / stale-mapping class of bug that
affected the Docker runtime does not apply here. Other services tunnel through
the code-server `/proxy/{port}/` path.
