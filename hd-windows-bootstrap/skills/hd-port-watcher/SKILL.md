---
name: hd-port-watcher
description: >
  Dynamic port forwarding for Hydrogen Desktop. A daemon inside the WSL2
  workspace watches for new TCP listeners (OAuth callbacks from VS Code
  extensions like Codex, Copilot, GitLens) and notifies HD to create
  host-side TCP proxies. Covers the cases WSL2 auto-forward can't:
  `127.0.0.1`-only listeners and auto-forward gaps. Makes localhost:{port}
  on Windows reach the distro. Extensions just work — no manual setup.
  Trigger words: port forward, dynamic port, OAuth callback, Codex auth,
  extension auth, port mapping, localhost port, port watcher, port proxy.
---

# HD Port Watcher — Dynamic Port Forwarding

> This is the WSL2-runtime version (default). For the legacy Docker container
> runtime (`HD_RUNTIME=docker`) see the docker/ bucket.

## Why the daemon is still here under WSL2

WSL2 auto-forwards any `0.0.0.0:<port>` listener in the distro to
`localhost:<sameport>` on Windows — so you might think a port watcher is
unnecessary. It isn't. The daemon is **RETAINED** because WSL2's auto-forward
has two gaps the watcher closes:

1. **`127.0.0.1`-only listeners.** WSL2 does NOT forward loopback-only
   listeners. VS Code extensions (Codex, Copilot, GitLens) start OAuth callback
   servers that frequently bind `127.0.0.1` — the browser redirects to
   `localhost:{port}/auth/callback?code=...` but WSL2 never mirrored that port,
   so on Windows it doesn't exist.
2. **Auto-forward lag / wedge.** WSL2 localhost-forwarding can lag or break
   even for `0.0.0.0` listeners (a real HD-logged failure mode:
   "code-server alive in distro but Windows can't reach 127.0.0.1:7380"). The
   watcher gives HD a reliable host-side proxy that doesn't depend on WSL2's
   forwarder.

## The Solution

A lightweight daemon inside the distro monitors `/proc/net/tcp` for new
listening ports. When one appears (that wasn't there at boot and isn't a known
service), it notifies HD's control API. HD creates a host-side TCP proxy on
that same port, forwarding through code-server's `/proxy/{port}` to reach the
distro. The browser redirect just works — even for loopback-only callback
servers WSL2 wouldn't have forwarded.

## Architecture

```
WSL2 distro (Adom-Workspace):       Windows Host:
┌─────────────────────┐            ┌──────────────────────┐
│ Codex creates server │           │ HD Control API       │
│ on 127.0.0.1:1455    │           │ (:47084)             │
│ (WSL2 won't forward) │           │                      │
│ port-watcher.sh      │──POST──→ │ /port-forward        │
│ detects port 1455    │  open     │ creates TCP proxy    │
│                      │           │ on localhost:1455     │
│ code-server          │           │                      │
│ /proxy/1455/ ←───────┼───────── │ proxy forwards here  │
└─────────────────────┘            └──────────────────────┘
                                          ↑
                                   Browser redirects to
                                   localhost:1455/callback
```

## What Gets Forwarded (and what doesn't)

**FORWARDED (temporary, appeared after boot):**
- OAuth callback ports from extensions (Codex, Copilot, etc.) — especially
  `127.0.0.1`-only ones WSL2 cannot auto-forward
- Any new TCP listener that wasn't running when the distro started
- Auto-expires after 5 minutes (OAuth callbacks are fast)

**NOT FORWARDED (known services, stay behind /proxy/{port} or auto-forward):**
- code-server (8080 inside distro; auto-forwarded as 7380 mapping/`0.0.0.0`)
- relay WS/HTTP (8765, 8766)
- adom-vscode (8821)
- shotlog (8820)
- Any port in the KNOWN_PORTS list
- Any port that was listening at distro boot time
- Any port ≤ 1023

This keeps the local WSL workspace behaving like cloud Hydrogen — known
services use `/proxy/{port}` (or WSL2 auto-forward for `0.0.0.0` binds), and
only short-lived / loopback-only OAuth ports get a dedicated host proxy.

## API Endpoints

### POST /port-forward
Create or remove a host-side TCP proxy. Called by the distro's watcher.

