---
name: hydrogen-notifications
description: >
  How Hydrogen reaches the user OUTSIDE the window — native OS toast
  notifications + taskbar/dock attention — so the AI can proactively tell the user a
  long job finished or that it needs them (great for hands-free / away-from-keyboard
  work). Covers Hydrogen's notify handler (levels info|warning|error|emergency, optional
  <actions> buttons; emergency = a persistent attention request until the user looks)
  and how to fire one with the `notify` desktop command / `adom-bridge-cli notify_user`.
  Also the in-app `/ui/toast` (a message INSIDE the Hydrogen window) and Pup's
  browser_alert_window taskbar/dock nudge. The native OS-toast backend is
  platform-specific (see [[hydrogen-notifications-windows]] for the Windows path);
  cross-platform behavior is documented here. Trigger words — notify the user, send a
  notification, desktop notification, toast, os toast, native toast, taskbar flash, dock
  bounce, get the user's attention, alert the user, notify_user, emergency notification,
  urgent alert, notification actions, action buttons, ping the user, job done
  notification, tell me when it's done, request attention, browser_alert_window, in-app
  toast, ui toast, /ui/toast, show a toast in Hydrogen, toast inside the window.
---

# Hydrogen — Notifications (reaching the user outside the window)

When the user isn't looking at Hydrogen — a long build is running, you've finished a job, or
you're **blocked and need them** — you can reach them on the OS level: a native **toast**,
and for urgent cases a **persistent attention request** (a taskbar flash / dock bounce,
depending on platform). This is what makes hands-free / away-from-keyboard work usable:
don't just print a message into a panel nobody's watching — fire a notification.

> **Platform note:** the native OS toast is delivered by a per-platform backend. The full
> experience (a rich OS toast plus a persistent attention request) is best on Windows
> (WinRT toasts + taskbar attention — see [[hydrogen-notifications-windows]]); macOS has a more
> limited path (an `osascript`-style notification); Linux has no native toast path. The
> `notify_user` API itself is the same everywhere; what differs is how richly the OS
> surfaces it.

## Firing a notification

Source: `src-tauri/crates/hydrogen-app/src/notifications.rs` (`handle_notify` → `show_toast`).
Dispatched via the `notify` message; from the workspace use the ab CLI:

```bash
adom-bridge-cli notify_user '{"title":"Build complete","body":"hd_build_rust finished — exit 0","level":"info"}'
```

Payload shape (`NotifyPayload`):

```json
{
  "title": "...",
  "body":  "...",
  "level": "info | warning | error | emergency",   // default: info
  "actions": ["Open log", "Dismiss"]                 // optional buttons
}
```

| Field | Notes |
|---|---|
| `title` | Toast heading. (On some platforms Hydrogen prefixes the app identity — see the platform companion.) |
| `body` | The message. |
| `level` | `info` / `warning` / `error` / `emergency`. `warning`/`error`/`emergency` render as **long-duration** toasts; `info` is short. |
| `actions` | Optional array of button labels rendered as buttons in the toast. Empty/omitted = no buttons. |

### Levels — and the `emergency` attention request

- `info` / `warning` / `error` — a standard toast (warnings and errors stay up longer).
- **`emergency`** — in addition to the toast, Hydrogen calls **`request_user_attention(Critical)`**
  on the main window and shows/unminimizes it. This produces a **persistent attention
  request** (a taskbar flash on Windows, a dock bounce on macOS) that **keeps going until
  the user actually interacts with the window/taskbar themselves** — it is *not* cleared by
  a programmatic focus. Reserve `emergency` for "I genuinely cannot proceed without you" —
  it's intentionally hard to ignore.

> The Windows-specific toast identity/title behavior (the AUMID "Adom" title quirk) and the
> WinRT/orange-taskbar-flash details live in [[hydrogen-notifications-windows]].

## In-app toast — `POST /ui/toast` (inside the Hydrogen window)

The notifications above reach the user **outside** the window (OS toast / taskbar). For a
lightweight message **inside** the Hydrogen window — the same toast UI the app uses for its own
success/error messages — fire a control-API toast:

```bash
# via the control API (or adom-cli hydrogen api, or the API Explorer "Try it")
POST /ui/toast { "message": "Build finished ✅", "type": "success", "duration": 5000 }
```

| Field | Notes |
|---|---|
| `message` | Required. The toast text. |
| `type` | `info` (default) / `success` / `warning` / `error` — sets icon + color. |
| `duration` | ms before auto-dismiss (default 5000). **0 = persistent** until the user dismisses. |
| `groupId` + `detail` | Optional: coalesce related toasts into one expandable group. |

It emits the `hydrogen-toast` Tauri event, which the main window renders via the global
`toastStore` (bottom-stacked toasts). **OS toast vs in-app toast:** use a `notify` OS toast
when the user may be **away from / not looking at** Hydrogen; use `/ui/toast` for an in-window
status cue while they're working in Hydrogen. (Hydrogen's native recording uses this for its auto-stop
notice — see [hydrogen-recording](../hydrogen-recording/SKILL.md).)

## Pup's taskbar/dock nudge (`browser_alert_window`)

For AI-driven browser work, Pup has its own attention nudge:

```bash
adom-bridge-cli browser_alert_window '{"sessionId":"default"}'
```

It **flashes the taskbar / bounces the dock** for that browser window (and brings the page
to front within Chrome) **without stealing foreground focus** — a gentle "look here." (Use
`browser_focus_window` if you actually want to raise the window.)

## When you (the AI) should notify proactively

- **Long-job completion** — a build, a batch, a render, a deploy finished. Fire an `info`
  toast so the user can wander off and get pulled back.
- **You need the user** — an approval, a decision, a credential. Use `warning`, or
  `emergency` if you're fully blocked.
- **Hands-free / driving** — pair a notification with audio (TTS) so the user gets both a
  glance-able toast and the spoken answer.

Don't spam: one notification per meaningful event. Verify the bridge first
(`adom-bridge-cli ping`) before claiming you notified them.

## Related skills
- [hydrogen-adom-desktop](../hydrogen-adom-desktop/SKILL.md) — ab is what carries `notify_user` to the host; `ping`/`status` to verify the bridge and the `notify` capability
- [hydrogen-bridges](../hydrogen-bridges/SKILL.md) — the full ab capability list (`notify`, …) and Pup's `browser_alert_window`
- [[hydrogen-notifications-windows]] — the Windows toast backend (WinRT, AUMID "Adom" title, orange taskbar flash)
