---
name: hd-captions
description: >
  Paint labeled caption text on the Hydrogen Desktop workspace for demos/walkthroughs —
  captions are CAPTURED BY RECORDINGS so they show up in the finished video. Drive the
  WORKSPACE caption with `adom-cli hydrogen caption` — THE default, identical on
  web-Hydrogen AND HD (text positional; `-d` duration in SECONDS not ms; 30s auto-expire
  by default, 5-min hard cap, newest-wins, `hide` to clear; a raw-HTTP
  `POST .../current/caption` fallback exists for scripts hitting HD's API directly).
  Distinct from toasts (notifications) and TTS (audio). NOTE: a full-DESKTOP overlay
  (over every window, on top of other apps) exists as a platform-specific companion —
  see [[hd-captions-windows]]. Trigger words — caption, on-screen caption, workspace
  caption, hydrogen caption, screen overlay, screen label, callout, annotate the screen,
  step label, put text on screen, overlay text, caption command, adom-cli hydrogen
  caption, walkthrough label, demo callout, status overlay, label the screen, hide
  caption, clear captions, step 3 callout, caption duration, caption seconds, caption
  auto-expire, caption stuck on screen, caption units, caption position, caption size,
  persist caption.
---

# Hydrogen Desktop — On-Screen Captions

You can **paint labeled caption text on the Hydrogen Desktop workspace** for demos and
walkthroughs — and because captions are real pixels, **they're captured by recordings**,
so they end up in the finished video ("Step 3: run DRC →").

> Captions are **visual on-screen narration** — centered status / countdowns / "what
> I'm doing," great during demos and recordings. Distinct from:
> - **toasts** — corner pop-ups via `POST /ui/toast` (transient notifications, see
>   `hd-notifications`); a caption is centered narration, a toast is a corner alert.
> - **TTS** *audio* narration (`adom-tts`) — pair a caption with TTS for a narrated walkthrough.
> - the internal **auth-overlay caption** HD draws for login/auth flows — not something
>   you trigger for demos. The workspace caption below is the one you drive.

## Two caption surfaces — pick by WHAT you're recording

HD has **two** caption surfaces, each captured by a *different* kind of recording:

| Surface | Command | Renders | Captured by | Use when |
|---|---|---|---|---|
| **Workspace caption** | `adom-cli hydrogen caption` | **inside the HD workspace** (webview overlay, web-Hydrogen style) | a recording/screenshot of the **HD window** (panel/workspace) | the demo is **inside HD** — captioning the workspace itself |
| **Desktop overlay** | platform-specific (see [[hd-captions-windows]]) | **over the WHOLE desktop**, above every window | a **full-screen / desktop** recording | the demo shows **other apps** (KiCad, Fusion, a browser) or the whole screen |

**Match the caption to the recording.** A `screenshot panel` / workspace capture sees the
**webview** content, so it captures the **workspace** caption but NOT a desktop overlay (a
separate OS window). A full-**screen** recording captures the **desktop overlay** (it's
screen pixels). Pick wrong and your caption won't be in the video.

> Quick rule: "caption the Hydrogen workspace" → `adom-cli hydrogen caption`;
> "caption over the whole screen / while I record KiCad / a corner status label" → the
> desktop overlay in the platform companion (the only one with corners, ids, and x/y).

## Workspace caption — `adom-cli hydrogen caption` ⭐ THE DEFAULT

**Reach for this FIRST.** It's the *same* command on web Hydrogen and HD (adom-cli routes
through HD's workspace-events server → SSE → the frontend `captionStore`), so it stays
consistent across both — same principle as screenshots. Renders centered **inside the HD
workspace webview**. `show` takes the TEXT as a **positional arg** (NOT `--text`); the only
flags are `-d`/`--duration`, `-p`/`--position`, `-s`/`--size` (no `id`, `x`/`y`, or
`fontSize` — those are desktop-overlay-only). Subcommands: `show` / `hide`.

```bash
adom-cli hydrogen caption show "Step 1: open the board" -p center -s large     # 30s auto-expire
adom-cli hydrogen caption show "Step 2: run DRC" -d 60 -p center -s large       # hold 60 SECONDS
adom-cli hydrogen caption hide                                                  # clear now
```

### ⚠️⚠️ `-d` / `duration` is in **SECONDS — NOT milliseconds** ⚠️⚠️
THE gotcha. `-d 30` = 30 seconds. `-d 4000` = **66 MINUTES**, not 4 seconds. If you're
thinking in ms you're off by **1000×**. You almost never need a big number — the 30s
default already covers "leave it up while I do a thing." (Note: the *desktop overlay* in
the platform companion uses **milliseconds** — the two surfaces differ; don't cross the
units.)

> **Web-Hydrogen vs HD parity:** the **command + the SECONDS unit + `hide` are identical**
> on both (center/large rendering, `-d 20` held visibly). BUT the sane **lifecycle below
> (30s default / 300s cap / persist)** is verified on HD; web Hydrogen may still return the
> *older terse `_hint`* ("auto-hides after the specified duration") and may not enforce the
> 30s-default/300s-cap yet. **So on web Hydrogen, don't assume a fat `-d` self-heals — pass
> a sane duration.**

### Lifecycle (sane, never abandoned)
- **No `-d` (or `-d 0`) → auto-expires after 30s.** The right default — you do NOT need
  to `hide` it.
- **Positive `-d <seconds>` → holds that many seconds, HARD-CAPPED at 300s (5 min).** A
  larger value still clears at 5 min, so a fat-fingered `-d 4000` self-heals.
- **Newest wins:** showing another caption replaces the current one; `hide` clears immediately.
- **No "forever" via adom-cli** — its `-d` is an unsigned int (rejects negatives) by
  design. This is a **feature, not a gap**: adom-cli is the same binary on web-Hydrogen and
  HD, so "no persist via adom-cli" keeps both consistent and bounded (no abandoned
  captions). A persist-until-hidden escape exists ONLY on the raw HTTP endpoint
  (`{"duration":-1}`, below) — rarely needed.
- **No `caption status` verb (yet).** There's no way to query "is a caption up / how long
  left" from adom-cli — and with newest-wins + the 30s auto-expire you rarely need to.
- `-p` position: `top` / `center` / `bottom` (NO corners — use the desktop overlay for
  those). `-s` size: `small` / `medium` / `large`.
- Needs a live workspace/editor session (the server returns 409 if none).

### Direct HTTP fallback — only for scripts already hitting HD's API
adom-cli is the consistent default; use HTTP **only** when a script talks to HD's API
directly. It's the **same caption, same lifecycle** — adom-cli just wraps this path with
the workspace owner/repo. The caption lives on the **workspace-events server**
(`ADOM_HYDROGEN_URL`, the proxy) — **NOT the control port**:

```bash
# show — duration in SECONDS, identical body/lifecycle to adom-cli
curl -s -X POST "$ADOM_HYDROGEN_URL/api/workspaces/editor/<owner>/<repo>/current/caption" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Step 1: open the board","duration":60,"position":"center","size":"large"}'
# hide
curl -s -X POST "$ADOM_HYDROGEN_URL/api/workspaces/editor/<owner>/<repo>/current/caption" \
  -d '{"hide":true}'
# persist until hidden (HTTP-ONLY escape — adom-cli can't send a negative):
#   -d '{"text":"Recording…","duration":-1}'
```
Body: `{text, duration (SECONDS), position, size}`; clear with `{hide:true}`.

## Desktop overlay caption (over the whole screen)

For a caption that floats over **every window** (above other apps, the whole desktop) —
with ids, corners, and normalized x/y placement — HD provides a native always-on-top,
click-through desktop overlay. That surface and its arguments are **platform-specific**;
see **[[hd-captions-windows]]**.

## Patterns

- **Walkthrough / demo callouts** — drop a `center` caption per step. Combine with a
  recording so the callouts end up in the finished video. Pair with TTS for narration.
- **Status corner / point-at-a-thing** — these need named corners or normalized x/y, which
  only the desktop overlay provides; see [[hd-captions-windows]].

## Related skills
- [hd-adom-desktop](../hd-adom-desktop/SKILL.md) — the relay that carries caption verbs to the host
- `adom-tts` — *audio* narration to pair with on-screen captions (captions are visual-only)
- [[hd-captions-windows]] — the full-desktop always-on-top overlay caption surface