```json
{"port": 1455, "action": "open"}   // Create proxy
{"port": 1455, "action": "close"}  // Remove proxy
```

### GET /port-forward
List currently forwarded ports.

```json
{"ok": true, "forwarded_ports": [1455], "count": 1}
```

## The Watcher Daemon

`scripts/port-watcher.sh` runs inside the distro:

1. Polls `/proc/net/tcp` every 2 seconds
2. Diffs against previous scan
3. New port (not in KNOWN_PORTS whitelist) → POST `/port-forward` open
4. Port gone → POST `/port-forward` close
5. Port open > 5 minutes → auto-expire (likely a service, not OAuth)

No boot snapshot — the whitelist is the sole source of truth. Services
like shotlog can start at any time (days/weeks later) and will never
get a host proxy as long as their port is in the whitelist.

The watcher reaches HD at `127.0.0.1:<control>/port-forward` — WSL2 mirrored
networking shares loopback with the Windows host, so `127.0.0.1` from inside the
distro reaches HD's host listener. The control port is dynamic per launch; the
live control URL is in `~/.adom/hd-control-url`.

## Installation

The watcher is a bash script (`port-watcher.sh`) deployed into the distro
during setup steps. Installation uses `wsl -d Adom-Workspace`, NOT
`docker cp`/`docker exec`:

```bash
# Copy the script into the distro (from Windows host, via the \\wsl$ share or wsl cat)
wsl -d Adom-Workspace -u root -- bash -c 'cat > /usr/local/bin/port-watcher.sh' < port-watcher.sh
wsl -d Adom-Workspace -u root -- chmod +x /usr/local/bin/port-watcher.sh
# Launch detached inside the distro
wsl -d Adom-Workspace -u adom -- bash -c 'nohup bash /usr/local/bin/port-watcher.sh >/tmp/port-watcher.log 2>&1 &'
```

The script parses `/proc/net/tcp` directly in `awk` — it filters listener rows
(state `0A`), splits the hex `local_address`, and converts the port with
`strtonum("0x" …)`. No Python is involved.

## UI: Toast + Port Mappings Dialog

**Toast notification:** When a port is forwarded, HD shows an info toast:
"Port 1455 forwarded to workspace". When removed: "Port 1455 forwarding stopped".
Powered by the `port-forward-changed` Tauri event.

**Port Mappings dialog:** Accessible from the Adom menu → Admin → "Port Mappings".
Shows auto-forwarded `0.0.0.0` ports AND dynamic watcher-created proxies. Dynamic
ports have a "Stop" button. Matches the API Explorer visual style.

## Adding New Known Services

When a new service is added to the distro that runs a persistent TCP server,
add its port to the `KNOWN_PORTS` whitelist string in `port-watcher.sh`
(`scripts/port-watcher.sh:16`):

```bash
KNOWN_PORTS="8080 8765 8766 8821 8820 36035 47084 47083 47085 1420 7380 8770 9000"
```

This prevents it from getting a dedicated host proxy. Services should bind
`0.0.0.0` (auto-forwarded) or use `/proxy/{port}` instead, consistent with web
Hydrogen.

## Why Both Layers

There are TWO distinct forwarding mechanisms. The `/proc/net/tcp` watcher above
is **Layer 2**. Layer 1 is a completely separate path — the OAuth-callback
**localhost proxy** baked into HD itself — and it's why VS Code extension logins
"just work" without any watcher round-trip.

### Layer 1 — the OAuth-callback localhost proxy (zero-latency, the primary path)

HD intercepts top-level WebView2 navigations via
`setup_frame_navigation_interception()` (`hd-app/src/lib.rs:75`). On every
navigation it runs `extract_oauth_callback_port()` (`lib.rs:384`), which
**triple-URL-decodes** the target URL (`urlencoding::decode` x3) and scans each
decode layer — plus the raw and the percent-encoded
`redirect_uri=http%3A%2F%2Flocalhost%3A…` form — for
`redirect_uri=http://localhost:<port>`. When it finds one, it calls
`start_oauth_callback_proxy(port)` (`lib.rs:411`), which **pre-binds**
`127.0.0.1:<port>` on the Windows host (via `hd_control::reuse_bind_tcp`) and
waits up to ~5 min for one inbound request. When the browser redirects to
`localhost:<port>/callback?code=…`, HD's pre-bound listener accepts it and
forwards the full path into the distro via code-server:
`http://localhost:<code_server_port>/proxy/<port>/<path>` (`lib.rs:454`), then
streams code-server's response back to the browser.

