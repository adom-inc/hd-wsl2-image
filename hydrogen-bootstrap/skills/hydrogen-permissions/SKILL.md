---
name: hydrogen-permissions
description: >
  Hydrogen AUTO-GRANTS every webview permission — microphone, camera,
  clipboard-read, geolocation, notifications, sensors — so inside Hydrogen a webview app NEVER
  shows a "this site wants to use your microphone/camera/clipboard/location" prompt. READ
  THIS before building or debugging a webview app that uses getUserMedia / clipboard /
  geolocation: do NOT tell the user to click "Allow" — there is no prompt to click; it's
  suppressed by design. Distinguish this browser-permission auto-grant from the SEPARATE
  in-app screen-share / mic consent the AI itself requests (that one IS user-approved — see
  hydrogen-capture-share). Hydrogen's webview engine is platform-specific; the per-engine
  implementation detail (e.g. WebView2 on Windows) lives in the platform companion (see
  [[hydrogen-permissions-windows]]). Trigger words — permission, permissions, webview permission,
  allow microphone, allow camera, allow clipboard, clipboard read, getUserMedia, mic
  permission, camera permission, geolocation permission, notifications permission, sensors
  permission, site wants to use, permission prompt, click allow, no permission prompt,
  auto-grant, auto granted, why no prompt, permission denied webview.
---

# Hydrogen auto-grants every webview permission

Hydrogen's webview registers a permission handler that returns **ALLOW for every
permission kind** — microphone, camera, clipboard-read, geolocation, notifications,
sensors, etc. So **inside Hydrogen the user never sees a "this site wants to use your microphone /
camera / clipboard / location" dialog.** Webview apps that call `getUserMedia`, read the
clipboard, or ask for geolocation simply *work*, with no prompt.

Every request is unconditionally allowed. In the Hydrogen log you'll see lines like `[perm]
auto-granted permission kind …` and, at startup, `[perm] Registered PermissionRequested
auto-grant handler`.

> **Platform note:** Hydrogen uses a different webview engine per platform (e.g. WebView2 on
> Windows, WebKit on mac/Linux). The auto-grant policy is the same everywhere — every
> permission is allowed up front — but the exact engine API is platform-specific. The
> Windows/WebView2 implementation and its code evidence are in [[hydrogen-permissions-windows]].

## Why Hydrogen does this

Hydrogen is the user's **trusted desktop app** — they've already chosen to run it. Intermediate
per-site Web permission prompts (especially the clipboard-paste dialog) are pure friction
with no added safety here, since there's no untrusted third-party browsing context: the
surfaces are Hydrogen's own panels and the user's own webview apps. So Hydrogen grants them all up
front.

## What this means for you when building webview apps

- **Don't instruct the user to "click Allow."** There is no prompt — telling them to look
  for one is wrong and confusing. `getUserMedia({ audio: true })`, clipboard reads,
  geolocation, notifications all resolve without a dialog.
- If a webview app *isn't* getting mic/camera data, the cause is **not** a denied
  permission prompt (Hydrogen never denies). Look elsewhere: no device present, the page served
  over a non-secure context, a code bug, or the OS-level privacy toggle for the camera/mic
  being off for the app entirely.
- This is behavior baked into Hydrogen's webview host — it's not something the web page or the
  user configures.

## NOT the same as in-app screen-share / mic consent

This auto-grant is **only** the low-level webview browser-permission layer. It is separate
from the **screen-share / microphone consent the AI itself requests** when it wants to
capture the user's screen or mic for a session — that flow **is** explicitly user-approved
(the user sees and accepts an in-app consent UI). Don't conflate them: webview site
permissions are silently allowed; the AI's capture/share request is a real, user-facing
approval. See `hydrogen-capture-share`.

## Related skills
- `hydrogen-capture-share` — the SEPARATE, user-approved screen-share / mic consent the AI requests
- [hydrogen-open-url](../hydrogen-open-url/SKILL.md) — opening URLs/webview apps inside Hydrogen (where these permissions apply)
- [[hydrogen-permissions-windows]] — the WebView2 (Windows) implementation + lib.rs evidence
