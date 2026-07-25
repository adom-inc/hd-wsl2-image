---
name: hd-embedded-ad
description: How Hydrogen Desktop (HD) and Adom Desktop (AD) interact via "embedded mode". Use whenever the user asks about the system tray icon, why AD isn't visible, why two desktop apps are installed, the "Embedded · HD" footer pill, or how to make AD show up standalone. Trigger words — embedded mode, system tray, AD tray, why is adom desktop hidden, where's my tray icon, HD vs AD, both apps installed, why two installs, ad missing from tray, switch AD to standalone, AD won't show, run AD without HD, decouple AD from HD.
---

# HD ↔ AD Embedded Mode

There are two desktop apps in the Adom ecosystem: **Hydrogen Desktop (HD)** — the user-facing workspace app — and **Adom Desktop (AD)** — the bridge that talks to local apps (KiCad / Fusion 360 / Chrome / files). HD's installer silently bundles AD and runs it in **embedded mode**, where AD is invisible and HD's tray menu mirrors AD's controls.

This skill explains how the two interact so you can answer "why isn't AD in my tray?", "should I have two installs?", "why did the tray icon disappear?" and similar.

## Two modes

### Standalone AD (no HD anywhere)

How AD launches when nobody owns it:
- Tray icon visible in Windows notification area
- Main window opens on launch (unless `--start-hidden`)
- Autostart shortcut in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AdomDesktop.lnk` → launches on every boot
- Registered in Add/Remove Programs (HKLM `Uninstall\AdomDesktop`)
- Auto-update polls `wiki-ufypy5dpx93o.adom.cloud/static/apps/adom-desktop/version.json` every 4h
- Footer shows the user's email + a "Sign in" / "Sign out" link

This is what AD looked like before HD existed and what it reverts to when HD vanishes.

### Embedded AD (HD owns it)

HD's installer puts AD into embedded mode by:
1. Writing `%LOCALAPPDATA%\Adom Desktop\embedded.json` marker (`{"owner":"hydrogen-desktop", ...}`)
2. Deleting AD's Desktop / Start Menu / Startup `.lnk` shortcuts so the user can't double-launch standalone AD
3. Configuring HD's own systray to mirror AD's menu (Open AD, Connect All, Disconnect All, Settings, etc.)

When HD spawns AD with `--embedded --start-hidden --relay-url ws://127.0.0.1:8765 --relay-name hydrogen-desktop`, AD detects embedded mode and:
- **Hides** its system tray (HD owns the one tray)
- **Suppresses** its autostart shortcut creation
- **Disables** its auto-updater (HD owns AD's update channel — fresh AD bundled in each HD release)
- **Hides** its main window on boot (HD's tray "Open Adom Desktop" menu item opens it on demand)
- **Skips** HKLM Uninstall registration (HD's installer offers cascade-uninstall of AD)
- Footer shows a read-only email + an "Embedded · HD" pill

Result: the user only ever sees one app (HD) in the tray + Start Menu, even though two processes (HD + AD) are running.

## How AD detects "am I embedded?" — 3-signal cascade

AD calls `embedded::detect_embedded_mode()` at boot. First match wins:

1. **CLI flag**: `--embedded` (or `--embedded-mode`) on the command line. Writes the marker file, owner defaults to `hydrogen-desktop`. **This is what HD spawns AD with.**
2. **Env var**: `ADOM_EMBEDDED=1` (or `true`). Same behavior as the flag.
3. **Marker file**: `%LOCALAPPDATA%\Adom Desktop\embedded.json` exists. AD then probes HD's **liveness beacon** on `127.0.0.1:9001` (a real port AD listens for — NOT HD's control API; HD's actual control API is **47084**):
   - If HD answers the beacon → embedded mode
   - If HD doesn't answer → AD treats the marker as stale, deletes it, falls back to standalone

If none of the three signals fire → standalone.

## Lifecycle ownership in embedded mode

HD's runtime supervisor:
- Reads HD's session token from `%APPDATA%\hydrogen-desktop\hydrogen-session.txt`
- Spawns AD detached with the embedded flags above
- Polls `http://127.0.0.1:47200/health` every 5s
- If AD's health probe fails → HD respawns AD with the same args

HD's tray menu (mirrors AD's controls so the user gets all the AD verbs without seeing AD's tray):
```
Open Hydrogen Desktop
Reload Workspace
── Adom Desktop ──
Open Adom Desktop      → POST 127.0.0.1:47200 desktop/window_show
Connect All            → POST desktop/connect_all
Disconnect All         → POST desktop/disconnect_all
Settings (Adom Desktop)→ POST desktop/window_show
─────
Quit                   → POST desktop/shutdown, 200ms grace, then app.exit(0)
```

HD's uninstaller PREUNINSTALL hook prompts "Also remove Adom Desktop?" → cascade-uninstalls AD on Yes.

## Runtime transitions

**AD ≥ v1.8.47** re-checks HD's liveness every 60s during runtime, not just at boot. This is the normal daily cycle for most users, not an edge case:

- Morning: user launches HD → HD spawns AD with `--embedded` → AD's tray hides, pill appears
- Evening: user quits HD → AD's next poll fails the HD probe → AD reverts to standalone → tray reappears
- Next morning: user launches HD again → AD's next poll succeeds → AD re-embeds → tray hides

The same AD process can flip mode back and forth indefinitely across an HD-quit / HD-relaunch cycle. Transitions:

| Current mode | HD probe says | What AD does |
|---|---|---|
| Standalone | dead | stay standalone (no-op) |
| Standalone | alive | → **embed**: hide tray, write marker, hide main window, show "Embedded · HD" pill |
| Embedded | dead | → **unembed**: show tray, delete marker, hide pill (main window left as-is) |
| Embedded | alive | stay embedded (refresh marker heartbeat in `last_seen`) |

Both transitions emit a `mode-changed` event so the frontend can update the footer pill in real time.

**AD ≤ v1.8.46** only checks at boot. If HD dies while AD is running, AD stays invisible in embedded mode until restart.

## Common questions

### "I don't see AD in my system tray on a Windows box with HD installed"

Expected. HD's installer deleted AD's autostart shortcut, so AD doesn't launch on boot. AD only runs when HD spawns it. HD's tray includes AD's menu items.

To verify: `tasklist | findstr adom-desktop`. If AD's running, it's just hidden (per embedded mode). If not running, HD isn't either.

### "I want AD standalone — how do I unembed?"

- Quit HD
- Delete `%LOCALAPPDATA%\Adom Desktop\embedded.json`
- Launch AD via `%LOCALAPPDATA%\Adom Desktop\adom-desktop.exe`
- AD will detect no marker + no CLI flag → standalone mode → tray reappears

Or uninstall HD with "Yes, also remove Adom Desktop" → No → HD is gone, AD's marker is cleared, AD reverts to standalone on next launch. (Note: AD's autostart shortcut was deleted by HD's installer, so AD still won't auto-launch on boot until you re-run AD's installer to recreate it.)

### "Both HD and AD are installed — is that normal?"

Yes. HD's NSIS POSTINSTALL hook silently runs the bundled AD installer with `/S /NOLAUNCH`. AD lives at `%LOCALAPPDATA%\Adom Desktop\`, HD at `%LOCALAPPDATA%\Hydrogen Desktop\`. Two separate exes, two separate Add/Remove Programs entries (well, only HD's is in Add/Remove if HD's installer ran the embedded-mode AD which skips HKLM register — AD ≥ v1.8.46).

### "AD's tray suddenly appeared even though HD is installed"

HD probably crashed or was closed. AD ≥ v1.8.47's runtime poll noticed HD is dead and reverted to standalone tray. The fix: relaunch HD from the Start Menu → AD's next poll detects HD → tray hides again.

### "Direct API for AD verbs"

AD listens on `127.0.0.1:47200` for `POST /command` with `{"app":"desktop","command":"<verb>","args":{...}}`. The 7 user-visible verbs HD's tray uses:
- `window_show`, `window_hide`
- `connect_all`, `disconnect_all`
- `shutdown`
- `embedded_status` (returns `{embedded, owner, source, ...}`)
- `logout`

Port discovery if 47200 is taken: read `%USERPROFILE%\.adom\direct-api-port` (single line `host:port`).

## Source-of-truth references

- AD's mode detection: `adom-desktop/src-tauri/src/embedded.rs:detect_embedded_mode()`
- HD's AD spawn: `hydrogen-desktop/src-tauri/crates/hd-app/src/ad_supervisor.rs:spawn_ad_embedded()`
- HD's tray menu: `hydrogen-desktop/src-tauri/crates/hd-app/src/tray.rs:install_tray()`
- HD's NSIS hook (embed-AD on install / offer-uninstall): `hydrogen-desktop/src-tauri/crates/hd-app/installer/hd-install.nsh.template`
- AD's release manifest (used by HD's release pipeline to fetch bundled AD): `wiki-ufypy5dpx93o.adom.cloud/static/apps/adom-desktop/version.json`
