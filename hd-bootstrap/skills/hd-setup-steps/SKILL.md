---
name: hd-setup-steps
description: What HD's setup steps did to prepare your workspace — the install sequence that provisions the golden workspace image, injects your Adom session, wires up the relay, and walks the Claude auth gate. Use this skill when the user asks "what did setup do", "why is X installed", "re-run a setup step", "what's a virgin reset", or "why did step N fail". Trigger words — setup steps, install steps, setup panel, virgin reset, re-run step, Run All, what did setup do, why is X installed, setup failed, install-tools, hd setup, claude code extension install, gallia install, hd workspace ready.
---

# HD Setup Steps — what was done to prepare your workspace

This is the platform-generic, user-facing Q&A about what HD's setup did. The
exact per-platform step list, the workspace-provisioning commands, and the
state-file name live in the companion [[hd-setup-steps-windows]] skill (for
Windows/WSL2).

When you first launched Hydrogen Desktop (or after a virgin reset), HD ran an
install sequence to turn a blank machine into a fully-tooled Adom workspace.
The heavy tooling (code-server, gallia, the Adom CLIs, the claude CLI + Code
extension, VS Code settings, and all `hd-*` skills) is already BAKED into the
golden image; setup just provisions that image, injects your Adom session,
wires up the relay, and walks the Claude auth gate. This skill explains what
each phase did so you can help the user understand their environment, re-run
failed steps, or wipe and rebuild. See `hd-golden-image` for the baked-image
model.

The cascade is halt-on-failure, resume-not-restart, with per-step 3x
auto-retry. The exact steps and ordering are platform-specific — see
[[hd-setup-steps-windows]].

## The setup state machine — what each phase does

