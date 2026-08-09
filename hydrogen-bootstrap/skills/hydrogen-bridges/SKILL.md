---
name: hydrogen-bridges
description: >
  Complete reference for the Hydrogen bridge ecosystem: the built-in KiCad, Fusion 360,
  and Puppeteer bridges, plus the extensible wiki bridge catalog (e.g. Blender)
  and the full set of Adom Bridge capabilities. How they connect through adom-bridge-cli, the Bridge Manager
  dialog, bridge status polling, and all bridge CLI commands. Use when the AI
  needs to take screenshots, control KiCad/Fusion/browser, transfer files,
  interact with the user's desktop, or check bridge status. Trigger words --
  screenshot, desktop screenshot, list windows, capture screen, kicad, fusion,
  browser, puppeteer, pup, send file, pull file, notify, desktop, bridge,
  bridge manager, bridge status, bridge install.
---

# Hydrogen -- Bridge Ecosystem

Hydrogen is the bridge between your Docker container and the user's Windows desktop.
All commands go through the relay at ws://localhost:8765/.

---

## Bridge Architecture

Hydrogen launches external bridge processes **on demand**. This is an **extensible**
ecosystem, not a fixed list — new bridges ship via the wiki catalog (see
"Extensible bridge catalog" below). The core/first-party bridges:

| Bridge | Display name | Port (default) | Target app | Description |
|--------|-------------|------|------------|-------------|
| `kicad-bridge` | KiCad Bridge | 8771 | KiCad | Control KiCad PCB editor from Adom containers |
| `fusion-bridge` | Fusion 360 Bridge | 8773 | Fusion 360 | Control Fusion 360 CAD/CAM and EAGLE PCB |
| `puppeteer-bridge` | Puppeteer Bridge | 8851 | Chrome for Testing | Chrome automation, screenshots, and recording |

**Bridge ports have conventional defaults** (KiCad **8771**, Fusion **8773**, Pup **8851**), but adom-bridge-cli registers the **live** port at bridge launch and may pick a different one if a default is taken. To find the actual live port, run `adom-bridge-cli status` and look at `desktop.apps.<bridge>.bridgePort` (or `adom-bridge-cli bridge_list`). In practice you don't need the port directly — use the `adom-bridge-cli <verb>` CLI which routes to the right bridge automatically.

Bridges are launched on demand by Hydrogen. They are NOT always running. The Bridge
Manager polls status every 15 seconds via Tauri `invoke('get_bridge_status')`.

### What Adom Bridge can do (live capability list)

Bridges are only part of ab. Query the **authoritative, machine-specific** list:

```bash
adom-bridge-cli status   # → .capabilities  and  .desktop.apps
```

On a typical machine `.capabilities` =
`notify, files, kicad, fusion360, shell, usb, screenshot, browser, caption, record`.
Mapping to where each is documented:

| capability | what it is | skill |
|---|---|---|
| `kicad` / `fusion360` / `browser` | the three built-in app bridges | this skill |
| `screenshot` / `record` / `caption` | OS screenshots, screen/tab recording, recording captions | this skill (screenshots/recording); `caption` is recording-caption support |
| `files` | send_files / pull_file | **hydrogen-file-transfer**, **hydrogen-adom-desktop** |
| `notify` | desktop toast notifications | this skill |
| `shell` | run a command on the user's PC (approval-gated) | **hydrogen-adom-desktop** |
| `usb` | USB passthrough to the workspace (e.g. workcell hardware over USBIP) | not yet covered — query `adom-bridge-cli status`; future skill |

> `.desktop.apps` also reports, per app: `bridgeRunning`, `installed`, `running`,
> `version` — use it to check whether the target app (KiCad/Fusion/Chrome) is
> present before driving its bridge.

### Bridge status values

| Status | Meaning | Icon | Color |
|--------|---------|------|-------|
| `running` | Bridge process is alive and connected | `mdi:circle` (filled) | `#00b8b0` (teal) |
| `stopped` | Bridge exists but not running | `mdi:circle-outline` | `#808080` (gray) |
| `not_installed` | Bridge binary not found | `mdi:download` | `#e8a838` (amber) |

### BridgeInfo type

