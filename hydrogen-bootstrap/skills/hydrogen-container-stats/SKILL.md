---
name: hydrogen-container-stats
description: Hydrogen's workspace stats indicator in the top-right of the title bar — two thin progress bars (CPU + RAM) labelled "Container" plus an info tooltip on hover that shows the workspace name, CPU vs total cores, RAM usage vs limit, disk usage, image, ID, and creation date. Polls once per second when running, every 5 seconds when stopped. Status badges show stopped / starting / restarting / restart-needed states. Use this skill when the user asks about CPU/RAM usage, the resource bars in Hydrogen's title bar, workspace disk usage, the "restart needed" badge, why bars are red/yellow, or what's in the tooltip. Trigger words — container stats, workspace stats, container cpu, container ram, container disk, resource bars, cpu bar, ram bar, container tooltip, container indicator, top bar stats, restart needed badge, container stopped badge, container starting, workspace_stats, workspace stats.
---

# Hydrogen Workspace Stats Indicator

The top-right of Hydrogen's title bar (next to the audio/video icons and your profile avatar) shows a tiny `Container` block with two horizontal progress bars — CPU% and RAM% — that animate in real-time. Hovering brings up a tooltip with the full workspace details. The numbers reflect your **local Hydrogen workspace**; the header reads "Container" on all platforms.

> Platform layers add a `*-windows` companion ([[hydrogen-container-stats-windows]]) with the host-specific probe — the WSL `workspace_stats()` health check, `wsl --terminate` restart, the benign `[docker]` log line, and distro disk semantics.

## How often it polls

There's an active polling loop in Hydrogen's title bar that asks the runtime for fresh stats on a timer:

- **Every 1 second** when the workspace is `running` — for live, smooth bar animation
- **Every 5 seconds** when it's `stopped`, `starting`, `restarting`, or `restart needed` — saves cycles when nothing's changing

Each poll calls Tauri `invoke('get_container_stats')`, which dispatches through the runtime trait (`WorkspaceRuntime::get_stats`) to the active host's probe. The probe runs with short timeouts so a hung host subsystem can't freeze the UI.

If you ever want to lighten the load (e.g. on a battery-constrained laptop), the relevant code is in `EditorNav.svelte`'s `pollStats()` closure — adjust the `pollInterval` ternary.

## What the bars show

| Bar | What it measures |
|-----|------------------|
| CPU | % of the workspace's available CPU being consumed (1.0 = 1 full vCPU). Capped at 100% display |
| RAM | % of the workspace's memory in use vs its limit |

Both bars share the same color-threshold rules:
- **Teal / green** — ≤ 50% usage (normal)
- **Yellow** (`warn` class) — 51-80% usage
- **Red** (`danger` class) — > 80% usage

## What the tooltip shows

When you hover over the bars, a tooltip appears with:

| Line | Example |
|------|---------|
| Container | the workspace name |
| CPU + RAM totals | `CPU: 1.7% of 16 cores | RAM: 0.7 GB / 16.0 GB` |
| Disk | `Disk: 1.3 GB` (workspace disk usage) |
| Image | `Image: Ubuntu 24.04` |
| ID | the registered workspace identifier |
| Created | `5/24/2026, 3:18:09 PM` (locale-formatted) |

If the workspace is in a non-healthy state, the tooltip shows a single red line instead:
- `Workspace is stopped — start from the menu` (when stopped)
- `Workspace runtime is broken — restart from the menu` (when the workspace / code-server is unreachable, e.g. after sleep/hibernate)

## Status badge in the header

The `Container` text in the section header gets an inline status badge depending on state:

| Badge | Meaning | Color |
|-------|---------|-------|
| (no badge) | Running normally | normal |
| `stopped` | Workspace registered but not running | red |
| `starting` | Hydrogen is starting the workspace / code-server | yellow |
| `restarting` | Hydrogen is restarting the workspace | yellow |
| `restart needed` | The workspace or code-server is unreachable (usually a hiccup after the host wakes from sleep) | red |

When `restart needed` shows, open the Adom menu → Restart Workspace (see the `[[hydrogen-ui]]` skill for the Adom menu). A "Restart" here terminates and re-ensures the workspace + code-server.

## How it works under the hood

- **Polling frequency**: see "How often it polls" above — 1s when running, 5s when not.
- **Backend command**: Tauri `invoke('get_container_stats')` → `WorkspaceRuntime::get_stats`, routed to the active host runtime's probe.
- **Two health levels** the probe checks: (1) is the host runtime itself available; (2) is the workspace registered + running with code-server reachable on host port 7380. If either fails, the probe returns a needs-restart signal instead of stats and the UI shows the red "restart needed" badge.
- **Rate-limited error logging**: the "needs restart" log line is printed at most once every 30 seconds, even though the frontend polls every 1s, so the log stays readable.

The authoritative "which runtime am I on" log line is `[app] Active workspace runtime: …`. (Platform-specific log signals — e.g. the benign Windows `[docker]` heartbeat — are covered in `[[hydrogen-container-stats-windows]]`.)

## API access

If you want the same stats data your AI can hit directly via the control API:

```bash
# From inside the workspace — query the control API on the host
curl -s "$(cat ~/.adom/hydrogen-control-url)/container-stats"
```

(Read the live URL from `~/.adom/hydrogen-control-url` rather than hardcoding it — the port is **dynamic per launch**.)

Returns JSON like:
```json
{
  "ok": true,
  "container_name": "Adom-Workspace",
  "container_id": "Adom-Workspace",
  "container_created": "2026-05-24T20:18:09Z",
  "image": "Ubuntu 24.04",
  "cpu_percent": 1.7,
  "cpu_cores": 16,
  "mem_usage_mb": 716,
  "mem_limit_mb": 16384,
  "mem_percent": 4.4,
  "disk_usage_mb": 1300
}
```

Or if the workspace is in a broken state:
```json
{ "ok": false, "needs_restart": true, "error": "Workspace needs restart" }
```

## CSS selectors

| Element | Selector |
|---------|----------|
| The whole indicator block | `.resource-bars` |
| Header with title + status badge | `.resource-bars-header` |
| Title text ("Container") | `.resource-bars-title` |
| One bar row (CPU or RAM) | `.resource-bar-item` |
| Bar fill | `.resource-bar-fill` (modifier classes: `.warn`, `.danger`) |
| Bar percentage label | `.resource-bar-value` |
| Hover tooltip container | `.resource-bars-tooltip` |
| One tooltip line | `.resource-bars-tooltip-row` |

## Common questions

**"Why is CPU showing 200% / 1600%?"** It's not — the displayed % is capped at 100 for the bar fill, but the tooltip shows the real number. CPU of `100% of 16 cores` means 1 full vCPU pegged.

**"Why does RAM stay constant at ~4% even when I'm doing nothing?"** Code-server, the relay, gallia, the adom-vscode HTTP API, etc. all run in the workspace all the time. ~700 MB baseline is normal.

**"The 'restart needed' badge appeared — what happened?"** Almost always a hiccup after the host woke from sleep/hibernate, leaving the workspace or code-server unreachable. Click Restart Workspace in the Adom menu (top-left); Hydrogen restarts the workspace, re-ensures code-server, and the badge clears.

**"Disk is 1.3 GB — does that include my project files?"** Yes — `/home/adom/project` lives inside the workspace, so the `Disk:` figure includes your project.

## Related skills

- `[[hydrogen-workspace-monitoring]]` — the 15s state poll + floaty states behind these badges
- `[[hydrogen-container]]` — workspace context: relay, bridges, env vars
