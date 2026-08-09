---
name: hydrogen-container-stats
description: Hydrogen's workspace stats indicator in the top-right of the title bar — two thin progress bars (CPU + RAM) labelled "Container" plus an info tooltip on hover that shows the workspace name, CPU vs total cores, RAM usage vs limit, disk usage, image/distro, ID, and creation date. Polls once per second when running, every 5 seconds when stopped. Status badges show stopped / starting / restarting / restart-needed states. Use this skill when the user asks about CPU/RAM usage, the resource bars in Hydrogen's title bar, workspace disk usage, the "restart needed" badge, why bars are red/yellow, or what's in the tooltip. Trigger words — container stats, workspace stats, container cpu, container ram, container disk, resource bars, cpu bar, ram bar, container tooltip, container indicator, top bar stats, restart needed badge, container stopped badge, container starting, workspace_stats, distro stats, wsl stats.
---

# Hydrogen Workspace Stats Indicator

> This is the WSL2-runtime version (default). The legacy Docker equivalent
> (`HD_RUNTIME=docker`) is in the docker/ bucket.

The top-right of Hydrogen's title bar (next to the audio/video icons and your profile avatar) shows a tiny `Container` block with two horizontal progress bars — CPU% and RAM% — that animate in real-time. Hovering brings up a tooltip with the full workspace details. Under the WSL2 runtime these numbers now reflect the **`Adom-Workspace` distro**, not a Docker container — but the UI is unchanged, so the header still reads "Container".

## How often it polls

There's an active polling loop in Hydrogen's title bar that asks the runtime for fresh stats on a timer:

- **Every 1 second** when the workspace is `running` — for live, smooth bar animation
- **Every 5 seconds** when it's `stopped`, `starting`, `restarting`, or `restart needed` — saves cycles when nothing's changing

Each poll calls Tauri `invoke('get_container_stats')`. This command no longer reaches into Docker directly — it dispatches through the runtime trait: `WorkspaceRuntime::get_stats` → `WslDistroRuntime::get_stats` → `workspace_stats()`, a WSL health/stat probe of the `Adom-Workspace` distro. (Under `HD_RUNTIME=docker` the same command routes to the Docker impl instead.) The probe runs with short timeouts so a hung WSL subsystem can't freeze the UI.

If you ever want to lighten the load (e.g. on a battery-constrained laptop), the relevant code is in `EditorNav.svelte`'s `pollStats()` closure — adjust the `pollInterval` ternary.

## What the bars show

| Bar | What it measures | Source |
|-----|------------------|--------|
| CPU | % of the distro's available CPU being consumed (1.0 = 1 full vCPU). Capped at 100% display | `workspace_stats()` WSL probe |
| RAM | % of the distro's memory in use vs its limit | `workspace_stats()` WSL probe |

Both bars share the same color-threshold rules:
- **Teal / green** — ≤ 50% usage (normal)
- **Yellow** (`warn` class) — 51-80% usage
- **Red** (`danger` class) — > 80% usage

## What the tooltip shows

When you hover over the bars, a tooltip appears with:

| Line | Example |
|------|---------|
| Container | `Adom-Workspace` (the distro name) |
| CPU + RAM totals | `CPU: 1.7% of 16 cores | RAM: 0.7 GB / 16.0 GB` |
| Disk | `Disk: 1.3 GB` (distro disk usage) |
| Image | `Image: Ubuntu 24.04 (Adom-Workspace)` (the imported distro) |
| ID | `Adom-Workspace` (the registered distro identifier) |
| Created | `5/24/2026, 3:18:09 PM` (locale-formatted) |

If the workspace is in a non-healthy state, the tooltip shows a single red line instead:
- `Workspace is stopped — start from the menu` (when stopped)
- `Workspace runtime is broken — restart from the menu` (when the distro/code-server is unreachable, e.g. after sleep/hibernate)

## Status badge in the header

The `Container` text in the section header gets an inline status badge depending on state:

