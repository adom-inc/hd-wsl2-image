---
name: hd-tab-icons
description: >
  How Hydrogen **webview** tab icons work in the Adom editor — panels with
  `panelType: adom/a1b2c3d4-0031-4000-a000-000000000031`. (Native panels
  like Schematic Editor, 3D Editor, Desktop Demo, KiCad panel have their
  own icon mechanism and are NOT covered here.) The critical gotcha:
  `displayIcon` (HTTP API) / `--display-icon` (CLI) is only the
  **pre-load placeholder** — the loaded page's own `<link rel="icon">`
  overrides it as soon as the page loads. The only stable way to control
  a webview tab's icon is to serve the favicon you want from your own app.
  Covers the override mechanism, shipping a custom favicon from a
  Rust/Node/Python app, using `mdi:<name>` and `data:image/svg+xml;base64,...`
  placeholders, common icons, and troubleshooting. Trigger words: hydrogen
  webview tab icon, webview tab icon, mdi icon webview tab, displayIcon
  webview, display-icon, webview tab icon not showing, custom webview tab
  icon, colored webview tab icon, tab chip icon, webview tab icon svg,
  webview tab icon base64, favicon override webview tab, webview tab icon
  keeps resetting, webview tab icon reverts after page load.
---

# Hydrogen Webview Tab Icons

How Hydrogen **webview** workspace tabs actually get their icons in
the Adom editor. **Read the "Real mechanism" section first** — the
placeholder vs. favicon distinction is the thing future Claude
sessions usually get wrong, including an earlier version of this
skill.

## Scope

This skill is **only** about tabs whose `panelType` is
`adom/a1b2c3d4-0031-4000-a000-000000000031` — the generic Hydrogen
webview that loads an HTML page from a URL. The favicon-override
mechanism described below is specific to webview panels because
only they load an HTML page that can ship its own
`<link rel="icon">`.

Other panel types — Schematic Editor, 3D Editor, KiCad panel,
Desktop Demo, Movie Maker, Adom Viewer native panel, etc. —
have their icons assigned by Hydrogen's internal panel registry
keyed off `panelType`, not by anything the tab adder passes in.
If your tab isn't a webview and its icon is wrong, **this skill
will not help you** — open a Hydrogen issue instead.

## Real mechanism (the thing everyone misses)

Hydrogen webview tabs have **two** sources for their displayed icon,
and the loaded page wins:

1. **`panelState.displayIcon`** — a placeholder you pass via
   `--display-icon` / HTTP `displayIcon`. Shown **only until the page
   loads**.
2. **The loaded page's `<link rel="icon">`** — Hydrogen's Web View
   panel reads the favicon after `load` and writes it into
   `panelState.displayIcon`, overriding whatever the placeholder was.

**Practical consequence:** once any page with a favicon finishes
loading, your `--display-icon "mdi:chip"` is gone. If you want the
icon to be **stable and predictable**, you have to serve the favicon
you want **from the page you load**.

Empirical proof: create a tab with `--display-icon "mdi:rocket-launch"`,
navigate it to `https://example.com`, then inspect the tab's
`panelState.displayIcon` via `adom-cli hydrogen workspace tabs` — it
will be a `data:image/svg+xml;base64,...` value matching example.com's
favicon, not `mdi:rocket-launch`.

## Brand rule: icons must be monochrome `#e6edf3`

Per `gallia/skills/brand/SKILL.md`, **all Adom icons must be monochrome
white (`#e6edf3`)** — no colored icons, no multi-color, no brand-palette
colors in icons. This applies to tab icons too.

- **First choice:** use an `mdi:<name>` placeholder for the `--display-icon`
  flag. MDI icons are already monochrome and inherit the theme color
  automatically, so you get brand compliance for free. Search
  https://pictogrammers.com/library/mdi/ for a matching icon.
- **If you need a custom icon** (no MDI match, or you want to ship your
  own favicon for the page-load override): hand-roll an SVG with
  `fill="#e6edf3"` (or `fill="currentColor"` so it inherits), a
  `24x24` viewBox, and clean filled paths or 2px strokes. **No
  gradients, no shadows, no color.** Details that break at 16 px lose.

Concrete example of a brand-compliant custom icon (the adom-tsci
chip) — 318 bytes, single path, monochrome `#e6edf3`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e6edf3">
  <path d="M6 2a2 2 0 0 0-2 2v2H2v2h2v3H2v2h2v3H2v2h2v2a2 2 0 0 0 2 2h2v2h2v-2h3v2h2v-2h3v2h2v-2a2 2 0 0 0 2-2v-2h2v-2h-2v-3h2v-2h-2V8h2V6h-2V4a2 2 0 0 0-2-2h-2V0h-2v2h-3V0h-2v2H9V0H7v2H6zm0 2h12v16H6V4zm2 3v10h8V7H8zm2 2h4v6h-4V9z"/>