So the callback port is bound the *instant* the OAuth URL is seen leaving the
WebView — before the provider ever redirects — which is why Codex / Copilot
OAuth completes with zero manual setup and zero watcher latency.

**Control / callback endpoints** (HD control API, port 47084):
- `POST /start-oauth-proxy` — manually pre-bind a callback port (same effect as
  the navigation interceptor; used by the manual fallback).
- `GET /oauth/callback` — HD's own built-in callback receiver (used by the
  Claude Code PKCE flow); do not call directly.

**Failure mode the AI may see:** if the proxy binds but code-server can't be
reached, HD returns a styled **502 Bad Gateway** page (dark `#0d1117`
background, teal `#00b8b0` "OAuth callback proxy" heading) reading roughly *"HD
tried to forward this OAuth callback to the container via code-server proxy
(port …/proxy/…), but it failed. The extension that started this OAuth flow may
need its callback port (…) mapped to the host."* Seeing that page in a browser
means Layer 1 fired but the distro-side proxy hop failed — check the HD log for
`[oauth-proxy]` lines and that code-server is alive.

### Layer 2 — the port watcher (`/proc/net/tcp` daemon, the safety net)

The bash daemon documented above. Safety net for extensions that open OAuth
URLs through mechanisms that bypass top-level WebView navigations, AND the only
thing that surfaces `127.0.0.1`-only callback servers WSL2 silently won't
forward. Note: when an app has already registered its port via the
adom-port-hints protocol, the watcher skips it (it only owns the fallback for
third-party extensions that don't know HD exists).

### Layer 3 — manual

`POST /start-oauth-proxy` or `POST /port-forward` (or
`adom-cli port-forward register`) for cases where both automatic layers miss.

## Port Conflicts

If the host port is already taken by another Windows app, the forwarding
fails silently. The OAuth callback will break. Mitigation: extensions
typically pick a different random port on retry. HD logs the conflict.

## How OAuth Callbacks Work End-to-End

1. Extension (Codex) starts HTTP server on `127.0.0.1:1455` inside the distro
2. port-watcher.sh detects port 1455 (not in boot snapshot, not known) —
   note WSL2 would NOT have auto-forwarded this loopback-only listener
3. Watcher POSTs `{"port":1455,"action":"open"}` to HD
4. HD creates TCP proxy: `localhost:1455` → code-server `/proxy/1455/`
5. Extension opens browser with `redirect_uri=http://localhost:1455/callback`
6. User authenticates, browser redirects to `localhost:1455/callback?code=...`
7. HD's proxy receives the request, forwards into the distro via code-server
8. Extension receives callback, completes auth
9. Extension closes its server, port 1455 disappears
10. Watcher POSTs `{"port":1455,"action":"close"}`, HD removes proxy

## Debugging

All debugging runs inside the distro via `wsl -d Adom-Workspace -u adom -- ...`,
NEVER `docker exec`:

```bash
# Check what ports the watcher sees
wsl -d Adom-Workspace -u adom -- bash -c "cat /proc/net/tcp | awk '\$4 == \"0A\" { split(\$2, a, \":\"); printf \"%d\\n\", strtonum(\"0x\" a[2]) }' | sort -n"

# Check the watcher's own log
wsl -d Adom-Workspace -u adom -- cat /tmp/port-watcher.log

# Check what HD has forwarded (from Windows host)
curl -sf http://127.0.0.1:47084/port-forward

# Manually forward a port (for testing, from Windows host)
curl -sf -X POST http://127.0.0.1:47084/port-forward \
  -H Content-Type:application/json \
  -d '{"port":1455,"action":"open"}'

# Check HD log for port-fwd events
# Look for [port-fwd] entries
```

## Related skills

- `hd-networking` — `0.0.0.0` auto-forward, reaching the host at `127.0.0.1`
  (mirrored networking / loopback), NEVER do these
- `hd-ports` — bind `0.0.0.0` first; fall back to the port-forward registry for
  `127.0.0.1`-only services or unreliable auto-forward
