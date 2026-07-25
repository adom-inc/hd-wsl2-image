---
name: hd-container-windows
description: Windows/WSL2-specific spine for the HD workspace — the `Adom-Workspace` WSL2 distro, how it's imported (`wsl --import` of the golden image), the distro user/exec model, code-server port 7380 auto-forward to Windows localhost, the Rust runtime source, and the Cloud-vs-WSL2 comparison table. Companion to [[hd-container]]. Trigger on Windows host, WSL2, Adom-Workspace distro, wsl --import, wsl exec, distro user, code-server 7380 forward, mirrored networking, golden image distro.
---

# Hydrogen Desktop Workspace — Windows / WSL2 specifics

Companion to **[[hd-container]]**. On Windows, HD hosts the workspace as a **WSL2 Ubuntu distro named `Adom-Workspace`**. Everything in the generic skill (Ubuntu 24.04, code-server, the relay, bridges, env vars, the "setup-steps not bootstrap.sh" rule) applies; this skill adds the WSL2-specific facts.

## The distro — exact facts (don't guess)

| Field | Value |
|-------|-------|
| Distro name | `Adom-Workspace` (fixed — there is no random container suffix) |
| Imported from | golden image `adom-golden.tar.gz` via `wsl --import` |
| Architecture | matches host — almost always `linux-x64` on Windows hosts, `linux-arm64` on Apple Silicon (when WSL2 is unavailable, macOS/Ubuntu hosts use their own platform layer) |
| Distro default user | `adom` (`wsl.conf [user] default=adom`) — in-distro exec via `wsl -d Adom-Workspace -u adom --`; root via `-u root` |
| Work user UID | `adom` is UID 1001 |
| Workspace location | `/home/adom/project` lives directly in the distro's ext4 filesystem (no separate Docker volume) |
| Runtime source | `hydrogen-desktop/src-tauri/crates/hd-app/src/runtime/wsl.rs` (selector `runtime/mod.rs::select_runtime()`) |

## How it's provisioned (vs the legacy Docker path)

HD provisions the distro through `setup_steps_wsl.rs` (runtime mechanics in `runtime/wsl.rs`). The WSL cascade is **16 steps** (state file `setup-steps-wsl.json`) vs the legacy Docker flow's 24.

The Docker `pull-image` / `create-container` / `start-container` steps are collapsed into a single step 1, `ensure-workspace`, which runs `wsl --import` of `adom-golden.tar.gz` if the distro isn't already registered. (For the legacy Docker `setup_steps.rs` flow see the docker bucket.)

When debugging install issues on Windows, the source of truth is `setup_steps_wsl.rs` (and `runtime/wsl.rs`).

## code-server port auto-forward

Code-server runs inside the distro on `0.0.0.0:7380`; **WSL2 auto-forwards 7380 to Windows `localhost:7380`**, which is how the host webview reaches it.

## Host control API reachability

The Windows host control API is reachable from inside the distro at `127.0.0.1` — **WSL2 mirrored networking shares loopback with the Windows host**. The port is dynamic per launch; read the live URL from `~/.adom/hd-control-url`.

## Host file paths in bridge commands

KiCad/Fusion/file-transfer bridge commands that reference host files use **Windows path convention** (e.g. `C:\\Users\\john\\board.kicad_pcb`, with escaped backslashes in JSON).

## WSL2-specific environment variable

- `HD_RUNTIME=wsl2` — indicates the WSL2 runtime (default on Windows); `docker` selects the legacy container runtime.

## What's different from Adom cloud containers (WSL2 detail)

| Feature | Adom Cloud | HD Local (WSL2) |
|---------|-----------|-----------------|
| Workspace provisioning | Adom platform API | `wsl --import` of `adom-golden.tar.gz` on the user's machine |
| Relay connection | wss:// through Cloudflare | ws://localhost:8765 (direct, no TLS) |
| Bridge latency | ~50-100ms (internet round-trip) | <1ms (localhost) |
| VSCODE_PROXY_URI | Coder proxy URL | http://localhost:7380/proxy/{{port}}/ |
| Socket.IO (collab) | Connected to iron.adom.inc | Disabled (single-user) |
| Service containers | Adjacent containers | Remote via Adom cloud |

## Golden-image specifics

The distro is imported from a full pre-baked image — gallia, the Adom CLIs, the claude CLI + Code extension, code-server (pinned), VS Code settings, and all `hd-*` skills are baked in at image-build time, NOT installed by setup steps.

## Related skills

- `[[hd-container]]` — the platform-generic workspace context this companion extends
- `[[hd-container-stats-windows]]` — the WSL probe behind the title-bar CPU/RAM indicator
