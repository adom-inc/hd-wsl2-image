---
name: hd-browser-picker
description: HD's Browser Picker — the canonical handler for EVERY URL that gets opened inside HD. Click a link anywhere (main page, code-server iframe, webview panel, PortMappingsDialog, OAuth redirect, localhost link, external link) and HD intercepts it via 5 layers (on_new_window / on_navigation / NewWindowRequested / AddScriptToExecuteOnDocumentCreated / ContextMenuRequested) and routes it through the BrowserProfileDialog so the user (or an AI driving automation) picks where it opens — native browser profile, Hydrogen tab, HD window, or Pup. 5-second auto-countdown so AIs don't block waiting on a click. Read BEFORE adding a URL-opening feature, debugging dead links, fixing `shell.open not allowed`, or automating browser interactions from HD. Trigger words — browser picker, BrowserProfileDialog, hd-open-url, hd-open-url-force, open with browser picker, shell.open not allowed, shell:default, shell:allow-open, plugin-shell, url interception, link click, target blank, claude auth url, adom auth url, oauth callback in browser, default browser, browser profile, AI browser automation, countdown picker, auto-timer, shift click force, right-click open with, context menu, webview links, on_new_window, hd-links (legacy name).
---

# Hydrogen Desktop — Browser Picker (URL Interception)

## The Problem

HD wraps a WebView2 that contains:
- The Hydrogen SvelteKit frontend (localhost:1420)
- A code-server iframe (localhost:8080) with VS Code + Claude Code
- Webview panel iframes (any external URL like wiki, google, etc.)

When a link is clicked anywhere in this stack, HD needs to:
1. Catch it before it opens uncontrolled
2. Route it through the Browser Picker dialog
3. Let the user choose: native browser (Chrome/Edge), Hydrogen Tab, HD Browser Window, or Pup

## The 5 Interception Layers

Each layer catches a different type of URL event. All registered in `setup_frame_navigation_interception()` in `hd-app/src/lib.rs` via `webview.with_webview()`.

### Layer 1: `on_new_window` (Tauri wrapper)
**Catches:** `window.open()`, `<a target="_blank">` from the TOP-LEVEL webview and direct child frames
**Action:** Deny ALL. Dispatch to Browser Picker via CustomEvent.
**Shift detection:** Yes — `GetAsyncKeyState(0x10)` checks if Shift is held, dispatches `hd-open-url-force` for Browser Picker override.
**Debounce:** 500ms to prevent event loops.

### Layer 2: `on_navigation` (Tauri wrapper)
**Catches:** Top-level frame navigations (someone navigating the main webview to an external URL)
**Action:** Allow localhost/tauri/data/about. Block all external HTTPS. Dispatch to Browser Picker.

### Layer 3: `add_FrameNavigationStarting` (raw COM)
**Catches:** ALL child frame navigations (iframe navigating itself)
**Action:** Log only — don't block. Webview panels legitimately load external URLs in iframes.
**Why not block:** Blocking breaks webview panels (they need external URLs). Same-domain navigations (wiki → wiki/skills) work fine.

