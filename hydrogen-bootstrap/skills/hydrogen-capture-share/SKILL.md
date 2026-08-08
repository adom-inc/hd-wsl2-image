---
name: hydrogen-capture-share
description: >
  The in-HD screen-share + AI-consent surface that lets YOU (the AI) screenshot
  the editor or the whole screen into the container. Covers the Screen Capture
  dropdown in the editor toolbar (Share this tab / Share entire screen / Stop
  sharing, plus Workspace / Full-screen screenshot), the Webview-vs-Pup Window
  mode toggle, the panel/workspace/screen capture scopes + Element-Capture
  RestrictionTarget, and the AI sharing-approval flow: SharingApprovalDialog
  ("AI wants access" + your reason), the ~3s auto-approve in HD, and the
  cancelable CountdownToast before capture starts. READ THIS before trying to
  screenshot the editor — a screenshot of HD's own UI requires an active share.
  Trigger words — screen share, share this tab, share screen, screen capture
  dropdown, capture the editor, screenshot the workspace, workspace screenshot,
  AI wants access, sharing approval, consent dialog, countdown toast, start
  sharing, stop sharing, window mode, webview vs pup, RestrictionTarget, element
  capture, capture scope, panel screenshot, capture frame, share with the AI.
---

# Hydrogen — Screen Capture & Sharing (the AI-consent surface)

This is the surface **you (the AI) trigger to see HD's own screen.** To screenshot
the *editor* (panels, the workspace, or the whole monitor) into the container, a
**screen share must be active first.** You request it, the user consents once (HD
auto-approves in ~3s), a brief countdown plays, then you can capture frames.

> This is **not** the same as host OS screenshots. `desktop_screenshot_*`
> (see [hydrogen-adom-desktop](../hydrogen-adom-desktop/SKILL.md)) take true OS screenshots via
> AD with zero dialogs. This skill is the **in-webview** share that captures what
> HD itself is rendering (the editor) via the browser's `getDisplayMedia`/Element
> Capture, gated by an in-app consent dialog. And it is distinct from
> [hydrogen-permissions](../hydrogen-permissions/SKILL.md) (WebView2 auto-granting mic/cam OS
> permissions) — that's a different layer.

## The Screen Capture dropdown (editor toolbar)

Source: `src/lib/components/editor/EditorNav.svelte` (~L2227–2332).
Store: `src/lib/stores/screenCaptureStore.ts`.

**When not yet sharing**, the dropdown offers two ways to start:

| Option | Description | What you get |
|---|---|---|
| **Share this tab** | "Panels and workspace screenshots" | Captures HD's own webview — panels + workspace |
| **Share entire screen** | "Full display including other apps" | Captures the whole monitor (or a chosen window) |

