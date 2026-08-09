---
name: hydrogen-networking
description: >
  Port architecture, hostnames, and networking rules for Hydrogen.
  MUST READ before adding ports, exposing a service to your Windows host,
  referencing host URLs from inside the workspace, or wiring any service
  communication.
  Trigger words — Hydrogen port, Hydrogen network, port mapping, proxy, 127.0.0.1, loopback,
  mirrored networking, hydrogen-control-url,
  VSCODE_PROXY_URI, relay URL, code-server proxy, container networking,
  ADOM_CARBON_URL, ADOM_HYDROGEN_URL, direct connect, 8770, 7380.
---

# Hydrogen — Networking & Port Architecture

> This is the WSL2-runtime version (default). For the legacy Docker container
> runtime (`HD_RUNTIME=docker`) see the docker/ bucket.

## Core Principle: WSL2 auto-forwards `0.0.0.0` listeners

The Hydrogen workspace is a WSL2 distro (`Adom-Workspace`), not a Docker container.
WSL2 has a built-in localhost-forwarding feature: **any service that binds
`0.0.0.0:<port>` inside the distro is automatically reachable at
`127.0.0.1:<sameport>` on Windows** — no Docker `-p` mapping, no proxy hop
required. There is no port-mapping table to maintain; the port number is the
same on both sides.

The two corollaries that drive everything below:
- **Bind `0.0.0.0`, not `127.0.0.1`.** WSL2 does NOT auto-forward a
  `127.0.0.1`-only listener — Windows can't see it. A distro service that
  binds loopback-only is invisible to the host until you route it explicitly
  (see `hydrogen-port-watcher`).
- **There are NO Docker port mappings.** code-server binds `0.0.0.0:7380`
  inside the distro and is therefore reachable at `localhost:7380` on Windows
  automatically. Same for a dev server on `0.0.0.0:5173` → `localhost:5173`.

## In-distro services (no port mapping needed)

| Distro Port | Service | Reachable on Windows at |
|-------------|---------|-------------------------|
| 7380 | code-server (VS Code) | `localhost:7380` (auto-forwarded) |
| 8765 | relay WS | bind `0.0.0.0` → `localhost:8765`, or `/proxy/8765/` |
| 8766 | relay HTTP | bind `0.0.0.0` → `localhost:8766`, or `/proxy/8766/` |
| 5173 | your dev server | bind `0.0.0.0` → `localhost:5173` |

All of these are also reachable through code-server's `/proxy/<port>/` URL
(see below), which remains the preferred path for browser-facing HTTP/WS.

## Host-Side Ports (Tauri app, native Windows listeners)

These ports run on the Windows host inside the Hydrogen Tauri process. They are
native TCP listeners on Windows — not inside the distro.

| Port | Service | Notes |
|------|---------|-------|
| 1420 | Dev file server | Dev mode only, serves `build/` |
| 8770 | adom-bridge-cli direct connect | Owned by Adom Bridge, NOT Hydrogen |
| 47080 | Hydrogen discovery server | |
| 47083 | Hydrogen reverse proxy | Proxies to code-server |
| 47084 | Hydrogen control API | Health, setup, eval, CDP, `/wsl/status`, `/port-forward` |
| 47085 | WebView2 CDP | Chrome DevTools Protocol |

These are configurable via `%APPDATA%\hydrogen-desktop\ports.json`.

**Reaching a host service FROM the distro:** just use `127.0.0.1:<port>`. WSL2
**mirrored networking** shares the loopback interface between the distro and the
Windows host, so a Windows listener on `127.0.0.1:<port>` is reachable at the same
`127.0.0.1:<port>` from inside the distro — no gateway IP, no firewall rule, no
`0.0.0.0` requirement on the host side. (`host.docker.internal` is a Docker-ism Hydrogen
does NOT use under WSL2 — inside the distro it resolves to a *different* interface,
not where Hydrogen listens, so curls to it fail.)

## Hostnames — reach the host at `127.0.0.1`

### From inside the distro → host machine
```
127.0.0.1
```
WSL2 mirrored networking shares loopback with the Windows host, so `127.0.0.1`
inside the distro reaches Windows host listeners directly. The distro's
`/etc/hosts` also has `127.0.0.1 adom-host` (the non-Docker alias → loopback), but
you generally don't need it — use `127.0.0.1`. Used for:
- `ADOM_CARBON_URL=http://127.0.0.1:{proxy_port}`
- `ADOM_HYDROGEN_URL=http://127.0.0.1:{proxy_port}`
- Direct connect probe: `http://127.0.0.1:8770/health`
- Hydrogen control API: the live URL in `~/.adom/hydrogen-control-url` (`http://127.0.0.1:<dynamic>`)

