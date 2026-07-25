---
name: hd-ui
description: >
  HD's user interface: menus, dialogs, panels, login/logout, profile menu,
  workspace layout, setup panel — and how to DRIVE them from the workspace via
  the UI command bus (GET /ui/actions → POST /ui/invoke), the first-class way to
  open/close/toggle any HD menu or dialog (no CDP clicking). READ when the user
  asks you to open/close a dialog or menu, operate HD's UI, or you need to know
  where a UI element is. Trigger words — HD menu, HD dialog, HD panel, open
  dialog, open menu, close dialog, drive UI, ui/actions, ui/invoke, command bus,
  ports.open, settings.open, about dialog, profile menu, login, logout, settings,
  setup panel, Adom menu, HD UI.
---

# Hydrogen Desktop — UI Reference

## Window Layout

HD's window has these regions (top to bottom, left to right):

### Title Bar
- **Left**: "jlauer12 / Hydrogen Desktop" — shows user + app name
- **Right**: CPU/RAM badges, window controls (minimize/maximize/close)

### Tab Bar
- **VS Code** tab — the main code editor (iframe to code-server)
- **Webview** tab — wiki/app content panel
- Additional tabs for bridges, sensors, etc.

### Main Content Area
- **Left pane**: Usually VS Code iframe
- **Right pane**: Usually webview (wiki, shotlog, etc.)
- Panes are split and resizable

### Setup Panel (bottom)
- Collapsible panel showing the setup-cascade steps
- See `hd-setup` skill for details

## Menus

### Adom Menu (top-left logo dropdown)
The main menu, opened by clicking the Adom logo at the top-left. Items are grouped into labelled sections (in order, top to bottom):

**(top, unlabelled)**
- **Go to Dashboard** — switches to the Hydrogen dashboard view
- **Settings** — opens the Settings dialog
- **Ports...** — opens the port configuration dialog (see hd-ports)
- **API Explorer...** — opens the control-API endpoint explorer dialog

