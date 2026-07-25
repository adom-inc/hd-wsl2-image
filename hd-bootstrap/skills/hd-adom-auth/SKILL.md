---
name: hd-adom-auth
description: >
  Adom auth in HD — how login/logout works (auth intent flow), where the
  session token lives, the profile menu, and how the Adom session feeds the
  setup steps. For Claude Code auth specifically, see hd-claude-auth.
  READ when troubleshooting Adom login failures, session token expiry, the
  profile dropdown, or virgin-reset Adom-auth options. Trigger words —
  adom login, login, logout, auth, session token, auth intent, confirmation
  code, profile menu, avatar, sign in, sign out, auth proxy, clear session,
  HD adom login, Your profile, Your repositories.
---

# Hydrogen Desktop -- Authentication Reference

## Auth Flow Overview

HD uses an **auth intent** flow (no email/password entry in the app).
The backend creates a short-lived intent token on the Carbon API,
opens the user's default browser to the Adom login page, and polls until
the user completes sign-in in the browser.

### Sequence

1. HD calls `invoke('auth_intent_start')` -> backend POSTs to
   `https://carbon.adom.inc/auth/intents` with `{"max_age": 7776000}`
   (90-day session).
2. Carbon returns `{token, confirmation_code, expires_at, auth_url}`.
3. HD opens the browser to the **`auth_url` Carbon returned**, falling back to
   `https://hydrogen.adom.inc/auth/intent?token={token}` (singular `intent`,
   token as a query param — NOT `/auth/intents/{token}`).
4. HD displays the confirmation code on screen and shows a spinner.
5. Frontend polls `invoke('auth_intent_poll', {token})` every 2 seconds.
   Backend GETs `https://carbon.adom.inc/auth/intents/{token}/status`.
6. When the user confirms in the browser, the response includes
   `{state: "authenticated", session_token: "..."}`.
7. The backend saves the session token to HD's app-data directory on the host
   (the `hydrogen-session.txt` file) and a replay copy alongside it.
8. Frontend redirects to the dashboard.

### Source files

- **Login page**: `src/routes/auth/login/+page.svelte`
- **Auth backend**: `src-tauri/crates/hd-app/src/lib.rs` (functions
  `auth_intent_start`, `auth_intent_poll`, `auth_proxy`,
  `check_replay_credentials`, `replay_adom_login`). NOTE: the old
  `src-tauri/src/lib.rs` is a pre-crate-split vestige — the live code is in the
  `hd-app` crate.
- **Auth components**: `src/lib/components/auth/` (Header, Form, Footer,
  SubmitButton, Error, Success)
- **User API**: `src/lib/api/authenticated_user.ts`

---

## Session Token

**Location**: HD's app-data directory on the host (the `hydrogen-session.txt`
file).

A plain-text file containing the Adom session cookie value. Created by either:
- The auth intent flow (on successful poll)
- The auth proxy (when Carbon returns a `set-cookie: session_token=...` header)

The auth proxy (`invoke('auth_proxy', ...)`) reads this file and attaches it
as a `Cookie: session_token=...` header on every request to `carbon.adom.inc`.

### Token lifecycle

- **Created**: on login (auth intent or browser set-cookie capture)
- **Refreshed**: automatically when the auth proxy receives a new set-cookie
- **Cleared**: on logout (`auth_proxy({path: "/auth/clear-local"})`) or on
  401 response (backend auto-deletes the file)
- **Max age**: 90 days (set at intent creation)

### Reading the token programmatically

```bash
# From the control API
curl http://127.0.0.1:47084/auth-token

# From inside the workspace (injected by setup step inject-api-key, mode 644)
cat /var/run/adom/api-key
```

For the host-specific path table and the runtime-specific way to read
`/var/run/adom/api-key` from outside the workspace, see the
[[hd-adom-auth-windows]] companion skill.

---

## Auth Proxy

The backend command `auth_proxy` is the gateway for all authenticated requests
to the Adom Carbon API. It:

1. Reads the session token from disk
2. Attaches it as a cookie to the outgoing request
3. Captures any `set-cookie` response and updates the saved token
4. On 401, deletes the token and returns `{expired: true}`
5. Supports a special `path: "/auth/clear-local"` to delete the token file

**Base URL**: `https://carbon.adom.inc`

```javascript
// Example: get the current user
const result = await invoke('auth_proxy', {
  path: '/api/me',
  method: 'GET'
});
// result = { status: 200, data: { id: "...", name: "jlauer12", ... }, ok: true }
```

---

## Credential Replay

On login page mount, HD checks for saved credentials before starting the
full auth intent flow:

1. `invoke('check_replay_credentials')` checks if replay files exist on disk.
2. If the replay-session file exists (has_adom = true), HD shows a "REPLAY"
   badge and a 5-second countdown.
3. `invoke('replay_adom_login')` attempts to authenticate using the saved
   session token.
4. If replay succeeds, the user is logged in without opening a browser.
5. If replay fails, HD falls back to the normal auth intent flow.

This makes re-login after a virgin reset instant when the user chose to
preserve the Adom session token.

---

## Claude Credentials

**Location**: HD's app-data directory on the host (the
`replay-claude-credentials.json` file).

Stores Claude Code OAuth credentials so they can be replayed into the
workspace during bootstrap. The setup step `inject-api-key` reads the
session token to authenticate with the Adom API, and Claude credentials
are injected separately.

### Virgin reset options for auth

The virgin reset panel (Setup Panel -> Virgin Reset) has per-item toggles:

| Toggle | File | What it clears |
|--------|------|----------------|
| Adom session token | `hydrogen-session.txt` | Adom login. Next launch requires re-auth. |
| Claude credentials | `replay-claude-credentials.json` | Claude Code OAuth. Next bootstrap re-authenticates Claude. |

These are independent -- you can wipe Claude creds without losing Adom login,
or vice versa.

### CSS selectors for virgin reset auth options

```
label.virgin-opt  -- each checkbox row
input[type="checkbox"]  -- the toggle (bind:checked to virginOpts.adom_token / virginOpts.claude_token)
.virgin-hint  -- shows filename (hydrogen-session.txt / replay-claude-credentials.json)
.vp-badge  -- status badge ("exists" / "clean")
.vp-exists  -- green badge (file exists)
.vp-clean  -- gray badge (file gone)
```

---

## Profile Menu

**Location**: Top-right corner of the editor nav bar.
**Source**: `src/lib/components/editor/EditorNav.svelte` (lines ~2403-2443)

Click the circular user avatar to open a dropdown with two sections.

### Menu items

| Item | Icon | Action |
|------|------|--------|
| Your profile | `mdi:account-circle-outline` | Navigates to `/users/{username}` |
| Your repositories | `mdi:folder-outline` | Navigates to `/users/{username}/repositories` |
| Your molecules | `mdi:atom` | Navigates to `/users/{username}/molecules` |
| Log out | `mdi:logout` | Confirms, then clears session + redirects to login |

**CRITICAL**: Logout is ONLY in the profile menu (top-right avatar), NOT in
the Adom menu (top-left logo). Do not look for logout in the wrong menu.

### CSS selectors

| Element | Selector |
|---------|----------|
| Profile dropdown container | `.profile-dropdown-container` |
| Avatar button | `.profile-dropdown-button` |
| Avatar image | `.profile-dropdown-button img` |
| Dropdown (open) | `.profile-dropdown-content.open` |
| Menu items | `.profile-dropdown-content .dropdown-link` |
| Menu item icons | `.dropdown-link span` |

### CDP eval examples

