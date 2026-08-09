---
name: hydrogen-setup
description: >
  Hydrogen setup panel: the install-step cascade, Run All, Rollback All, Virgin Reset
  with toggles, and automated testing patterns. MUST READ before running setup,
  testing steps, or doing virgin resets. Covers the step list, the virgin
  reset toggle panel, how to keep auth during resets, and how Run All handles
  failures. Trigger words — setup panel, install steps, run all, virgin reset,
  rollback, step failed, wipe, reset workspace, keep auth, test setup.
---

# Hydrogen -- Setup Panel & Virgin Reset

This is the platform-generic reference for the Hydrogen setup panel and virgin
reset. The host-platform specifics (the exact install cascade on Windows/WSL2,
distro import/unregister mechanics, the per-platform step list and state file)
live in the companion [[hydrogen-setup-windows]] skill.

## Zero-Click Goal

The Hydrogen setup process targets ZERO manual clicks for the user. The heavy
lifting is already done at image-build time: the golden workspace image ships
with code-server, gallia, the Adom CLIs, the claude CLI + Code extension, VS
Code settings, and all `hd-*` skills BAKED IN. Setup just provisions that
image, injects the user's session, wires up the relay, and walks the single
human auth gate. If something is missing, Hydrogen downloads it — never tell the
user to install something manually. See the `hydrogen-golden-image` skill for the
baked-image model.

## The Install Steps

The setup cascade is a halt-on-failure, resume-not-restart sequence with
per-step 3x auto-retry. State is tracked per-step (status pending / running /
done / failed, output text, percent complete) and Hydrogen reads it on launch to
decide whether the setup panel auto-opens. The exact step list, ordering, and
state-file name are platform-specific — see [[hydrogen-setup-windows]].

Conceptually the steps fall into these phases:

1. **Provision the workspace** — ensure the runtime is available, import the
   golden image, create the workspace user, start code-server, verify host
   loopback reachability. This single step subsumes any older
   pull-image / create-instance / start-instance trio.
2. **Activate the editor** — wait for code-server, activate editor extensions
   (baked, installs nothing), reload the editor iframe, prove the
   editor-control API answers.
3. **Wire identity + environment** — set the Adom env URLs, inject the Adom
   session token, re-assert VS Code config backstops idempotently, apply the
   per-session layout.
4. **Wire the relay** — verify the Adom Bridge companion app, start the
   relay inside the workspace, prove direct-connect and register the relay for
   file streaming.
5. **Gates + payoff** — gate on adom-cli reachability (carbon +
   hydrogen-proxy), walk the single Claude auth gate, confirm the editor SSE
   session, verify the proxy holds a real layout, open Claude Code and send the
   first prompt, and finally open welcome.html in Hydrogen's right pane (hard-fails
   if the Welcome tab doesn't appear).

### Steps that NO LONGER EXIST (baked into the golden image)

These are NOT setup steps anymore — they are baked at image-build time and
must not be listed or "run": `install-gallia`, `install-hydrogen-skills`,
`verify-adom-bridge-cli`, `install-claude-cli`, `install-claude-ext`,
`write-vscode-settings`, `set-trusted-domains`, `clean-layout`. gallia, the
Adom CLIs, the claude CLI + Code extension, code-server, settings, and all
`hd-*` skills are baked into the golden image. See `hydrogen-golden-image`.

## Panel Buttons

- **Run All** — executes all pending steps sequentially. STOPS on first failure.
- **Rollback All** — rolls back all completed steps in reverse order.
- **Virgin Reset ▾** — opens the toggle panel (see below).
- **Run** (per-step) — runs a single step.
- **Rollback** (per-step) — rolls back a single step.

## CRITICAL: Run All Stops on Failure

If any step fails, Run All ABORTS (halt-on-failure, after the per-step 3x
auto-retry is exhausted). Remaining steps are NOT executed. The cascade
resumes — it does NOT restart from the first step — so to recover after a
failure: fix the issue, then either:
- Click "Run All" again (it resumes from the first not-done step)
- Click "Run" on the failed step to retry just that one

## Virgin Reset Toggle Panel

