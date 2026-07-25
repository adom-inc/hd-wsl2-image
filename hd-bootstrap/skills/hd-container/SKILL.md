---
name: hd-container
description: Context for Claude Code running inside a Hydrogen Desktop workspace. Documents the exact OS (Ubuntu 24.04, code-server, the local workspace), explains how setup differs from Adom cloud containers (HD setup-steps NOT bootstrap.sh), what bridges are available, and how to use the relay. Trigger on startup, adom-cli errors, bridge commands, screenshot requests, container-platform questions, code-server / VS Code extension issues, or when the AI needs concrete facts about its environment instead of guessing.
---

# Hydrogen Desktop Workspace

You are running inside the **local workspace** managed by Hydrogen Desktop (HD). HD is the flagship Adom desktop app — it manages your workspace, bridges to desktop apps, and provides VS Code + Claude Code. HD runs on Windows, macOS, and Ubuntu; the platform-specific mechanics of how the workspace is hosted are abstracted away from inside the workspace — the facts below hold regardless of host OS.

> Platform layers add a `*-windows` companion to this skill (`[[hd-container-windows]]`) with the host-specific spine — the WSL2 `Adom-Workspace` distro, `wsl --import`, code-server port auto-forward, the runtime source, and the Cloud-vs-local comparison table.

## The workspace — exact facts (don't guess)

| Field | Value |
|-------|-------|
| Provisioned from | a pre-baked golden image (full image, not bootstrapped from scratch) |
| Base | Ubuntu 24.04 |
| Architecture | matches host (`dpkg --print-architecture`) — `linux-x64` or `linux-arm64` |
| code-server | pinned via the golden image |
| code-server binary | `/usr/lib/code-server/bin/code-server` |
| Extensions dir | `~/.local/share/code-server/extensions/` |
| Settings | `~/.local/share/code-server/User/settings.json` |
| Work user | `adom` (passwordless sudo, home `/home/adom`) |
| Workspace | `/home/adom/project` |
| Pre-installed | Node 18 + npm, Python 3.12, git, gh, curl, wget, jq, build-essential, cmake, pkg-config, libssl-dev |
| Code-server runs as | `code-server --bind-addr 0.0.0.0:7380 --auth none --disable-telemetry /home/adom/project` |

If you ever need to confirm: `cat /etc/os-release`, `uname -m`, `/usr/lib/code-server/bin/code-server --version`. Don't speculate about alpine/arm64 — Ubuntu 24.04 matches the cloud container.

## Setup is via HD's setup-steps, NOT gallia bootstrap.sh

HD provisions this workspace through its own **setup-steps** flow, shown as the "Install Tools" panel in the HD UI. It is a **different code path** than cloud containers, which run `gallia/scripts/bootstrap.sh`.

Most tooling is NOT installed by a step — it's BAKED into the golden image at image-build time (gallia, the Adom CLIs, the claude CLI + Code extension, code-server, VS Code settings, and all `hd-*` skills). The provisioning step imports the golden image if the workspace isn't already registered, and the relay is started by the `start-relay` step. See `[[hd-setup-steps]]`.

When debugging install issues here, the source of truth is HD's setup-steps code — its step IDs (`ensure-workspace`, `install-adom-vscode`, `set-env-vars`, `inject-api-key`, `start-relay`, `claude-auth`, etc.) map 1:1 to what ran on this workspace. There is NO `install-claude-ext` / `install-claude-cli` / `install-gallia` / `write-vscode-settings` step — those are baked. Do NOT chase bugs into `bootstrap.sh` — that script lives in the baked image but HD itself never invokes it.

## VS Code extension caveats

- The Claude Code extension and `code-server` settings (including `extensions.autoUpdate: true` / `extensions.autoCheckUpdates: true`) are BAKED into the golden image — there is no `write-vscode-settings` or `install-claude-ext` setup step. Auto-update **must** stay on so every installed extension auto-updates from the marketplace; the image bakes it on. Do not regress this.
- Bare `code-server --install-extension <id>` (no version pin) historically resolves to the **universal** target-platform build. For some extensions (notably `anthropic.claude-code` after 2.1.89), Anthropic stopped shipping universal builds — so bare install permanently sticks at 2.1.89 even when newer per-arch builds exist. The golden-image bake installs the latest per-arch build pinned, so the workspace ships current. It also heals orphan `extensions.json` entries (entries pointing to deleted dirs cause a permanent "Invalid extensions detected" banner).
- Marketplace: code-server uses **Open VSX** (open-vsx.org), not Microsoft Marketplace. No `EXTENSIONS_GALLERY` env override is set; `product.json` has no gallery URL — it falls through to Open VSX defaults.

