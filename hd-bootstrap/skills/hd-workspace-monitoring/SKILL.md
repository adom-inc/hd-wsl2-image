---
name: hd-workspace-monitoring
description: >
  How Hydrogen Desktop monitors and manages the local workspace and code-server.
  Covers the 15s workspace state poll, the two health levels (runtime available,
  workspace Running + code-server reachable), the floaty states, auto-start via
  setup_and_start, auto-reload of the VS Code iframe, and the lifecycle dialog
  system. Read BEFORE touching PanelVisualStudioCode.svelte,
  ContainerLifecycleDialog.svelte, or any workspace state handling code. Trigger
  words: workspace stopped, workspace monitoring, workspace poll, workspace floaty,
  start workspace, code-server reachable, lifecycle dialog, workspace state,
  workspace running.
---

# HD Workspace Monitoring

This is the platform-generic reference for how HD monitors workspace health.
The host-platform specifics (the runtime-unavailable floaty wording, the stop
command, the exact code-server reachability port, and the no-daemon framing)
live in the companion [[hd-workspace-monitoring-windows]] skill.

## Architecture

The workspace is HD's local code-server-backed dev environment. HD monitors
workspace health at two levels:

1. **Runtime available** — is the workspace runtime itself installed and
   responding on this machine?
2. **Workspace healthy** — is the workspace present AND Running AND is
   code-server reachable on its host port?

The second level is a real reachability check, not just "is the workspace
present." A resume reality-check (after sleep, or after an HD rebuild/relaunch)
requires code-server to actually answer before HD trusts the workspace as
healthy — a workspace can be Running while code-server is dead.

The VS Code panel (`PanelVisualStudioCode.svelte`) polls workspace state every
15s and shows appropriate UI for each state. These frontend components are
runtime-agnostic; they front the active runtime via the runtime trait.

## Workspace State Poll

`PanelVisualStudioCode.svelte` calls `get_container_status` (Tauri command)
every 15s. The command dispatches through the runtime trait to the active
runtime impl. Returns a status struct shaped like:
```rust
pub struct ContainerStatus {
    pub docker_available: bool,    // is the workspace runtime available?
    pub image_pulled: bool,        // is the workspace image/tarball present?
    pub container_exists: bool,    // is the workspace present (Running or Stopped)?
    pub container_running: bool,   // is it Running AND code-server reachable?
    pub container_id: Option<String>,
    pub error: Option<String>,
}
```
The field names are inherited from the Docker era; under any runtime they map
onto the two health levels above (runtime availability, then
workspace-present → workspace-Running + code-server-reachable).

## Floaty States

All floaties appear INSIDE the VS Code panel only — not as full-app modals.
They are draggable (grab header to move). The rest of the app (wiki tab, menu,
etc.) remains fully interactive.

### 1. Runtime Not Available (red dot)
- **When**: the workspace runtime itself is not installed / not responding
  (level-1 health fails)
- **Action**: "Run Setup Steps" button → dispatches `hd-show-setup` event
  (which walks the user through enabling the runtime)
- **Color**: Red dot in header

The exact runtime name and floaty message are platform-specific — see
[[hd-workspace-monitoring-windows]].

### 2. Workspace Stopped / Not Ready (red dot)
- **When**: the runtime is available but the workspace isn't Running, or it's
  Running but code-server isn't reachable on its host port
  (`container_running == false`)
- **Message**: "The Adom workspace is not running."
- **Action**: "Start Workspace" button → calls `setup_and_start` Tauri command
- **Lifecycle dialog**: Shows the draggable lifecycle dialog with live setup
  output
- **Auto-reload**: After the workspace + code-server come up, waits for
  code-server health, then reloads the VS Code iframe

## Auto-Start via `setup_and_start`

The "Start Workspace" path calls Tauri `setup_and_start`, which delegates to
the active runtime's `setup_and_start`:
- If the workspace isn't present yet, `fresh_import` = download the golden
  image + provision the workspace + start code-server.
- If the workspace is present but code-server is down, it just (re-)starts
  code-server.

Importantly, code-server runs as an **HD-owned child process** (not a detached
`nohup`) — it dies with HD. So HD also **re-ensures code-server on every
launch** (look for `re-ensured code-server on launch` in the log). Without
that, a freshly relaunched HD would show the workspace Running but the editor
stuck on "Starting AI Environment" forever, because the previous HD's
code-server child was orphaned. See `hd-workspace-lifecycle` for the full
lifecycle detail.

## Lifecycle Dialog

`ContainerLifecycleDialog.svelte` — a draggable floating card (no background
blur) that shows live command output for start/stop/restart operations on the
workspace.

### Events
Listens for `hd-container-lifecycle` CustomEvents on `window`:
- `action: 'restart' | 'stop' | 'start'` — opens dialog, starts spinner
- `action: 'step', step: string` — appends a log line
- `action: 'done'` — stops spinner, shows Close button, auto-reloads VS Code
- `action: 'stopped'` — stops spinner (for stop-only operations)
- `action: 'error', message: string` — shows error state

### Title
Dynamic based on `actionType`:
- Restarting: "Workspace Restarting..." → "Restart Complete"
- Stopping: "Stopping Workspace..." → "Workspace Stopped"
- Starting: "Starting Workspace..." → "Workspace Started"
- On error: "Restart/Stop/Start Failed"

### VS Code Auto-Reload
After the `done` event, the dialog polls code-server health (`/proxy/8080/`)
every 5s for up to 2 minutes. When healthy, it reloads all iframes whose src
points at the host-side code-server port, then shows "VS Code iframe reloaded"
and stops.

## Tauri Commands

| Command | What it does |
|---|---|
| `get_container_status` | Returns workspace status — runtime available, workspace present, Running + code-server reachable |
| `setup_and_start` | `fresh_import` (provision workspace) + start code-server, up to 10 min timeout |
| `stop_container` | Stops the workspace |
| `toggle_console` | Show/hide the debug console window |
| `is_console_visible` | Returns true if console window exists |

The exact stop command is platform-specific — see
[[hd-workspace-monitoring-windows]].

## Menu Items (Adom Menu → Workspace Section)
- **Restart Workspace** — stop the workspace + re-ensure code-server; emits
  lifecycle events, shows dialog
- **Stop Workspace** — stops the workspace; emits lifecycle events, shows
  dialog, triggers stopped floaty
- **Start Workspace** — available when stopped (from floaty button or menu)

## Settings (Desktop section in Settings dialog)
- `desktop.show_console_on_startup` — boolean, default false
- `desktop.launch_on_boot` — boolean, default true (auto-start on boot)

## Related skills

- [[hd-workspace-monitoring-windows]] — the WSL2 "Not Available" floaty, `wsl --terminate` stop, the 7380 reachability check, the no-daemon framing
- `hd-workspace-lifecycle` — provision/export/remove/stop, the never-touch-global rule, control endpoints
- `hd-container-stats` — the title-bar CPU/RAM bars and `workspace_stats()` probe
- `hd-networking` — code-server port, control port
