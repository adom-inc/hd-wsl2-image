---
name: hydrogen-eval
description: >
  Inject JavaScript into ANY surface of the Hydrogen window from inside
  the workspace — the app shell (top nav, dialogs), the VS Code workbench, the
  wiki panel, or the Claude chat webview. Backed by the control API's POST
  /eval-in, which connects directly to the right CDP target and returns the JS
  value. Use it to build add-ons (e.g. a usage meter in the top bar), demo
  overlays (a moving arrow that points at things), highlight elements, read DOM
  state, or drive the UI. Works in dev AND release builds. Trigger words:
  eval-in, inject ui, eval into hd, hd overlay, demo arrow, highlight element,
  add-on, addon, usage meter, inject script, target shell, target workbench,
  target claude, find probe, eval-in targets, point at element, nav widget.
---

# hydrogen-eval — inject JS into any Hydrogen surface (`POST /eval-in`)

The Hydrogen window is **not one page**. It's a tree of cross-origin surfaces, each a
separate Chrome DevTools Protocol (CDP) target/context:

| friendly target | what it is | typical use |
|---|---|---|
| `shell` | the Hydrogen app shell (Svelte): top nav, logo menu, dialogs, the floating layer | inject add-ons/overlays that float over everything |
| `workbench` | the VS Code editor (code-server) | activity bar, tabs, the "Claude Code: Open" button |
| `wiki` | the wiki panel iframe | wiki DOM |
| `claude` | the Claude Code chat **webview** (only exists while the panel is open) | the chat input + send button |

`/eval-in` figures out where a surface lives (it differs between dev and release —
see "Why two paths" below) and runs your JS there, returning the value.

## Finding the control port + reaching it from the workspace

The control API port is **dynamic** (auto-resolves conflicts per launch). From inside
the workspace, reach Hydrogen on `127.0.0.1` (WSL2 mirrored networking shares loopback with the
Windows host). Read the live control URL from the discovery file `~/.adom/hydrogen-control-url`
(your non-interactive Bash shells don't source `.bashrc`/`profile.d`, so the env var alone
is unreliable):

```bash
BASE="$(cat ~/.adom/hydrogen-control-url)"   # http://127.0.0.1:<dynamic>
```

(Never hardcode the port — read the live URL from `~/.adom/hydrogen-control-url`.)

## Discover the surfaces

```bash
curl -sf $BASE/targets | jq .
# each surface has a friendly alias (shell|workbench|wiki|claude), url, id.
# the claude target (Claude chat webview) appears only when that panel is open.
```

`POST /eval-in` with no `target` (or no `js`) also returns the surface list, so an
agent can ask "what can I inject into?" and pick.

## The call

```
POST /eval-in
{
  "target": "shell" | "workbench" | "wiki" | "claude" | "<url-substring>" | "<id>",
  "js":     "<javascript; value of last expression is returned>",
  "find":   "<OPTIONAL JS expression>",   // disambiguate among same-origin contexts
  "frame":  "<url-substring | index>",     // OPTIONAL nested-context selector
  "awaitPromise": true                      // OPTIONAL (default true)
}
→ { "ok": true, "value": <result>, "target": "<matched url>", "contextId": N, "frames": [...] }
```

### `find` — the important one

A surface can expose **several same-origin nested contexts** (the workbench
exposes ~6 `localhost:7380` contexts). Origin alone is ambiguous, so pass `find` —
a JS **expression** (e.g. `document.querySelector('...')`, NOT a bare CSS selector).
`/eval-in` evals it in each candidate context and runs your `js` in the **first
one where `find` is truthy**.

## Recipes

### Add-on: a widget in the top nav (e.g. a usage meter) — target `shell`
Inject once; it persists until reload. Append your element to `nav` in the shell.

### Demo overlay: a red arrow over everything that you reposition — target `shell`
Inject a `position:fixed; z-index:2147483647; pointer-events:none` element with a
CSS `transition` into the shell `body`, then move it with cheap follow-up evals
(it glides). The shell floats over all iframes, so window coords work everywhere.

### Highlight an element (even deep in the workbench / Claude webview)
Eval **inside the element's own surface** and set `outline` — no coordinate math.
Use `find` to land in the right context, e.g.
`find: document.querySelector("a[aria-label='Claude Code: Open']")`.

### Type into & submit the Claude chat (panel must be open)
Stable selectors (NOT the CSS-module hash classes like `.messageInput_xxxx`,
which change per build):
- input  = `[aria-label='Message input']` (a `contenteditable` div) — focus it,
  then `document.execCommand('insertText', false, text)`.
