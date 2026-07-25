---
name: hd-captions-windows
description: >
  Windows-specific companion to [[hd-captions]]. The full-DESKTOP overlay caption on
  Windows — `adom-desktop desktop_caption` — HD's built-in Win32 always-on-top,
  click-through overlay that floats over ALL windows (above KiCad, Fusion, a browser, the
  whole screen) and is captured by a full-screen/desktop recording. Covers the
  desktop-overlay args (text, id, position top/center/bottom/corners, normalized x/y,
  size/fontSize, duration in MILLISECONDS, action: hide|force-clear) and the id rule (same
  id replaces, different ids coexist). For the cross-platform WORKSPACE caption
  (`adom-cli hydrogen caption`, SECONDS units), see [[hd-captions]]. Windows-only.
  Trigger words — desktop caption, desktop_caption, screen overlay, always on top text,
  click-through overlay, corner caption, caption id, caption position corners, caption x y,
  force-clear captions, full-screen caption, caption over other apps, win32 caption overlay.
---

# Hydrogen Desktop — Desktop Overlay Caption (Windows)

Windows-specific companion to **[[hd-captions]]**. The generic skill covers the
cross-platform **workspace** caption (`adom-cli hydrogen caption`, SECONDS units, rendered
inside the HD webview). This page covers the **full-desktop overlay** caption, which is
Windows-only.

## Desktop overlay caption — `adom-desktop desktop_caption`

HD's built-in **Win32 always-on-top, click-through overlay** — floats over every window,
doesn't steal focus or intercept clicks (the user works "through" it). The full-featured
surface (ids, corners, x/y, force-clear). It's captured by a **full-screen / desktop**
recording (it's real screen pixels), but NOT by a workspace/panel webview capture (it's a
separate OS window). **Windows-only** (non-Windows no-ops).

## Firing a caption

Source: `src-tauri/crates/hd-app/src/caption.rs` (`handle_caption`). The AD CLI verb is
**`desktop_caption`** (the internal message type is `caption`; `adom-desktop status` lists
the `caption` capability). Plain `adom-desktop caption` is NOT a verb — it errors.

```bash
adom-desktop desktop_caption '{"text":"Step 3: approve the UAC dialog →","position":"center","size":"large","duration":6000}'
```

### Arguments

| Arg | Type | Meaning |
|---|---|---|
| `text` | string | The caption text. Omit (with no `action`) to hide. |
| `id` | string | Caption identity. **Same id → replaces** that caption; **different ids → coexist.** Defaults to `_default`. |
| `position` | string | `top`, `bottom` (default), `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right`. |
| `x` / `y` | float | **Normalized 0.0–1.0** screen coordinates (clamped). Use for precise placement instead of a named `position`. |
| `size` | string | `large` / `medium` (default) / `small`. |
| `fontSize` | int | Explicit pixel font height (also accepts `font_size`). Overrides `size`. |
| `duration` | int | **Milliseconds** on screen (default 4000), then a short fade-out. ⚠️ **NOTE: this surface is ms — the OPPOSITE of the workspace caption in [[hd-captions]], whose `-d` is SECONDS.** `4000` here = 4s; `4000` there = 66 min. |
| `action` | string | `hide` (dismiss this id, or all if id empty) or `force-clear` (destroy **all** captions regardless of id). |

### The id rule (this is the powerful part)

Captions are keyed by `id`. **Reuse an id to update a caption in place**; **use different
ids to show several at once.** That lets you run, e.g., a persistent status caption in a
corner *and* a moving center callout simultaneously:

```bash
# persistent status in the corner
adom-desktop desktop_caption '{"id":"status","text":"Recording…","position":"top-right","size":"small","duration":60000}'

# step callouts in the center, each replacing the last (same id)
adom-desktop desktop_caption '{"id":"step","text":"Step 1: open the board","position":"center","duration":4000}'
adom-desktop desktop_caption '{"id":"step","text":"Step 2: run DRC","position":"center","duration":4000}'

# clear just the step callout
adom-desktop desktop_caption '{"id":"step","action":"hide"}'

# nuke everything
adom-desktop desktop_caption '{"action":"force-clear"}'
```

## Patterns

- **Walkthrough / demo callouts over other apps** — drop a `center` caption per step (same
  `id` so each replaces the last). Combine with a full-screen recording so the callouts end
  up in the finished video. Pair with TTS for narration.
- **Status corner** — a long-`duration` small caption in a corner (`top-right`), separate
  `id`, while you drive the rest of the screen.
- **Point at a thing** — use normalized `x`/`y` to sit a label next to a button or dialog
  you're about to act on.
- **Cleanup** — `action:"hide"` per id when a step is done; `action:"force-clear"` to wipe
  the screen of all captions at the end of a tour.

## Related skills
- [[hd-captions]] — the cross-platform workspace caption (`adom-cli hydrogen caption`, SECONDS units)
- [hd-recording](../hd-recording/SKILL.md) — captions are captured *into* screen recordings
- [hd-adom-desktop](../../hd-bootstrap/skills/hd-adom-desktop/SKILL.md) — AD carries the `caption` / `desktop_caption` verb to the host; verify the `caption` capability via `adom-desktop status`
- `adom-tts` — *audio* narration to pair with on-screen captions (captions are visual-only)
