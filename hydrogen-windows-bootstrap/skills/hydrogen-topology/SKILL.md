---
name: hydrogen-topology
description: >
  MUST READ before ANY HD work. Explains the three-layer topology: cloud
  Docker (where Claude runs), Windows machine (where HD + Adom Bridge run),
  and the HD local WSL2 workspace (the Adom-Workspace distro). Every command
  you run goes through the relay to Windows. You CANNOT directly access the
  WSL2 distro — you must shell through Windows. Trigger words — HD topology,
  cloud vs local, wsl exec, where am I, which workspace, adom-bridge-cli
  relay, test from container, three tiers, architecture, windows machine.
---

# Hydrogen — Topology (READ FIRST)

WSL2-runtime version (default). Legacy Docker container runtime (`HD_RUNTIME=docker`) is in the docker/ bucket.

## You are NOT on the user's machine

You (Claude) run inside an **Adom cloud Docker container**. The user's
Windows machine is a remote target you reach through the `adom-bridge-cli`
CLI relay. There are THREE separate environments:

### 1. Cloud Docker (where you run)
- Your shell, your filesystem, your git repos
- `adom-bridge-cli` CLI connects to Adom Bridge on Windows via relay
- This container has NOTHING to do with HD's local WSL2 workspace
- Restarting the WSL2 distro on Windows does NOT affect you
- You can freely `git push`, edit code, run builds here

### 2. Windows Machine (user's desktop)
- **Adom Bridge** — relay client app, listens on port 8770 (direct connect)
- **Hydrogen** — the Tauri app you're building
- **WSL2** — hosts the `Adom-Workspace` distro
- You reach this via `adom-bridge-cli shell_execute '{"command":"..."}'`
- Commands run in `cmd.exe` on Windows

### 3. HD Local WSL2 Workspace (the `Adom-Workspace` distro)
- Distro name: `Adom-Workspace` (fixed — no random suffix, no container name)
- Runs code-server, adom-bridge-cli CLI, relay server
- You reach this via: `adom-bridge-cli shell_execute '{"command":"wsl -d Adom-Workspace -u adom -- <cmd>"}'`
- This is TWO hops: cloud → relay → Windows → wsl exec → distro

## Command Patterns

### Run something on Windows
```bash
adom-bridge-cli shell_execute '{"command":"dir C:\\Github"}'
```

### Run something in the HD local WSL2 workspace
```bash
adom-bridge-cli shell_execute '{"command":"wsl -d Adom-Workspace -u adom -- ls /home/adom"}'
```

### Test adom-bridge-cli CLI inside the WSL2 workspace
```bash
adom-bridge-cli shell_execute '{"command":"wsl -d Adom-Workspace -u adom -- adom-bridge-cli ping"}'
```
This tests the FULL chain: distro → local relay → Adom Bridge on Windows.

### Screenshot HD window
```bash
adom-bridge-cli desktop_screenshot_window '{"hwnd":HWND}'
```

### Pull file from Windows to cloud
```bash
adom-bridge-cli pull_file '{"filePaths":["C:\\path\\file"],"saveTo":"/tmp"}'
```

## The WSL2 distro ≠ Your Container

- If the `Adom-Workspace` distro on Windows goes down, YOUR cloud container is fine
- You can still talk to Adom Bridge, screenshot windows, run shell commands
- You just can't `wsl -d Adom-Workspace ...` into the workspace until it's back
- Starting/stopping the distro on Windows is done via shell_execute. Only ever
  touch `Adom-Workspace` (`wsl --terminate Adom-Workspace`) — NEVER a global
  `wsl --shutdown`, which would knock out any other WSL distro the user has
  (e.g. a Docker Desktop integration).

## The Relay Chain

```
Cloud adom-bridge-cli CLI
  → WS relay (cloud :8765)
    → internet
      → Adom Bridge on Windows (relay client)
        → executes command locally
          → returns result
            → back through relay to your CLI
```

For the HD local WSL2 workspace, there's a SECOND relay:
```
Workspace's adom-bridge-cli CLI
  → local relay (distro :8765)
    → code-server proxy (:7380/proxy/8765/)
      → Adom Bridge on Windows (connected as WS client)
        → executes command
          → returns through same chain
```

## Critical Setup Steps for the HD Local WSL2 Workspace

The HD install flow MUST verify this chain works:

1. **Verify Adom Bridge running on Windows** — probe port 8770
   If not running: tell user to install from wiki and launch it
2. **Install adom-bridge-cli CLI into the workspace** — download binary
3. **Start relay inside the workspace** — `adom-bridge-cli serve`
4. **Register relay with Adom Bridge** — `server_add` via direct connect
   URL: `ws://127.0.0.1:{code_server}/proxy/8765/`
5. **Test round-trip** — `wsl -d Adom-Workspace -u adom -- adom-bridge-cli ping`
   Must return `pong` — proves the full chain works

## NEVER Do These

1. **NEVER confuse your cloud Docker with the HD local WSL2 workspace.**
   `curl http://127.0.0.1:8766/health` hits YOUR relay, not the workspace's.
2. **NEVER try to `wsl -d Adom-Workspace` from your shell.**
   The distro lives on Windows WSL2, not here.
3. **NEVER assume the workspace's status affects your container.**
   They're completely independent.
4. **NEVER run a global `wsl --shutdown` or `wsl --unregister` of anything
   other than `Adom-Workspace`.** Those hit every distro on the user's machine.
5. **NEVER skip the adom-bridge-cli round-trip test.**
   The relay chain has many links — test end-to-end, not individual parts.

## Related skills

- `hydrogen-container` — facts about the `Adom-Workspace` distro you run inside
- `hydrogen-volume` — where your files live and how to back up / copy out the distro
