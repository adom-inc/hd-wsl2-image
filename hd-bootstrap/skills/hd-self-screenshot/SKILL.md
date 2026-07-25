---
name: hd-self-screenshot
description: >
  Screenshot HD from inside the workspace — a panel/webview (the welcome page, a
  tab), the whole workspace, OR the whole screen/desktop — using the BUILT-IN
  `adom-cli hydrogen screenshot`. It saves a PNG into the container's
  `screenshots/` folder and prints the path to Read. THE answer for "take a
  screenshot of the welcome page", "screenshot the webview", "screenshot this
  panel", "screenshot the editor", "screenshot my whole screen / the desktop",
  "show me what HD looks like", or verifying a UI change (ralph loop). Use this
  even for "my whole screen / my desktop / my monitor" — that's the `screen`
  scope. You do NOT need any image resizer. For a SPECIFIC element/region (a CPU
  meter, a menu, a dialog, a toolbar) or an inline-b64 PNG, use the canonical
  `POST /screenshot` control endpoint with a CSS `selector` (it ALWAYS region-clips
  to that element) — and combine it with the UI command bus (`hd-ui`: `ui/invoke`
  to open a menu/dialog, then `/screenshot` its selector). Identical across web
  Hydrogen and HD. Trigger words — screenshot HD, screenshot the welcome page,
  screenshot the webview, screenshot a panel, screenshot a tab, screenshot the
  workspace, screenshot the editor, screenshot my screen, screenshot the whole
  screen, screenshot the desktop, capture my monitor, full screen capture,
  screenshot everything on screen, what does HD look like, adom-cli hydrogen
  screenshot, capture panel, capture workspace, capture screen, screenshot a region,
  clip to selector, screenshot an element, screenshot a menu, screenshot a dialog,
  region screenshot, b64 screenshot, POST /screenshot, /shot, screenshot without flash,
  no-flash screenshot, which screenshot tool, verify visually, ralph loop, shotlog,
  image resizer, resize screenshot.
---

# HD — Screenshot a panel / webview / the workspace / the screen

The built-in way to screenshot anything inside HD is the **`adom-cli hydrogen
screenshot`** command — the *same* `adom-cli` you already use. It captures the
real rendered surface, drops a PNG into the container's `screenshots/` folder,
and prints the path. Just `Read` that path. **No image resizer needed.**

## Which screenshot tool? — the priority ladder

What you're capturing (and whether you want the teal flash) picks the tool. Default to
HD-native:

1. **HD content — a panel, the workspace, the editor, a webview, the screen
   (the 99% case): `adom-cli hydrogen screenshot panel|workspace|screen`. THIS IS THE
   DEFAULT — reach for it first.** It's the *same* command in web Hydrogen and HD (HD is
   meant to behave like web Hydrogen, and `adom-cli` is the one surface that's identical on
   both), saves a PNG to your container's `screenshots/`, and you just `Read` it. Don't lead
   with an HD-only endpoint.
   - **HD-only enhancement / power path — `POST /screenshot {target, selector, b64, silent}`
     (CDP).** Use ONLY when you need something `adom-cli` doesn't give you: a precise CSS
     `selector` region-clip, an inline-base64 PNG (`b64`), or a `silent` (no-flash) grab — see
     below. It does NOT exist in web Hydrogen, so it's a deliberate step OFF the consistent path.
   - **The one time you switch to CDP for an ordinary shot:** during another thread's
     recording the `adom-cli` SSE path returns `capture_busy` — then fall to `POST /screenshot`
     (CDP), which coexists (see "During a recording" below). That's a fallback, not the default.

## During a recording (multi-thread) — pick a coexisting method, never blind-retry

Adom users run **multiple AI threads on one HD**, so another thread may be recording the
screen while you capture. **Only the `adom-cli` SSE path (`screenshot panel/workspace/screen`)
is affected** — the CDP path coexists. HD makes this deterministic:

- **Pre-flight `GET /capture/availability`** → reports the recording state plus, per method,
  reliability + whether it coexists with a recording, a `recommended` method, and a `_hint`.
  Check it **only when a recording might be running.**
  - **`recommended` is STATE-DEPENDENT and agrees with the default:** when
    `recording.active === false` it returns **`"sse"`** (≡ `adom-cli hydrogen screenshot`, the
    web-Hydrogen-consistent default); when `recording.active === true` it returns **`"cdp"`**
    (the SSE path would `capture_busy`, so CDP is correct). So you can follow `recommended`
    directly — it will never push you off `adom-cli` while idle. Your everyday default remains
    `adom-cli`; CDP is the during-a-recording fallback.
- **`capture_busy`:** the SSE path (`PATCH /current/screenshot`, i.e. `adom-cli screenshot
  panel/workspace`) returns, the moment a recording is active, `{ok:false, error:"capture_busy",
  retry_after_ms, alternatives:[{method:"cdp"}], _hint}` — never an empty body. **On
  `capture_busy`: read `alternatives` and SWITCH — do NOT blindly retry the SSE path.**