- submit = `button[type='submit'][data-permission-mode]` (disabled until text) —
  `.click()` it; fallback = dispatch an `Enter` keydown on the input.

## Why two paths (dev vs release) — you don't have to care

- **Dev build:** shell is `localhost:1420`; the workbench (`localhost:7380`) is
  same-process, so it's a context INSIDE the shell page (not a separate target).
  `/eval-in` falls back to the shell and filters contexts by origin.
- **Release build:** shell is `tauri.localhost`; the workbench is a different site →
  an out-of-process iframe (OOPIF) → its own top-level target. `/eval-in` connects
  directly.

You just pass `target:"workbench"` (or `claude`) and `/eval-in` picks the right
path. Prefer it over the older `/eval` (shell only) and `/iframe-eval`
(page-context walk, breaks in release).

## Verify-then-fallback (recommended)

`/eval-in` returns the JS value, so always verify: after an action, eval a probe
and check it; if it fails, try a second technique. The Hydrogen "eval-in demo" floating
toolbar does exactly this and logs endpoint + params + verify + fallback per step.

## Don'ts
- Don't hardcode the control port — read `/ports`.
- Don't pass `find` as a bare CSS selector — it's a JS expression.
- Don't select by CSS-module hash classes — use stable attributes (`aria-label`, `data-*`, `role`).
- Don't expect the `claude` webview to exist unless the Claude panel is open.
- Don't use `/eval` for workbench/Claude — it only reaches the shell page.

## Cross-references
- **hydrogen-api** — the full control API surface
- **hydrogen-ui** / **hydrogen-adom-menu** — where UI elements live
- **hydrogen-self-screenshot** — capture the result of your injection

## Recipe: hide/show activity-bar icons (the RIGHT way — persisted, overflow-proof)

Do NOT hide activity-bar icons with `display:none` on `.action-item` — that misses
icons collapsed into the "…" (Additional Views) **overflow** and doesn't persist.
Instead write VS Code's own source-of-truth state, then reload the workbench:

- **DB:** `vscode-web-state-db-global` → store `ItemTable` → key `workbench.activity.pinnedViewlets2`
- It's an array of `{id, pinned, visible, order}`. Set **`pinned:false` to hide** an
  icon from the activity bar (works even if it's in the overflow), **`pinned:true` to restore**.
- **IDs:** Explorer `workbench.view.explorer` · Search `workbench.view.search` ·
  Source Control `workbench.view.scm` · Run&Debug `workbench.view.debug` ·
  Extensions `workbench.view.extensions` (extension views: `workbench.view.extension.<id>`).
- IndexedDB is **per-origin**, so read/write from **any** `localhost:7380` context
  (target `workbench`, `find: "(typeof indexedDB!=='undefined')"`) — don't require the
  workbench main doc (it's absent during a reload).
- After writing, **reload the workbench** (`iframe.src=iframe.src` on the `shell`, or
  `POST /reload-vscode`) so VS Code re-reads `pinnedViewlets2`.

```jsonc
// hide Search / Source Control / Run&Debug (then reload)
{ "target":"workbench", "find":"(typeof indexedDB!=='undefined')", "awaitPromise":true,
  "js":"(async function(){function g(d,k){return new Promise(function(r){var o=indexedDB.open(d);o.onsuccess=function(){var b=o.result;var q=b.transaction('ItemTable','readonly').objectStore('ItemTable').get(k);q.onsuccess=function(){b.close();r(q.result)}}})}function p(d,k,v){return new Promise(function(r){var o=indexedDB.open(d);o.onsuccess=function(){var b=o.result;var t=b.transaction('ItemTable','readwrite');t.objectStore('ItemTable').put(v,k);t.oncomplete=function(){b.close();r(true)}}})}var DB='vscode-web-state-db-global',K='workbench.activity.pinnedViewlets2';var a=JSON.parse(await g(DB,K));var ids=['workbench.view.search','workbench.view.scm','workbench.view.debug'];a.forEach(function(e){if(ids.indexOf(e.id)>-1)e.pinned=false});await p(DB,K,JSON.stringify(a));return 'hidden';})()" }
```

The Hydrogen demo toolbar's **Hide / Restore activity icons** buttons (`/demo/run
{action:"hide-activitybar"|"show-activitybar"}`) do exactly this. The setup-steps
`configure-vscode` step should hide icons this way too (persisted across the
mid-setup reload), not via CSS or transient `:8821` layout calls.
