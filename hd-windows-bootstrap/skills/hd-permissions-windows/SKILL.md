---
name: hd-permissions-windows
description: >
  Windows-specific companion to [[hd-permissions]]. How HD's webview-permission auto-grant
  is implemented on Windows: the WebView2 `PermissionRequested` handler that returns
  `COREWEBVIEW2_PERMISSION_STATE_ALLOW` for every permission kind (mic, camera,
  clipboard-read, geolocation, notifications, sensors), with lib.rs code evidence. For the
  cross-platform policy + what it means when building webview apps, see [[hd-permissions]].
  Windows-only. Trigger words — webview2 permission, PermissionRequested,
  COREWEBVIEW2_PERMISSION_STATE_ALLOW, lib.rs permission handler, windows webview
  auto-grant, webview2 allow, permission auto-grant windows.
---

# HD WebView2 permission auto-grant (Windows)

Windows-specific companion to **[[hd-permissions]]**. The generic skill covers the policy
(HD auto-grants every webview permission so users never see an Allow prompt) and what it
means when building webview apps. This page covers the Windows/WebView2 implementation.

> **Windows-only.** On other platforms HD uses a different webview engine (e.g. WebKit) but
> applies the same allow-everything policy — see [[hd-permissions]].

## The WebView2 `PermissionRequested` handler

On Windows, HD's webview is **WebView2**. HD registers a `PermissionRequested` handler that
returns **ALLOW for every permission kind** — clipboard-read, mic, camera, geolocation,
notifications, sensors, etc.

Evidence: `hd-app/src/lib.rs` (~lines 326-349):

```rust
// PermissionRequested: auto-grant EVERY permission kind (clipboard
// read, mic, camera, geolocation, notifications, sensors, …) so the
// user never sees a WebView2 "site wants to" dialog.
…
args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
hd_log::hd_log!("[perm] auto-granted permission kind {:?}", kind);
```

Every request is unconditionally set to `COREWEBVIEW2_PERMISSION_STATE_ALLOW`. In the HD log
you'll see lines like `[perm] auto-granted permission kind …` and, at startup, `[perm]
Registered PermissionRequested auto-grant handler`.

This is WebView2/Windows-specific behavior baked into HD's webview host — it's not something
the web page or the user configures. If a webview app *isn't* getting mic/camera data on
Windows, note that the OS-level Windows privacy toggle for the camera/mic can still be off
for the app entirely (that's an OS setting, not a denied WebView2 prompt — HD never denies).

## Related skills
- [[hd-permissions]] — the cross-platform auto-grant policy + webview-app guidance
- `hd-capture-share` — the SEPARATE, user-approved screen-share / mic consent the AI requests
