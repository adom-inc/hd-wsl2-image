---
name: hydrogen-api
description: >
  Complete reference for Hydrogen control API endpoints. The control
  API runs on a dynamic port (find it via port discovery). Use these endpoints
  to drive Hydrogen programmatically: manage the workspace runtime, control Claude
  Code, manipulate VS Code, manage workspace tabs, run setup steps, trigger
  virgin reset, and more. ~159 endpoints. Two self-documenting sources of truth
  list them live: GET /_manifest (curated grouped list) and GET /test/help
  (the /test/* diagnostics).
  Trigger words: Hydrogen API, control API, Hydrogen endpoint, container exec, claude api,
  iframe eval, workspace tabs, setup run-all, runtime status, reload vscode,
  browser profiles, open url, virgin reset api, diagnostics, ad health,
  test window-tree, ai cursor, setup panel, screenshot mode.
---

# Hydrogen Control API Reference

The control API exposes **~159 endpoints**. Don't trust a static count or list in
this file to stay exhaustive — the API is **self-documenting**, with two live
sources of truth you should hit first:

| Source | What it gives you | Where |
|---|---|---|
| `GET /_manifest` | Curated, grouped, machine-readable list of the highest-value endpoints (path, method, args, description, `visibility`). `hd_api` forwards anything not listed. | `lib.rs:9144` |
| `GET /test/help` | Lists the `/test/*` diagnostics (window enumeration, UIA click, dialog classification, cascade reset). Gated behind `HD_TEST_API_ENABLED=1`. | `lib.rs:9723` |

**Base URL:** `http://127.0.0.1:<dynamic>` — the loopback address. The port is
dynamic per launch; read the live URL from `~/.adom/hydrogen-control-url` — see
"Finding the Control Port" below.

## Finding the Control Port

The control API port is dynamic (default 47084, auto-resolves conflicts).

```bash
# From Hydrogen log
adom-bridge-cli hd_log '{"tail":100}' | grep "control="

# From inside the workspace — USE THIS. Hydrogen writes its live control URL to a discovery
# file every launch, so you never hunt for the dynamic port:
CTRL="$(cat ~/.adom/hydrogen-control-url)"; curl -sf "$CTRL/health"
```

⭐ **From the workspace, read `~/.adom/hydrogen-control-url`** (e.g. `http://127.0.0.1:<control>`) — a
file, NOT an env var (your non-interactive Bash shells don't source `.bashrc`/`profile.d`). Hydrogen
rewrites it with the live dynamic port every launch. This is the channel for the UI command bus,
the live ports map, Claude control, etc. — distinct from `adom-cli` (`ADOM_HYDROGEN_URL` → SSE),
which is unchanged for web-hydrogen parity.

> For the host-side ways to discover the port (Hydrogen log/`ports.json`) and the
> host runtime endpoints (`/wsl/*`, `/docker/*`, `/system/reboot`), see the
> [[hydrogen-api-windows]] companion skill.

## Health & Status

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Hydrogen alive check — returns `{ok, port, service}` |
| GET | `/buildinfo` | Running build git SHA + build metadata (the only trustworthy "did my build ship?" check) |
| GET | `/ports` | The 4 editable PortConfig ports (proxy, control, cdp, code_server) |
| GET | `/ports/all` | LIVE full port map — every port Hydrogen has bound, with status info |

## ab-health diagnostics (`/ad/*`)

These verify the **adom-bridge-cli / relay / embedded-ab** half of Hydrogen is alive (the
bridge that connects this cloud container to Hydrogen). All GET, all return `{ok, ...}`.

| Method | Path | Description |
|---|---|---|
| GET | `/ad/health` | Overall embedded-ab health roll-up |
| GET | `/ad/process` | Is the adom-bridge-cli process running |
| GET | `/ad/embedded` | Embedded-ab module status |
| GET | `/ad/workspace-direct` | ⭐ The **converged** check — direct path to the workspace relay (use this one) |
| GET | `/ad/relay` | Relay (WS/HTTP) reachability |
| GET | `/ad/liveness-beacon` | Liveness beacon freshness |
| GET | `/ad/direct-api` | Direct-API reachability |
| GET | `/ad/discovery-file` | Discovery file present + parseable |

## Driving Hydrogen's UI (command bus)

Open/close/toggle any Hydrogen menu, dialog, or panel — the first-class alternative to CDP clicking. See the `hydrogen-ui` skill.

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/ui/actions` | — | List every drivable UI action `{id,label,description,group}` (+ `_hints`) |
| POST | `/ui/invoke` | `{"id":"ports.open"}` | Run a UI action; returns `{ok,value}` only after the frontend ran it |
| GET | `/auth-token` | Hydrogen session token |
| GET | `/setup-status` | Overall setup completion state |
| GET | `/diagnostics/all` | Run all diagnostic checks |
| GET | `/diagnostics/{name}` | Run a single diagnostic check |

## Workspace / Container Management

These endpoints manage the active workspace runtime.

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/container-status` | — | Workspace runtime available, image/distro present, workspace exists/running |
| GET | `/container-stats` | — | CPU, memory, disk usage |
| POST | `/container-restart` | — | Restart the active workspace runtime (5s timeout) |
| POST | `/container-stop` | — | Stop the active workspace runtime |
| POST | `/container-exec` | `{"command":"..."}` | Run command in the workspace as user `adom` |
| POST | `/container-delete` | — | Remove the workspace |
| POST | `/image-delete` | — | Remove workspace image |
| GET | `/container-images` | — | List available workspace images |
| POST | `/container-switch-image` | `{"image":"..."}` | Switch to different image |
| POST | `/container-pull-image` | `{"image":"..."}` | Pull an image |
| GET | `/container/logs` | — | Workspace stdout/stderr |
| GET | `/container/env` | — | Workspace environment variables |
| GET | `/container/ports` | — | Published port mappings |
| GET | `/container/disk` | — | Disk usage inside the workspace |
| POST | `/container/restart` | — | Alias for `/container-restart` |

> Runtime-specific endpoints — the WSL `/wsl/*` tables, the legacy Docker
> `/docker/*` tables, and `/volume-delete` (Docker-only) — live in the
> [[hydrogen-api-windows]] companion skill.

## WebView & VS Code

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/eval` | `{"js":"..."}` | JS eval in main Hydrogen webview |
| POST | `/iframe-eval` | `{"js":"...","contextIndex":N}` | JS eval in a specific iframe context (0-14) |
| POST | `/cdp-eval` | `{"expression":"..."}` | Direct Chrome DevTools Protocol eval |
| POST | `/click` | `{"x":N,"y":N}` | Click at coordinates in webview |
| POST | `/mouse-click` | `{"x":N,"y":N,"button":"left"}` | Mouse click with options |
| POST | `/query` | `{"selector":"..."}` | Query DOM elements |
| POST | `/reload-vscode` | — | Reload the VS Code iframe |
| POST | `/vscode/hide-activity-items` | — | Hide activity-bar items (persisted, overflow-proof) |
| GET | `/targets` | — | List CDP targets (all webview contexts) |
| GET | `/cdp-info` | — | CDP connection info (port, URL) |
| GET | `/devtools` | — | DevTools status |

### AI cursor (visible cursor for demos / clicking)

Distinct from `/click` and `/mouse-click` — this renders a **visible** AI cursor,
glides it, and can click. Use for demos or when the user should see where the AI clicks.

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/ai-cursor/move` | `{"x":N,"y":N}` | Move (glide) the visible AI cursor to coordinates |
| POST | `/ai-cursor/click` | `{"x":N,"y":N}` | Move the visible AI cursor there + click |
| POST | `/ai-cursor/hide` | — | Hide the visible AI cursor |

### Screenshot primitives

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/capture/viewport` | — | Capture the Hydrogen webview viewport (PNG) |
| POST | `/shot` | `{...}` | Screenshot primitive (see **hydrogen-self-screenshot** for the full workflow) |

### Port hints

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/adom-port-hints` | — | Read the workspace port-hints map |
| POST | `/adom-port-hints` | `{...}` | Write/merge the workspace port-hints map |

## Claude Code

### Status / auth state (GET)

| Method | Path | Description |
|---|---|---|
| GET | `/claude/status` | Install state, auth, active session, version |
| GET | `/claude/auth-check` | Deep auth check — file exists, token, expiry |
| GET | `/claude/auth-status` | Auth-status detail |
| GET | `/claude/auth-page-state` | Which auth screen the panel shows: `continue-in-browser` \| `subscription-button` \| `chat`; returns `oauth_url` + `at_browser_auth_gate` |
| GET | `/claude/detect-auth-failure` | Scan webview contexts for auth button/errors |
| GET | `/claude/sessions` | List active Claude sessions |

### Auth actions (POST)

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/claude/find-auth-button` | — | Find + highlight the sign-in button WITHOUT clicking (validation) |
| POST | `/claude/start-auth` | — | Find + highlight + CLICK the "Claude.ai Subscription" button to begin OAuth |
| POST | `/claude/trigger-auth` | — | Alias for start-auth |
| POST | `/claude/detect-state` | — | Detect current auth/panel state |
| POST | `/claude/authorize-in-browser` | `{"timeout_ms":N,"dry_run":B,"fresh":B,"oauth_url":"..."}` | Auto-click the "Authorize" button on the claude.ai OAuth page (unattended sign-in) |
| POST | `/claude/authorize-tab-enter` | — | Approve the Adom OAuth tab via Enter (branded picker flow) |
| POST | `/claude/inject-creds` | — | Push host backup credentials into the workspace |
| POST | `/claude/wipe-creds` | `{"backup":B}` | Wipe Claude credentials (destructive); `backup:false` keeps the host backup so reinject can restore |

### Panel / conversation control (POST unless noted)

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/claude/open` | — | Open Claude Code panel (`claude-vscode.editor.open`) |
| POST | `/claude/ensure-open` | — | Ensure the panel is open (strict readiness; recovery if not rendered) |
| POST | `/claude/open-with-message` | `{"message":"..."}` | Open + pre-fill message |
| POST | `/claude/focus` | — | Focus Claude panel |
| POST | `/claude/new-conversation` | — | Start a fresh conversation (shows sign-in panel when unauthenticated) |
| POST | `/claude/new-chat-and-send` | `{"text":"...","typed":B,"submit":B,"delay_ms":N}` | Open fresh conversation, wait for compose box, type + (default) submit |
| POST | `/claude/submit` | — | Find + click send button |
| POST | `/claude/send` | `{"message":"..."}` | Send message to Claude |
| POST | `/claude/inject` | `{"message":"..."}` | Inject text into the compose box |
| POST | `/claude/inject-message` | `{"message":"..."}` | Inject into conversation |
| POST | `/claude/type-and-submit` | `{"message":"...","delay_ms":N}` | Type char-by-char (human-paced) + submit |
| POST | `/claude/remote-control` | `{"name":"..."}` | Turn on Claude Code Remote Control (submits `/remote-control` slash command) |
| POST | `/claude/highlight-open-button` | `{"duration":N}` | Glow animation on Claude button |
| POST | `/claude/clear-open-highlight` | — | Clear the open-button highlight |

## OAuth & Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/claude-auth` | — | Full PKCE OAuth flow — opens browser, sets up callback |
| GET | `/oauth/callback` | — | OAuth callback handler (receives auth code) |
| POST | `/auth/proxy` | varies | Proxy auth requests to carbon.adom.inc |
| POST | `/open-url` | `{"url":"..."}` | Open URL (triggers browser picker) |
| POST | `/start-oauth-proxy` | `{"port":N}` | Start OAuth callback proxy on a port |
| GET | `/browser-profiles` | — | List browsers + profiles with avatars |
| POST | `/open-in-profile` | `{"url":"...","browser":"...","profileDir":"..."}` | Open URL in specific browser profile |
| POST | `/browser-picker/opened` | `{...}` | Frontend reports the browser picker was opened |
| GET | `/browser-picker/last-open` | — | Last browser-picker open event |

## Setup Steps & Setup Panel

### State / trigger / step control

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/setup/state` | — | Get current setup state (`never-run` \| `in-progress` \| `complete`) |
| POST | `/setup/state` | `{"state":"..."}` | Set setup state |
| POST | `/setup/step/<id>` | `{"continue_after":B}` | ⭐ Run one step by id (forces panel visible first); `continue_after:true` runs this step + every step after it |
| POST | `/setup/force-close` | — | Force-close setup panel |
| POST | `/setup/countdown` | `{"seconds":N,"message":"..."}` | Show countdown overlay |
| GET | `/setup/trigger` | — | Read trigger file |
| DELETE | `/setup/trigger` | — | Delete trigger file |
| POST | `/config-reset` | — | Reset Hydrogen config |

> ⛔ **REFUSED as deprecated** (headless runs with no visible UI):
> `POST /setup/run-all`, `POST /setup/run-step`, `POST /setup/virgin-reset`.
> They return a refusal pointing at the UI-visible path.
> To run steps: use `POST /setup/step/<id>` or relaunch Hydrogen to auto-run the cascade.

### Setup panel control

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/setup/panel/show` | — | Force the setup panel visible |
| POST | `/setup/panel/hide` | — | Hide the setup panel |
| POST | `/setup/panel/show-virgin-reset` | — | Show panel + expand the Virgin Reset section |
| POST | `/setup/panel/virgin/show` | — | Show the Virgin Reset section only |
| POST | `/setup/panel/virgin/hide` | — | Hide the Virgin Reset section |
| POST | `/setup/panel/set-virgin-options` | `{"options":{...}}` | Set the virgin-reset checkboxes |
| POST | `/setup/panel/run-virgin-reset` | — | ⭐ The **ONLY** allowed virgin-reset trigger — UI-visible by construction (shows panel + checkboxes + progress before deleting anything) |
| POST | `/setup/panel/wipe-keep-auth` | — | Synchronous wipe that KEEPS Adom + Claude tokens |
| POST | `/setup/screenshot-mode` | `{"enabled":B}` | Toggle per-step screenshot capture (default OFF) |
| GET | `/setup/screenshot-mode` | — | Whether per-step screenshot mode is on |

## Workspace Tabs

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/workspace/tabs` | — | List all workspace tabs |
| GET | `/workspace/tabs/find?name=X` | — | Find tab by name (404 if not found) |
| POST | `/workspace/tabs` | `{tab spec}` | Add a new tab |

## App lifecycle & window

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/app/restart` | — | Restart the Hydrogen app (kills + respawns the binary) |
| POST | `/app/relaunch-frontend` | — | Relaunch the Hydrogen GUI (kill+respawn) while it is responsive |
| POST | `/window/foreground` | — | Bring the Hydrogen window to the foreground (unminimize + focus) |

> Host OS reboot (`/system/*`) is platform-specific — see the
> [[hydrogen-api-windows]] companion skill.

## Diagnostics (`/test/*`)

Window enumeration, UIA clicking, native-dialog classification, and cascade
diagnostics. **Gated behind `HD_TEST_API_ENABLED=1`** (return 404 / "test API
disabled" otherwise). `GET /test/help` self-lists the whole cluster.

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/test/help` | — | Self-lists every `/test/*` endpoint |
| GET | `/test/window-tree` | — | Enumerate all visible top-level windows |
| POST | `/test/focus` | `{"window":"..."}` | Focus Hydrogen (`self`) or a window by title substring |
| POST | `/test/click-uia` | `{...}` | Poll UIAutomation for a Button by Name; Invoke when found |
| GET | `/test/setup-steps` | — | Raw setup-steps.json + derived summary (alias: `/test/install-steps`) |
| POST | `/test/dump-state` | `{...}` | Write a diagnostic bundle (logs, install-steps, runtime state, tasklist, window-tree) |
| POST | `/test/reset-cascade` | — | Delete install-steps.json + emit setup-reset event |
| POST | `/test/screenshot-hydrogen-window` | `{...}` | Capture Hydrogen's own window to a PNG file |

> The `/test/probe-dialogs` endpoint (classifies UAC / WSL2-update / MSI /
> Docker-EULA blocker windows) is Windows-specific — see the
> [[hydrogen-api-windows]] companion.

## Key Patterns

### iframe-eval context discovery
Contexts 0-14 cover all webview frames. Context numbers shift when panels open/close.
Always scan, never hardcode. The Claude Code extension webview IS reachable through
these contexts.

```
POST /iframe-eval {"js":"document.body.innerText.substring(0,100)","contextIndex":3}
```

### container-exec
Runs as user `adom` inside the workspace. Use full paths (`/home/adom/`
not `~/`). Tilde doesn't expand through the exec chain.

```
POST /container-exec {"command":"ls /home/adom/project"}
```

### Trigger setup re-run after completion
The trigger file poller STOPS when all steps are done. Use the step API instead:
```
POST /setup/step/<id> {"continue_after": true}
```
