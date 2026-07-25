---
name: hd-profile-menu
description: HD's profile menu — the user-avatar dropdown in the top-right corner that links to your Adom profile/repositories/molecules pages on adom.inc and contains the logout action. Logout is gated by a confirm dialog and returns you to the HD login page; logging in is the gate to using HD at all (no anonymous use). Use when the user asks about "log out", "logout", "sign out", "Your profile", "Your repositories", "Your molecules", the avatar dropdown, the login page, or "why am I locked out". Trigger words — profile menu, avatar menu, top-right avatar, user menu, log out, logout, sign out, confirm logout, login gate, login page, your profile, your repositories, your molecules, adom.inc profile, hd locked out, hd login required, return to login.
---

# HD Profile Menu

The profile menu is the dropdown that opens when you click your **circular user avatar in the top-right corner** of HD. It contains links to your Adom-account pages on `adom.inc` plus the logout action.

This is **separate from the Adom menu** (top-left logo). Different audiences, different functions — see [hd-ui](../hd-ui/SKILL.md) for the Adom menu.

## Where your avatar image comes from

- **Logged in via Google** — HD displays the Google profile photo that Google gives us as part of the sign-in payload. You change it by changing your Google account photo.
- **Logged in via direct Adom login** (email/password style) — HD shows the avatar you've uploaded on `adom.inc`. To customize it, click **Your profile** in this menu to open your profile page on adom.inc and change the avatar there.

## What's in the menu

| Item | Icon | Behavior |
|------|------|----------|
| **Your profile** | person | `goTo('/users/<name>')` — navigates the HD webview to your Adom profile page |
| **Your repositories** | folder | `goTo('/users/<name>/repositories')` — your repositories list |
| **Your molecules** | atom / molecule | `goTo('/users/<name>/molecules')` — your molecules list |
| **Log out** | exit-arrow | Opens a confirm dialog → on confirm, clears the Adom session and returns to the HD login page |

> **Note (current behavior, verified 2026-06-12)**: the three "Your *" items call `goTo('/users/<name>/...')` (see `EditorNav.svelte` ~L2540-2557), i.e. they navigate the HD webview itself to the in-app `/users/...` route rather than opening adom.inc in the user's external browser. This is in-app navigation, not the Browser Picker. (The earlier "routes to internal HD views" concern has been narrowed to this expected in-app routing.)

## Log out — the confirm dialog

Clicking **Log out** opens this dialog:

```
┌──────────────────────────────────┐
│ Log Out                          │
│                                  │
│ Are you sure you want to log out?│
│                                  │
│              [Cancel]  [Confirm] │
└──────────────────────────────────┘
```

- **Cancel** — dismisses the dialog, you stay signed in
- **Confirm** — wipes `hydrogen-session.txt` from `%APPDATA%\hydrogen-desktop\`, clears in-memory session state, and routes the webview to `/auth/login`

After Confirm: you land on the HD login page and **cannot use HD until you log in again.**

## Login is a gate to using HD

HD is **not usable without an Adom login**. There is no anonymous mode, no skip-login option once you're signed out. The (app)/+layout.svelte enforces this — if the session token is missing or expired, every protected route redirects to `/auth/login`.

The login itself uses the auth-intent flow (no email/password entry in HD — you complete sign-in in your default browser, then HD picks up the session). See [hd-adom-auth](../hd-adom-auth/SKILL.md) for the full flow.

After successful login, HD restores you to the route you were trying to reach (or the dashboard).

## CSS selectors (for CDP eval / Claude automation)

| Element | Selector |
|---------|----------|
| Avatar button (top-right) | `.profile-dropdown-button` |
| Open dropdown | `.profile-dropdown-content` |
| Your profile item | first `.profile-dropdown-content .dropdown-link` |
| Log out item | `.profile-dropdown-content .dropdown-link` whose text is "Log out" |
| Logout confirm dialog | `.confirm-dialog` containing text "Log Out" |
| Confirm button | `.confirm-dialog .confirm-btn`, `button:has-text("Confirm")` |
| Cancel button | `.confirm-dialog .cancel-btn`, `button:has-text("Cancel")` |

```bash
# Open profile menu
echo "document.querySelector('.profile-dropdown-button')?.click()" | node C:\Users\john\hd-cdp.js

# Trigger logout
echo "Array.from(document.querySelectorAll('.dropdown-link')).find(e => e.textContent.includes('Log out'))?.click()" | node C:\Users\john\hd-cdp.js

# Confirm logout (after dialog appears)
echo "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Confirm')?.click()" | node C:\Users\john\hd-cdp.js
```

## Related skills

- [hd-adom-auth](../hd-adom-auth/SKILL.md) — the Adom session token, login flow, profile loading
- [hd-claude-auth](../hd-claude-auth/SKILL.md) — Claude Code auth (separate from Adom auth; logging out of Adom does NOT log you out of Claude)
- [hd-browser-picker](../hd-browser-picker/SKILL.md) — what opens the Your-*/external URLs in the user's chosen browser
- [hd-ui](../hd-ui/SKILL.md) — the Adom menu (top-left, different dropdown)