### Layer 4: `add_NewWindowRequested` (raw COM)
**Catches:** New window requests that Tauri's wrapper might miss
**Action:** `SetHandled(true)` for external URLs. No event dispatch (Tauri's handler does that).
**Purpose:** Safety net — prevents any uncontrolled window from being created.

### Layer 5: `AddScriptToExecuteOnDocumentCreated` (WebView2 API)
**Catches:** `<a target="_blank">` clicks inside cross-origin iframes
**Why needed:** Cross-origin iframe `target="_blank"` clicks don't fire `NewWindowRequested` on the parent WebView2. This is a WebView2 security boundary.
**How:** Injects a click listener into ALL frames (including cross-origin) that intercepts `target="_blank"` clicks and dispatches a CustomEvent to `window.top`.
**Survives:** Page reloads, iframe navigations — WebView2 auto-injects on every document load.

### Layer 6: `add_ContextMenuRequested` (raw COM, ICoreWebView2_11)
**Catches:** Right-click on links
**Action:** Adds "Open Link with Browser Picker" or "Open Page with Browser Picker" to the native WebView2 context menu.
**How:** Cast `ICoreWebView2` → `ICoreWebView2_11`, register handler. On right-click, check `HasLinkUri()`, create custom menu item via `ICoreWebView2Environment9.CreateContextMenuItem()`, register `add_CustomItemSelected` handler that dispatches `hd-open-url-force`.

## What Each Click Type Triggers

| User action | Where | Layer that catches | Result |
|---|---|---|---|
| Left-click `<a target="_blank">` in webview panel iframe | Cross-origin iframe | Layer 5 (JS script) | Browser Picker |
| Left-click regular `<a href>` in webview panel iframe | Cross-origin iframe | Layer 3 (logged) | Navigates iframe normally |
| Right-click → "Open in new window" | Any iframe | Layer 1 (on_new_window) | Browser Picker |
| Right-click → "Open Link with Browser Picker" | Any link | Layer 6 (context menu) | Browser Picker (force) |
| Shift+click any link | Anywhere | Layer 1 + shift detection | Browser Picker (force, no auto-timer) |
| `window.open()` from code-server | Code-server iframe | Layer 1 (on_new_window) | Browser Picker |
| `vscode.env.openExternal()` from Claude Code | Code-server → window.open | Layer 1 (on_new_window) | Browser Picker |
| Claude Code auth button | Code-server extension | Layer 1 (on_new_window) | Claude-branded Browser Picker |

## Browser Picker Dialog

`src/lib/components/BrowserProfileDialog.svelte`

### 3 Branded Variants
1. **Claude auth** — Claude logo, "Connect to Claude Code" (domains: `*.claude.ai`, `*.claude.com`)
2. **Adom auth** — Adom logo, "Sign in to Hydrogen Desktop" (domains: `*.adom.inc` + `/auth/intent`)
3. **General link** — "Browser Picker" title, no logo

### Consistent Elements (all variants)
- "Browser Picker" title at top
- Native Browsers section with real Google profile avatars
- Hydrogen Desktop section (collapsible, collapsed for auth)
- Details section (collapsible, collapsed) — URL, remember checkbox, trigger info, build version
- 5-second auto-timer with progress bar (cancelled by mouse movement)
- Keyboard navigation (arrow keys + Enter)
- 800ms delayed tooltips

### Auto-Timer Behavior
- Picks best default: work browser profile (non-gmail email) for auth, Pup for right-click/iframe opens
- 5-second countdown with progress bar
- ANY mouse movement cancels the timer
- Shift+click (force-show) disables timer entirely
- Selected destination highlighted with teal border

### ⭐ Fresh-window option (first-class)
A **freshly-launched browser window/process auto-foregrounds on Windows** — focus-stealing
prevention does NOT block a process's own first window. A URL opened as a *tab* in an
already-running browser does NOT reliably come to the front. So "fresh" is the proven way
to make the **Claude/Adom consent page pop to the front by itself** (removes the manual
foreground step that used to block hands-free auth).

- Mechanism: launch the browser exe with `--new-window` (Chromium) / `-new-window`
  (Firefox) before the URL, instead of `open::that(url)` (shell-open can't force a window).
- UI: an **"Open in a fresh window"** checkbox above the Native Browsers list. **Defaulted
  ON for auth URLs** (Claude/Adom), OFF otherwise. Only native-browser destinations honor
  it; internal HD destinations ignore it. The dialog dispatches `select` with
  `fresh: dest.category==='native' ? freshWindow : false`; `onProfileSelect` threads it to
  `open_in_browser_profile` / `/open-in-profile`.
- `fresh` is honored by: Tauri `open_in_browser_profile` (direct), `POST /open-in-profile`
  (direct), and `POST /open-url` (where it **pre-seeds the picker's toggle**; add
  `direct:true` to open immediately instead). Direct paths echo
  `{"fresh":…, "method":"<exe … fresh-window>"}`.
- Dev Toolbar A/B debug buttons: **▶ Open URL — FRESH window** vs **▶ Open URL — normal**.

### URL Event Deduplication
Frontend deduplicates URL events within 1-second window (same URL) to prevent double-open from multiple layers firing for the same click. Force events (Shift) bypass dedup.

### Prefs Sync
Preferences re-read from localStorage on every dialog open. If user deletes a domain in Browser Picker Manager, the next dialog open reflects it immediately.

## Custom Context Menu Implementation

Uses raw COM API via `ICoreWebView2_11` (cast from `ICoreWebView2` using `windows::core::Interface::cast`).

Key COM types used:
- `ICoreWebView2_11` — has `add_ContextMenuRequested`
- `ICoreWebView2Environment9` — has `CreateContextMenuItem`
- `ICoreWebView2ContextMenuTarget` — `HasLinkUri()`, `LinkUri()`, `PageUri()`
- `ICoreWebView2ContextMenuItemCollection` — `Count()`, `InsertValueAtIndex()`
- `ICoreWebView2ContextMenuItem` — `add_CustomItemSelected()`
- `COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND` — command-type menu item

webview2-com 0.38 handler types used: `ContextMenuRequestedEventHandler`, `CustomItemSelectedEventHandler`

### How we got the context menu working (the full story)

**Initial assumption:** webview2-com 0.38 doesn't have context menu types. WRONG.

**First attempt:** Upgrade to webview2-com 0.39 which obviously has them. FAILED — 0.39 requires `windows 0.62` but Tauri pins `windows 0.61`. The upgrade broke 15+ API call sites due to `PCWSTR`/`HSTRING` type changes.

**Second attempt:** Write raw COM vtable bindings for ICoreWebView2_11 manually. UNNECESSARY.

**The discovery:** webview2-com 0.38 DOES export all the types. They're in `webview2_com::Microsoft::Web::WebView2::Win32::*` — the same module as everything else. The standard `.cast()` pattern works:

```rust
use windows::core::Interface;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_11,
    ICoreWebView2Environment9,
    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
};

// Cast from base ICoreWebView2 — no raw vtable, no version upgrade
let core11: ICoreWebView2_11 = core.cast()?;
let env9: ICoreWebView2Environment9 = env.cast()?;
```

**The BOOL gotcha:** The one type that didn't work was `windows::Win32::Foundation::BOOL`. In windows 0.61, `BOOL(0)` isn't valid (it's not a tuple struct). `BOOL::default()` also fails (can't find it in the module). The fix is a raw cast:

```rust
let has_link = {
    let mut val = 0i32;
    target.HasLinkUri(&mut val as *mut i32 as *mut _)?;
    val != 0
};
```

COM `BOOL` is just an `i32` under the hood (0 = false, non-zero = true). Casting the pointer works perfectly.

**The full chain:**
```rust
// 1. Cast to ICoreWebView2_11
let core11: ICoreWebView2_11 = core.cast()?;

// 2. Register ContextMenuRequested handler
core11.add_ContextMenuRequested(&handler, &mut token)?;

// 3. In the handler: get the right-click target
let target = args.ContextMenuTarget()?;

// 4. Check if it's a link (BOOL workaround)
let mut val = 0i32;
target.HasLinkUri(&mut val as *mut i32 as *mut _)?;

// 5. Get the link URL
let mut uri = PWSTR::null();
target.LinkUri(&mut uri)?;
let url = uri.to_string().unwrap_or_default();

// 6. Create custom menu item via Environment9
let env9: ICoreWebView2Environment9 = env.cast()?;
let item = env9.CreateContextMenuItem(&label, None, KIND_COMMAND)?;

// 7. Add click handler
item.add_CustomItemSelected(&click_handler, &mut token)?;

// 8. Insert at top of context menu
let items = args.MenuItems()?;
items.InsertValueAtIndex(0, &item)?;
```

**Lesson:** Don't assume a crate is missing types because the docs are sparse. The `webview2_com::Microsoft::Web::WebView2::Win32::*` re-export brings in the ENTIRE WebView2 COM type library. If the COM interface exists in the WebView2 SDK, the Rust binding exists too — you just need to cast to the right version interface.

## AddScriptToExecuteOnDocumentCreated Script

```js
(function() {
    if (window.__hdLinkIntercept) return;
    window.__hdLinkIntercept = true;
    document.addEventListener('click', function(e) {
        var a = e.target.closest('a[target="_blank"]');
        if (!a) return;
        var href = a.href;
        if (!href || href.startsWith('javascript:')) return;
        if (new URL(href).hostname === window.location.hostname) return;
        e.preventDefault();
        e.stopPropagation();
        try {
            window.top.dispatchEvent(new CustomEvent('hd-open-url', {
                detail: JSON.stringify({
                    url: href,
                    trigger: 'target_blank_click',
                    shiftHeld: e.shiftKey
                })
            }));
        } catch(err) {
            window.parent.postMessage({
                type: 'hd-open-url', url: href, trigger: 'target_blank_click'
            }, '*');
        }
    }, true);
})();
```

**Why same-domain is allowed:** `if (new URL(href).hostname === window.location.hostname) return;` — wiki links to other wiki pages should navigate the iframe normally. Only cross-domain links get intercepted.

## WebView2 Event Architecture — What We Learned

### How to access raw WebView2 COM APIs from Tauri

Tauri exposes the platform webview via `webview.with_webview(|platform_webview| { ... })`. The closure runs on the main (UI) thread where COM objects live.

```rust
let controller = platform_webview.controller();  // ICoreWebView2Controller
let env = platform_webview.environment();         // ICoreWebView2Environment
let core = controller.CoreWebView2().unwrap();    // ICoreWebView2
```

From the base `ICoreWebView2`, you can cast to higher interfaces:
```rust
use windows::core::Interface;
let core4: ICoreWebView2_4 = Interface::cast(&core).unwrap();   // for add_FrameCreated
let core11: ICoreWebView2_11 = core.cast().unwrap();             // for add_ContextMenuRequested
let env9: ICoreWebView2Environment9 = env.cast().unwrap();       // for CreateContextMenuItem
```

### WebView2 event handler types in webview2-com 0.38

The crate provides `*EventHandler::create(Box::new(|sender, args| { ... }))` factory methods:
- `NavigationStartingEventHandler` — for `add_NavigationStarting` / `add_FrameNavigationStarting`
- `NewWindowRequestedEventHandler` — for `add_NewWindowRequested`
- `ContextMenuRequestedEventHandler` — for `add_ContextMenuRequested`
- `CustomItemSelectedEventHandler` — for context menu item click
- `AddScriptToExecuteOnDocumentCreatedCompletedHandler` — callback for script registration
- `FrameCreatedEventHandler` — for `add_FrameCreated` (on ICoreWebView2_4)

All handlers register with a `&mut i64` token parameter (for later removal).

### The event token pattern
```rust
let mut token = 0i64;
core.add_FrameNavigationStarting(&handler, &mut token)?;
// token is now set — save it to call remove_FrameNavigationStarting later
```

### Which events fire at which iframe depth

| Event | Top-level | Direct child iframe | Cross-origin child iframe |
|---|---|---|---|
| `NavigationStarting` (on_navigation) | Yes | No | No |
| `FrameNavigationStarting` | N/A | Yes | Yes (same-domain only for some) |
| `NewWindowRequested` (on_new_window) | Yes | Yes (same-origin) | **NO** (cross-origin) |
| `ContextMenuRequested` | Yes | Yes | Yes |

The critical gap: **cross-origin iframe `target="_blank"` clicks don't fire `NewWindowRequested`** on the parent. This is a WebView2 security boundary, not a bug.

### AddScriptToExecuteOnDocumentCreated — the secret weapon

This is a WebView2 configuration API, not eval injection. Key properties:

1. **Registered once** on `ICoreWebView2`, applies forever
2. **Runs in ALL frames** — top-level, child iframes, cross-origin iframes, nested iframes
3. **Runs BEFORE page JavaScript** — your script is guaranteed to execute first
4. **Survives navigations** — when the frame navigates to a new page, the script runs again
5. **Survives reloads** — F5, location.reload(), everything
6. **Controlled by WebView2** — not by the page, not by JS, not by CORS

This is how Electron handles preload scripts. It's the ONLY reliable way to run code inside a cross-origin iframe without the iframe's cooperation.

```rust
let script = windows::core::HSTRING::from("(function() { /* your code */ })();");
let handler = webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
    Box::new(|_, _| Ok(()))
);
core.AddScriptToExecuteOnDocumentCreated(&script, &handler)?;
```

The script has access to:
- `window.top` — can dispatch CustomEvents to the top-level page (works even cross-origin in WebView2)
- `window.parent.postMessage()` — fallback if `window.top` access is blocked
- `document.addEventListener()` — full DOM access within the frame
- `window.location` — the frame's current URL

We use it to intercept `target="_blank"` clicks that would otherwise be invisible to the Rust layer.

### COM method signature patterns in webview2-com 0.38

The types use a mix of safe wrappers and raw out-parameters:

**Safe wrappers (return `Result<T>`):**
```rust
let target = args.ContextMenuTarget()?;    // returns Result<ICoreWebView2ContextMenuTarget>
let items = args.MenuItems()?;              // returns Result<ICoreWebView2ContextMenuItemCollection>
let item = env9.CreateContextMenuItem(&label, None, KIND_COMMAND)?; // returns Result<ICoreWebView2ContextMenuItem>
```

**Out-parameter methods:**
```rust
let mut has_link = windows::Win32::Foundation::BOOL(0);
target.HasLinkUri(&mut has_link)?;          // writes to has_link
if has_link.as_bool() { ... }

let mut uri = windows::core::PWSTR::null();
target.LinkUri(&mut uri)?;                  // writes to uri
let url = uri.to_string().unwrap_or_default();

let mut count = 0u32;
items.Count(&mut count)?;                   // writes to count
```

**Event registration:**
```rust
let mut token = 0i64;
menu_item.add_CustomItemSelected(&handler, &mut token)?;
items.InsertValueAtIndex(count, &menu_item)?;
```

### Cargo.toml requirements

The `Win32_Foundation` and `Win32_System_Com` features must be enabled on the windows crate for BOOL and COM types:
```toml
[target.'cfg(windows)'.dependencies]
webview2-com = "0.38"
windows = { version = "0.61", features = [
    "Win32_Foundation",
    "Win32_System_Com",
    "Win32_System_WinRT",
    ...
] }
```

## Hard-Won Lessons

### `NewWindowResponse::Allow` must NEVER be returned
Original code returned `Allow` for localhost URLs. Code-server's `openExternal` wraps URLs in localhost routes. Returning `Allow` created uncontrolled WebView2 windows with no handlers. Fix: Deny everything, always.

### Cross-origin iframe `target="_blank"` is invisible to WebView2
No COM event fires on the parent WebView2 when a cross-origin child iframe has a `target="_blank"` click. Not `NewWindowRequested`, not `FrameNavigationStarting`, not `NavigationStarting`. The ONLY way to catch it: `AddScriptToExecuteOnDocumentCreated`.

### `on_new_window` features param isn't a string
Tauri's `on_new_window` callback receives `(Url, NewWindowFeatures)`. `NewWindowFeatures` is a struct with `size()` and `position()` methods, NOT a string. Can't call `.is_empty()`.

### `dispatch_url_event` needs 200ms delay
At 50ms, the webview eval sometimes doesn't process. 200ms is reliable.

### Domain check must only check the domain, not query params
URLs like `https://claude.com/oauth?redirect_uri=http://localhost:PORT` contain "localhost" in the query string. The `is_internal` check must parse the domain from `url.split('/').nth(2)`, not `url.contains("localhost")`.

### webview2-com 0.38 vs 0.39
0.38 is pinned by Tauri v2 (requires windows 0.61). 0.39 requires windows 0.62 and breaks 15+ API signatures. But 0.38 DOES have `ICoreWebView2_11`, `ContextMenuRequestedEventHandler`, and related types — they just use out-parameter patterns, not safe wrappers. Use `core.cast::<ICoreWebView2_11>()` which works in 0.38.

## Files

| File | What |
|---|---|
| `src-tauri/crates/hd-app/src/lib.rs` | All 6 interception layers, dispatch_url_event, context menu |
| `src/lib/components/BrowserProfileDialog.svelte` | Browser Picker dialog (3 variants, auto-timer, keyboard nav) |
| `src/lib/components/editor/EditorNav.svelte` | Browser Picker Manager modal |
| `src/routes/+layout.svelte` | CustomEvent listeners, URL event parsing, deduplication |
| `src/lib/assets/claude-logo.svg` | Real Claude logo from claude.ai/favicon.svg |
| `src/lib/assets/adom-logo-teal.svg` | Adom brand logo |
| `src/lib/buildVersion.ts` | Build version tracking for verification |
| `src-tauri/capabilities/default.json` + `src-tauri/crates/hd-app/capabilities/default.json` | Tauri permissions — MUST include `shell:default` AND `shell:allow-open` |

## The 5-second auto-countdown (why AI loves it)

The picker opens with a countdown on its best-default destination. If nothing interrupts, the URL auto-routes there. This is the key feature for AI automation: triggers like OAuth redirects, "open in browser" links, or wiki references work hands-free.

- **AI scripts can fire a URL open and the right thing happens within 5s** — no clicking, no blocking on a dialog.
- **Mouse movement cancels the timer** — if a human is at the keyboard, just wiggle the mouse and the picker waits.
- **Shift+click disables the timer entirely** — forces an explicit human choice.

Best-default heuristic:
- `*.claude.ai` / `*.claude.com` → "Claude auth" variant, defaults to work browser profile
- `*.adom.inc` + `/auth/intent` → "Adom auth" variant, defaults to work browser
- Right-click / iframe / unknown context → Pup (AI-drivable browser)
- General → user's last pick for that domain

## Localhost URLs route through the picker too

**Rule:** ALL http(s) URLs go through the picker, including `http://localhost:*` and `http://127.0.0.1:*`. PortMappingsDialog's container-service links must open in the user's chosen browser, NOT in a popup-blocked WebView2 child window.

The `on_new_window` handler in `lib.rs` (line ~1986) MUST dispatch `hd-open-url` for both internal AND external URLs. If you see `is_internal` short-circuiting the dispatch with no `dispatch_url_event` call, that's the bug — internal URLs fall through to Tauri's default `shell.open()` which then fails with the permission error below.

## `shell:default` is non-negotiable

The picker's "open in native browser" path ultimately calls `@tauri-apps/plugin-shell.open()`. That requires BOTH `shell:allow-open` AND `shell:default` in BOTH capability files. Without `shell:default` you get this exact rejection in the HD log:

```
[JS UNHANDLED REJECTION] shell.open not allowed. Permissions associated with this command: shell:allow-open, shell:default
```

Both files must list both permissions:
- `src-tauri/capabilities/default.json`
- `src-tauri/crates/hd-app/capabilities/default.json` (the hd-app crate's own capabilities)

Tauri compiles capabilities INTO the binary at build time. Capability changes require a Rust rebuild (`hd_build_rust`), not just a frontend rebuild.

## AI automation recipe

```bash
# 1. (Optional) Set Pup as default for domains you want to drive
#    HD UI → Settings → Browser Picker Manager → add domain → choose Pup
#    OR let the 5s auto-countdown pick Pup for unknown URLs.

# 2. Trigger a URL open
adom-desktop shell_execute '{"command":"curl -s -X POST -d {\"url\":\"https://example.com\"} http://127.0.0.1:47084/open-url"}'

# 3. Within 5s, picker auto-routes to Pup (or saved pref)
# 4. Drive Pup with adom-desktop browser_* verbs
adom-desktop browser_eval '{"sessionId":"default","js":"document.title"}'

# Force a picker dialog (no auto-timer)
adom-desktop shell_execute '{"command":"curl -s -X POST -d {\"url\":\"https://example.com\",\"force\":true} http://127.0.0.1:47084/open-url"}'

# Route through the picker with the fresh-window toggle PRE-CHECKED (force = skip the
# 5s timer). The user/AI then picks a native browser → opens fresh + auto-foregrounds.
adom-desktop hd_api '{"method":"POST","path":"/open-url","body":{"url":"https://claude.ai/","fresh":true,"force":true}}'
# BYPASS the picker and open directly in a specific browser+profile, fresh:
adom-desktop hd_api '{"method":"POST","path":"/open-in-profile","body":{"url":"https://claude.ai/","browser":"edge","profileDir":"Default","fresh":true}}'
# /open-url with direct:true also bypasses the picker (opens immediately, default browser):
adom-desktop hd_api '{"method":"POST","path":"/open-url","body":{"url":"https://claude.ai/","fresh":true,"direct":true}}'
```

`/open-url` ROUTES THROUGH THE PICKER by default (emits `browser-open-request`):
`fresh` pre-seeds the "Open in a fresh window" toggle, `force:true` skips the 5s
auto-timer, `direct:true` (or naming a concrete `browser`) bypasses the picker and
opens immediately. The response `routed` field is `"browser-picker"` or `"direct"`.
`/open-in-profile` always opens directly (no picker). Both direct paths echo
`method:"msedge.exe … fresh-window"` — read it before claiming success.

## Prefs are now an API — the picker is a FALLBACK, not a gate

The per-domain routing memory is CRUD over the control API, so the **AI governs routing** and
the picker only pops for a domain with no policy + no direct call:
`GET /browser-picker/prefs` (read `{domains:{<host>:{destination,label}}}`),
`PUT /browser-picker/prefs {domain,destination,label?}` (set/override),
`DELETE /browser-picker/prefs/<host>` (forget one), `DELETE /browser-picker/prefs` (clear all).
`destination` is an ID: `hydrogen-tab` | `webview-window` | `pup-window`, or
`browser:<browser>:<dir>` (profile dir encoded in the ID). `fresh` is per-open, not stored.
Writes hit the Manager's live state (localStorage + `hd-url-routing-prefs-changed`). Full
routing-policy guidance lives in **[hd-open-url](../hd-open-url/SKILL.md)**.

## How HD skills get deployed (workflow note)

HD public skills (this one, hd-open-url, hd-monitor, etc.) live in the HD repo under `skills/public-facing/{shared,wsl2,docker}/<name>/SKILL.md`. They're deployed into the user's workspace by the `install-hd-skills` setup step, which is runtime-aware: it installs `shared/` plus the active runtime's bucket (`wsl2/` by default via the `/mnt/c` auto-mount; `docker/` via `docker cp` under `HD_RUNTIME=docker`), flat into `~/.claude/skills/<name>/`. See `hd-skill-catalog` (public) and `hd-skills-structure` (dev-internal) for the full layout.
