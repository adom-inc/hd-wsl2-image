---
name: hydrogen-desktop-sse
description: How HD's local workspace API + SSE works (a.k.a. the workspace API) — replaces Carbon for workspace commands so the workspace's adom-cli controls HD, not cloud Hydrogen. Covers the full pipeline, routing, env vars, field format differences, port discovery, and hard-won lessons. Trigger words — HD SSE, workspace API, local API, adom-cli workspace, add-tab, move-tab, webview tab, EventSource, workspace_updated, ADOM_CARBON_URL, ADOM_HYDROGEN_URL, discovery port.
---

# Hydrogen Desktop — Local Workspace API + SSE

> Platform note: HD runs the same local workspace API on every platform (Windows/WSL2,
> macOS, Linux). For the WSL2-specific networking details (mirrored loopback,
> `%APPDATA%\hydrogen-desktop\ports.json`, the `HD_RUNTIME=docker` runtime, relay
> same-port behavior), see **[[hydrogen-desktop-sse-windows]]**.

## Architecture

```
Workspace adom-cli (the local workspace)
    → http://127.0.0.1:47083 (HD's proxy)
    → HD handles workspace commands locally + broadcasts SSE
    → HD frontend receives SSE, re-fetches workspace, renders

Cloud adom-cli (unchanged)
    → carbon.adom.inc → Hydrogen web
```

HD runs its own workspace API on port 47083 (reverse proxy, default — see PortConfig) so the workspace's adom-cli controls HD's UI, not cloud Hydrogen. No cross-talk between environments. The workspace reaches HD at `127.0.0.1:47083`.

## Port 47083 routing (the hd-proxy / reverse-proxy)

All requests hit port 47083 (reverse proxy, default — see PortConfig). The router in `handle_request()` decides:

| Path pattern | Handler | Where |
|---|---|---|
| `/api/workspaces/editor/{owner}/{repo}/current/*` | Local workspace API | In-memory |
| `/api/panels/webview/*`, `/api/panels/sandbox/*` | Local panel API | SSE broadcast |
| `/containers/*` | Local container discovery | Canned response |
| `/proxy/{port}/{path}` | Workspace proxy | TCP forward to the workspace |
| Everything else (`/api/*`, etc.) | Carbon proxy | HTTPS to carbon.adom.inc |

The dev file server on port 1420 forwards `/api/*` directly to `handle_request()` (same function, not TCP — supports SSE streaming via BoxBody).

## SSE Connection

**Endpoint:** `GET /api/workspaces/editor/{owner}/{repo}/current/events`

Uses `tokio::sync::broadcast` channel. On connect sends `{"type":"connected","connectionId":"hd-local"}`. Workspace mutations broadcast `{"type":"workspace_updated"}`.

**Frontend connects** in `PanelWorkspaceComponent.svelte` → `setupSSE()`. In Tauri mode, `$page.params` may be empty (adapter-static), so it falls back to `owner=local, repo=workspace`.

**Critical lesson:** The `onopen` handler PUTs the workspace state. This broadcasts `workspace_updated`, which the frontend re-fetches. Set `skipNextSSESync = true` before the PUT to prevent the feedback loop that kills the connection.

## Container Discovery

adom-cli calls `/containers/{slug}` to get owner/repo. The slug comes from parsing `VSCODE_PROXY_URI`'s hostname — split on `-`, take the LAST segment.