**DESKTOP** (Tauri-only — won't appear in browser-served HD; in order)
- **Adom Desktop** — brings the embedded Adom Desktop window to the foreground (taskbar); bus id `adom-desktop.open`
- **Zoom** — webview zoom controls (− %  +) with persistence across launches
- **Fullscreen** — toggle fullscreen
- **Console** — show/hide the HD debug console window
- **Developer Tools** — open the webview developer tools
- **Dev Toolbar** — show/hide the Adom Dev Toolbar window (eval-in / shot / Claude control endpoints); bus id `dev-toolbar.toggle`

> The Bridges section / "Bridge Manager" item was removed (it was a no-op with no backing panel). For the bridge panel itself, see `hd-bridges`.

**Workspace / runtime section** (section label shows live status badge: `RUNNING`, `STOPPED`, etc.)
- **Restart** — restarts the workspace (terminates and re-ensures code-server). The exact mechanism is runtime-specific.
- **Stop** — stops the workspace. The exact mechanism is runtime-specific.

**ADMIN**
- **Setup Steps** — opens the setup panel (the setup cascade for the active runtime); see hd-setup-steps
- **Virgin Reset** — opens the virgin reset section of the setup panel; see hd-volume for what each toggle deletes
- **Browser Picker Manager** — configure per-domain default browser/profile prefs; see hd-browser-picker

### Profile Menu (top-right avatar)
Click the user avatar (circular photo) in the top-right corner.
- **Your profile** — view Adom profile
- **Your repositories** — list repos
- **Your molecules** — list molecules
- **Log out** — signs out of Adom, removes session token

**CRITICAL**: Logout is ONLY in the profile menu (top-right avatar),
NOT in the Adom menu (top-left). Future AI threads: don't look for
logout in the wrong menu.

## Dialogs

### Port Settings Dialog
Access: Adom menu → Ports...
Shows all configurable ports with live conflict detection.
Fields: Code Editor, Workspace Proxy, Control API, DevTools (CDP), Hostname.
See `hd-networking` skill for port details.

### Settings Dialog
Access: Adom menu → Settings
Application-level preferences.

### Browser Picker Dialog
Appears when clicking external links. Shows detected browser profiles
(Edge, Chrome, etc.) with per-domain "remember" option.

## Driving the UI — the command bus (PREFERRED, first-class)

⭐ **Every menu / dialog / panel HD has wired is a first-class action you drive over the control
API — no CDP, no `.click()`, no selector guessing.** This is how you operate HD's UI when the
user says "open the Ports dialog", "open About", "show settings", etc.

**Get the control URL from the discovery file** `~/.adom/hd-control-url` (HD rewrites it with
the live, dynamic control port every launch; it's the host loopback, reachable from the
workspace). Read it from a file, not an env var — your Bash tool runs non-interactive shells
that don't source `.bashrc`/`profile.d`:

```bash
CTRL="$(cat ~/.adom/hd-control-url)"
```

**Always do this in order:**

1. **Discover** what's drivable (ids + descriptions):
   ```bash
   curl -s "$CTRL/ui/actions"
   # → {ok, count, actions:[{id,label,description,group}], _hints}
   ```
2. **Drive** one — returns ONLY after the frontend actually ran it:
   ```bash
   curl -s -X POST "$CTRL/ui/invoke" \
     -H 'Content-Type: application/json' -d '{"id":"ports.open"}'
   # → {ok:true, id:"ports.open", value:…}
   ```
3. **Not in the list?** That absence is the signal: the element isn't wired to the bus yet. It
   needs a 2-line `registerUiAction(...)` in its Svelte component (a dev change in the
   hydrogen-desktop repo — see that repo's `hd-ui-actions` skill). Don't fall back to clicking;
   wire it. The response's `_hints.if_missing` says the same.

Common ids (always `GET /ui/actions` for the live set): `adom-menu.open`/`.close`,
**`profile-menu.open`/`.close`**, `ports.open`/`.close`, `settings.open`/`.close`,
`api-explorer.open`/`.close`, `browser-picker.open`/`.close`, `about.open`/`.close`,
`adom-desktop.open`, `setup-panel.show`, `virgin-reset.open`, `dashboard.go`,
`fullscreen.toggle`, `console.toggle`, `devtools.open`, `dev-toolbar.toggle`,
`container.start`/`.stop`/`.restart`.

**Menu ITEMS, not just open/close:** the profile menu also exposes per-item actions —
**`profile.view`**, **`profile.repositories`**, **`profile.molecules`**, **`profile.logout`** —
so you can trigger a specific item directly (it navigates as if the human clicked it),
WITHOUT opening the menu + screen-clicking. (`profile.logout` is the canonical logout — see
the logout note above.) `GET /ui/actions` for the live set; the Adom menu will get the same
item-level treatment over time.

> Note: there is **no** `port-mappings.open`/`.close` id — that action was never
> registered. Don't try to invoke it.
> **Gap:** `setup-panel` has `.show` but **no `.hide`** — to close it, eval
> `window.__hdSetSetupPanel(false)` (via `/eval-in`) or open another surface. A
> `setup-panel.hide` action is on the wishlist.

### Open a surface, then screenshot it (the killer combo)
Combine the bus with HD's canonical capture endpoint to grab any menu/dialog/panel with
**no screen-clicking**: `POST /ui/invoke {id:"<x>.open"}` → `POST /screenshot
{target:"shell", selector:"<open-state selector>"}` → `POST /ui/invoke {id:"<x>.close"}`.
The `/screenshot` region-flash lands on that selector. Resolved selectors (verified live):
**Adom & profile menus** → `.dropdown-content.open` (one open at a time); **Setup panel** →
`.setup-panel`; **API Explorer** → `.dialog`. Full `/screenshot` reference (target/selector/
b64/silent) is in **[hd-self-screenshot](../hd-self-screenshot/SKILL.md)**.

> **This is HD-desktop-only and SEPARATE from `adom-cli`.** `adom-cli` drives *web-hydrogen's*
> UI via the SSE bridge (`ADOM_HYDROGEN_URL`) and is unchanged. For HD desktop's far richer UI
> control, use the command bus above — never `adom-cli` for this.

## Legacy: raw CDP clicking (deprecated fallback — the command bus above is canonical)

⚠ The command bus (`/ui/actions` → `/ui/invoke`) is the canonical way to drive HD's UI. Before
it existed, UI was driven by CDP `.click()` on CSS selectors via the HD CDP eval channel. This
is brittle (selectors drift; multiple `localhost:1420` CDP targets) and the selectors below may
be stale. Reach for CDP ONLY for an element not yet on the bus — and the better fix is to
register it. Eval JS against the CDP endpoint (its port comes from `/discover` as `cdp`).

### Find and click menu items
```js
// Open Adom menu
document.querySelector('.logo-button')?.click()

// Find a menu item by text
var items = document.querySelectorAll('.dropdown-link,.menu-item');
var target = Array.from(items).find(function(e){return e.textContent.includes('Ports')});
if (target) target.click()
```

### Click setup panel buttons
```js
document.querySelector('.run-all').click()                 // Run All
document.querySelector('.virgin-reset-btn')?.click()       // Virgin Reset dropdown
document.querySelector('.virgin-go')?.click()              // Wipe Selected (execute virgin reset)
document.querySelector('.close-btn,.setup-close')?.click() // Close setup panel
```

### Query step states
```js
JSON.stringify(Array.from(document.querySelectorAll('.step-row')).map(
function(e,i){
  var icon=e.querySelector('.step-icon');
  return{n:i+1, s:icon?.textContent?.trim()}
}))
```

## CSS Selectors for Key Elements

| Element | Selector |
|---------|----------|
| VS Code iframe | `iframe.vis-studio-iframe` or `iframe[title="code"]` |
| Setup panel | `.setup-panel` |
| Run All button | `.run-all` |
| Virgin Reset button | `.virgin-reset-btn` |
| Wipe Selected button | `.virgin-go` |
| Step rows | `.step-row` |
| Step icon (✅/❌/○) | `.step-icon` |
| Step label | `.step-label` |
| Adom menu button | `.logo-button` |
| Profile menu button | `.profile-dropdown-button` |
| Tab bar | tab container at top |