```javascript
// Open the profile menu
document.querySelector('.profile-dropdown-button')?.click();

// Click "Your profile"
var links = document.querySelectorAll('.profile-dropdown-content .dropdown-link');
if (links[0]) links[0].click();

// Click "Your repositories"
if (links[1]) links[1].click();

// Click "Your molecules"
if (links[2]) links[2].click();

// Click "Log out"
var logoutBtn = Array.from(document.querySelectorAll('.profile-dropdown-content .dropdown-link'))
  .find(function(e) { return e.textContent.includes('Log out'); });
if (logoutBtn) logoutBtn.click();
// Note: this triggers a confirm dialog. To auto-confirm, you need to handle the dialog.

// Read the current user's avatar URL
var avatar = document.querySelector('.profile-dropdown-button img');
avatar ? avatar.src : 'no avatar';

// Read the current username from the avatar alt text
avatar ? avatar.alt : 'unknown';
```

---

## Logout Flow

1. User clicks "Log out" in profile menu.
2. `showConfirm('Are you sure you want to log out?', 'Log Out')` -- confirmation dialog.
3. If confirmed (app mode):
   - `invoke('auth_proxy', {path: '/auth/logout', method: 'DELETE'})` -- server-side logout
   - `invoke('auth_proxy', {path: '/auth/clear-local', method: 'POST'})` -- deletes `hydrogen-session.txt`
   - Clears auth-related domain preferences from `localStorage['hd-url-routing-prefs']`
4. Redirects to `/auth/login`.

---

## Login Page UI

**Route**: `/auth/login`

### App mode (auth intent)
- Adom logo + "Log in to Hydrogen" header
- Confirmation code in a monospace box (`.confirmation-code`)
- Spinner + "Waiting for you to sign in..."
- "Open browser again" button (`.retry-button`)
- "Continue without login" link at the bottom (`.skip-login a`)

### Browser mode (email/password)
- Standard form with email + password fields
- "Log In" submit button
- Footer with registration link

### Auth intent CSS selectors

| Element | Selector |
|---------|----------|
| Container | `.intent-container` |
| Confirmation code | `.confirmation-code` |
| Spinner | `.spinner` |
| Status message | `.intent-message` |
| Hint text | `.intent-hint` |
| Success message | `.intent-success` |
| Error message | `.intent-error` |
| Retry button | `.retry-button` |
| Replay badge | `.replay-badge` |
| Skip login link | `.skip-login a` |

### CDP eval on the login page

```javascript
// Check auth intent state
document.querySelector('.intent-message')?.textContent;
// -> "Waiting for you to sign in..." or "Authenticated! Redirecting..."

// Read the confirmation code
document.querySelector('.confirmation-code')?.textContent;

// Click retry
document.querySelector('.retry-button')?.click();

// Skip login (continue without auth)
document.querySelector('.skip-login a')?.click();
```

---

## How Auth Affects Setup Steps

The setup/bootstrap process depends on a valid session token:

1. **inject-api-key** -- reads the HD-side `hydrogen-session.txt`, writes the
   token into the workspace at `/var/run/adom/api-key` (mode 644) as the Adom
   API key. If the token is missing or expired, this step fails and downstream
   steps (adom-cli, gallia, etc.) cannot authenticate.

2. **Claude auth** -- uses `replay-claude-credentials.json` if available;
   otherwise requires the user to complete the Claude OAuth flow inside the
   VS Code iframe.

If bootstrap fails on auth, the fix is usually: log in again via the profile
menu login page, then re-run bootstrap from the Adom menu.

---

## Control API Auth Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth-token` | Read the saved Adom session token |
| POST | `/claude-auth` | Start Claude Code OAuth (PKCE) |
| GET | `/oauth/callback` | Receives OAuth redirect (auto, do not call) |
| POST | `/start-oauth-proxy` | Spin up temp TCP listener for OAuth callback |
| POST | `/auth/proxy` | Proxy request to Carbon API with session token |

See the **hd-settings** skill (API Explorer section) for the
full endpoint reference.

---

## Cross-references

- **hd-adom-auth-windows** -- host app-data path table + WSL2 specifics
- **hd-ui** -- menu layout, where profile menu lives
- **hd-setup** -- bootstrap steps that depend on auth
- **hd-settings** -- API Explorer (auth endpoints tab)
- **hd-networking** -- control API port (47084)
- **carbon-preferences** -- user preferences that require auth