```typescript
interface BridgeInfo {
    name: string           // e.g. "kicad-bridge"
    display_name: string   // e.g. "KiCad Bridge"
    version: string        // e.g. "1.0.0"
    description: string
    port: number           // conventional default; live port via `adom-bridge-cli status`
    status: 'running' | 'stopped' | 'not_installed'
    app_detected: boolean  // true if target app (KiCad, Fusion, Chrome) is found
    app_name: string       // e.g. "KiCad"
    install_url: string    // e.g. "https://www.kicad.org/download/"
    install_method: string // "free_download" or "auto_download"
}
```

---

## Bridge Manager Dialog

**Access**: Adom menu (top-left logo) -> Desktop section -> Bridge Manager
**Source**: `src/lib/components/editor/BridgeManager.svelte`

Renders as a panel (not an overlay dialog) with a vertical card list showing
each bridge's status. Auto-refreshes every 15 seconds.

### Features
- Status badges with color-coded icons
- Per-bridge install links when the target app is missing
- "Browse Bridge Catalog" button linking to the wiki (`/apps?tag=hydrogen-bridge`)
- Polls `invoke('get_bridge_status')` on mount and every 15 seconds

> **App missing? You can auto-install it.** When the target app isn't installed,
> the dialog shows an install link — but the AI doesn't have to stop there. For
> KiCad and Node.js you can trigger an **unattended winget install** instead of
> asking the user to download:
> `adom-bridge-cli desktop_install_kicad '{}'` / `adom-bridge-cli desktop_install_node '{}'`.
> (Fusion 360 cannot be installed programmatically — surface the link for that.)

### CSS selectors

| Element | Selector |
|---------|----------|
| Container | `.bridge-manager` |
| Header title | `.bridge-manager .header h2` |
| Subtitle | `.bridge-manager .subtitle` |
| Bridge card grid | `.bridge-grid` |
| Bridge card | `.bridge-card` |
| Running bridge card | `.bridge-card.running` |
| Bridge icon | `.bridge-icon` |
| Bridge name | `.bridge-name` |
| Bridge version | `.bridge-version` |
| Bridge description | `.bridge-description` |
| Bridge status | `.bridge-status` |
| App missing link | `.bridge-app-missing a` |
| Browse catalog button | `.browse-btn` |

### CDP eval examples

```javascript
// Read bridge statuses
JSON.stringify(Array.from(document.querySelectorAll('.bridge-card')).map(function(card) {
  return {
    name: card.querySelector('.bridge-name')?.textContent?.trim(),
    status: card.querySelector('.bridge-status')?.textContent?.trim(),
    running: card.classList.contains('running')
  };
}));

// Click Browse Bridge Catalog
document.querySelector('.browse-btn')?.click();
```

### Opening the Bridge Manager from the Adom menu

```javascript
// Open Adom menu, then click Bridge Manager
document.querySelector('.logo-button')?.click();
setTimeout(function() {
  var items = document.querySelectorAll('.dropdown-link');
  Array.from(items).find(function(e) { return e.textContent.includes('Bridge Manager'); })?.click();
}, 200);
```

---

## Prerequisites

Check connection: `adom-bridge-cli ping` -- returns "pong" if Hydrogen is connected.
If not connected, the user needs to launch Hydrogen on their Windows machine.

---

## Screenshots (zero dialogs, instant)

```bash
# Full screen capture
adom-bridge-cli desktop_screenshot_screen

# Resized for Claude vision (default to this)
adom-bridge-cli desktop_screenshot_screen '{"maxWidth": 1500}'

# Specific window by HWND
adom-bridge-cli desktop_screenshot_window '{"hwnd": 12345}'

# List all capturable windows
adom-bridge-cli desktop_list_windows
```

**AI guidance:**
- Default to `maxWidth: 1500` -- Claude vision hard limit is 2000px
- Use `format: "png"` for UI/text (default, lossless)
- Use `format: "jpeg", quality: 80` for photos/3D renders
- Use `format: "webp"` for smaller file sizes

---

## Browser Automation (Puppeteer Bridge)

Port: default **8851** (adom-bridge-cli registers the live port; see `adom-bridge-cli status`). Auto-downloads Chrome for Testing if not present.