The control port is **dynamic per launch** — read it from `~/.adom/hydrogen-control-url`
(your non-interactive Bash shells don't source `.bashrc`/`profile.d`, so the env var
alone is unreliable): `BASE="$(cat ~/.adom/hydrogen-control-url)"`.

### From the host → distro services (via proxy)
```
http://127.0.0.1:{code_server_port}/proxy/{distro_port}/
ws://127.0.0.1:{code_server_port}/proxy/{distro_port}/
```
Example: relay health → `http://127.0.0.1:7380/proxy/8766/health`
Example: relay WS → `ws://127.0.0.1:7380/proxy/8765/`

This path always works for `0.0.0.0` AND `127.0.0.1`-bound distro services,
because code-server itself is inside the distro and proxies to them locally.
It is the preferred path for browser-facing HTTP/WS even though direct
auto-forward also works for `0.0.0.0` listeners.

### From the host → host-side services
```
http://127.0.0.1:{port}/
```
Control API → `http://127.0.0.1:47084/health`
Direct connect → `http://127.0.0.1:8770/health`

## Relay Architecture

The relay (`adom-bridge-cli serve`) runs inside the distro on ports 8765
(WebSocket) and 8766 (HTTP). It binds `0.0.0.0`, so it is reachable both via
WSL2 auto-forward (`localhost:8765` / `localhost:8766` on Windows) and via the
code-server proxy. The proxy path is preferred for connection stability:

1. **adom-bridge-cli on Windows** connects as a WS client via the
   code-server proxy: `ws://127.0.0.1:7380/proxy/8765/`
2. **Registration** happens via `server_add` on the direct connect
   API (port 8770):
   ```json
   {
     "name": "Hydrogen Local WSL",
     "url": "ws://127.0.0.1:7380/proxy/8765/",
     "autoConnect": true
   }
   ```
3. **Health checks** use the proxy path:
   `http://127.0.0.1:7380/proxy/8766/health`

This matches cloud containers where adom-bridge-cli connects via
`wss://<slug>.adom.cloud/proxy/8765/`.

## VSCODE_PROXY_URI

Inside the distro, `VSCODE_PROXY_URI` is set by code-server:
```
https://<slug>.adom.cloud/proxy/{{port}}/     (cloud)
http://localhost:7380/proxy/{{port}}/          (Hydrogen local, approximate)
```

Tools that build proxy URLs should use `VSCODE_PROXY_URI` when
available, falling back to `http://127.0.0.1:{code_server}/proxy/{port}/`.

## In-distro command form

The workspace is a WSL2 distro, so you reach it with `wsl`, NEVER `docker exec`:
```bash
wsl -d Adom-Workspace -u adom -- <cmd>
# or, since the distro boots as root:
wsl -d Adom-Workspace -- su - adom -c '<cmd>'
```

## NEVER Do These

1. **NEVER bind `127.0.0.1`-only** for a service that must be reachable from
   Windows. WSL2 won't auto-forward it. Bind `0.0.0.0`, or register it with the
   port-forward registry (see `hydrogen-port-watcher`).
2. **NEVER use `host.docker.internal` for distro→host** communication — it's a
   Docker-ism Hydrogen doesn't use; inside the distro it resolves to the wrong interface.
   Reach the host at `127.0.0.1` (WSL2 mirrored networking shares loopback); read
   Hydrogen's live control URL from `~/.adom/hydrogen-control-url`.
3. **NEVER assume you need a firewall rule or gateway IP to reach the host.**
   Under WSL2 mirrored networking the host's `127.0.0.1` listeners are shared with
   the distro's loopback — `127.0.0.1:<port>` just works, no firewall allow needed.
4. **NEVER `docker exec` / `docker cp` against the workspace.** It's a WSL2
   distro; use `wsl -d Adom-Workspace`.
5. **NEVER hardcode port numbers** in distro code. Read from env vars
   (`ADOM_CARBON_URL`, `ADOM_HYDROGEN_URL`) or discover via the direct
   connect API.
6. **NEVER assume adom-bridge-cli direct connect (8770) is owned by Hydrogen.**
   It's owned by Adom Bridge. Hydrogen's direct-api thread binds to 8770
   as a fallback but Adom Bridge takes priority when both are running.
