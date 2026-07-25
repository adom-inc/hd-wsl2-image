---
name: hd-api-windows
description: >
  Windows/WSL2-specific Hydrogen Desktop control-API surface — the /wsl/*
  runtime endpoints, the legacy /docker/* (HD_RUNTIME=docker) endpoints,
  /volume-delete, /system/* host-reboot ("Reboot Windows"), the
  /test/probe-dialogs UAC/MSI/Docker-EULA blocker catalog, WebView2 CDP/DevTools
  notes, host-side port discovery (HD log + %APPDATA%\hydrogen-desktop\ports.json),
  and the WSL2 mirrored-networking loopback note. READ alongside the generic
  [[hd-api]] skill on a Windows host. Trigger words — wsl status, docker status,
  reboot windows, system reboot, probe-dialogs, UAC dialog, MSI installer,
  Docker EULA, mirrored networking, ports.json, volume-delete, WebView2,
  terminal-profile, virgin-reset-progress.
---

# HD Control API — Windows / WSL2 specifics

This is the Windows companion to the generic [[hd-api]] skill. Read that first
for the platform-neutral endpoint groups (health, claude, setup, tabs, eval,
ui). This page carries the runtime-specific and host-specific endpoints that
were stripped out of the generic version.

## Host-side port discovery

In addition to the in-workspace `~/.adom/hd-control-url` discovery file, you can
find the dynamic control port from the Windows host:

```bash
# From HD log
adom-desktop hd_log '{"tail":100}' | grep "control="

# From ports.json
type %APPDATA%\hydrogen-desktop\ports.json
```

**Loopback note:** WSL2 mirrored networking shares loopback with the Windows
host, so `http://127.0.0.1:<port>` is the same address from inside the
`Adom-Workspace` distro and on the Windows host. `/ports/all` reports
mirrored-mode info per port.

## WSL runtime endpoints (default runtime)

When HD runs the workspace as a WSL2 distro, it additionally exposes:

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/wsl/status` | — | WSL distro state (registered, running, code-server reachable) |
| GET | `/workspace/health` | — | Deep workspace health (distro + code-server + host reachability) |
| GET | `/virgin-reset-progress` | — | Live progress of an in-flight virgin reset |
| POST | `/workspace/terminal-profile` | — | Ensure the stable `Adom-Workspace` Windows Terminal profile (idempotent) |
| POST | `/workspace/terminal-profile/remove` | — | Remove the `Adom-Workspace` Windows Terminal profile(s) |
| POST | `/workspace/check-updates` | — | Check upstream for newer code-server + Claude extension; stage them |
| POST | `/workspace/apply-updates` | — | Apply staged code-server/extension updates + reload editor |

> ⛔ `POST /wsl/unregister` is **REFUSED as deprecated** — it was a headless
> destructive reset (deletes `/home/adom/project`). Use the Setup panel's Virgin
> Reset or `POST /setup/panel/run-virgin-reset` instead.

## Docker Desktop (legacy Docker runtime only — `HD_RUNTIME=docker`)

This `/docker/*` table applies only when HD is running the legacy Docker runtime.

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/docker/status` | — | Docker Desktop running state |
| GET | `/docker/version` | — | Docker engine version |
| GET | `/docker/containers` | — | List all Docker containers |
| GET | `/docker/images` | — | List all Docker images |
| POST | `/docker/start` | — | Launch Docker Desktop + start container |
| POST | `/docker/stop` | — | Stop Docker Desktop |
| POST | `/docker/restart` | — | Restart Docker Desktop |
| POST | `/docker/wait-ready` | — | Block until Docker daemon responds |
| POST | `/docker/install` | — | Install Docker Desktop (downloads ~730 MB) |
| POST | `/docker/uninstall` | — | Uninstall Docker Desktop |
| POST | `/docker/clean-reinstall` | — | Uninstall + reinstall Docker Desktop |
| GET | `/docker/install-progress` | — | Current install step + progress |

Also Docker-runtime only:

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/volume-delete` | — | Remove project volume (DESTRUCTIVE). No volume exists under WSL. |

## System (host OS reboot)

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/system/nonce` | — | Get nonce for authenticated reboot |
| GET | `/system/reboot-state` | — | Check reboot pending state |
| POST | `/system/reboot` | `{"nonce":"..."}` | Reboot Windows (nonce-authenticated) |
| POST | `/system/cancel-reboot` | — | Cancel pending reboot |

## WebView & VS Code (Windows specifics)

HD's webview is **WebView2** on Windows; `/cdp-eval`, `/cdp-info`, and
`/devtools` target the WebView2 DevTools (Chrome DevTools Protocol) endpoint.

## Diagnostics — dialog blocker catalog

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/test/probe-dialogs` | — | Enumerate visible windows, classify against the cascade-blocker catalog (UAC, WSL2 update, MSI installer, Docker EULA, …); returns `kind` + `is_blocking` per window |

(Gated behind `HD_TEST_API_ENABLED=1`, like the rest of `/test/*`.)
