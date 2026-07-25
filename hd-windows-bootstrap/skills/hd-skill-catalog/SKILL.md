---
name: hd-skill-catalog
description: The catalog of skills available to your Claude inside this Hydrogen Desktop workspace. Lists every public `hd-*` skill that ships with HD and explains what each one is for, so you can pick the right skill before doing anything HD-related. READ THIS FIRST when you're in a fresh HD workspace and want to know what Claude knows. Trigger words — hd skills, what skills do I have, hd catalog, skill index, skill list, what can claude do in hd, hd-* skills, browser picker, hd setup, hd container info, hd networking, hd volume, hd ports.
---

# HD Skill Catalog

You're running inside a Hydrogen Desktop workspace — a **WSL2 Ubuntu distro
`Adom-Workspace`** by default, or a **Docker container** under the legacy
`HD_RUNTIME=docker` runtime. HD ships a curated catalog of public skills (all
named `hd-*`) so your Claude knows about HD's own interface, networking, setup
flow, and gotchas. The `install-hd-skills` setup step deploys them **flat into
`~/.claude/skills/<name>/SKILL.md`** automatically.

## How the catalog is bucketed (and what you actually have)

The public skills live in three buckets in the HD repo under
`skills/public-facing/`:

- **`shared/`** — runtime-neutral. **Always installed.**
- **`wsl2/`** — the WSL2 implementations of runtime-specific topics. Installed
  when HD runs the **default WSL2 runtime**.
- **`docker/`** — the legacy Docker implementations of the same topics, plus the
  Docker-Desktop-only skills. Installed only when `HD_RUNTIME=docker`.

`install-hd-skills` deploys `shared/` **plus the active runtime's bucket** —
mirroring `runtime/mod.rs::select_runtime()`. So you have exactly one runtime's
flavor of each topic, never both. **Read `hd-runtime-mode` first** to confirm
which runtime you're in.

## Shared skills (always present)

| Skill | What it covers |
|-------|----------------|
| `hd-skill-catalog` | This file — read first to know what's available. |
| `hd-runtime-mode` | WSL2 vs Docker: which runtime you're in and what differs. |
| `hd-golden-image` | Your workspace is a pre-baked golden WSL2 image — gallia, CLIs, claude, code-server, settings, and these skills are baked in (not installed by setup); how to update. |
| `hd-skill-loop` | (Maintainers) The loop to fix a wrong/stale HD skill: verify vs the live HD, fix it live, write it back to the repo, bake it into the next image. |
| `hd-who-am-i` | Answer "who am I / what can I do here" — the auto-question HD injects on first launch. |
| `hd-adom-auth` | Adom login/logout, auth intent flow, session token, profile menu. |
| `hd-claude-auth` | How Claude Code signs in: OAuth via Browser Picker, credential backup, the `claude-auth` step. |
| `hd-api` | Control API reference (`127.0.0.1:47084`). |
| `hd-desktop-sse` | HD's local workspace API + SSE — adom-cli inside the workspace talks to HD, not cloud Hydrogen. |
| `hd-monitor` | Watch the workspace in real-time via SSE; composes with Claude's Monitor tool. |
| `hd-ui` | HD's menus, dialogs, panels, programmatic UI control via CDP, CSS selectors. |
| `hd-open-url` | The decision guide for "open a website": the six ways to open a URL (webview tab, HD window, Pup, native browser, picker, headless curl) and when to pick each. |
| `hd-browser-picker` | Every URL HD opens routes through a 5-layer interception into a picker dialog (AI-friendly 5s countdown). |
| `hd-permissions` | Why mic/camera/clipboard/notifications "just work" — HD auto-grants WebView2 permissions, so webview apps see no Allow prompts. |
| `hd-adom-desktop` | What HD and Adom Desktop (AD) are + how they work together — AD is your reach onto the user's real OS (create files/folders, run shell, OS screenshots, launch apps, browsers, KiCad/Fusion). |
| `hd-bridges` | Built-in KiCad/Fusion/Puppeteer bridges + extensible wiki catalog (e.g. Blender) + full AD capability list (usb, caption, record…). |
| `hd-eval` | Inject JS into ANY HD surface (shell/workbench/wiki/Claude) via POST /eval-in; build add-ons, overlays, highlights. |
| `hd-adom-menu` | The upper-left Adom logo menu: Settings, Ports, API Explorer, DevTools, Setup Steps, Virgin Reset, About dialog, version readout. |
| `hd-settings` | HD's Settings dialog + the full preferences tree (theme, vim mode, 3D control style, launch-on-boot, AD window behavior). |
| `hd-file-transfer` | Move files BOTH ways between the WSL2 workspace and the Windows PC (/mnt/c, \\wsl$, adom-desktop relay). |
| `hd-tab-icons` | Webview tab icon customization (displayIcon API, brand colors, MDI/SVG). |
| `hd-profile-menu` | The avatar dropdown: profile/repos/molecules links and logout. |
| `hd-embedded-ad` | HD ↔ Adom Desktop embedded mode: tray, hidden AD, footer pill. |
| `hd-self-screenshot` | How Claude screenshots HD panels + any host window (window control, multi-monitor), ralph loops, resize-before-Read rule. |
| `hd-capture-share` | The screen-share + "AI wants access" approval + countdown the AI triggers to capture the editor; tab/screen scopes, Webview/Pup window mode. |
| `hd-recording` | Record screen/window — HD's NATIVE WGC/DXGI recorder (h264/h265 mp4 → `recordings/`, no picker/banner, "record kicad"/"record whole screen", max-duration cap), plus AD desktop recording + the tab-vs-desktop footgun. |
| `hd-screen-lock` | HD screen capture and the display wake-lock: HD's native screenshots (CDP) + recording (WGC/DXGI) hold NO wake-lock, so HD has no burn-in leak; the cap + "● Recording" indicator; `powercfg /requests` to diagnose. |
| `hd-notifications` | Reach the user — OS Windows toasts + emergency taskbar flash via `notify_user`, AND the in-app `POST /ui/toast` (toast inside the HD window). |
| `hd-captions` | Paint labeled text on the user's screen — a Win32 always-on-top caption overlay for demos / step callouts. |
| `hd-welcome` | The static welcome page shown after setup completes. |
| `hd-overview` | Master skill index, grouped by category. |

