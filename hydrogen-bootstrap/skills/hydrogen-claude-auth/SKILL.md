---
name: hydrogen-claude-auth
description: How Claude Code authenticates inside Hydrogen — the OAuth flow that opens in your browser via the Browser Picker, where credentials are stored on host vs workspace, how Hydrogen backs them up so a workspace rebuild doesn't make you re-auth, the virgin-reset toggle that wipes Claude creds, and the 4-technique auth cascade Hydrogen runs if Claude isn't authenticated. READ when troubleshooting "Claude not authenticated", expired Claude tokens, re-authenticating after a virgin reset, or wondering where Claude credentials live. Trigger words — claude auth, claude code login, claude code authentication, claude not authenticated, claude oauth, claude credentials, claude session, claude.ai subscription, replay-claude-credentials.json, claude-auth, claude credential backup, claude re-auth, claude expired, claude.ai subscription button.
---

# Hydrogen Claude Auth — how Claude Code signs in

Claude Code (the VS Code extension inside your Hydrogen workspace) authenticates separately from your Adom login. Hydrogen takes responsibility for making sure Claude is signed in throughout workspace rebuilds so you don't have to re-authenticate every time.

For Adom auth (your hydrogen.adom.inc login), see [hydrogen-adom-auth](../hydrogen-adom-auth/SKILL.md). This skill is Claude-Code-specific.

## The flow

1. The Claude Code extension panel shows a "Claude.ai Subscription" button when it isn't authenticated.
2. Clicking opens an OAuth URL to `claude.ai`.
3. Hydrogen's Browser Picker intercepts the URL (since it's a `*.claude.ai` link). The "Claude auth" branded variant of the picker appears with the work browser profile pre-selected and a 5-second auto-countdown.
4. The browser opens the Claude OAuth page; you complete sign-in (or it auto-completes if you're already signed in to claude.ai).
5. Claude returns OAuth credentials, which the extension stores at `/home/adom/.claude/.credentials.json` inside the workspace.
6. Hydrogen's setup step `claude-auth` notices the new credentials and **backs them up to the host** (in Hydrogen's app-data directory, as `replay-claude-credentials.json`) so future workspace rebuilds can replay them. The exact host path is platform-specific — see the platform layer for where it lives on your OS.

## Where Claude credentials live

| Layer | Location | Purpose |
|-------|----------|---------|
| Inside workspace (live) | `/home/adom/.claude/.credentials.json` | Active credentials the extension and `claude` CLI both read |
| Host-side backup | `replay-claude-credentials.json` in Hydrogen's app-data dir on the host | Backup so a fresh workspace can be re-authenticated without re-OAuth |
| VS Code secret store (in code-server's user data) | webview-internal, can't be inspected directly | The extension also keeps a secret per panel; this is what dictates the chat UI showing vs the auth button |

**Key insight**: each Claude Code panel instance keeps its own auth state. If one panel says "not authenticated", opening a NEW Claude Code conversation panel often shows the auth button fresh and lets you sign in cleanly.

## How Hydrogen keeps you signed in across workspace rebuilds

When you virgin-reset and rebuild the workspace (assuming you DON'T check the "Claude credentials" toggle):

1. Workspace deleted + recreated by setup steps
2. Step `claude-auth` runs early — reads the `replay-claude-credentials.json` backup from Hydrogen's host app-data dir
3. If the file exists AND the `expiresAt` is still in the future → copies it into the new workspace at `/home/adom/.claude/.credentials.json`
4. Claude Code extension reads it on first launch → user stays signed in

If credentials are expired or missing, Hydrogen runs the **auth cascade** to get you signed in without manual fiddling.

## The 4-technique auth cascade

If Claude isn't authenticated after setup, Hydrogen tries each technique in order until one works. Each call logs to the setup panel output so you see exactly what's happening.

| # | Technique | What it does |
|---|-----------|--------------|
| 1 | Detect auth failure | Scans all VS Code webview contexts for the "Claude.ai Subscription" button / "How do you want to log in?" text. Confirms whether the auth UI is reachable. |
| 2 | Open NEW conversation + auto-click auth button | The new-conversation panel re-evaluates auth state and shows the button cleanly. Hydrogen clicks it via the webview eval channel. |
| 3 | Open Claude editor + auto-click auth button | If technique 2 didn't trigger a fresh auth state, opens a Claude editor (different VS Code command) and tries the same click. |
| 4 | CLI fallback (`claude auth login`) | Runs `claude auth login` inside the workspace, extracts the OAuth URL from stdout, opens it in your browser via the Browser Picker. You paste the returned code into a VS Code terminal. |

After authentication, the new credentials are immediately backed up to the host via step 6 of the flow above.

## Virgin reset — what each option does

The setup panel's Virgin Reset section has a per-Claude-creds toggle:

| Toggle | What happens to Claude auth | When to use |
|--------|----------------------------|-------------|
| **Claude credentials** (default OFF) | Deletes the `replay-claude-credentials.json` backup from the host AND the credentials inside the workspace. **You will need to re-OAuth.** | When Claude is stuck in a broken auth state and you want a true fresh sign-in. |
| **Workspace** (default ON) | The workspace is rebuilt. If Claude creds toggle is OFF (default), `claude-auth` replays the backup → you stay signed in. | Normal virgin reset for testing. |
| **Workspace data** (default ON) | Wipes your `/home/adom/project/` work. Doesn't directly affect Claude creds, but rebuilds the workspace — same as above. | When you want a totally fresh `~/project/`. |

**Standard pattern for AI-driven testing**: keep the "Claude credentials" toggle OFF so testing doesn't bounce you out of Claude every cycle.

## Common failures

**"Claude.ai Subscription" button keeps appearing even though I just signed in**
- A SECOND panel still has stale auth state. Close all Claude Code panels and open one fresh — it'll read the new credentials.

**Credentials backup file exists but Claude says expired**
- Open the `replay-claude-credentials.json` backup (in Hydrogen's host app-data dir) and check the `expiresAt` (epoch ms). Compare to current time. If past, you need to re-OAuth. Hydrogen's auth cascade will handle this on next setup run.

**`claude auth status` says `loggedIn: true` but the extension says not authenticated**
- **Known quirk**: the CLI and the VS Code extension use SEPARATE credential stores. `claude auth status` checks the CLI store; the extension uses VS Code secrets. Trust the extension UI (the "Claude.ai Subscription" button) over the CLI's status output.

**OAuth callback fails / browser shows "connection refused"**
- The callback URL is hitting a local port that Hydrogen hasn't forwarded to the host. Check the Hydrogen log for `[oauth] Callback port N detected` — Hydrogen should auto-start a proxy for it. If not, register the port manually via `adom-cli port-forward register <port> --visibility external`. (How host↔workspace port forwarding works is platform-specific — see the platform layer.)

## Related skills

- [hydrogen-adom-auth](../hydrogen-adom-auth/SKILL.md) — Adom (hydrogen.adom.inc) login, separate from Claude
- [hydrogen-browser-picker](../hydrogen-browser-picker/SKILL.md) — the Browser Picker that routes the Claude OAuth URL, including the branded "Claude auth" variant
- `hydrogen-setup-steps` — the `claude-auth` step and the auth cascade are part of setup
- `hydrogen-volume` — explains why the host-side backup survives workspace rebuild
