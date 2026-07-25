---
name: hd-screen-lock
description: >
  HD screen capture (screenshots + recording) and the display wake-lock. A browser
  getDisplayMedia capture asserts ES_DISPLAY_REQUIRED, which blocks the user's
  screensaver and stops the display turning off → burn-in. HD is NATIVE: its
  screenshots use CDP and its recording uses Windows.Graphics.Capture (WGC) /
  DXGI — neither holds the display wake-lock — so HD does not have the web leak.
  HD still must start→capture→release per op, cap recordings, and show a "●
  recording" indicator so a forgotten recording is never silent. Read before
  adding or using HD screenshot / screen-recording features. Trigger words: hd
  screenshot, hd recording, screen capture, wake lock, screensaver blocked,
  display won't sleep, ES_DISPLAY_REQUIRED, release capture, burn-in, powercfg
  requests, getDisplayMedia, recording auto-stop, max duration.
---

# HD screen capture & the display wake-lock

A browser/`getDisplayMedia` screen capture asserts **`ES_DISPLAY_REQUIRED`** →
Windows won't run the screensaver or turn the display off while it's held →
**burn-in**. Web Hydrogen is forced to keep a capture stream alive all session
(the browser re-prompts otherwise), so it **leaks this lock constantly** — that
has cost real nights of burn-in. `powercfg /requests` shows the holder, e.g.
`DISPLAY: msedge.exe — screen capture`.

## HD is native — it does NOT have this leak

HD never uses `getDisplayMedia`:

- **Screenshots** use **CDP** (`Page.captureScreenshot` via `/capture/viewport` and
  `/shot`) — a one-shot grab, no `MediaStream`, no wake-lock. See
  [hd-self-screenshot](../hd-self-screenshot/SKILL.md).
- **Recording** uses **Windows.Graphics.Capture (WGC)** per-window + **DXGI Desktop
  Duplication** full-screen (Rust, `crates/hd-control/src/recorder.rs`). **WGC/DXGI
  do NOT call `SetThreadExecutionState` / hold `ES_DISPLAY_REQUIRED`** — so a native
  recording does **not** block the screensaver or keep the display awake. See
  [hd-recording](../hd-recording/SKILL.md).

So the burn-in failure mode that bites web Hydrogen **cannot happen** from HD's own
capture. The remaining risk is only a *forgotten* recording wasting CPU/disk — which
HD guards with the rules below.

## Rules HD must follow (and already does)

- **Screenshots:** grab the frame → done. Never hold a capture between shots.
  (CDP capture is inherently one-shot; there is nothing to release.)
- **Recording:** has a server-side **max-duration auto-stop** (`maxSeconds`, default
  **600s / 10 min**; a watchdog finalizes the mp4 and emits `recording-auto-stopped`
  → a UI toast). Overriding the cap requires a `reason` so the toast can explain it.
- **Loud indicator:** while a native recording runs, HD shows a persistent **"●
  Recording · <source>"** badge (bottom-right) so it's never silently on.
- **No blur-stop for screen recording:** HD being backgrounded is the *normal* case
  for native screen recording (you're recording KiCad / Fusion / the desktop), so HD
  does **not** stop on blur/minimize — that would break the core use. The
  max-duration cap + indicator are the right nets here. (Blur-stop only makes sense
  for a `getDisplayMedia` *tab* capture, which HD doesn't use.)
- **Treat a held wake-lock as a bug.** HD shouldn't ever hold one; if you find one,
  diagnose with `powercfg /requests` (elevated) — the holder is listed under
  `DISPLAY:`.

## If you DO find the display pinned on

1. `powercfg /requests` (elevated) — read the `DISPLAY:` section for the holder.
2. If it's a **browser** (`msedge.exe`/`chrome.exe — screen capture`), that's a
   `getDisplayMedia` leak from web Hydrogen or a pup tab capture — stop that capture
   (close the tab / `browser_record_stop`), not an HD problem.
3. If it's **HD**, that's unexpected (native capture holds no lock) — capture the
   `powercfg` output and treat it as a bug to file against the recorder.

A screensaver can't clear another process's power request, so "release at the
source" is the fix. HD's native capture is release-by-construction.

## Separate concern: capture CONTENTION while recording (multi-thread)

Distinct from the wake-lock: when one AI thread is recording, another thread's
**screenshot** must not silently fail. HD handles this without holding any lock —
CDP `POST /screenshot`, AD `desktop_screenshot_window`/`_screen`, and pup
`browser_screenshot` all **coexist** with a live recording; only the `adom-cli` SSE
screenshot path returns **`capture_busy`** (with `alternatives`) so the caller switches
methods instead of getting an empty frame. Pre-flight with `GET /capture/availability`.
This is a *contention* guard, not a power-state one — full detail in
[hd-self-screenshot](../hd-self-screenshot/SKILL.md) ("During a recording") and
[hd-recording](../hd-recording/SKILL.md).

## Related skills
- [hd-recording](../hd-recording/SKILL.md) — native WGC/DXGI recording, the max-duration cap + reason, the "● Recording" indicator
- [hd-self-screenshot](../hd-self-screenshot/SKILL.md) — native CDP screenshots (no wake-lock)
- [hd-notifications](../hd-notifications/SKILL.md) — OS toasts + the in-app `/ui/toast`
- gallia `screen-capture-wake-lock` — the **web-Hydrogen** side of this issue (where the leak actually happens)
