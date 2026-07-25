---
name: hd-adom-desktop-windows
description: >
  Windows/WSL2-specific details for HD's reach onto the host via Adom Desktop —
  the C:\ / %USERPROFILE% / %APPDATA% paths, host control-port discovery via
  ports.json, the WSL2 0.0.0.0:8765 → host-loopback relay forwarding, the cmd /C
  shell, winget auto-install verbs (KiCad / Node), the wsl_exec --distro
  Adom-Workspace runner, and the taskkill warning. READ alongside the generic
  [[hd-adom-desktop]] skill when acting on a Windows host. Trigger words —
  windows host, WSL2, cmd /C, taskkill adom-desktop, ports.json, winget,
  desktop_install_kicad, desktop_install_node, wsl_exec, Adom-Workspace,
  mirrored networking, host loopback, %APPDATA%, C:\Users.
---

# Hydrogen Desktop ↔ Adom Desktop — Windows / WSL2 specifics

This is the Windows companion to the generic [[hd-adom-desktop]] skill. Read
that first for the HD↔AD capability map, dual-client model, relay verbs, and
capability verification. This page only carries the Windows/WSL2 specifics that
were stripped out of the generic version.

> **Windows-only:** On Windows, AD reaches the user's real **Windows** machine,
> and HD's host layer (screenshots, notifications, captions, window control) runs
> against Win32. The default workspace runs as a **WSL2 Ubuntu distro**
> (`Adom-Workspace`).

## Host paths

- Host shell commands run via `cmd /C` on Windows.
- `send_files` / `pull_file` use Windows paths, e.g.
  `C:\Users\<you>` (`%USERPROFILE%`) for the user's home, the Desktop folder
  under it, etc.

```bash
adom-desktop pull_file  '{"filePaths":["C:\\path\\file"],"saveTo":"/tmp"}'
adom-desktop send_files '{"filePaths":["/tmp/x"],"saveTo":"C:\\Users\\<you>"}'
```

## HD control-port discovery (ports.json)

`hd_api` hits HD's control API, discovering its real port from
`%APPDATA%\hydrogen-desktop\ports.json` key `control` (fallback **47084**).

## WSL2 relay forwarding

The in-workspace relay binds `0.0.0.0:8765` inside the distro (HTTP on `8766`),
and WSL2 forwards it to the host's `localhost:8765` / `localhost:8766`, which is
how the host-side clients (HD's built-in bridge + the embedded AD) reach your
in-workspace relay. It's reached **same-port** under WSL2 — there's no host
47081/47082 remap (that was the old Docker model). WSL2 mirrored networking also
shares loopback with the Windows host, so `http://127.0.0.1:<port>` is the same
address from inside the distro and on the host.

## Auto-installing missing apps (winget)

On Windows you don't have to stop at a download link — trigger an unattended
winget install:

```bash
adom-desktop desktop_install_kicad '{}'   # winget install KiCad
adom-desktop desktop_install_node  '{}'   # winget install Node.js (unblocks the Pup bridge)
```

(`install_kicad` fires when `kicad_list_versions` returns
`errorCode:"kicad_not_installed"`; `install_node` when a `browser_*` call returns
`errorCode:"node_not_found"`.)

## Structured runner: wsl_exec

To run a script *inside* the WSL2 workspace distro with no quoting hazard:

```bash
adom-desktop wsl_exec '{"distro":"Adom-Workspace","user":"adom","scriptB64":"<b64>"}'
```

Base64 the script body so no quoting survives to be mangled.

## What NOT to do (Windows)

- **Never `taskkill /F /IM adom-desktop.exe`** — the host AD is your relay
  bridge; killing it severs your control channel (you can't get it back from in
  here).