```bash
# Open browser window
adom-bridge-cli browser_open_window '{"url": "https://example.com"}'

# Screenshot current tab
adom-bridge-cli browser_screenshot '{"sessionId": "default"}'

# Evaluate JavaScript
adom-bridge-cli browser_eval '{"js": "document.title", "sessionId": "default"}'

# Navigate
adom-bridge-cli browser_navigate '{"url": "https://...", "sessionId": "default"}'

# List open windows/tabs
adom-bridge-cli browser_list_windows

# Record tab (CDP screencast, zero dialogs)
adom-bridge-cli browser_record_start '{"sessionId": "default"}'
adom-bridge-cli browser_record_stop '{"sessionId": "default"}'
```

---

## KiCad Bridge

Port: default **8771** (adom-bridge-cli registers the live port; see `adom-bridge-cli status`). Requires KiCad to be installed on the user's Windows machine.

```bash
adom-bridge-cli kicad_open_board '{"path": "C:\\path\\to\\board.kicad_pcb"}'
adom-bridge-cli kicad_open_schematic '{"path": "C:\\path\\to\\schematic.kicad_sch"}'
adom-bridge-cli kicad_open_3d_viewer
adom-bridge-cli kicad_run_drc '{"path": "..."}'
adom-bridge-cli kicad_screenshot_all
adom-bridge-cli kicad_window_info
adom-bridge-cli kicad_send_key '{"key": "ctrl+s"}'
adom-bridge-cli kicad_list_versions
adom-bridge-cli kicad_install_symbol '{"path": "/tmp/symbol.kicad_sym", "library": "MyLib"}'
adom-bridge-cli kicad_install_library '{"path": "/tmp/footprints", "name": "MyFootprints"}'
```

**Always run `kicad_window_info` BEFORE any KiCad operation** to check for modal dialogs —
and AFTER any save/DRC/open to catch errors KiCad raised.

### Finding + reading KiCad errors (modal dialogs)
`kicad_window_info` returns `hasModalDialogs` (bool) + a `modalDialogs` array — **this is how
you detect a KiCad error/blocking dialog** (a save-permission error, a file-format warning, a
DRC blocker). Each entry is `{hwnd, ownerHwnd, title}` (e.g. `title:"Error"`):