**While sharing**, it shows `Sharing <surface>` ("entire screen" / "window" / "this
tab") plus capture actions:

| Action | Description |
|---|---|
| **Workspace screenshot** | Save to container's `screenshots` folder |
| **Full screen screenshot** | Save to container's `screenshots` folder (only when the surface is a monitor/window) |
| **Stop sharing** | Ends the share |

### Window mode toggle (Webview vs Pup)

Below the share options is a **Window mode** toggle with two buttons —
**Webview** and **Pup** (`windowModeStore`). It selects which window surface
capture/recording targets: HD's own embedded Webview, or a Pup (Puppeteer)
browser window. Webview = "see HD itself"; Pup = "see the AI-driven browser."

## Capture scopes & how a frame is taken

`screenCaptureStore.ts` exposes the scope type and the capture functions:

```ts
type CaptureScope = 'screen' | 'workspace' | 'panel';
```

| Scope | Function | What it captures |
|---|---|---|
| `panel` | `capturePanel(panelId)` | a single editor panel |
| `workspace` | `captureWorkspace()` | the whole HD workspace surface |
| `screen` | `captureScreen()` | the full display / shared window |

Other store entry points you'll see: `startTabCapture()`, `startScreenCapture()`,
`stopScreenCapture()`, `captureFrame()`, `isCaptureActive()`,
`promptScreenCapture(message?)` (asks the user to enable sharing).

State shape: `{ isSharing, displaySurface, hasElementCapture, promptMessage }`,
where `displaySurface` is `'browser'` (tab) / `'window'` / `'monitor'`.

### Element Capture (RestrictionTarget)

When `'RestrictionTarget' in window` and `getDisplayMedia` are available, HD can
**restrict a tab capture to a single DOM element** so only that panel is in frame:
`restrictCaptureTo(el)` builds a `RestrictionTarget.fromElement(el)` and calls
`track.restrictTo(target)` (a short ~3s settle window). This is how a panel-scoped
capture yields just the panel, not the whole webview.

> Native (Tauri) note: inside HD, tab/screen snapshots come from the native CDP
> path rather than a live `MediaStream`; the store still flips `isSharing` and sets
> `displaySurface` to `'window'`/`'monitor'` so the same UI flow applies.

## The AI sharing-approval flow

When you (or a bridge) need screen/mic access, HD shows a consent gate before any
capture. Source: `src/lib/components/editor/SharingApprovalDialog.svelte`,
store `src/lib/stores/sharingApprovalStore.ts`.

The request you send carries:

```ts
{ bridgeKey, reason, shareType: 'tab' | 'screen' | null, audio: boolean }
```

- The dialog header reads **"AI wants access"** and shows **your `reason`** in a
  highlighted box. **Send a clear, specific reason** — it's the only thing the user
  sees to decide. ("Screenshot the schematic panel to verify the layout," not
  "capture screen.")
- **HD auto-approves after ~3 s** (`AUTO_MS = 3000`), showing
  "Auto permission will be given in N…". This is the HD-only fast path so you're
  not blocked on hands-free flows.
- **The user can override before it auto-fires:** flip share-type between
  **Share this tab** and **Share entire screen**, toggle the **mic**, or pick a mic
  device. Any interaction cancels the auto-countdown so they stay in control.
- On approve, HD starts the screen share first (tab or screen), then mic if
  requested, and returns a result (`status: 'approved'`, with `sharing` + `mic`
  details) to the requesting bridge.

### CountdownToast — the cancelable lead-in

Source: `src/lib/components/editor/CountdownToast.svelte`. Before capture/recording
actually starts, a countdown toast ("Recording in N…", default 3) plays, optionally
showing the sources and reason. It has a **cancel (×)** — the user can abort right
up to the last second. Don't assume capture started the instant you requested it;
the toast is a real, abortable delay.

## What this means for you (the AI)

1. **To screenshot HD's editor you need an active share.** If you're not sharing,
   call `promptScreenCapture(...)` / send a sharing request with a reason; don't
   silently fail a `capturePanel`/`captureWorkspace`.
2. **Write the reason for a human.** It's your one chance to justify the access.
3. **Respect the override + countdown.** The user may switch share-type, deny mic,
   or cancel the countdown — read the returned result before claiming success.
4. **Pick the right scope:** `panel` (one panel, Element-Capture-restricted),
   `workspace` (the HD surface), or `screen` (full display). Use Window mode
   (Webview vs Pup) to choose HD's own UI vs the AI browser.
5. **For host-OS screenshots that need no share at all,** use AD's
   `desktop_screenshot_*` instead (see Related skills).

## Related skills
- [hd-recording](../hd-recording/SKILL.md) — screen/mic recording (same share + countdown machinery; in-app .webm recorder + AD desktop recording)
- [hydrogen-self-screenshot](../hydrogen-self-screenshot/SKILL.md) — CDP per-panel screenshots + shotlog visual-verify loop
- [hydrogen-permissions](../hydrogen-permissions/SKILL.md) — WebView2 auto-granting OS mic/cam/notification permissions (a *different* layer from this consent dialog)
- [hydrogen-adom-desktop](../hydrogen-adom-desktop/SKILL.md) — AD's dialog-free host OS screenshots (`desktop_screenshot_screen/_window`)
