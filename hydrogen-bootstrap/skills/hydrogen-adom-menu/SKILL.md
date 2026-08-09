---
name: hydrogen-adom-menu
description: >
  The Adom menu — the logo dropdown in the UPPER-LEFT corner of Hydrogen
  (click the teal Adom logo). It is the hub for app-level actions: Go to
  Dashboard, Settings, Ports, API Explorer, and a Desktop section (Adom Bridge,
  Zoom, Fullscreen, Console, Developer Tools, Dev Toolbar), a
  Container section (Start/Restart/Stop), and an Admin section (Setup Steps,
  Virgin Reset, Browser Picker Manager). Also covers the window
  TITLE BAR version readout and the About dialog (version/sha/build/signed +
  Adom Bridge version + wiki/repo links). Use when the user asks "what's in the
  Adom menu", "where's settings/devtools/about", "what version am I running", or
  about any upper-left menu item. NOTE: this is the upper-LEFT logo menu — the
  upper-RIGHT avatar dropdown is hydrogen-profile-menu. Trigger words: adom menu, logo
  menu, upper left menu, hamburger menu, settings, ports, api explorer, developer
  tools, devtools, dev toolbar, adom desktop, about, about dialog, what version,
  build info, setup steps menu, virgin reset menu, browser picker, console,
  fullscreen, zoom.
---

# The Adom menu (upper-left logo dropdown)

Click the **teal Adom logo** in the top-left corner to open it. (Double-click the
logo = go straight to the Dashboard.) Source: `EditorNav.svelte` → `.logo-button`
→ `.logo-dropdown-container .dropdown-link` items.

> This is the **upper-LEFT** menu. The **upper-RIGHT** avatar dropdown (profile,
> repositories, logout) is a different menu — see **hydrogen-profile-menu**.

## Items (top to bottom)

| Item | What it does |
|---|---|
| **Go to Dashboard** | Navigate Hydrogen to your Adom dashboard (`/`) |
| **Settings** | Opens the Settings dialog (`SettingsDialog.svelte`) |
| **Ports…** | Configure local host port assignments for Hydrogen services (`SettingsPortsDialog`) |
| **API Explorer…** | Browse + test every Hydrogen control-API endpoint (`ApiExplorerDialog`); see **hydrogen-api** |
| *— Desktop —* | (desktop-only section, shown when running in Hydrogen/Tauri; in order) |
| **Adom Bridge** | Bring the embedded Adom Bridge window to the foreground (taskbar) — FIRST item in the section |
| **Zoom** | −/+ zoom the whole Hydrogen UI (persisted) |
| **Fullscreen** | Toggle fullscreen |
| **Console** | Show/hide the native Hydrogen debug console window |
| **Developer Tools** | Opens WebView2 DevTools (separate window) — see below |
| **Dev Toolbar** | Show/hide the Adom Dev Toolbar window (eval-in / shot / Claude control endpoints) |
| *— Container —* | (state shown: running/stopped/…) |
| **Start / Restart / Stop Container** | Workspace lifecycle (see **hydrogen-workspace-lifecycle**) |
| *— Admin —* | |
| **Setup Steps** | Show the setup-steps panel — the setup cascade for the active runtime (16 steps under WSL2); see **hydrogen-setup-steps** / **hydrogen-setup** |
| **Virgin Reset** | Open the virgin-reset panel — wipe + re-run setup (see **hydrogen-setup**) |
| **Browser Picker Manager** | Manage saved browser choices per domain (see **hydrogen-browser-picker**) |

> **Removed items (do not list):** "Bridge Manager" (was a no-op with no backing
> panel) and "Port Mappings…" (no such action exists in the code).

Drive it programmatically with **hydrogen-eval** (`target:"shell"`): click
`.logo-button`, then click the `.dropdown-link` whose text matches the item.

## Developer Tools

The `devtools` capability is compiled into **all** builds (dev and release), so
"Open Developer Tools" works for end users too — Hydrogen is a developer tool. It opens
WebView2 DevTools as a **separate top-level window** (a window-bounded Hydrogen
screenshot will NOT show it). Also reachable from the tray menu and via
`POST /devtools` (or the `open_devtools` Tauri command). Pair with **hydrogen-eval** to
inspect/inject into any panel.

## Version readout — title bar + About dialog

**Title bar** (always visible) shows, in order:
`Hydrogen  v<version> · <dev|release> · <sha>-dirty · <build time> · <signed|unsigned> · ab <ad-version>`
— a fast way to confirm which build is running and whether it's signed.

**About dialog** (deep version info) — open it from the **tray menu → "About
Hydrogen"** (emits the `show-about` event; the dialog is mounted
app-wide). It shows, for **both** Hydrogen and the embedded **Adom Bridge**:
- Version, channel (dev/release), signed yes/no, commit SHA (+dirty), build time,
  install path, and reachability/endpoint (for ab)
- Links to each app's GitHub repo and **wiki** pages (they're git
  repos now)

Backed by the `get_about_info` Tauri command.

## Related
- **hydrogen-profile-menu** — the upper-RIGHT avatar dropdown (don't confuse the two)
- **hydrogen-settings** — the settings tree behind the **Settings** item
- **hydrogen-api** — the control-API surface behind **API Explorer…**
- **hydrogen-capture-share** / **hydrogen-recording** — the AV capture/record controls (Dev Toolbar)
- **hydrogen-setup** / **hydrogen-setup-steps** — what Setup Steps / Virgin Reset do
- **hydrogen-eval** — drive these menu items / inject UI from the workspace