```bash
adom-bridge-cli kicad_window_info '{}'
# → { editors:[...], hasModalDialogs:true,
#     modalDialogs:[{ "hwnd":200934, "ownerHwnd":6163368, "title":"Error" }], projectManager:{...} }
```
- ⚠️ `modalDialogs` gives the **title + hwnd, NOT the body text**. To read *what the error says*,
  **screenshot the dialog by its hwnd**: `adom-bridge-cli desktop_screenshot_window '{"hwnd":200934}'`
  → read the saved PNG. (Verified live 2026-06-15: a `ctrl+s` on a read-only board surfaced
  `hasModalDialogs:true` + a `title:"Error"` entry; screenshotting its hwnd read *"Insufficient
  permissions to save file …"*.)
- **Dismiss** it before proceeding: `kicad_send_key '{"hwnd":<dialog hwnd>,"key":"return"}'`
  (OK) or `"escape"` (Cancel). A lingering modal blocks every subsequent KiCad action.
- So the loop is: **operate → `kicad_window_info` → if `hasModalDialogs`, screenshot each
  `modalDialogs[].hwnd` to read it → handle/dismiss.** Don't assume an operation succeeded just
  because the verb returned `success:true` — KiCad can still pop a blocking error.

---

## Fusion 360 Bridge

Port: default **8773** (adom-bridge-cli registers the live port; see `adom-bridge-cli status`). Requires Fusion 360 to be installed on the user's Windows machine.

```bash
adom-bridge-cli fusion_start
adom-bridge-cli fusion_import_step '{"path": "C:\\path\\to\\model.step"}'
adom-bridge-cli fusion_export_step '{"path": "C:\\path\\to\\output.step"}'
adom-bridge-cli fusion_board_info
adom-bridge-cli fusion_electron_run '{"command": "..."}'
```

---

## Extensible bridge catalog (bridges are NOT a fixed set)

Bridges are a growing ecosystem. The three above (KiCad / Fusion 360 / Puppeteer)
are **built into Adom Bridge**. Additional bridges are published to the **wiki
bridge catalog** and installed on demand — for example the **Blender bridge**
(`adom-blender-bridge`), which is NOT built in (it won't appear in `adom-bridge-cli
status` until installed). To use a catalog bridge:

- **Discover:** Bridge Manager → "Browse Bridge Catalog" → wiki `/apps?tag=hydrogen-bridge`.
- **Reserved ports:** the `8900-8999` range is set aside for 3rd-party bridges.
- **Enumerate what's actually live:** `adom-bridge-cli status` → `desktop.apps.*` lists
  every bridge ab currently knows about, with `bridgePort`, `status`, and whether
  the target app was detected. **Treat that as the source of truth** for "what
  bridges exist right now" — this skill's table lists the core ones, but new
  catalog bridges will appear in `status` without being in this table.
- **Invoke any bridge** through the `adom-bridge-cli <verb>` CLI; it routes to the
  right bridge automatically (you rarely need the port directly).

> Maintainer note: keep this skill in sync by periodically running
> `adom-bridge-cli status` against a fully-bridged machine and reconciling the table.

---

## File Transfer

```bash
# Send file from Docker to Windows desktop
adom-bridge-cli send_files '{"files": [{"path": "/home/adom/project/output.pdf"}]}'

# Pull file from Windows to Docker
adom-bridge-cli pull_file '{"remotePath": "C:\\Users\\john\\Downloads\\data.csv", "localPath": "/tmp/data.csv"}'
```

---

## Desktop Interaction

```bash
# Toast notification
adom-bridge-cli notify_user '{"message": "Build complete!", "duration_ms": 5000}'

# Open URL in user's browser
adom-bridge-cli desktop_open_url '{"url": "https://..."}'

# Open folder in Explorer
adom-bridge-cli desktop_open_folder '{"path": "C:\\Users\\john\\project"}'

# Execute shell command (requires user approval)
adom-bridge-cli shell_execute '{"command": "dir C:\\Github"}'
```

---

## Screen Recording

> **Served by the embedded ab process, NOT Hydrogen's built-in bridge.** The
> `desktop_record_*` / `desktop_recorder_*` verbs only exist when the standalone
> ab (spawned `--embedded`) is connected. Verify before using:
> `adom-bridge-cli status` → `.capabilities` must include `record`. If it's absent,
> only Hydrogen's built-in bridge is up and these verbs return "unknown desktop
> command". See **hydrogen-recording** for full details.

> **Tab-vs-desktop footgun.** `desktop_record_start` records the **whole screen**
> and requires an explicit `confirmDesktopNotTabRecording:true` guard so you don't
> accidentally capture the entire desktop when you meant one tab. To record a
> single Chrome tab, use `browser_record_start` instead (CDP screencast, served by
> the Puppeteer bridge, no whole-screen capture).

```bash
# Record entire desktop (ab-served; needs the confirm guard, zero dialogs)
adom-bridge-cli desktop_record_start '{"reason": "Demo recording", "confirmDesktopNotTabRecording": true}'
adom-bridge-cli desktop_record_stop

# Record a single browser tab (CDP screencast, zero dialogs) — prefer this for one tab
adom-bridge-cli browser_record_start '{"sessionId": "default"}'
adom-bridge-cli browser_record_stop '{"sessionId": "default"}'
```

---

## Ralph Loop Pattern

```bash
# 1. Take screenshot
adom-bridge-cli desktop_screenshot_screen '{"maxWidth": 1500}'
# 2. Read the screenshot (it's saved to /screenshots/)
# 3. Analyze with Claude vision
# 4. Make changes
# 5. Take another screenshot
# 6. Repeat until done
```

---

## Browser Profiles

Hydrogen can detect all browser profiles installed on the user's machine and open
URLs in specific browsers/profiles.

**Control API endpoints**:
- `GET /browser-profiles` -- detect Chrome, Edge, Brave, Firefox, Opera profiles
- `POST /open-in-profile` -- open URL in a specific browser and profile
- `POST /open-url` -- open URL in the default browser

**Source**: `src/lib/components/BrowserProfileDialog.svelte`

---

## Cross-references

- **hydrogen-ui** -- Adom menu layout where Bridge Manager lives
- **hydrogen-networking** -- port architecture (conventional bridge ports + dynamic registration)
- **hydrogen-adom-menu** -- the API Explorer (has bridge-related endpoints)
- **hydrogen-settings** -- Hydrogen settings surface
- **hydrogen-self-screenshot** -- host screenshots, window control, and the ralph loop
- **kicad-interaction** -- foundational KiCad desktop interaction rules
- **pup** -- Puppeteer browser control via pup CLI
