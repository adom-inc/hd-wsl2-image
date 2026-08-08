---
name: hydrogen-ports
description: How HD does port forwarding between your WSL2 workspace and your Windows machine — WSL2's automatic `0.0.0.0` localhost-forwarding (no Docker `-p` map), the code-server `/proxy/<port>/` URL pattern that exposes any internal port, the port-forward registry for `127.0.0.1`-only services that WSL2 won't auto-forward, and the PortMappingsDialog UI. Use when the user asks "why isn't my server reachable", "how do I expose port X", "what's localhost:7380", "register a port", "auto-forward a port", or "the dynamic port dialog". Trigger words — port forwarding, ports, hd ports, container port, proxy port, code-server proxy, /proxy/, port mappings dialog, port hints, auto forward, expose port, register port, host port, dynamic port, ports.json, PortConfig, port resolver, localhost port not working.
---

# HD Ports — forwarding workspace services to your Windows host

> This is the WSL2-runtime version (default). For the legacy Docker container
> runtime (`HD_RUNTIME=docker`) see the docker/ bucket.

The HD workspace is a WSL2 distro (`Adom-Workspace`), not a Docker container.
There is **no Docker `-p` port mapping** — WSL2 auto-forwards listeners for you.
Any service that binds `0.0.0.0:<port>` inside the distro is reachable at
`localhost:<sameport>` on Windows automatically. code-server itself binds
`0.0.0.0:7380`, so `localhost:7380` on Windows just works. For browser-facing
HTTP/WS, code-server's `/proxy/<port>/` URL pattern is still preferred and still
exposes any internal port. For the cases WSL2 auto-forward can't cover
(`127.0.0.1`-only listeners, or when auto-forward is flaky), HD's port-forward
registry creates a real host-side proxy on demand.

## The first rule: bind `0.0.0.0`

| Bind address inside distro | Reachable on Windows? |
|----------------------------|------------------------|
| `0.0.0.0:N` (all interfaces) | YES — `localhost:N` automatically |
| `127.0.0.1:N` (loopback only) | NO — WSL2 won't forward it |

So before you do anything else: **make your service bind `0.0.0.0`.** For most
dev servers that's a flag (`--host 0.0.0.0`, `vite --host`, `HOST=0.0.0.0`,
`server.address("0.0.0.0")`). Once it binds `0.0.0.0`, it auto-forwards — no
registration needed.

## The code-server proxy URL pattern

Any service listening on port N inside the distro is reachable at:

```
http://localhost:7380/proxy/N/
```