## adom-cli is authenticated

HD auto-injects the user's session token on every launch. To verify:
```bash
adom-cli carbon user get
```
If this returns user data, all adom-cli commands work (containers, repos, orgs, wiki, etc.). If it fails, the user needs to log in via HD's login page.

## Relay server is running

The adom-desktop relay runs on ports 8765 (WebSocket) / 8766 (HTTP) inside this workspace. The `start-relay` setup step launches it.

Check health: `curl -sf http://127.0.0.1:8766/health`
Check desktop connection: `adom-desktop ping`

The host control API is reachable from inside the workspace at `127.0.0.1`. The port is dynamic per launch, so read the live URL from `~/.adom/hd-control-url` (`http://127.0.0.1:<dynamic>`): `BASE="$(cat ~/.adom/hd-control-url)"; curl "$BASE/health"`.

## Available bridge commands (when desktop is connected)

### Screenshots (zero dialogs, instant)
```bash
adom-desktop desktop_screenshot_screen                    # full screen capture
adom-desktop desktop_screenshot_screen '{"maxWidth":1500}' # resized for Claude vision
adom-desktop desktop_screenshot_window '{"hwnd": N}'       # capture specific window
adom-desktop desktop_list_windows                          # list all windows with handles
```
Default to `maxWidth: 1500, format: "png"` for UI screenshots. Use `"jpeg"` for natural photos, `"webp"` for smaller files.

### Browser automation (Puppeteer)
```bash
adom-desktop browser_open_window '{"url": "https://..."}'
adom-desktop browser_screenshot '{"sessionId": "default"}'
adom-desktop browser_eval '{"js": "document.title"}'
adom-desktop browser_navigate '{"url": "..."}'
```

### KiCad bridge
```bash
adom-desktop kicad_open_board '{"path": "/path/to/board.kicad_pcb"}'
adom-desktop kicad_screenshot_all
adom-desktop kicad_run_drc '{"path": "..."}'
adom-desktop kicad_window_info
```
(Paths to host files use the host's native path convention.)

### Fusion 360 bridge
```bash
adom-desktop fusion_start
adom-desktop fusion_import_step '{"path": "..."}'
adom-desktop fusion_export_step '{"path": "..."}'
```

### File transfer
```bash
adom-desktop send_files '{"files": [{"path": "/home/adom/file.txt"}]}'
adom-desktop pull_file '{"remotePath": "<host path>", "localPath": "/tmp/file.txt"}'
```

### Desktop interaction
```bash
adom-desktop notify_user '{"message": "Build complete", "duration_ms": 3000}'
adom-desktop desktop_open_url '{"url": "https://..."}'
adom-desktop desktop_open_folder '{"path": "<host folder path>"}'
```

## What's different from Adom cloud containers

| Feature | Adom Cloud | HD Local |
|---------|-----------|----------|
| Workspace provisioning | Adom platform API | golden image imported on the user's machine |
| Relay connection | wss:// through Cloudflare | ws://localhost:8765 (direct, no TLS) |
| Bridge latency | ~50-100ms (internet round-trip) | <1ms (localhost) |
| VSCODE_PROXY_URI | Coder proxy URL | http://localhost:7380/proxy/{{port}}/ |
| Socket.IO (collab) | Connected to iron.adom.inc | Disabled (single-user) |
| Service containers | Adjacent containers | Remote via Adom cloud |

## Environment variables

- `ADOM_DESKTOP_MODE=local` — indicates HD local mode
- `GALLIA_SERVICE=local` — tells gallia this is a local workspace
- `VSCODE_PROXY_URI=http://localhost:7380/proxy/{{port}}/` — code-server's proxy

(Platform layers may set additional host-specific env vars — see `[[hd-container-windows]]`.)

## Related skills

- `[[hd-container-stats]]` — the title-bar CPU/RAM indicator for this workspace
- `[[hd-setup-steps]]` — what each setup step did to prepare your workspace