Click "Virgin Reset ▾" to expand the wipe options. Each toggle has a
live status badge showing the current state. The ONLY programmatic trigger is
`POST /setup/panel/run-virgin-reset` (see below).

| Toggle (option key) | What it wipes | Status badges |
|---|---|---|
| Install step state (`install_state`) | Resets all steps to pending | CLEAN / EXISTS |
| Workspace (`container`) | PRISTINE wipe + re-provision of the workspace (ONLY Hydrogen's own workspace) | GONE / RUNNING / EXISTS |
| Image tarball (`tarball`, legacy `image`) | Deletes the cached golden image (full re-download) | CACHED / GONE |
| Webview storage (`webview_storage`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | CLEAN / EXISTS |
| VS Code state (`vscode_state`) | Queued wipe, flushed at next Hydrogen launch (restart_required) | CLEAN / EXISTS |
| Adom session token (`adom_token`) | Deletes `hydrogen-session.txt` | CLEAN / EXISTS |
| Claude credentials (`claude_token`) | Deletes the host-side Claude creds backup | CLEAN / EXISTS |

`confirmed_destructive` must be set for the reset to proceed. **"Wipe
Selected"** at the bottom executes the reset for all checked toggles.

The workspace reset is a PRISTINE wipe + re-provision — it backs up Claude
creds first UNLESS `claude_token` is checked. The `webview_storage` /
`vscode_state` wipes are queued and flushed at the next Hydrogen launch
(restart_required), NOT immediate; there is no reboot for the wipe.

CRITICAL — the virgin reset only ever touches Hydrogen's OWN workspace. It NEVER
touches other workspaces, distros, or runtimes the user may have on the
machine. The platform-specific commands (and the never-touch-global rule)
are in [[hydrogen-setup-windows]].

## Automated Testing Pattern

For AI-driven ralph loop testing, keep auth tokens so steps don't fail:

```
Checked:   install_state, container
Unchecked: tarball (cached, saves the full-image re-download),
           adom_token, claude_token
```

This gives a freshly-provisioned workspace while keeping auth working — the
inject-api-key step and the claude-auth step won't fail.

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

### Provision the workspace (step 1)
The big one. Ensures the runtime is available (installing it if needed), then
provisions the workspace from the full pre-baked golden image, creates the
workspace user, starts code-server, and verifies host loopback reachability.
This single step replaces the old pull-image / create-instance /
start-instance trio. Platform-specific provisioning commands and any
runtime-install reboot are in [[hydrogen-setup-windows]].

### inject-api-key
Writes the Adom session token into the workspace so adom-cli works. Requires
the user to be signed in. Keep the `adom_token` toggle UNCHECKED during
automated test resets.

### test-direct-connect
Proves the fast workspace→desktop command path. The CLI auto-probes the host
control API and routes through Adom Bridge's direct connect API.

### test-relay (register relay)
Registers the relay (started by the start-relay step) with Adom Bridge for
file streaming via the code-server proxy path. This enables `pull_file`,
`send_files`, and `shell_execute`.

### claude-auth
The single human gate. Restores / validates Claude creds in the workspace
(backed up host-side) and, when needed, drives the in-editor Claude.ai sign-in
via the native browser Browser Picker. Runs LAST before the payoff steps.

### The final gates
`ensure-sse` confirms the editor browser SSE session is connected (so the
Welcome webview-open doesn't 409); `verify-workspace` confirms the proxy holds
a real layout; `welcome` opens Claude Code and sends the first prompt; the
final `open-welcome` gate opens welcome.html in Hydrogen's right pane and HARD-FAILS
if the Welcome tab doesn't appear.

> Note: gallia, the Adom CLIs, the claude CLI + Code extension, VS Code
> settings, and `hd-*` skills are NOT setup steps — they are baked into the
> golden image. See `hydrogen-golden-image`.

## Workspace Recreation

When the workspace is wiped and re-provisioned (step 1), the new workspace is
a fully pre-baked image. Host port-forwarding for code-server is handled by the
runtime, so the port-conflict / stale-mapping class of bug does not apply.
Other services tunnel through the code-server `/proxy/{port}/` path. The
platform-specific port-forwarding behavior is in [[hydrogen-setup-windows]].
