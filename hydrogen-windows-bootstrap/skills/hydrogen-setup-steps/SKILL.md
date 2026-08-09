---
name: hydrogen-setup-steps
description: What Hydrogen's setup steps did to prepare your workspace — the 28-step cascade that imports the Adom-Workspace golden image, injects your Adom session, wires up the relay, walks the Claude auth gate, and then opens 9 named AI-thread conversations. Use this skill when the user asks "what did setup do", "why is X installed", "re-run a setup step", "what's a virgin reset", or "why did step N fail". Trigger words — setup steps, install steps, setup panel, virgin reset, re-run step, Run All, what did setup do, why is X installed, setup failed, install-tools, hd setup, claude code extension install, gallia install, hd workspace ready.
---

# Hydrogen Setup Steps — what was done to prepare your workspace

WSL2-runtime version (default). The legacy 24-step Docker cascade
(`HD_RUNTIME=docker`) is in the docker/ bucket.

When you first launched Hydrogen (or after a virgin reset), Hydrogen ran a 28-step cascade to turn a blank machine into a fully-tooled Adom workspace — the `Adom-Workspace` WSL2 distro. The heavy tooling (code-server, gallia, the Adom CLIs, the Claude Code VS Code extension, VS Code settings, and all `hd-*` skills) is already BAKED into the golden image; setup imports that image, injects your Adom session, wires up the relay, installs the `claude` CLI at runtime (the one thing NOT baked — its self-setup needs a live session), walks the Claude auth gate, then opens the first conversation + 9 named AI-thread conversations. This skill explains what each step did so you can help the user understand their environment, re-run failed steps, or wipe and rebuild. See `hydrogen-golden-image` for the baked-image model.