- Authoritative recording state: `GET /recording/native/status`. See `hd-recording`.

## Pick the scope — panel / workspace / screen

| You want… | Command | Sub-command |
|---|---|---|
| ONE panel or webview tab (the welcome page, a viewer, the editor) | `adom-cli hydrogen screenshot panel …` | `panel` |
| The whole HD **workspace** (every panel side by side) | `adom-cli hydrogen screenshot workspace` | `workspace` |
| The whole **screen** — desktop, taskbar, OTHER apps | `adom-cli hydrogen screenshot screen` | `screen` |

**"My whole screen / my desktop / my monitor / everything"** → `adom-cli hydrogen
screenshot screen`. The HD `screen` scope captures the real desktop and saves the PNG into
your container, same as the others.

## Do this — it saves a PNG and prints the path; then Read it

```bash
# Whole workspace (simplest — no tab name needed):
adom-cli hydrogen screenshot workspace
# → prints  screenshots/<ts>.png  (relative to ~/project) → Read ~/project/screenshots/<ts>.png

# Whole screen / desktop (other apps, taskbar):
adom-cli hydrogen screenshot screen --reason "show the desktop"

# A specific panel / webview tab. Tab names are whatever the USER has open — DON'T
# guess (a guess like --name welcome 404s if the tab is actually named "Wiki").
# If you're not certain the tab exists by that name, LIST tabs first:
adom-cli hydrogen workspace get        # shows every panel/tab: its id AND name
# then capture by --tab-id (most reliable) or the EXACT name you saw:
adom-cli hydrogen screenshot panel --tab-id <tabId>
adom-cli hydrogen screenshot panel --name "3D Viewer"
```

The welcome page is *usually* a tab named "Welcome", but on an active workspace it
may be replaced (e.g. by a "Wiki" tab) — so if `--name welcome` 404s with
`No tab matching 'welcome'`, run `adom-cli hydrogen workspace get` and screenshot
the webview tab you find by its `--tab-id`.

### What it returns — a saved path; just Read it
The command saves the PNG into the container's `screenshots/` folder and prints the
path. **Read it — done.** No decoding, no resizer, no second tool. The printed path
is **relative to `~/project`** (matches the cloud contract); the `_hint` gives the full
path:

```
screenshots/2026-06-13T20-04-43.png
_hint: Screenshot saved to ~/project/screenshots/<ts>.png. Read the file to view it.
```
→ `Read ~/project/screenshots/<ts>.png` (prepend `~/project/` to the line-1 path, or
just use the full path from the `_hint`).

### If a capture errors, retry once
A COLD capture can occasionally fail with a proxy URL containing a literal `{{port}}`
(e.g. `…/proxy/{{port}}/: error sending request`) — a known **adom-cli** cold-start
race (the proxy port isn't substituted yet). Just **run the same command again**; the
warm retry succeeds.

## Sharing must be active (it usually is; here's the gate)

Capturing a panel/workspace needs an active tab/screen share. Check and, if
needed, the `--reason` you pass pops a one-time approval the user clicks:

```bash
adom-cli hydrogen screenshot status     # → {"sharing":{"active":true},"availableScopes":["panel","workspace"]}
# If a panel/workspace shot 409s or says sharing isn't active, just include
# --reason "<why>" (it triggers the approval dialog), or explicitly request it:
adom-cli hydrogen sharing request --share tab     # panel/workspace scopes
adom-cli hydrogen sharing request --share screen  # adds the 'screen' scope
```
The `screen` scope is for the whole desktop; `panel`/`workspace` come from tab
sharing. See `hd-capture-share` for the sharing/approval UX.

**Release SCREEN sharing when you're done.** A `screen` share (getDisplayMedia) holds the
display **awake** — leaving it active blocks the user's screensaver. After a one-off
`screen` capture, run `adom-cli hydrogen sharing stop` (and close any Pup windows you
opened). Tab `panel`/`workspace` sharing doesn't hold the display, so this only matters
once you've requested the `screen` scope.

## Why this works the same in HD as it does for web Hydrogen

`adom-cli` is **one binary** used by both web Hydrogen and HD — you can test these
commands anywhere. The difference is purely *where the work runs*: HD intercepts
what adom-cli talks to. `adom-cli hydrogen <cmd>` hits `ADOM_HYDROGEN_URL`, which
in HD points at **HD's local proxy**. HD's proxy pulls out the **local hydrogen/SSE
commands** (screenshot, webview, caption, notify, recording…) and runs them against
the HD frontend over SSE, while **carbon/cloud calls pass straight through** to the
cloud. For a screenshot: `PATCH /current/screenshot` → HD broadcasts an SSE
`screenshot_request` → the frontend Element-Captures the panel → uploads it into
**this container's** `screenshots/` folder → the CLI returns the saved path. So the
command, and the returned path, behave the same — the bytes just land in your local
container.

## What NOT to do (these are the traps)

- **You do NOT need an image resizer.** `adom-cli hydrogen screenshot` produces a
  normal PNG and the `Read` tool reads PNGs directly. (Don't reach for ImageMagick
  `convert` or Pillow — neither is guaranteed in the golden image, and you don't
  need them.)

## Capture ANY region, element, or surface — `POST /screenshot`

`adom-cli hydrogen screenshot` above is the easy "save a panel/workspace/screen PNG"
path. For **precise control** — a specific VS Code or webview surface, **any CSS
region** (a meter, a menu, a dialog, a toolbar), or an inline PNG with no flash — use
HD's **canonical capture endpoint `POST /screenshot`** (aliases: `/shot`,
`/capture/viewport`). Read the control URL from the FILE — it's the dynamic port, and
your non-login Bash shell won't have the env var:

```bash
CTRL="$(cat ~/.adom/hd-control-url)"   # http://127.0.0.1:<dynamic>
curl -s -X POST "$CTRL/screenshot" -H 'Content-Type: application/json' \
  -d '{"target":"full","b64":true}'
```

| Field | Meaning |
|---|---|
| `target` | the surface — `full`/`window` (whole HD window) · `vscode`/`editor`/`workbench`/`code` (the VS Code panel) · `shell`/`hd` (the Svelte shell: title bar, menus, panels) · a **webview url-substring** (e.g. `wiki`) · **or a TAB DISPLAY NAME** (e.g. `"ScreenA"`, `"VS Code"`) — see by-name note below |
| `selector` | **optional CSS selector — it ALWAYS WINS and region-clips to that element.** e.g. `.resource-bars` (CPU/RAM meter), `iframe[src*='wiki']`, `.setup-panel`, `.dialog`, `.dropdown-content.open` |
| `b64` | `true` → returns the PNG inline as a `dataUrl` (decode + Read); else saved to a file in `screenshots/` |
| `silent` | `true` → suppress the capture flash |
| `name` | optional label for the saved file |

A `selector` clips to the **first matching element** in that surface — grab JUST a
meter, a menu, a dialog, a toolbar instead of the whole window (verified live:
`{selector:".resource-bars"}` → 192×61, vs `{target:"full"}` → the whole window).

**Screenshot a tab by its display NAME — incl. a BACKGROUND tab.**
`POST /screenshot {target:"<tab name>"}` resolves the name → the workspace panel, **activates
that tab** (so a *background* tab actually paints — a webview is an OOPIF and can't be CDP-shot
while hidden), captures the shell cropped to that panel, then **restores the previously-active
tab**. So in a pane stacked `VS Code | ScreenA | ScreenB` (ScreenB showing), `{target:"ScreenA"}`
returns ScreenA's pixels and leaves ScreenB active. The `adom-cli` SSE path
(`screenshot panel --name ScreenA`) also activates + restores. This is the right call for
"shot tab #2 while #4 is showing."

**The teal zap:** every HD-driven capture flashes a teal (`#00b8b0`) highlight on the
captured **region** (just the panel/menu/region; full-window flash only for
`target:full`). Teal = HD-driven. Pass `silent:true` to suppress it.

### Screenshot a menu / dialog / panel — open it, then clip to it
The killer combo with the UI command bus (see **`hd-ui`**): **open a surface →
screenshot just that surface → close it** — no screen-clicking, no guessing where it is.
```bash
CTRL="$(cat ~/.adom/hd-control-url)"
curl -s -X POST "$CTRL/ui/invoke"  -H 'Content-Type: application/json' -d '{"id":"adom-menu.open"}'
curl -s -X POST "$CTRL/screenshot" -H 'Content-Type: application/json' -d '{"target":"shell","selector":".dropdown-content.open","b64":true}'
curl -s -X POST "$CTRL/ui/invoke"  -H 'Content-Type: application/json' -d '{"id":"adom-menu.close"}'
```
Resolved selectors (verified live): **Adom menu & profile menu** → `.dropdown-content.open`
(only one open at a time); **Setup panel** → `.setup-panel`; **API Explorer** → `.dialog`.
`GET $CTRL/ui/actions` for the live set of menus/dialogs you can open (see `hd-ui`).

## Ralph loop + shotlog (optional)

Verify a UI change: make the change → (rebuild if needed) →
`adom-cli hydrogen screenshot panel --name <panel>` → `Read` it → wrong? fix and
repeat. Log shots for the user with `shotlog inject -c hd-ui -d "<desc>" <path>`
(shotlog resizes internally — another reason you don't need `convert`).

## Related skills
- [hd-capture-share](../hd-capture-share/SKILL.md) — the sharing/approval UX behind `screenshot`
- [hd-recording](../hd-recording/SKILL.md) · [hd-captions](../hd-captions/SKILL.md) — sibling `adom-cli hydrogen` AV verbs
- `shotlog` — the screenshot log viewer/injector