**Response format** (must match Carbon's exactly):
```json
{
  "repository": {
    "owner": { "name": "jlauer12" },
    "name": "workspace"
  },
  "slug": "hdlocal",
  "status": "running"
}
```

NOT `{"owner": "jlauer12", "repository": "workspace"}` — adom-cli reads `container["repository"]["owner"]["name"]`.

## Workspace Env Vars

Set when the workspace is created:

| Var | Value | Why |
|---|---|---|
| `VSCODE_PROXY_URI` | `http://hd-hdlocal/proxy/{{port}}/` | Slug = `hdlocal` (last segment after `-`) |
| `ADOM_CARBON_URL` | `http://127.0.0.1:47083` | Container discovery + non-workspace API |
| `ADOM_HYDROGEN_URL` | `http://127.0.0.1:47083` | Workspace mutations (adom-cli sends these HERE, not to Carbon) |
| `ADOM_DESKTOP_MODE` | `local` | Tells adom-cli it's a local environment |

`127.0.0.1` reaches HD on the host from inside the workspace. The canonical code-server port HD exposes on the host is 7380.

**Also set in adom-cli config** (persists across sessions):
```bash
adom-cli config set-url http://127.0.0.1:47083
adom-cli config set-token <session-token>
```
Plus manually write `hydrogen_url` to `~/.config/adom-cli/config.json` (no CLI command for it).

**API key** injected at `/var/run/adom/api-key` by bootstrap via `GET "$(cat ~/.adom/hd-control-url)/auth-token"` (the control URL is `http://127.0.0.1:<dynamic>`).

## Workspace Tree Format

The frontend serializes splits with `first`/`second`, NOT `children`:
```json
{
  "type": "split",
  "id": "desktop-root-split",
  "direction": "horizontal",
  "ratio": 0.5,
  "first": { "type": "leaf", "id": "pane-left", ... },
  "second": { "type": "leaf", "id": "pane-right", ... }
}
```

All tree traversal functions (`find_leaf_path`, `find_split_path`, `resolve_path`) must handle BOTH `children` array and `first`/`second` keys.

## REST Endpoint Field Names (adom-cli vs HD)

adom-cli sends different field names than you might expect:

| Endpoint | adom-cli sends | HD must read |
|---|---|---|
| POST /tabs | `{panelId, panelType, displayName, initialState}` | Construct tab with UUID, merge initialState into panelState |
| POST /moves | `{sourcePanelId, tabId, targetPanelId}` | NOT `sourcePanel`/`targetPanel` |
| DELETE /tabs | `{panelId, tabId}` or `{name}` | Support both |

## Smoke Test (from inside the workspace)

```bash
# 1. Probe — confirms SSE alive
adom-cli hydrogen probe
# → browser_connected: true, sse_connections: 1

# 2. Get workspace
adom-cli hydrogen workspace get

# 3. Add tab
adom-cli hydrogen workspace add-tab \
  --panel-id desktop-pane-right \
  --panel-type adom/a1b2c3d4-0031-4000-a000-000000000031 \
  --display-name "Test Page" \
  --initial-state '{"url":"https://wiki-ufypy5dpx93o.adom.cloud/apps/shotlog"}'

# 4. Move tab
adom-cli hydrogen workspace move-tab \
  --from-panel-id desktop-pane-right \
  --tab-id <tab-id-from-step-3> \
  --to-panel-id desktop-pane-left

# 5. Screenshot to verify
adom-desktop hd_screenshot
```

## What Broke and Why

### SSE never connected on fresh launch
`setupSSE()` checks `$page.params.owner` and `$page.params.repo`. In Tauri mode with adapter-static, these are empty. **Fix:** fall back to `owner=local, repo=workspace` when in Tauri mode.

### SSE connected then immediately disconnected
The `onopen` handler PUTs workspace state → broadcasts `workspace_updated` → frontend re-fetches → gets the state it just PUT → re-applies → triggers autosave → another PUT → loop. **Fix:** set `skipNextSSESync = true` before the `onopen` PUT.

### adom-cli "Could not get owner from container info"
Three stacked issues:
1. `VSCODE_PROXY_URI` was `http://localhost:8080/...` → slug parsed as `8080` → called `/containers/8080` → Carbon 404
2. Container info response had flat `{"owner": "..."}` but adom-cli reads `container["repository"]["owner"]["name"]`
3. `ADOM_HYDROGEN_URL` wasn't set → workspace commands went to `hydrogen.adom.inc` instead of HD

### add-tab returned "Missing 'tab' in body"
HD expected `{"panelId", "tab": {id, panelType, panelState}}` but adom-cli sends `{"panelId", "panelType", "displayName", "initialState"}` — flat format. **Fix:** accept both, construct tab with UUID for the flat format.

### move-tab returned "Source/target panel not found"
Two issues:
1. Handler read `sourcePanel`/`targetPanel` but adom-cli sends `sourcePanelId`/`targetPanelId`
2. `find_leaf_path` only traversed `children` array, not `first`/`second` keys

### Webview tabs were blank + opened in native browser
`add_FrameNavigationStarting` was blocking ALL external URLs in child iframes, including legitimate webview panel content. **Fix:** stop blocking frame navigations entirely — webview panels need external URLs. URL interception for window.open still works via `on_new_window`.

### Google showed "blocked" icon
Not an HD bug. Google sends `X-Frame-Options: SAMEORIGIN` which prevents iframe embedding. Sites that allow embedding (adom.inc, wiki) load fine.

## Port Discovery — How Any Client Finds HD

All HD ports are dynamic (configurable via `ports.json`). The ONE constant is the **discovery port: 47080**. It never changes.

```
GET http://127.0.0.1:47080/discover
```

Returns:
```json
{
  "ok": true,
  "code_server": 7380,
  "proxy": 47083,
  "control": 47084,
  "cdp": 47085,
  "hostname": "hd.localhost"
}
```

> **Relay ports:** clients discover the relay ports from `~/.adom/cli-relay-ports.json`
> (fallback 8765/8766), not from `/discover`. Relay port mapping/exposure varies by
> platform — see **[[hydrogen-desktop-sse-windows]]**.

### Who uses it

| Client | What it discovers | How |
|---|---|---|
| adom-desktop relay | Control API port (was hardcoded 9001) | `curl :47080/discover` → use `control` field |
| adom-cli in the workspace | Proxy + Hydrogen URL | Already set via `ADOM_CARBON_URL` env var at workspace creation |
| External tools / diagnostics | Any port | Hit discovery, get the full map |
| Cloud Docker (this container) | All HD ports | `curl http://<desktop-ip>:47080/discover` via relay |

### Implementation

Tiny `std::net::TcpListener` on port 47080 in `hd-app/src/lib.rs`. Runs on a plain OS thread (no tokio). Reads `get_runtime_ports()` on each request. Returns raw HTTP response with JSON body.

```rust
std::thread::spawn(move || {
    let listener = std::net::TcpListener::bind("127.0.0.1:47080").unwrap();
    for stream in listener.incoming() {
        let ports = hd_control::get_runtime_ports();
        let body = serde_json::json!({ "ok": true, ...ports });
        // write HTTP/1.1 200 OK + JSON
    }
});
```

### Port defaults (PortConfig)

| Service | Default Port | User-visible? | Workspace Port |
|---|---|---|---|
| Discovery | **47080** (FIXED) | No | n/a |
| Code-server | 7380 | Yes (in webview URLs) | 8080 |
| Proxy | 47083 | No | n/a |
| Control API | 47084 | No | n/a |
| CDP | 47085 | No | n/a |
| Relay WS | (platform-dependent) | No | 8765 |
| Relay HTTP | (platform-dependent) | No | 8766 |

On first launch, defaults are written without scanning. Workspace-side ports (8080, 8765, 8766) are always fixed — only host-side ports are dynamic. The `ports.json` location and relay host mapping are platform-specific — see **[[hydrogen-desktop-sse-windows]]**.

## Files

| File | What |
|---|---|
| `src-tauri/crates/hd-proxy/src/lib.rs` | Workspace API, SSE, Carbon proxy, tree mutations (~1500 lines) |
| `src-tauri/crates/hd-docker/src/lib.rs` | Container env vars (CARBON_URL, HYDROGEN_URL, VSCODE_PROXY_URI) |
| `src-tauri/crates/hd-control/src/lib.rs` | `/auth-token` endpoint, `/ports` endpoint, `/setup/*` routes |
| `src-tauri/crates/hd-control/src/ports.rs` | PortConfig struct, load/save/resolve, DISCOVERY_PORT constant |
| `src-tauri/crates/hd-app/src/lib.rs` | Discovery server on :47080, port resolution at startup |
| `src/lib/stores/portStore.ts` | Frontend Svelte store, `initPorts()`, `controlUrl()`, `codeServerUrl()` |
| `src/lib/components/editor/workspaces/PanelWorkspaceComponent.svelte` | Frontend SSE setup, autosave, workspace re-fetch |
| `scripts/hd-bootstrap.sh` | Sets adom-cli config, injects API key, uses `HD_CONTROL_PORT` env var |