| Badge | Meaning | Color |
|-------|---------|-------|
| (no badge) | Running normally | normal |
| `stopped` | Distro registered but not running | red |
| `starting` | Hydrogen is starting the distro / code-server | yellow |
| `restarting` | Hydrogen is restarting the distro | yellow |
| `restart needed` | The distro or code-server is unreachable (usually a WSL2 hiccup after Windows wake) | red |

When `restart needed` shows, open the Adom menu → Restart Workspace (see the `hydrogen-ui` skill for the Adom menu). A "Restart" here is `wsl --terminate Adom-Workspace` + re-ensure code-server — NOT `docker restart`.

## How it works under the hood

- **Polling frequency**: see "How often it polls" above — 1s when running, 5s when not.
- **Backend command**: Tauri `invoke('get_container_stats')` → `WorkspaceRuntime::get_stats`. In WSL mode that is `WslDistroRuntime::get_stats` → `workspace_stats()`. NO `docker exec`, NO cgroup file reads, NO bollard `stats()` — those were the Docker-runtime mechanism and do not run under WSL.
- **Two health levels** (`workspace_stats()` checks both): (1) is WSL2 itself available; (2) is `Adom-Workspace` registered + Running with code-server reachable on host port 7380. If either fails, the probe returns a needs-restart signal instead of stats and the UI shows the red "restart needed" badge.
- **Rate-limited error logging**: the "needs restart" log line is printed at most once every 30 seconds, even though the frontend polls every 1s, so the log stays readable.

### The benign `[docker] unhealthy` log line

You will sometimes see this in Hydrogen's log even on the WSL2 path:

```
[docker] Container runtime unhealthy — exec failed, needs restart
```

**Under WSL this is BENIGN NOISE.** It's a leftover hydrogen-docker heartbeat with no container bound to it — there is no Docker container in WSL mode, so "exec failed" is expected and meaningless. It does NOT mean your workspace is broken.

The real WSL health signal to watch for is:

```
[wsl] Workspace unhealthy …
```

That line (not the `[docker]` one) reflects the actual `Adom-Workspace` distro state. And the authoritative "which runtime am I on" line is `[app] Active workspace runtime: WslDistro`.

## API access

If you want the same stats data your AI can hit directly via the control API:

```bash
# From inside the distro — query the control API on the host
curl -s "$(cat ~/.adom/hydrogen-control-url)/container-stats"
```

(Reach the control API at `127.0.0.1` — WSL2 mirrored networking shares loopback with the Windows host. The port is **dynamic per launch**; read the live URL from `~/.adom/hydrogen-control-url` rather than hardcoding it.)

Returns JSON like:
```json
{
  "ok": true,
  "container_name": "Adom-Workspace",
  "container_id": "Adom-Workspace",
  "container_created": "2026-05-24T20:18:09Z",
  "image": "Ubuntu 24.04 (Adom-Workspace)",
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

**"Why does RAM stay constant at ~4% even when I'm doing nothing?"** Code-server, the relay, gallia, the adom-vscode HTTP API, etc. all run in the distro all the time. ~700 MB baseline is normal.

**"The 'restart needed' badge appeared — what happened?"** Almost always a WSL2 hiccup after Windows wake/sleep, leaving the distro or code-server unreachable. Click Restart Workspace in the Adom menu (top-left). Hydrogen will `wsl --terminate Adom-Workspace`, re-ensure code-server, and the badge clears.

**"The log says `[docker] … unhealthy` — is my workspace broken?"** No. Under WSL that line is a benign leftover heartbeat with no container bound. Look at `[wsl] Workspace unhealthy …` for the real signal. See "The benign `[docker] unhealthy` log line" above.

**"Disk is 1.3 GB — does that include my project files?"** Yes — under WSL there is no separate Docker volume; `/home/adom/project` lives inside the distro, so the `Disk:` figure is the distro's on-disk size including your project.

## Related skills

- [hydrogen-workspace-monitoring](../hydrogen-workspace-monitoring/SKILL.md) — the 15s state poll + floaty states behind these badges
- [hydrogen-workspace-lifecycle](../hydrogen-workspace-lifecycle/SKILL.md) — start/stop/restart/unregister of the distro
- [hydrogen-networking](../hydrogen-networking/SKILL.md) — port 7380 code-server, host reachability, control port 47084
