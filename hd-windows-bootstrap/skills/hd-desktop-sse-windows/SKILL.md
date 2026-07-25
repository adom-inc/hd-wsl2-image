---
name: hd-desktop-sse-windows
description: Windows/WSL2-specific details for HD's local workspace API + SSE — mirrored-networking loopback sharing, the ports.json location under %APPDATA%, the HD_RUNTIME=docker vs WSL2 relay same-port-vs-host-mapping behavior, and hd-docker create_container env injection. Read alongside the platform-generic [[hd-desktop-sse]]. Trigger words — WSL2 SSE, mirrored networking, ports.json APPDATA, HD_RUNTIME docker, Adom-Workspace distro relay, same-port loopback.
---

# Hydrogen Desktop — Local Workspace API + SSE (Windows / WSL2 specifics)

Platform companion to **[[hd-desktop-sse]]**. Everything here is Windows/WSL2-only; the
architecture, routing, env-var contract, REST field shapes, and the fixed discovery port
(47080) all live in the generic skill.

## The workspace runtime on Windows

On Windows the workspace is the **WSL2 `Adom-Workspace` distro** by default, or a **Docker
container under `HD_RUNTIME=docker`** (legacy). The workspace's adom-cli is what controls HD's
UI via the local workspace API.

## Mirrored networking shares loopback with the Windows host

Under WSL2 with **mirrored networking**, `127.0.0.1` is shared between the distro and the
Windows host. That means:

- From inside the `Adom-Workspace` distro, `http://127.0.0.1:47083` reaches HD's proxy running
  on the Windows host — no special host IP, no `/proxy/` hop needed for the host-loopback ports.
- The same `127.0.0.1:<port>` works identically from inside the distro and on Windows.
- The control URL HD writes to `~/.adom/hd-control-url` (`http://127.0.0.1:<dynamic>`) is the
  Windows-host loopback, reachable from the distro because of mirrored loopback.

## Relay ports: same-port under WSL2 (no host 47081/47082)

Under the WSL2 runtime the relay listens **same-port 8765 (WS) / 8766 (HTTP)** inside the distro
and is reached **same-port** via mirrored loopback (or via `/proxy/`). There are **no host
47081/47082 listeners** under WSL2.

- Clients discover the relay ports from `~/.adom/cli-relay-ports.json` (fallback 8765/8766),
  NOT from `/discover`.
- Contrast with the Docker runtime, where the relay's container ports (8765/8766) are
  host-mapped to 47081/47082. The same-port-vs-host-mapped distinction is the WSL2-vs-Docker
  difference to keep straight.

For reference, the relay-port rows in the generic PortConfig table resolve like this on Windows:

| Service | WSL2 (default) | Docker runtime | Workspace Port |
|---|---|---|---|
| Relay WS | same-port (no host listener) | host 47081 | 8765 |
| Relay HTTP | same-port (no host listener) | host 47082 | 8766 |

## ports.json location

Host-side port config is stored at `%APPDATA%\hydrogen-desktop\ports.json`. On first launch
defaults are written without scanning; PortConfig auto-resolves conflicts on startup. Only
host-side ports are dynamic — workspace-side ports (8080, 8765, 8766) are always fixed.

## Env-var injection under the Docker runtime

Under `HD_RUNTIME=docker`, the workspace env vars from the generic skill
(`VSCODE_PROXY_URI`, `ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`, `ADOM_DESKTOP_MODE`) are set in
`create_container()` in `hd-docker/src/lib.rs` when the container is created. Under WSL2 the
same contract is applied to the distro environment instead.

## Files

| File | What |
|---|---|
| `src-tauri/crates/hd-docker/src/lib.rs` | `create_container()` — container env vars under the Docker runtime |
| `src-tauri/crates/hd-control/src/ports.rs` | PortConfig load/save against `%APPDATA%\hydrogen-desktop\ports.json` |
