---
name: hydrogen-container
description: Context for Claude Code running inside a Hydrogen WSL2 workspace distro. Documents the exact OS (Ubuntu 24.04, code-server 4.112.0, the Adom-Workspace distro), explains how setup differs from Adom cloud containers (setup-steps NOT bootstrap.sh), what bridges are available, and how to use the relay. Trigger on startup, adom-cli errors, bridge commands, screenshot requests, container-platform questions, code-server / VS Code extension issues, or when the AI needs concrete facts about its environment instead of guessing.
---

# Hydrogen Workspace (WSL2)

WSL2-runtime version (default). Legacy Docker container runtime (`HD_RUNTIME=docker`) is in the docker/ bucket.

You are running inside the **`Adom-Workspace` WSL2 distro** managed by Hydrogen (HD). HD is the flagship Adom desktop app — it manages your WSL2 workspace, bridges to desktop apps, and provides VS Code + Claude Code.

## The workspace — exact facts (don't guess)

| Field | Value |
|-------|-------|
| Distro name | `Adom-Workspace` (fixed — there is no random container suffix) |
| Imported from | golden image `adom-golden.tar.gz` (full pre-baked image) via `wsl --import` |
| Base | Ubuntu 24.04 |
| Architecture | matches host (`dpkg --print-architecture`) — almost always `linux-x64` on Windows hosts, can be `linux-arm64` on Apple Silicon hosts |
| code-server | 4.112.0 (pinned via setup step) |
| code-server binary | `/usr/lib/code-server/bin/code-server` |
| Extensions dir | `~/.local/share/code-server/extensions/` |
| Settings | `~/.local/share/code-server/User/settings.json` |
| Distro default user | `adom` (`wsl.conf [user] default=adom`) — in-distro exec via `wsl -d Adom-Workspace -u adom --`; root via `-u root` |
| Work user | `adom` (UID 1001, passwordless sudo, home `/home/adom`) |
| Workspace | `/home/adom/project` (lives directly in the distro's ext4 filesystem) |
| Pre-installed | Node 18 + npm, Python 3.12, git, gh, curl, wget, jq, build-essential, cmake, pkg-config, libssl-dev |
| Code-server runs as | `code-server --bind-addr 0.0.0.0:7380 --auth none --disable-telemetry /home/adom/project` (WSL2 auto-forwards 7380 to Windows `localhost:7380`) |
| Runtime source | `hydrogen-desktop/src-tauri/crates/hd-app/src/runtime/wsl.rs` (selector `runtime/mod.rs::select_runtime()`) |

If you ever need to confirm: `cat /etc/os-release`, `uname -m`, `/usr/lib/code-server/bin/code-server --version`. Don't speculate about alpine/arm64 — Ubuntu 24.04 matches the cloud container.

## Setup is via HD's setup-steps, NOT gallia bootstrap.sh

HD provisions this distro through its own **setup-steps** flow (Rust code in `hydrogen-desktop/src-tauri/crates/hd-app/src/setup_steps_wsl.rs`, with the runtime mechanics in `hydrogen-desktop/src-tauri/crates/hd-app/src/runtime/wsl.rs`), shown as the "Install Tools" panel in the HD UI. It is a **different code path** than cloud containers, which run `gallia/scripts/bootstrap.sh`.

The WSL cascade is **28 steps** (state file `setup-steps-wsl.json`) vs the legacy Docker flow's 24. Most tooling is NOT installed by a step — it's BAKED into `adom-golden.tar.gz` at image-build time (gallia, the 8 Adom CLIs, the Claude Code extension, code-server, VS Code settings, and all `hd-*` skills). The one exception is the `claude` CLI, which is installed at RUNTIME by step 13 `install-claude-cli` (its self-setup needs a live session). The Docker `pull-image` / `create-container` / `start-container` steps are collapsed into a single step 1, `ensure-workspace`, which runs `wsl --import` of `adom-golden.tar.gz` if the distro isn't already registered. The relay is started by the `start-relay` step. See `hd-golden-image`.

When debugging install issues here, the source of truth is `setup_steps_wsl.rs` (and `runtime/wsl.rs`) — its step IDs (`ensure-workspace`, `install-adom-vscode`, `set-env-vars`, `inject-api-key`, `start-relay`, `claude-auth`, etc.) map 1:1 to what ran on this distro. There is NO `install-claude-ext` / `install-claude-cli` / `install-gallia` / `write-vscode-settings` step anymore — those are baked. Do NOT chase bugs into `bootstrap.sh` first — that script lives in the baked image but HD itself never invokes it. (For the legacy Docker `setup_steps.rs` flow see the docker/ bucket.)

## VS Code extension caveats

- The Claude Code extension and `code-server` settings (including `extensions.autoUpdate: true` / `extensions.autoCheckUpdates: true`) are BAKED into the golden image — there is no `write-vscode-settings` or `install-claude-ext` setup step. Auto-update **must** stay on so every installed extension auto-updates from the marketplace; the image bakes it on. Do not regress this.
- Bare `code-server --install-extension <id>` (no version pin) historically resolves to the **universal** target-platform build. For some extensions (notably `anthropic.claude-code` after 2.1.89), Anthropic stopped shipping universal builds — so bare install permanently sticks at 2.1.89 even when newer `linux-x64` builds exist. The golden-image bake installs the latest `linux-x64` build pinned, so the workspace ships current. It also heals orphan `extensions.json` entries (entries pointing to deleted dirs cause a permanent "Invalid extensions detected" banner).
- Marketplace: code-server uses **Open VSX** (open-vsx.org), not Microsoft Marketplace. No `EXTENSIONS_GALLERY` env override is set; `product.json` has no gallery URL — it falls through to Open VSX defaults.

## adom-cli is authenticated

HD auto-injects the user's session token on every launch. To verify:
```bash
adom-cli carbon user get
```
If this returns user data, all adom-cli commands work (containers, repos, orgs, wiki, etc.). If it fails, the user needs to log in via HD's login page.

## Relay server is running

The adom-bridge-cli relay runs on ports 8765 (WebSocket) / 8766 (HTTP) inside this distro. The `start-relay` setup step launches it.

Check health: `curl -sf http://127.0.0.1:8766/health`
Check desktop connection: `adom-bridge-cli ping`

The Windows host control API is reachable from inside the distro at `127.0.0.1` — WSL2 mirrored networking shares loopback with the Windows host. The port is dynamic per launch, so read the live URL from `~/.adom/hd-control-url` (`http://127.0.0.1:<dynamic>`): `BASE="$(cat ~/.adom/hd-control-url)"; curl "$BASE/health"`.

## Available bridge commands (when desktop is connected)

### Screenshots (zero dialogs, instant)
```bash
adom-bridge-cli desktop_screenshot_screen                    # full screen capture
adom-bridge-cli desktop_screenshot_screen '{"maxWidth":1500}' # resized for Claude vision
adom-bridge-cli desktop_screenshot_window '{"hwnd": N}'       # capture specific window
adom-bridge-cli desktop_list_windows                          # list all windows with HWNDs
```
Default to `maxWidth: 1500, format: "png"` for UI screenshots. Use `"jpeg"` for natural photos, `"webp"` for smaller files.

### Browser automation (Puppeteer)
```bash
adom-bridge-cli browser_open_window '{"url": "https://..."}'
adom-bridge-cli browser_screenshot '{"sessionId": "default"}'
adom-bridge-cli browser_eval '{"js": "document.title"}'
adom-bridge-cli browser_navigate '{"url": "..."}'
```

### KiCad bridge
```bash
adom-bridge-cli kicad_open_board '{"path": "C:\\path\\to\\board.kicad_pcb"}'
adom-bridge-cli kicad_screenshot_all
adom-bridge-cli kicad_run_drc '{"path": "..."}'
adom-bridge-cli kicad_window_info
```

### Fusion 360 bridge
```bash
adom-bridge-cli fusion_start
adom-bridge-cli fusion_import_step '{"path": "..."}'
adom-bridge-cli fusion_export_step '{"path": "..."}'
```

### File transfer
```bash
adom-bridge-cli send_files '{"files": [{"path": "/home/adom/file.txt"}]}'
adom-bridge-cli pull_file '{"remotePath": "C:\\Users\\john\\file.txt", "localPath": "/tmp/file.txt"}'
```

### Desktop interaction
```bash
adom-bridge-cli notify_user '{"message": "Build complete", "duration_ms": 3000}'
adom-bridge-cli desktop_open_url '{"url": "https://..."}'
adom-bridge-cli desktop_open_folder '{"path": "C:\\Users\\john\\project"}'
```

## What's different from Adom cloud containers

| Feature | Adom Cloud | HD Local (WSL2) |
|---------|-----------|-----------------|
| Workspace provisioning | Adom platform API | `wsl --import` of `adom-golden.tar.gz` on the user's machine |
| Relay connection | wss:// through Cloudflare | ws://localhost:8765 (direct, no TLS) |
| Bridge latency | ~50-100ms (internet round-trip) | <1ms (localhost) |
| VSCODE_PROXY_URI | Coder proxy URL | http://localhost:7380/proxy/{{port}}/ |
| Socket.IO (collab) | Connected to iron.adom.inc | Disabled (single-user) |
| Service containers | Adjacent containers | Remote via Adom cloud |

## Environment variables

- `ADOM_DESKTOP_MODE=local` — indicates HD local mode
- `HD_RUNTIME=wsl2` — indicates the WSL2 runtime (default); `docker` selects the legacy container runtime
- `GALLIA_SERVICE=local` — tells gallia this is a local workspace
- `VSCODE_PROXY_URI=http://localhost:7380/proxy/{{port}}/` — code-server's proxy

## Related skills

- `hydrogen-topology` — the three-tier topology; tier 3 is this WSL2 distro
- `hydrogen-volume` — where your files live, what persists, and how to back up / copy out the distro
