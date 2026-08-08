---
name: hydrogen-workspace-monitoring
description: >
  How Hydrogen Desktop monitors and manages the local WSL2 workspace distro
  (`Adom-Workspace`) and code-server. Covers the 15s workspace state poll, the
  two health levels (WSL2 available, distro Running + code-server reachable), the
  floaty states (WSL not available, distro stopped), auto-start via setup_and_start,
  auto-reload of the VS Code iframe, and the lifecycle dialog system. Read BEFORE
  touching PanelVisualStudioCode.svelte, ContainerLifecycleDialog.svelte, or any
  workspace state handling code. Trigger words: workspace stopped, wsl not available,
  workspace monitoring, distro poll, workspace floaty, start workspace, code-server
  reachable, lifecycle dialog, workspace state, Adom-Workspace running.
---

# HD Workspace Monitoring

> This is the WSL2-runtime version (default). The legacy Docker equivalent
> (`HD_RUNTIME=docker`) is in the docker/ bucket.

## Architecture

Under the WSL2 runtime the workspace is the **`Adom-Workspace` distro** (imported via
`wsl --import`), not a Docker container. HD monitors workspace health at two levels:

1. **WSL2 available** — is WSL2 itself installed and responding on this machine?
2. **Workspace healthy** — is `Adom-Workspace` registered AND Running AND is
   code-server reachable on host port **7380**?

The second level is a real reachability check, not just "is the distro registered."
A resume reality-check (after sleep, or after an HD rebuild/relaunch) requires
code-server to actually answer before HD trusts the workspace as healthy — a distro
can be `Running` while code-server is dead.

The VS Code panel (`PanelVisualStudioCode.svelte`) polls workspace state every 15s
and shows appropriate UI for each state. These frontend components survive unchanged
from the Docker era; they now front the WSL runtime via the runtime trait.

## Workspace State Poll

`PanelVisualStudioCode.svelte` calls `get_container_status` (Tauri command) every 15s.
The command dispatches through the runtime trait to the WSL impl. Returns a status
struct shaped like:
```rust
pub struct ContainerStatus {
    pub docker_available: bool,    // under WSL: is WSL2 available?
    pub image_pulled: bool,        // is the Adom-Workspace tarball/distro present?
    pub container_exists: bool,    // is the distro registered (Running or Stopped)?
    pub container_running: bool,   // is it Running AND code-server reachable on :7380?
    pub container_id: Option<String>,
    pub error: Option<String>,
}
```
The field names are inherited from the Docker era; under WSL they map onto the two
health levels above (WSL availability, then distro-registered → distro-Running +
code-server-reachable).

## Floaty States

All floaties appear INSIDE the VS Code panel only — not as full-app modals.
They are draggable (grab header to move). The rest of the app (wiki tab, menu, etc.)
remains fully interactive. The old Docker floaties ("Docker Desktop not installed/
running") become WSL/distro states under this runtime.

### 1. WSL2 Not Available (red dot)
- **When**: WSL2 itself is not installed / not responding (level-1 health fails)
- **Message**: "WSL2 is required but not available."
- **Action**: "Run Setup Steps" button → dispatches `hd-show-setup` event (which walks
  the user through enabling WSL2)
- **Color**: Red dot in header

### 2. Workspace Stopped / Not Ready (red dot)
- **When**: WSL2 is available but `Adom-Workspace` isn't Running, or it's Running but
  code-server isn't reachable on :7380 (`container_running == false`)
- **Message**: "The Adom workspace is not running."
- **Action**: "Start Workspace" button → calls `setup_and_start` Tauri command
- **Lifecycle dialog**: Shows the draggable lifecycle dialog with live setup output
- **Auto-reload**: After the distro + code-server come up, waits for code-server
  health, then reloads the VS Code iframe

There is no separate "daemon not running" middle state like Docker had — WSL has no
always-on daemon to launch. Either WSL2 is available or it isn't (state 1), and the
workspace is either healthy or it isn't (state 2).

## Auto-Start via `setup_and_start`

The "Start Workspace" path calls Tauri `setup_and_start`, which (in WSL mode)
delegates to `WslDistroRuntime::setup_and_start`:
- If the distro isn't present yet, `fresh_import` = download the golden
  `adom-golden.tar.gz` (from the `adom-inc/hd-wsl2-image` release) + `wsl --import
  Adom-Workspace` + start code-server.
- If the distro is present but code-server is down, it just (re-)starts code-server.

Importantly, code-server runs as an **HD-owned child process** (not a detached
`nohup`) — it dies with HD. So HD also **re-ensures code-server on every launch**
(look for `[wsl-startup] re-ensured code-server on launch` in the log). Without that,
a freshly relaunched HD would show the distro Running but the editor stuck on
"Starting AI Environment" forever, because the previous HD's code-server child was
orphaned. See [hydrogen-workspace-lifecycle](../hydrogen-workspace-lifecycle/SKILL.md) for the
full lifecycle detail.

## Lifecycle Dialog

`ContainerLifecycleDialog.svelte` — a draggable floating card (no background blur)
that shows live command output for start/stop/restart operations on the distro.

### Events
Listens for `hydrogen-container-lifecycle` CustomEvents on `window`:
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
After the `done` event, the dialog polls code-server health (`/proxy/8080/`) every 5s
for up to 2 minutes. When healthy, it reloads all iframes whose src points at
`localhost:7380` (the host-side code-server port), then shows "VS Code iframe reloaded"
and stops.

## Tauri Commands

| Command | What it does (WSL mode) |
|---|---|
| `get_container_status` | Returns workspace status — WSL available, distro present/registered, Running + code-server reachable |
| `setup_and_start` | `WslDistroRuntime::setup_and_start` — `fresh_import` (import distro) + start code-server, up to 10 min timeout |
| `stop_container` | Stops the workspace (`wsl --terminate Adom-Workspace`) |
| `toggle_console` | Show/hide the debug console window |
| `is_console_visible` | Returns true if console window exists |

There is no `launch_docker_desktop` equivalent under WSL — there's no daemon to start.

## Menu Items (Adom Menu → Workspace Section)
- **Restart Workspace** — `wsl --terminate Adom-Workspace` + re-ensure code-server; emits lifecycle events, shows dialog
- **Stop Workspace** — terminates the distro; emits lifecycle events, shows dialog, triggers stopped floaty
- **Start Workspace** — available when stopped (from floaty button or menu)

## Settings (Desktop section in Settings dialog)
- `desktop.show_console_on_startup` — boolean, default false
- `desktop.launch_on_boot` — boolean, default true (auto-start registry key)

## Related skills

- [hydrogen-workspace-lifecycle](../hydrogen-workspace-lifecycle/SKILL.md) — import/export/unregister/terminate, the never-touch-global-WSL rule, control endpoints
- [hydrogen-container-stats](../hydrogen-container-stats/SKILL.md) — the title-bar CPU/RAM bars and `workspace_stats()` probe
- [hydrogen-networking](../hydrogen-networking/SKILL.md) — port 7380 code-server, control port 47084
