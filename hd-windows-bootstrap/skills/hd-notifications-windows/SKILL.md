---
name: hd-notifications-windows
description: >
  Windows-specific companion to [[hd-notifications]]. How HD's native toasts are delivered
  on Windows — WinRT toasts routed through a PowerShell AUMID (so they may surface under an
  "Adom" title), and the `emergency` level's persistent ORANGE TASKBAR FLASH via
  request_user_attention(Critical) that keeps flashing until the user clicks the taskbar
  icon. Source: notifications.rs. For the cross-platform `notify_user` / `/ui/toast` /
  Pup-alert API, see [[hd-notifications]]. Windows-only. Trigger words — windows toast,
  winrt toast, AUMID, Adom title toast, orange taskbar flash, request_user_attention,
  taskbar attention, emergency notification windows, powershell toast, notifications.rs.
---

# Hydrogen Desktop — Native Toasts on Windows

Windows-specific companion to **[[hd-notifications]]**. The generic skill covers the
cross-platform `notify_user` API, the `/ui/toast` in-app toast, and Pup's
`browser_alert_window`. This page covers how the native OS toast is delivered on Windows.

> **Windows-only.** On macOS HD uses a more limited `osascript`-style notification; Linux
> has no native toast path. See [[hd-notifications]] for the platform-neutral story.

## WinRT toasts via a PowerShell AUMID

On Windows, HD's native toasts are **WinRT toasts** routed through a **PowerShell AUMID**.
The `<actions>` button labels from the `actions` payload render as buttons in the toast
template.

Source: `src-tauri/crates/hd-app/src/notifications.rs` (`handle_notify` → `show_toast`).

### The "Adom" title quirk (AUMID routing)

A side effect of the PowerShell AUMID: toasts may surface under an **"Adom"**
identity/title rather than a per-app one. Relatedly, if the `title` field doesn't already
start with "Adom", HD prefixes it → `"Adom: <title>"`. That's **expected** — don't treat an
"Adom"-labeled toast as a bug.

## The `emergency` level — persistent orange taskbar flash

For `level:"emergency"`, in addition to the toast HD calls
**`request_user_attention(Critical)`** on the main window and shows/unminimizes it. On
Windows this produces a **persistent ORANGE taskbar flash that keeps flashing until the
user actually clicks the taskbar icon themselves** — it is *not* cleared by a programmatic
focus. Reserve `emergency` for "I genuinely cannot proceed without you" — it's intentionally
hard to ignore.

## Related skills
- [[hd-notifications]] — the cross-platform `notify_user` / `/ui/toast` / Pup-alert API and the macOS/Linux fallback story
- [hd-adom-desktop](../../hd-bootstrap/skills/hd-adom-desktop/SKILL.md) — AD carries `notify_user` to the host