This works for HTTP services. WebSockets work too (`ws://localhost:7380/proxy/N/`).
No port mapping needed, and it works for `0.0.0.0` AND `127.0.0.1`-bound
services (code-server is inside the distro, so it reaches loopback listeners
that Windows can't). This is the preferred path for anything you open in a
browser.

Examples:
- Your dev server on port 5173 → `http://localhost:7380/proxy/5173/`
- The relay HTTP server on port 8766 → `http://localhost:7380/proxy/8766/`
- adom-vscode's API on port 8821 → `http://localhost:7380/proxy/8821/`

**This is how everything-inside-the-distro reaches everything-outside.** Inside
the distro, services that need to talk to "the host" use `127.0.0.1:<port>` —
WSL2 mirrored networking shares loopback with the Windows host — for HD's own
services (HD's live control URL is in `~/.adom/hd-control-url`), and the proxy
URL for everything else.

## The port-forward registry (for what auto-forward can't cover)

Auto-forward handles the common case. You still need the registry — HD's
port-forward registry, serviced by the port-watcher daemon (see
`hydrogen-port-watcher`) — when:

- The service binds **`127.0.0.1` only** and you can't change it (some OAuth
  callback servers, some native tools). WSL2 won't auto-forward loopback-only
  listeners; the registry creates a real host proxy that reaches them through
  code-server.
- WSL2 localhost-forwarding is **lagging or broken** for a port (a real HD
  failure mode: "code-server alive in distro but Windows can't reach
  127.0.0.1:7380"). The registry gives a reliable host-side proxy that doesn't
  depend on WSL2's forwarder.

Decision order:
1. **Bind `0.0.0.0`** → auto-forwarded, done.
2. Can't bind `0.0.0.0` (loopback-only), or auto-forward is unreliable →
   **register the port** so HD proxies it.

### Register a port (from inside your workspace)

```bash
# Tell HD: "please bind localhost:5555 on Windows and forward into the distro"
adom-cli port-forward register 5555 --name "oauth-cb" --reason "127.0.0.1-only oauth callback" --visibility external
```

Visibility options:
- `external` — bind `localhost:5555` on Windows via an HD-managed proxy AND
  keep the `/proxy/` URL working. Best for OAuth callbacks, native clients,
  loopback-only servers.
- `internal` — proxy URL only, no host binding. Best for webview panels that
  don't need a separate host port.
- `either` — let HD decide based on heuristics (defaults to external).

### Unregister
```bash
adom-cli port-forward unregister 5555
```

### List
```bash
adom-cli port-forward list
```

## The Port Mappings dialog

Open via: HD Adom menu → "Port Mappings", or `POST http://127.0.0.1:47084/setup/panel/show`
then navigate to the Ports tab. Shows:

- **Auto-forwarded ports** — `0.0.0.0` listeners WSL2 is mirroring to Windows
- **Registered ports** — anything you've registered via `port-forward register`
  (HD-managed host proxies, for loopback-only / unreliable cases)

Each row shows the direct URL (`http://localhost:<port>`) AND the proxy URL
(`http://localhost:7380/proxy/<port>/`). Click either to open in your browser
via the Browser Picker.

## HD's host-side port registry

HD reads/writes its host-side port assignments at
`%APPDATA%\hydrogen-desktop\ports.json`. The `PortConfig` struct
(`hd-control/src/ports.rs`) holds exactly four service ports —
`code_server`, `proxy`, `control`, `cdp` — plus the bind `hostname`. There are
no relay-WS / relay-HTTP host ports in `PortConfig`: under WSL2 the relay binds
**8765 (WS) / 8766 (HTTP) inside the distro**, reached at the same port on
Windows (mirrored loopback) or via `/proxy/8766/`, and discovered from
`~/.adom/cli-relay-ports.json` inside the distro. There is no host 47081/47082
listener.

Defaults (you can override via ports.json):

| Service | Default host port |
|---------|-------------------|
| code-server | 7380 |
| Discovery server | 47080 |
| Reverse proxy (`proxy`) | 47083 |
| HD control API (`control`) | 47084 |
| WebView2 CDP (`cdp`) | 47085 |
| KiCad bridge | **dynamic** (adom-bridge-cli picks at bridge launch) |
| Fusion bridge | **dynamic** (adom-bridge-cli picks at bridge launch) |
| Puppeteer bridge | **dynamic** (adom-bridge-cli picks at bridge launch) |

**Conflict resolution is NOT "next sequential port."** On startup
`PortConfig::resolve_available()` checks `proxy`, `control`, and `cdp`; if a
preferred fixed port is taken, HD binds an **ephemeral `127.0.0.1:0`** port (the
OS hands back a guaranteed-free one outside any HNS reservation) and persists it
to `ports.json`. It does **not** walk to 47086, 47087, … — HNS reserves
contiguous chunks invisible to netstat, so a walk would march into the next
reserved block. `code_server` is **exempt** and never resolved (it's tied to the
distro's mirrored port). So a busy box does NOT predictably land on
47083/47085 — the AI must discover the live ports.

**Never hardcode `127.0.0.1:9001` in distro code** — that was the old default
and has since moved. To find the real runtime ports, hit **`GET /ports`** on the
control API (default `127.0.0.1:47084`) — it returns
`{code_server, proxy, control, cdp, hostname}` straight from the resolved
`PortConfig` (`hd-app/src/lib.rs` `get_ports`). `ports.json` is the single source
of truth every consumer reads.

## Inside vs outside — which URL to use

| You're calling from | To reach a service on port N | Use |
|---------------------|------------------------------|-----|
| Distro shell / app | Another distro service | `http://localhost:N` |
| Distro app | The Windows host | `http://127.0.0.1:N` (WSL2 mirrored networking shares loopback with the host — no gateway IP, no firewall rule) |
| Windows browser | A `0.0.0.0`-bound distro service | `http://localhost:N` (auto-forwarded) |
| Windows browser | Any distro service (HTTP/WS) | `http://localhost:7380/proxy/N/` (proxy URL, preferred) |
| Windows browser | A `127.0.0.1`-only distro service | `http://localhost:N` (only after `port-forward register ... external`) |
| Distro | HD's own control API (on Windows host) | `$(cat ~/.adom/hd-control-url)` → `http://127.0.0.1:<dynamic>` (port is dynamic per launch) |

## Common bugs

**"My dev server at port 5173 doesn't load in Chrome"**
- Most likely it's bound `127.0.0.1` only. Restart it bound to `0.0.0.0`
  (e.g. `vite --host`) and it auto-forwards to `localhost:5173`.
- OR use the proxy URL: `http://localhost:7380/proxy/5173/`.
- If it IS on `0.0.0.0` but still unreachable, WSL2's forwarder may be lagging —
  register it: `adom-cli port-forward register 5173 --visibility external`.

**"OAuth callback fails with refused connection"**
- The provider is hitting `http://localhost:5555/callback` but the callback
  server is loopback-only inside the distro, so WSL2 doesn't forward it.
- Register first: `adom-cli port-forward register 5555 --visibility external --reason "oauth callback"`.
- HD auto-detects callback URLs and starts a proxy for them automatically in
  many cases (see HD log for `[oauth] Callback port X detected`), but
  registering explicitly is the reliable path.

**"`localhost:7380` shows nothing / code-server unreachable from Windows"**
- code-server is alive in the distro but WSL2 localhost-forwarding wedged (a
  real HD-logged failure mode). The port-forward registry / port-watcher
  daemon installs a host-side proxy to recover this — see `hydrogen-port-watcher`.
  Or restart HD to re-establish the forward.

## Related skills

- `hydrogen-networking` — the broader picture: `0.0.0.0` auto-forward, hostnames,
  proxy architecture, relay vs direct connect, firewall rules, NEVER do these
- `hydrogen-port-watcher` — the retained daemon that registers `127.0.0.1`-only
  listeners and covers WSL2 auto-forward gaps
- `hydrogen-container` — what's inside the workspace reachable on which port
- `hydrogen-desktop-sse` — the workspace API which runs on these ports
- `hd-browser-picker` — what happens when you click a port-mappings URL

## Bridge ports are dynamic

KiCad, Fusion 360, Puppeteer, and any 3rd-party bridges no longer have known
fixed ports. When a bridge launches, **adom-bridge-cli picks an available port at
runtime** and registers it. To find a running bridge's current port, query
adom-bridge-cli:

```bash
adom-bridge-cli status
# Look at desktop.apps.<bridge>.bridgePort
```

Or use the bridge directly via adom-bridge-cli CLI — you don't need the port at all:

```bash
adom-bridge-cli kicad_open_board '{"path":"..."}'  # adom-bridge-cli routes to the right port
adom-bridge-cli browser_eval '{"js":"..."}'
```

This means **old code or skill examples that hardcoded fixed bridge ports
(8771 / 8773 / 8851) are stale.** Use the adom-bridge-cli CLI or `status` lookup
instead.