## Runtime-specific skills (you get the variant for your runtime)

Same names across `wsl2/` and `docker/`; you have whichever matches your runtime.

| Skill | What it covers |
|-------|----------------|
| `hd-container` | This workspace's spec — Ubuntu 24.04, code-server 4.112.0, what's pre-installed, env vars. |
| `hd-topology` | The three layers and how commands route to reach the workspace. |
| `hd-networking` | Port architecture, hostnames, code-server proxy, host access, NEVER-do-these rules. |
| `hd-ports` | Forwarding workspace services to Windows. |
| `hd-port-watcher` | The dynamic port-forward daemon for extension OAuth callbacks. |
| `hd-volume` | Where your code lives, what persists, what a reset wipes, how to copy files out. |
| `hd-container-stats` | The title-bar CPU/RAM indicator and how its stats are gathered. |
| `hd-setup` | The setup panel UI — Run All, Rollback, Virgin Reset toggles. |
| `hd-setup-steps` | What each setup step did to tool your workspace. |

**WSL2-only:** `hd-workspace-lifecycle`, `hd-workspace-monitoring`.
**Docker-only (legacy):** `hd-docker-desktop`, `hd-docker-lifecycle`, `hd-docker-monitoring`.

## What's NOT in your workspace — internal dev skills

The HD repo also has skills under `skills/dev-internal-facing/` (hd-debug, hd-dev,
hd-docker, hd-pitfalls, hd-settings, an internal hd-setup-steps deep-dive,
hd-vm-test, and more). These are **Adom-employee-only development skills** — HD
build pipeline, debugging the Tauri/WebView2 source, internal architecture,
postmortems. They live in the HD repo but are **NEVER** deployed to user
workspaces.

The split is enforced by the `install-hd-skills` step, which only reads
`skills/public-facing/{shared,<runtime>}/hd-*/` — never `dev-internal-facing/`.

| Folder | Audience | Deployed to user workspaces? |
|--------|----------|------------------------------|
| `public-facing/shared/` | End users of HD | **Yes** (always) |
| `public-facing/wsl2/` | End users on the WSL2 runtime | **Yes** when WSL2 (default) |
| `public-facing/docker/` | End users on the Docker runtime | **Yes** when `HD_RUNTIME=docker` |
| `dev-internal-facing/` | Adom employees who develop HD | **No** (repo-only) |

## How to use this catalog

1. In a fresh HD workspace, scan this table for the most relevant `hd-*` skill
   before answering an HD-related question — and check `hd-runtime-mode` so you
   trust the right runtime's facts.
2. Skill descriptions are loaded automatically by skill-pilot at session start.
3. If a topic seems missing, it may be a dev-internal-facing skill (repo-only) —
   ask the user to check the HD repo.

## When skills get refreshed

The `install-hd-skills` step deploys skills. Re-run it via
`POST /setup/run-step {"id":"install-hd-skills"}` to refresh after an HD update.
