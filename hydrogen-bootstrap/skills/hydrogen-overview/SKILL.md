---
name: hydrogen-overview
description: >
  Master index for the platform-generic Hydrogen skills (the
  hydrogen-bootstrap set). Start here to find the right skill for any HD topic.
  These skills are runtime-neutral and apply on every host HD runs on
  (Windows, macOS, Ubuntu); platform layers add their own *-windows (etc.)
  companions. Trigger words: HD skills, hydrogen, what skills, find
  skill, HD help, HD overview, skill index, HD reference.
---

# Hydrogen — Skill Index

Hydrogen (HD) is Adom's standalone Tauri v2 app that runs the full
Hydrogen experience locally. One exe manages your workspace, VS Code,
Claude Code, the bridges, and the Adom Wiki — zero cloud dependency. HD runs
on Windows, macOS, and Ubuntu.

This index lists the **platform-generic** HD skills (the `hydrogen-bootstrap` set).
Every fact in these skills holds regardless of host OS. Where a topic has
host-specific mechanics (e.g. how the workspace is hosted, host networking,
host-side recording), the platform layer adds a companion skill — on Windows
those are the **`hydrogen-windows-bootstrap`** `*-windows` skills (and equivalents
for other platforms). The generic skill cross-references its companion.

## The generic HD skills (hydrogen-bootstrap)

| Skill | What it covers |
|---|---|
| **hydrogen-adom-auth** | Adom login/logout, session token, profile menu, how auth feeds setup. |
| **hydrogen-adom-desktop** | What HD and Adom Bridge (AD) are and how they work together — AD is your hands on the user's real OS (files, shell, OS screenshots, app launch, bridges). |
| **hydrogen-adom-menu** | The upper-left Adom logo menu (Settings, Ports, API Explorer, DevTools, Setup/Virgin Reset) + About dialog + version readout. |
| **hydrogen-api** | Control API reference. Runtime-neutral endpoints. |
| **hydrogen-bridges** | Built-in KiCad/Fusion/Puppeteer bridges + extensible wiki catalog (e.g. Blender) + AD capability list. |
| **hydrogen-captions** | Paint labeled text on the user's screen — an always-on-top caption overlay for demos / step callouts. |
| **hydrogen-capture-share** | The screen-share + "AI wants access" approval + countdown the AI triggers to capture the editor; tab/screen scopes, Webview/Pup window mode. |
| **hydrogen-claude-auth** | How Claude Code signs in: OAuth via Browser Picker, credential backup, the `claude-auth` step. |
| **hydrogen-container** | Context for Claude running inside the workspace: relay, direct connect, bridge commands, env vars. |
| **hydrogen-container-stats** | The title-bar CPU/RAM "Container" indicator and how its stats are gathered. |
| **hydrogen-desktop-sse** | Local workspace API + SSE — how adom-cli inside the workspace controls HD (replaces Carbon locally). |
| **hydrogen-eda-discovery** | EDA tool discovery / setup flow. |
| **hydrogen-eval** | Inject JS into any HD surface (shell/workbench/wiki/Claude) via /eval-in — add-ons, overlays, highlights, drive UI. |
| **hydrogen-instapcb** | InstaPCB integration in HD. |
| **hydrogen-monitor** | Real-time SSE event stream + Monitor-tool patterns for watching workspace mutations. |
| **hydrogen-naming** | The naming doctrine: Hydrogen/ah, Bridge/ab, and WHY installers/shortcuts MUST say "Adom Hydrogen" (users search "adom"). |
| **hydrogen-notifications** | Reach the user outside the window — native OS toasts + emergency taskbar flash via `notify_user`. |
| **hydrogen-open-url** | The decision guide for "open a website" — the ways (webview tab, HD window, Pup, native browser, picker, headless curl) and when to pick each. |
| **hydrogen-overview** | This index. |
| **hydrogen-permissions** | Why mic/camera/clipboard/notifications "just work" in HD — webview permissions are auto-granted, so webview apps see no Allow prompts. |
| **hydrogen-profile-menu** | The avatar dropdown: profile/repos/molecules links and logout. |
| **hydrogen-self-screenshot** | How the AI screenshots HD panels + any host window (window control, multi-monitor), injects to shotlog, runs visual self-checks. |
| **hydrogen-self-update** | How HD updates itself. |
| **hydrogen-settings** | HD's Settings dialog + the full preferences tree (theme, vim mode, 3D control style, launch-on-login, AD window behavior). |
| **hydrogen-setup** | The setup panel, Run All, Rollback, Virgin Reset. |
| **hydrogen-setup-steps** | What each setup step did to prepare your workspace. |
| **hydrogen-tab-icons** | Webview tab icon system — `displayIcon`, icon resolution, SVG data URLs. |
| **hydrogen-ui** | HD's UI: menus, dialogs, panels, CDP-driven navigation, brand/CSS conventions. |
| **hydrogen-welcome** | The static welcome page shown after setup completes. |
| **hydrogen-who-am-i** | Answer "who am I / what can I do here" — identity, resources, environment intro. |
| **hydrogen-workspace-monitoring** | Workspace + code-server health monitoring, floaty states, the 15s poll, auto-start. |
| **hydrogen-workspace-updater** | The workspace-tooling updater daemon. |

## Platform layers

Platform-specific mechanics live in a platform layer that ships alongside this
set and adds `*-windows`-style companion skills (e.g. `hydrogen-container-windows`,
`hydrogen-container-stats-windows`, `hydrogen-networking`, `hydrogen-volume`,
`hydrogen-workspace-lifecycle`). When a generic skill above has a host-specific detail,
it cross-references its companion. On a given host you'll have the generic set
plus that host's platform layer.