</svg>
```

Rendered in a dark-background Hydrogen tab bar, that's a white chip
with pins sticking out — visually identical to `mdi:chip` but served
from your own app so it can't be overridden.

## The right way: serve your own favicon from your app

If you're writing a Rust/Node/Python/Go app that opens a Hydrogen
webview tab, **put a `<link rel="icon">` in the HTML you serve**.
Hydrogen will pick it up on load and that's what the user will see.
Use a **brand-compliant `#e6edf3` monochrome SVG** (see section above).

### Rust + tiny_http example (the `adom-tsci` pattern)

```html
<!-- src/assets/shell.html, embedded in the binary via include_str! -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>My App</title>
<!-- Hydrogen reads this and uses it as the tab icon. -->
<link rel="icon" type="image/svg+xml" href="favicon.svg">
...
```

```rust
// Serve favicon.svg from the tiny_http route handler.
if url == "/favicon.svg" || url == "/favicon.ico" {
    let body = include_str!("../assets/icon.svg");
    return Ok(request.respond(
        Response::from_string(body)
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"image/svg+xml"[..]).unwrap()
            ),
    )?);
}
```

```svg
<!-- src/assets/icon.svg — MONOCHROME per the brand rule. fill must be
     "#e6edf3" (or "currentColor"), NEVER a colored palette value. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e6edf3">
  <rect x="5" y="5" width="14" height="14" rx="1"/>
  <rect x="3"  y="7"  width="2" height="2"/>
  <rect x="3"  y="11" width="2" height="2"/>
  <rect x="3"  y="15" width="2" height="2"/>
  <rect x="19" y="7"  width="2" height="2"/>
  <rect x="19" y="11" width="2" height="2"/>
  <rect x="19" y="15" width="2" height="2"/>
  <rect x="7"  y="3"  width="2" height="2"/>
  <rect x="11" y="3"  width="2" height="2"/>
  <rect x="15" y="3"  width="2" height="2"/>
  <rect x="7"  y="19" width="2" height="2"/>
  <rect x="11" y="19" width="2" height="2"/>
  <rect x="15" y="19" width="2" height="2"/>
</svg>
```