| Phase | Purpose |
|---|---|
| Provision the workspace | Ensure the runtime is available (install it if needed), provision the workspace from the golden image, create the workspace user, start code-server, verify host loopback. SUBSUMES the old pull-image / create-instance / start-instance steps. |
| wait-codeserver | Host TCP probe of the code-server port until it answers |
| install-adom-vscode | "Activate editor extensions" — installs NOTHING (binary + extension are baked); waits for Adom sign-in, reloads the editor iframe, and proves the editor-control API answers |
| set-env-vars | Set `ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`, `ADOM_HD_CONTROL_URL`, `VSCODE_PROXY_URI`, `ADOM_DESKTOP_MODE` |
| inject-api-key | Write the Adom session token into the workspace so adom-cli works |
| configure-vscode | settings.json / trusted-domains / activity-bar are BAKED; re-asserts theme + workbench backstops idempotently, and applies the per-session layout |
| ensure-adom-desktop | Verify the Adom Desktop companion app is running (the relay's desktop bridge) |
| start-relay | Start the adom-desktop relay inside the workspace |
| test-direct-connect | Prove the fast workspace→desktop command path |
| test-relay | Register the relay with Adom Desktop for file streaming (file transfer + shell exec) |
| test-adom-cli | GATE: carbon path + hydrogen-proxy reachability via adom-cli |
| claude-auth | The single human gate — restore Claude creds or drive the in-editor Claude.ai sign-in via the native browser Browser Picker; runs LAST before the payoff steps |
| ensure-sse | GATE: confirm the editor browser SSE session is connected so Welcome's webview-open doesn't 409 |
| verify-workspace | GATE: battery confirming the proxy holds a real layout |
| welcome | Open Claude Code, authenticate if needed, send the first prompt |
| open-welcome | GATE (final): open welcome.html in HD's right pane; hard-fails if the Welcome tab doesn't appear |

### Steps that NO LONGER EXIST (baked into the golden image)

These are NOT setup steps anymore — they are baked at image-build time:
`install-gallia`, `install-hd-skills`, `verify-adom-desktop`,
`install-claude-cli`, `install-claude-ext`, `write-vscode-settings`,
`set-trusted-domains`, `clean-layout`. If a user asks "what installed gallia /
the Claude extension / my skills / VS Code settings", the answer is: **baked
into the golden image at build time, not a setup step.** See `hd-golden-image`.

## Common user questions

**"Why is X installed in my workspace?"** → If X is gallia, an Adom CLI, the
claude CLI, the Claude Code extension, VS Code settings, or an `hd-*` skill, it
was **baked into the golden image** — not run as a setup step. The setup steps
only provision the image, inject your session, wire the relay, and walk Claude
auth. The setup panel (HD UI → bottom) lists every step with its current
status.

**"Setup failed at step N"** → The setup panel shows the error. Most common
failures: the provision step (runtime unavailable, or the golden-image
download), test-adom-cli (carbon/hydrogen-proxy not reachable yet), and
claude-auth (Claude credentials expired). Each step has a retry button (and the
cascade already retried it 3x). Platform-specific failure causes are in
[[hd-setup-steps-windows]].

**"Re-run a single step"** → In the setup panel, click the step row and use the
Re-run action. Or via API: `POST http://127.0.0.1:47084/setup/step/<id>`
(optional body `{"continue_after":true}` to keep going after it).

**"Re-run all steps"** → Click "Run All" in the setup panel; it resumes from the
first not-done step. (The old headless `POST /setup/run-all` is now REFUSED.)

## Virgin reset

Virgin reset wipes parts of your workspace so setup can rebuild them cleanly.
The ONLY programmatic trigger is `POST /setup/panel/run-virgin-reset`. Toggle
which artifacts to delete (option keys in parentheses):

| Toggle (key) | What gets wiped | When to use |
|---|---|---|
| Install step state (`install_state`) | Marks all steps as pending so they re-run | Always (default on) |
| Workspace (`container`) | PRISTINE wipe + re-provision — deletes the workspace AND everything in it, including your project files | Always (default on); your work is GONE |
| Image tarball (`tarball`, legacy `image`) | Deletes the cached golden image (full re-download) | Rarely — only if the image is corrupted |
| Webview storage (`webview_storage`) | Queued wipe, flushed at next HD launch (restart_required) | Rarely |
| VS Code state (`vscode_state`) | Queued wipe, flushed at next HD launch (restart_required) | Rarely |
| Adom session token (`adom_token`) | Deletes `hydrogen-session.txt`; forces re-login | Rarely |
| Claude credentials (`claude_token`) | Deletes the host-side Claude creds backup; forces Claude re-auth | When Claude auth is stuck |

`confirmed_destructive` must be set. After toggling, hit "Wipe Selected", then
"Run All" to rebuild. The workspace reset backs up Claude creds first UNLESS
`claude_token` is checked; the `webview_storage` / `vscode_state` wipes are
queued and flushed at the next HD launch (restart_required), not immediate.

CRITICAL: the workspace reset ONLY ever wipes HD's own workspace. It never
touches other workspaces, distros, or runtimes the user may have on the
machine, and it performs NO reboot for the wipe. The platform-specific wipe
commands are in [[hd-setup-steps-windows]].

## Setup panel APIs (useful for AI automation)

| Endpoint | What it does |
|---|---|
| `GET /setup/state` | Current state — `never-run`, `in-progress`, `complete`, or `error` |
| `POST /setup/step/<id>` | Re-run a single named step (optional `{"continue_after":true}`) |
| `POST /setup/panel/run-virgin-reset` | Trigger virgin reset with the supplied toggle options |
| `POST /setup/panel/show` | Open the setup panel from anywhere |

All on HD's control API at `http://127.0.0.1:47084`.

**DEPRECATED — now REFUSED, do not use:** `POST /wsl/unregister`,
`POST /setup/virgin-reset`, `POST /setup/run-all`, `POST /setup/run-step`. Use
`POST /setup/panel/run-virgin-reset` and `POST /setup/step/<id>` instead.

## Setup state file

Setup writes its state to a per-step state file (one entry per step with
`status: pending|running|done|failed`, output text, percent complete). HD reads
this on launch to decide whether the setup panel auto-opens. The exact file
name and location are platform-specific — see [[hd-setup-steps-windows]].

## Related skills

- [[hd-setup-steps-windows]] — the concrete WSL2 16-step cascade, the import step, `wsl --unregister`, `setup-steps-wsl.json`, and the golden tarball
- `hd-golden-image` — the baked-image model: what's pre-installed vs. what setup does
- `hd-setup` — the setup-panel UX and virgin-reset toggles
- `hd-browser-picker` — used by claude-auth for the Claude auth OAuth flow
- `hd-adom-auth` — how the Adom session token (inject-api-key) gets injected
