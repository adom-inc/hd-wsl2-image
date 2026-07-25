---
name: hd-workspace-monitoring-windows
description: >
  Windows/WSL2-specific details for HD workspace monitoring — the "WSL2 Not
  Available" floaty, the `wsl --terminate Adom-Workspace` stop command, the
  code-server-on-host-7380 reachability check, and the no-daemon framing (WSL
  has no always-on daemon to launch). READ alongside the generic
  [[hd-workspace-monitoring]] skill when you need the concrete WSL2 states,
  commands, or ports. Trigger words: wsl not available, Adom-Workspace running,
  wsl terminate, code-server 7380, no daemon, distro stopped, WSL2 floaty.
---

# HD Workspace Monitoring (Windows / WSL2 specifics)

This is the Windows companion to the generic [[hd-workspace-monitoring]]
skill. Read that first for the monitoring architecture, the ContainerStatus
struct, the 15s poll, the lifecycle dialog, the Tauri commands, the menu
items, and the Settings toggles. This page carries only the WSL2-specific
states, commands, and ports.

HD runs on Windows (WSL2), Mac, and Ubuntu. Under the WSL2 runtime the
workspace is the **`Adom-Workspace` distro** (imported via `wsl --import`), not
a Docker container. The legacy Docker equivalent (`HD_RUNTIME=docker`) is in
the docker/ bucket.

## The two WSL2 health levels

The generic two-level model maps onto WSL2 as:

1. **WSL2 available** — is WSL2 itself installed and responding on this
   machine?
2. **Workspace healthy** — is `Adom-Workspace` registered AND Running AND is
   code-server reachable on host port **7380**?

A workspace can be `Running` while code-server is dead, so the level-2 check is
a real host-loopback reachability probe of port 7380, not just "is the distro
registered."

## WSL2 floaty states

The old Docker floaties ("Docker Desktop not installed/running") become these
WSL/distro states under this runtime.

### 1. WSL2 Not Available (red dot)
- **When**: WSL2 itself is not installed / not responding (level-1 health
  fails)
- **Message**: "WSL2 is required but not available."
- **Action**: "Run Setup Steps" button → dispatches `hd-show-setup` event
  (which walks the user through enabling WSL2)

### 2. Workspace Stopped / Not Ready (red dot)
- **When**: WSL2 is available but `Adom-Workspace` isn't Running, or it's
  Running but code-server isn't reachable on :7380 (`container_running ==
  false`)

### No "daemon not running" middle state

There is no separate "daemon not running" middle state like Docker had — WSL
has no always-on daemon to launch. Either WSL2 is available or it isn't
(state 1), and the workspace is either healthy or it isn't (state 2). There is
no `launch_docker_desktop` equivalent under WSL.

## Auto-Start specifics

Under WSL mode, `setup_and_start` delegates to
`WslDistroRuntime::setup_and_start`:
- If the distro isn't present yet, `fresh_import` = download the golden
  `adom-golden.tar.gz` (from the `adom-inc/hd-wsl2-image` release) +
  `wsl --import Adom-Workspace` + start code-server.
- If the distro is present but code-server is down, it just (re-)starts
  code-server.

The re-ensure-on-launch log line is
`[wsl-startup] re-ensured code-server on launch`.

## VS Code Auto-Reload target

After the `done` lifecycle event, the dialog reloads all iframes whose src
points at `localhost:7380` (the host-side code-server port).

## WSL2-specific Tauri command mappings

| Command | WSL mode behavior |
|---|---|
| `get_container_status` | WSL available, distro present/registered, Running + code-server reachable on :7380 |
| `setup_and_start` | `WslDistroRuntime::setup_and_start` — `fresh_import` + start code-server, up to 10 min timeout |
| `stop_container` | Stops the workspace via `wsl --terminate Adom-Workspace` |

## WSL2-specific menu behavior

- **Restart Workspace** — `wsl --terminate Adom-Workspace` + re-ensure
  code-server
- **Stop Workspace** — `wsl --terminate Adom-Workspace`

## Related skills

- [[hd-workspace-monitoring]] — the generic monitoring UX, struct, poll, lifecycle dialog, and commands
- `hd-workspace-lifecycle` — import/export/unregister/terminate, the never-touch-global-WSL rule, control endpoints
- `hd-networking` — port 7380 code-server, control port 47084
