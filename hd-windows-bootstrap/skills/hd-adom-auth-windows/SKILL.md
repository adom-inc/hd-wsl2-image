---
name: hd-adom-auth-windows
description: >
  Windows/WSL2-specific details for Adom auth in HD — the exact %APPDATA%
  app-data path table for the session/replay/Claude credential files, and how
  to read the injected Adom API key from outside the WSL2 Adom-Workspace distro.
  READ alongside the generic [[hd-adom-auth]] skill when you need the concrete
  Windows file locations or the WSL2 cat command. Trigger words —
  %APPDATA%, hydrogen-session.txt, replay-session.txt,
  replay-claude-credentials.json, wsl Adom-Workspace, api-key path, windows
  auth files, where is the session token on windows.
---

# Hydrogen Desktop -- Auth (Windows / WSL2 specifics)

This is the Windows companion to the generic [[hd-adom-auth]] skill. Read that
first for the auth-intent flow, profile menu, login UI, and control-API auth
endpoints. This page only carries the Windows-specific file paths and the
WSL2-specific way to read the injected API key.

## Host app-data file table

On Windows, HD's app-data directory is `%APPDATA%\hydrogen-desktop\`. The
auth-related files the generic skill refers to live there:

| File | Path | Purpose |
|------|------|---------|
| Adom session token | `%APPDATA%\hydrogen-desktop\hydrogen-session.txt` | Plain-text Adom session cookie value. Read by the auth proxy; deleted on logout / 401. |
| Replay session copy | `%APPDATA%\hydrogen-desktop\replay-session.txt` | Replay copy of the session token; presence drives the "REPLAY" badge + countdown on the login page. |
| Claude credentials | `%APPDATA%\hydrogen-desktop\replay-claude-credentials.json` | Claude Code OAuth credentials replayed into the workspace during bootstrap. |

These are the same files the virgin-reset toggles operate on (see the generic
skill's "Virgin reset options for auth" table).

## Reading the injected API key from outside the WSL2 workspace

The `inject-api-key` setup step writes the Adom session token into the workspace
at `/var/run/adom/api-key` (mode 644). From inside the workspace you just
`cat /var/run/adom/api-key`. To read it from the Windows host (outside the
distro), go through `wsl`:

```bash
wsl -d Adom-Workspace -u adom -- cat /var/run/adom/api-key
```

(The default workspace distro is `Adom-Workspace`, user `adom`.)
