---
name: hd-container-stats-windows
description: Windows/WSL2-specific mechanism behind HD's title-bar CPU/RAM "Container" indicator — the `workspace_stats()` WSL health/stat probe of the `Adom-Workspace` distro, `wsl --terminate` as the "restart workspace" action, the benign `[docker] unhealthy` log line under WSL, the `[wsl]` real health signal, and WSL distro disk semantics. Companion to [[hd-container-stats]]. Trigger on workspace_stats WSL probe, wsl --terminate, [docker] unhealthy log, [wsl] unhealthy, WslDistroRuntime get_stats, distro disk, restart needed after Windows wake.
---

# HD Workspace Stats Indicator — Windows / WSL2 specifics

Companion to **[[hd-container-stats]]**. The bars, thresholds, polling cadence, tooltip fields, badges, CSS selectors, and control-API shape are all in the generic skill. This skill covers how the stats are actually gathered on Windows.

## The backend probe

Under the WSL2 runtime, `invoke('get_container_stats')` → `WorkspaceRuntime::get_stats` → `WslDistroRuntime::get_stats` → `workspace_stats()`, a WSL health/stat probe of the `Adom-Workspace` distro.

There is **NO `docker exec`, NO cgroup file reads, NO bollard `stats()`** — those were the Docker-runtime mechanism and do not run under WSL. (Under `HD_RUNTIME=docker` the same command routes to the Docker impl instead.) The probe runs with short timeouts so a hung WSL subsystem can't freeze the UI.

`workspace_stats()` checks two health levels: (1) is WSL2 itself available; (2) is `Adom-Workspace` registered + Running with code-server reachable on host port 7380. If either fails, it returns a needs-restart signal and the UI shows the red "restart needed" badge.

The tooltip's source values under WSL: CPU/RAM come from the `workspace_stats()` WSL probe; `Image` reads `Ubuntu 24.04 (Adom-Workspace)`; `ID` and `Container` are the distro name `Adom-Workspace`.

## "Restart Workspace" = `wsl --terminate`, not `docker restart`

When `restart needed` shows, Adom menu → Restart Workspace runs `wsl --terminate Adom-Workspace` + re-ensure code-server — NOT `docker restart`.

The trigger is almost always a WSL2 hiccup after Windows wake/sleep, leaving the distro or code-server unreachable.

## The benign `[docker] unhealthy` log line

You will sometimes see this in HD's log even on the WSL2 path:

```
[docker] Container runtime unhealthy — exec failed, needs restart
```

**Under WSL this is BENIGN NOISE.** It's a leftover hd-docker heartbeat with no container bound to it — there is no Docker container in WSL mode, so "exec failed" is expected and meaningless. It does NOT mean your workspace is broken.

The real WSL health signal to watch for is:

```
[wsl] Workspace unhealthy …
```

That line (not the `[docker]` one) reflects the actual `Adom-Workspace` distro state. The authoritative "which runtime am I on" line is `[app] Active workspace runtime: WslDistro`.

## Distro disk semantics

Under WSL there is no separate Docker volume; `/home/adom/project` lives inside the distro, so the `Disk:` figure in the tooltip is the distro's on-disk size including your project files.

## Common questions (WSL detail)

**"The log says `[docker] … unhealthy` — is my workspace broken?"** No — under WSL that line is a benign leftover heartbeat with no container bound. Look at `[wsl] Workspace unhealthy …` for the real signal.

## Related skills

- `[[hd-container-stats]]` — the platform-generic indicator this companion extends
- `[[hd-workspace-monitoring-windows]]` — distro + code-server health monitoring
- `[[hd-networking]]` — port 7380 code-server, host reachability
