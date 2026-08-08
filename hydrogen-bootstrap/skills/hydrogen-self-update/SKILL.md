---
name: hydrogen-self-update
description: "How the AI keeps the Hydrogen Desktop APP itself (the Windows/macOS frontend, not the workspace) up to date — AI-first, consent-based. Use when asked \"is there an HD update\", \"update Hydrogen Desktop\", \"is my HD current\", \"what version of HD am I on\", \"update the app\", \"new HD version\". Trigger words: HD update, update hydrogen desktop, app update, is HD current, HD version, new version of HD, relaunch to update, self-update."
---

# HD Self-Update — the AI updates the app for you (consent-based)

This is how the **Hydrogen Desktop app itself** (the Windows/macOS shell around your editor)
stays current. It is NOT the `workspace-updater` (that's the in-distro tooling). It's **AI-first**:
there is no nagging button — the AI notices a new HD version, tells you both version numbers, and
on your OK downloads + relaunches onto the new version.

## When to check
Check at the **start of a session** and whenever the user asks about updates. Don't poll
constantly.

## How to check (know both version numbers)
```
GET http://127.0.0.1:<control-port>/updater/status
```
Returns `{ current_version, latest_version, update_available, staged, ... }`:
- `update_available: true` → a newer HD exists.
- `staged: true` → it's already downloaded + SHA-verified in the background, so applying is an
  **instant relaunch** (no wait).
(`current_version` is also derivable from `/buildinfo`; `latest_version` comes from the wiki
`version.json`. `/updater/status` gives you both in one call.)

## What to do
If `update_available`, **tell the user both versions and ASK** — e.g.:
> "Hydrogen Desktop **vX → vY** is available (already downloaded). Want me to update and relaunch?
> Takes a few seconds; this workspace and our chat reconnect right after."

On **explicit consent**:
```
POST http://127.0.0.1:<control-port>/updater/install
```
HD applies the staged update (instant if `staged`, else downloads first) and relaunches onto the
new version. **The Linux workspace + code-server keep running**, so your session reconnects in a
few seconds — you can pick the conversation right back up.

## Rules
- **Consent-first.** Never relaunch HD without the user's OK (it restarts their app). Pick a
  natural break — not mid-task.
- **State both versions** (current → latest) so the user knows what's changing.
- This updates the **app shell only**. Editor extensions/code-server use the reload banner;
  in-workspace tooling/skills use the `workspace-updater`. Don't confuse the three.

## Resolving the control port
Read it from `VSCODE_PROXY_URI` / the HD `[ports]` log line (default control API `47084`), or
reach it through the relay/proxy like other HD control endpoints.