(Perfectly symmetric chip: body + 12 pins, 3 per side, even 4-unit
spacing, rx=1 rounded corner, all in brand `#e6edf3`. This is the
exact `adom-tsci` icon — taken from the repo's `src/assets/icon.svg`.)

When the page loads from `https://<workspace>.adom.cloud/proxy/<port>/`,
the browser fetches `/proxy/<port>/favicon.svg`, your app returns the
SVG, Hydrogen syncs it onto the tab, and the icon stays put.

**Rules for the favicon file:**

- **Square `viewBox`** (e.g. `0 0 64 64` or `0 0 24 24`).
- **Self-contained SVG** — no external fonts, no `xlink:href` to
  other files, no embedded images.
- **Bold, filled shapes over thin strokes** — the tab bar is
  ~16–20 px so details get lost.
- **Transparent background** is fine, the tab bar shows through.
- **Brand color in the SVG itself** if you want a colored icon. MDI
  icons can't be tinted.

## Placeholder-only case: `mdi:<name>` / `data:...` via add-tab

If the page you're loading **doesn't set its own favicon**, or if
you're creating a tab that navigates to about:blank or similar, the
`--display-icon` placeholder is all you get — and it will stick.

Examples where this is actually useful:

- **A tab that loads an external site with no favicon.** Rare in
  practice; most real sites have a favicon.
- **A stopgap during the ~100ms the page takes to load** — the user
  sees the placeholder, then it swaps to the page's favicon.
- **When you don't own the page** — you can't inject a `<link>`, so
  the placeholder is your only control point, knowing it's about to
  get overridden.

### CLI

```bash
adom-cli hydrogen workspace add-tab \
  --panel-id <leaf-id> \
  --panel-type "adom/a1b2c3d4-0031-4000-a000-000000000031" \
  --display-name "My App" \
  --display-icon "mdi:chip" \
  --initial-state '{"url":"https://example.com/"}'
```

### HTTP API

```bash
curl -s -X POST \
  -H "X-Api-Key: $API_KEY" $TARGET_HEADER \
  -H "Content-Type: application/json" \
  -d '{
    "panelId": "<leaf-id>",
    "panelType": "adom/a1b2c3d4-0031-4000-a000-000000000031",
    "displayName": "My App",
    "displayIcon": "mdi:chip",
    "initialState": { "url": "https://example.com/" }
  }' \
  "https://hydrogen.adom.inc/api/workspaces/editor/$OWNER/$REPO/current/tabs"
```

### Two placeholder formats

| Format | When to use | Example |
|---|---|---|
| `mdi:<icon-name>` | Monochrome icon from [Material Design Icons](https://icon-sets.iconify.design/mdi/). Inherits the editor theme's foreground color. Can't be tinted. | `mdi:chip`, `mdi:bug`, `mdi:eye` |
| `data:image/svg+xml;base64,<b64>` | Custom SVG, full control. **Must still be monochrome `#e6edf3`** per the brand rule — don't color your own placeholder. | `data:image/svg+xml;base64,PHN2...` |

**Again: both are placeholders. The page's favicon overrides them
both as soon as it loads.**

### Common MDI icons used in existing Adom tabs

| Icon | Typical use |
|---|---|
| `mdi:chip` | chips, ICs, boards, PCB/tscircuit tools |
| `mdi:eye` | viewers (AV) |
| `mdi:bug` | bug-filing tools |
| `mdi:chart-line` | visualizers |
| `mdi:monitor-cellphone` | demo/desktop tools |
| `mdi:github` | repo browsers |
| `mdi:book-open-variant` | docs viewers |
| `mdi:cart` | commerce tools |
| `mdi:robot` | automation / AI |
| `mdi:folder` | file explorers |
| `mdi:code-tags` | code editors |
| `mdi:palette` | design tools |
| `mdi:camera` | screenshot tools |

Full catalog: https://icon-sets.iconify.design/mdi/.

## Building a custom SVG data URL by hand

When you need a one-off custom icon and don't want to ship a file,
you can build a `data:` URL inline:

```bash
SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#00b8b0" d="M13.13 22.19L11.5 18.36..."/></svg>'
B64=$(echo -n "$SVG" | base64 -w0)
DATA_URL="data:image/svg+xml;base64,$B64"

adom-cli hydrogen workspace add-tab \
  --panel-id <leaf-id> \
  --panel-type "adom/a1b2c3d4-0031-4000-a000-000000000031" \
  --display-name "My App" \
  --display-icon "$DATA_URL" \
  --initial-state '{"url":"about:blank"}'
```

`base64 -w0` (no line wrapping) is important — newlines inside the
value break the JSON it gets embedded in.

This is still a **placeholder**. If the tab ever navigates to a page
with its own favicon, the placeholder is lost.

## Troubleshooting

### "I pass `mdi:chip` but the tab shows a different icon"

Your loaded page has a favicon that overrode the placeholder.
Options:

- **Best:** serve your own favicon from your app (see Real mechanism
  above). Pick an SVG that matches the brand/icon you want. Hydrogen
  will sync it onto the tab.
- **Acceptable:** if you don't control the page, you can re-set the
  `displayIcon` after load with another `add-tab`/PATCH call — but
  the next navigation will override it again.

### "My placeholder flickers for a moment then reverts"

That's the expected behavior — the placeholder shows until the page
finishes loading, then Hydrogen swaps in the page's favicon.

### "My tab has no icon at all"

The loaded page has no `<link rel="icon">` **and** no
`--display-icon` was passed. Hydrogen falls back to the default Web
View icon (a globe). Add a favicon to your served HTML.

### "I pass a `data:image/svg+xml;base64,...` and it's broken"

Usually a base64 encoding issue:

- Use `base64 -w0` (no wrap) so the output is a single line.
- Make sure the raw SVG has no unescaped newlines or tabs that break
  the JSON wrapper.
- The SVG must be self-contained: no `xlink:href` to other files, no
  `@import` in `<style>`, no embedded `<image>` pointing at URLs.

### "I set the tab to `mdi:chip` but `workspace tabs` shows a data URL"

Normal. Hydrogen rewrites `panelState.displayIcon` after page load
with whatever the page's favicon was (usually a data URL because
some sites inline their favicons). This is the override in action.

## How the `adom-tsci` app handles this

1. `src/cli/start.rs` passes `--display-icon "mdi:chip"` to
   `adom-cli hydrogen workspace add-tab` — this shows the MDI chip
   icon for ~100ms while the page loads.
2. `src/assets/shell.html` has
   `<link rel="icon" type="image/svg+xml" href="favicon.svg">`.
3. `src/server/mod.rs` serves the favicon at `/favicon.svg` with the
   content of `src/assets/icon.svg` — a teal-colored (`#00b8b0`)
   custom SVG chip.
4. When the shell loads, Hydrogen fetches `favicon.svg`, gets the
   teal chip SVG, and writes that into `panelState.displayIcon`.
5. The tab now **permanently** shows the teal chip — because every
   future reload re-serves the same favicon.

The MDI `mdi:chip` placeholder and the served `favicon.svg` are
visually similar by design — the transition is invisible. If they
were different, you'd see a brief flash.

## See also

- `~/.claude/skills/adom/guides/adom-workspace-control.md` — the full
  workspace API reference that documents `displayIcon` as a
  `panelState` field (but buries the favicon-override behavior).
- `~/.claude/skills/adom/webview/SKILL.md` — Web View panel actions
  (navigate, refresh, setHeaderHidden, setProxyEnabled).
- `~/.claude/skills/adom/guides/app-creator.md` — app conventions
  including the `docs/icon.svg` brand-icon requirement.
- [iconify MDI catalog](https://icon-sets.iconify.design/mdi/) — the
  searchable list of every `mdi:<name>`.