The cascade is executed by `setup_steps_wsl.rs` (`step_defs_wsl()` / `run_all_wsl()`). `run_all_wsl` is halt-on-failure, resume-not-restart, with per-step 3× auto-retry. In-distro work runs via `wsl -d Adom-Workspace -u adom -- <cmd>` (the distro's DEFAULT user is `adom` per `wsl.conf default=adom`, home `/home/adom`; root via `-u root`). There is NO `docker exec` and NO Docker image anywhere in this flow.

## The 28 steps (in order)

| # | Step | Purpose |
|---|------|---------|
| 1 | ensure-workspace | Install WSL2 if needed (one auto-reboot), `wsl --import Adom-Workspace` from the golden image tarball (full pre-baked image from the `adom-inc/hd-wsl2-image` GitHub release), create the `adom` user, start code-server, verify host loopback on 7380. SUBSUMES the old Docker pull-image / create-container / start-container steps. |
| 2 | wait-codeserver | Host TCP probe of the code-server port (default 7380), 120s |
| 3 | update-packages | GATE: `adom-wiki pkg update` converges the container to the LATEST published packages (skills included) — the golden image is baked once but installed for months. Gates on the ARTIFACT (hydrogen-bootstrap == registry latest + skills deployed), not the raw exit code; re-runs bootstrap postinstalls when an update lands. |
| 4 | install-adom-vscode | "Activate editor extensions" — installs NOTHING (binary + extension are baked); waits for Adom sign-in, reloads the editor iframe, and proves the :8821 editor-control API answers |
| 5 | set-env-vars | Set `ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`, `ADOM_HD_CONTROL_URL`, `VSCODE_PROXY_URI`, `ADOM_DESKTOP_MODE` |
| 6 | inject-api-key | Write the Adom session token into the distro at `/var/run/adom/api-key` (mode 644) so adom-cli works |
| 7 | configure-vscode | settings.json / trusted-domains / activity-bar are BAKED; re-asserts theme + workbench backstops idempotently, and applies the per-session layout via :8821 |
| 8 | ensure-adom-bridge-cli | Verify the Adom Bridge companion app is running on Windows (the relay's desktop bridge) |
| 9 | start-relay | Start the adom-bridge-cli relay inside the workspace (ports 8765 WS / 8766 HTTP) |
| 10 | test-direct-connect | Prove the fast workspace→desktop command path |
| 11 | test-relay | Register the relay with Adom Bridge for file streaming (file transfer + shell exec) |
| 12 | test-adom-cli | GATE: carbon path + hydrogen-proxy reachability via adom-cli (6 retries) |
| 13 | install-claude-cli | Install the Claude Code CLI (`claude`) into the distro via the official installer. NOT baked (its self-setup needs a live session) — Hydrogen installs it here at runtime, before sign-in, so the editor's Claude Code + the Welcome/thread conversations have a working `claude`. Idempotent (skips if present). |
| 14 | claude-auth | The single human gate — restore Claude creds or drive the in-editor Claude.ai sign-in via the native browser Browser Picker; runs just before the payoff steps |
| 15 | ensure-sse | GATE: confirm the editor browser SSE session is connected so Welcome's webview-open doesn't 409 |
| 16 | verify-workspace | GATE: battery confirming the proxy holds a real layout |
| 17 | welcome | Open Claude Code, authenticate if needed, and human-type the first prompt ("who am i and what can i do here") |
| 18 | thread-parts-search | Fresh Claude conversation: Adom parts-search app in a webview, find a popular STM32 for a BLDC motor |
| 19 | thread-kicad | Fresh conversation: is KiCad installed? open the symbol library, else offer to install + show a sample board |
| 20 | thread-fusion360 | Fresh conversation: is Fusion 360 installed? open a sample project (sch/brd/3d), else offer to install |
| 21 | thread-altium | Fresh conversation: is Altium installed? open it, else report whether it can be installed |
| 22 | thread-pup | Fresh conversation: intro pup, show the Adom wiki (adom-lbr page) in a pup window |
| 23 | thread-native-browser | Fresh conversation: what the AI can do to drive the user's real Chrome/Edge (logged-in sites) + any extension needed |
| 24 | thread-google | Fresh conversation: install adom-google (its own guided auth), then latest email subject, next cal entry, a gchat DM, a sample PCB BOM sheet |
| 25 | thread-chip-fetcher | Fresh conversation: install chip-fetcher, show it in a webview, search VL53L8CH |
| 26 | thread-tsci | Fresh conversation: adom-tsci builds an RP2040 + USB-C dev board in one prompt, shown in pup |
| 27 | verify-setup | GATE (catch-all): independently re-verifies the whole workspace end-to-end; HALTS naming any artifact that isn't actually there |
| 28 | open-welcome | GATE (final): open welcome.html in Hydrogen's right pane; hard-fails if the Welcome tab doesn't appear |

Steps 18–26 (the AI threads) each open a FRESH Claude conversation and human-type a prompt, strictly one at a time. They replaced the old single `eda-discovery` + `instapcb-quote` steps.

### Steps that NO LONGER EXIST (baked into the golden image)

These are NOT setup steps anymore — they are baked at image-build time: `install-gallia`, `install-hd-skills`, `verify-adom-bridge-cli`, `install-claude-ext`, `write-vscode-settings`, `set-trusted-domains`, `clean-layout`. If a user asks "what installed gallia / the Claude extension / my skills / VS Code settings", the answer is: **baked into the golden image at build time, not a setup step.** (Note: `install-claude-cli` is NOT in this list — the `claude` CLI IS a live setup step, since its self-setup needs a live session.) See `hydrogen-golden-image`.

## Common user questions

**"Why is X installed in my workspace?"** → If X is gallia, an Adom CLI, the Claude Code extension, VS Code settings, or an `hd-*` skill, it was **baked into the golden image** — not run as a setup step. (The `claude` CLI is the exception: it's installed at RUNTIME by step 13 `install-claude-cli`.) The setup steps only import the image, inject your session, wire the relay, and walk Claude auth. The setup panel (Hydrogen UI → bottom) lists every step with its current status.

**"Setup failed at step N"** → The setup panel shows the error. Most common failures: step 1 (WSL2 unavailable / Virtual Machine Platform feature off, or the `adom-golden.tar.gz` download), step 12 (test-adom-cli — carbon/hydrogen-proxy not reachable yet), step 13/14 (claude CLI install / Claude credentials expired). Each step has a retry button (and the cascade already retried it 3×).

**"Re-run a single step"** → In the setup panel, click the step row and use the Re-run action. Or via API: `POST http://127.0.0.1:47084/setup/step/<id>` (optional body `{"continue_after":true}` to keep going after it).

**"Re-run all steps"** → Click "Run All" in the setup panel; it resumes from the first not-done step. (The old headless `POST /setup/run-all` is now REFUSED.)

## Virgin reset

Virgin reset wipes parts of your workspace so setup can rebuild them cleanly. The ONLY programmatic trigger is `POST /setup/panel/run-virgin-reset`. Toggle which artifacts to delete (option keys in parentheses):

| Toggle (key) | What gets wiped | When to use |
|--------|----------------|-------------|
| Install step state (`install_state`) | Marks all steps as pending (`setup-steps-wsl.json`) so they re-run | Always (default on) |
| WSL2 distro (`container`) | PRISTINE `wsl --unregister Adom-Workspace` + reimport — deletes the distro AND everything in it, including `/home/adom/project` | Always (default on); your work in `/home/adom/project` is GONE |
| Distro tarball (`tarball`, legacy `image`) | Deletes the cached `adom-golden.tar.gz` (full-image re-download) | Rarely — only if the tarball is corrupted |
| Webview storage (`webview_storage`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | Rarely |
| VS Code state (`vscode_state`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | Rarely |
| Adom session token (`adom_token`) | Deletes `hydrogen-session.txt`; forces re-login | Rarely |
| Claude credentials (`claude_token`) | Deletes the host-side Claude creds backup; forces Claude re-auth | When Claude auth is stuck |

`confirmed_destructive` must be set. After toggling, hit "Wipe Selected", then "Run All" to rebuild. The distro reset backs up Claude creds first UNLESS `claude_token` is checked; the `webview_storage` / `vscode_state` wipes are queued and flushed at the next Hydrogen launch (restart_required), not immediate.

CRITICAL: the WSL reset ONLY ever runs `wsl --unregister Adom-Workspace` (+ reimport). It never runs global `wsl --shutdown` or `wsl --uninstall` (those would kill the user's other distros, including any Docker Desktop WSL integration), and it performs NO Docker actions and NO reboot for the wipe.

## Setup panel APIs (useful for AI automation)

| Endpoint | What it does |
|----------|--------------|
| `GET /setup/state` | Current state — `never-run`, `in-progress`, `complete`, or `error` |
| `POST /setup/step/<id>` | Re-run a single named step (optional `{"continue_after":true}`) |
| `POST /setup/panel/run-virgin-reset` | Trigger virgin reset with the supplied toggle options |
| `POST /setup/panel/show` | Open the setup panel from anywhere |

All on Hydrogen's control API at `http://127.0.0.1:47084`.

**DEPRECATED — now REFUSED, do not use:** `POST /wsl/unregister`, `POST /setup/virgin-reset`, `POST /setup/run-all`, `POST /setup/run-step`. Use `POST /setup/panel/run-virgin-reset` and `POST /setup/step/<id>` instead.

## Setup state file

Setup writes its state to `%APPDATA%\hydrogen-desktop\setup-steps-wsl.json` (one entry per step with `status: pending|running|done|failed`, output text, percent complete). Hydrogen reads this on launch to decide whether the setup panel auto-opens. (The legacy Docker runtime uses `setup-steps.json`.)

## Related skills

- `hydrogen-golden-image` — the baked-image model: what's pre-installed in `adom-golden.tar.gz` vs. what setup does
- `hydrogen-container` — the WSL2 distro and runtime that setup configures
- `hydrogen-networking` — how the distro reaches the host (`127.0.0.1` via WSL2 mirrored networking; live control URL in `~/.adom/hydrogen-control-url`) and how ports forward
- `hydrogen-browser-picker` — used by step 14 (claude-auth) for the Claude auth OAuth flow
- `hydrogen-adom-auth` — how the Adom session token (step 5) gets injected
- `hydrogen-volume` — where your files live in the distro and what survives a virgin reset (or doesn't)
