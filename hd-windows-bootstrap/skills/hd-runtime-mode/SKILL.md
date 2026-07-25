---
name: hd-runtime-mode
description: >
  Which workspace runtime your Hydrogen Desktop is using — a WSL2 Ubuntu distro
  (default) or a legacy Docker container (HD_RUNTIME=docker) — how to tell which
  one you're in, what changes between them, and which runtime-specific skills to
  trust. READ THIS FIRST when anything about the workspace's container/distro,
  networking, volumes, ports, or setup steps seems contradictory: the answer
  almost always depends on the runtime. Trigger words — runtime, wsl, wsl2,
  docker mode, HD_RUNTIME, Adom-Workspace, which runtime, container or distro,
  workspace runtime, container runtime unhealthy, am I in docker or wsl.
---

# HD Runtime Mode — WSL2 (default) vs Docker (legacy)

Hydrogen Desktop hosts your workspace one of two ways. Everything Claude knows
about "the container" — its filesystem, networking, ports, stats, and setup
steps — depends on which one is active. **Check the runtime before trusting any
runtime-specific advice.**

| `HD_RUNTIME` | Runtime | What the workspace is | Setup cascade | State file |
|---|---|---|---|---|
| unset / `wsl2` | **WslDistro — DEFAULT** | WSL2 Ubuntu distro `Adom-Workspace` (`wsl --import`) | 16 steps | `setup-steps-wsl.json` |
| `docker` | DockerDesktop — legacy fallback | Docker container (Docker Desktop) | 24 steps | `setup-steps.json` |

WSL2 is the default — you only get Docker if `HD_RUNTIME=docker` was set before
HD launched. The selector is `runtime/mod.rs::select_runtime()`; the WSL setup
executor is `setup_steps_wsl.rs`, the Docker one is `setup_steps.rs`. Both paths
are kept alive on purpose: the Docker runtime is a pristine fallback in case a
machine can't run WSL2.

## Which runtime am I in? (authoritative checks)

1. **Startup log line:** `[app] Active workspace runtime: WslDistro` (or
   `DockerDesktop`). This is the single source of truth.
2. **WSL only:** `wsl -l -v` shows `Adom-Workspace  Running`; HD logs
   `[wsl-trigger] backend poller armed (...setup-trigger-wsl.json)` and
   `[run_all_wsl] ...`.
3. **Docker only:** a `hydrogen-*` container appears in `docker ps`.
4. From inside the workspace, ask HD: `GET "$(cat ~/.adom/hd-control-url)/wsl/status"`
   (loopback `http://127.0.0.1:<dynamic>`) succeeds (with distro info) on the WSL runtime.

### ⚠️ Benign noise: `[docker] Container runtime unhealthy — exec failed, needs restart`
This line can appear **even on the WSL2 path** — a legacy `hd-docker` heartbeat
polls for a Docker container that doesn't exist and logs "unhealthy". It is
cosmetic and does NOT mean you're in Docker mode. The real WSL health signal is
`[wsl] Workspace unhealthy …`. Confirm the runtime via check #1, never by this line.

## What actually differs between the runtimes

| Concern | WSL2 (default) | Docker (legacy) |
|---|---|---|
| Workspace | `Adom-Workspace` distro, imported from the pre-baked `adom-golden.tar.gz` | container from a ~390 MB image |
| Run a command in it | `wsl -d Adom-Workspace -u adom -- <cmd>` | `docker exec <container> <cmd>` |
| Your files | `/home/adom/project` in the distro's ext4 fs (no volume); browse from Windows at `\\wsl$\Adom-Workspace\…` | Docker named volume; copy out via `docker cp` |
| Ports | code-server binds `0.0.0.0:7380`; WSL2 auto-forwards `0.0.0.0` listeners to Windows `localhost` | single `-p 7380:8080` map; other ports via `/proxy/<port>/` |
| Reach the host | `127.0.0.1` (WSL2 mirrored networking shares loopback with the Windows host); HD's live control URL is in `~/.adom/hd-control-url` | `host.docker.internal` (Docker-provided) |
| Wipe/reset | `wsl --unregister Adom-Workspace` (only that distro) | `docker rm` + volume/image removal |

## Which skills to trust

HD only installs the skills for the **active** runtime (plus the shared ones), so
in most workspaces you'll already have the right set. The runtime-specific skills
exist in two buckets in the HD repo — `wsl2/` and `docker/` — and share names:

- `hd-networking`, `hd-ports`, `hd-port-watcher`, `hd-volume`, `hd-container`,
  `hd-topology`, `hd-container-stats`, `hd-setup`, `hd-setup-steps`
- WSL-only workspace skills: `hd-workspace-lifecycle`, `hd-workspace-monitoring`
- Docker-only skills: `hd-docker-desktop`, `hd-docker-lifecycle`,
  `hd-docker-monitoring`

If you ever see Docker-specific advice (`docker exec`, named volumes, `-p` port
maps) while check #1 says `WslDistro`, you're reading the wrong bucket — defer to
the WSL2 mechanics above.

## Switching runtimes (rare; usually a dev/support action)
HD reads `HD_RUNTIME` from its environment at process start.
- → WSL2 (default): ensure `HD_RUNTIME` is unset or `wsl2`, relaunch HD. If a
  prior run set Docker: `setx HD_RUNTIME wsl2` then relaunch.
- → Docker (fallback): `setx HD_RUNTIME docker`, relaunch HD (requires Docker
  Desktop running).
