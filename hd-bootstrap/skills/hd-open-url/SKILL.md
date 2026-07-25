---
name: hd-open-url
description: >
  The decision guide for "open a URL / open a website" inside Hydrogen Desktop.
  When the user says "open ti.com" / "pull up the datasheet page" / "show me
  that site", HD has SIX distinct ways to do it — a Hydrogen webview tab, an HD
  browser window, Pup (AI-drivable Chrome), a native desktop browser profile,
  the Browser Picker chooser, or headless curl/fetch — each with different
  trade-offs. READ THIS to pick the right one and to explain the options back to
  the user instead of silently guessing. For the interception/plumbing behind the
  picker see hd-browser-picker; to drive Pup see pup; for webview tabs see
  adom-workspace-control. Trigger words — open url, open website, open the site,
  open ti.com, open a link, pull up the page, show me the website, view this url,
  open in browser, which browser, how do I open, open the datasheet page, open in
  a tab, open in pup, open in chrome, headless fetch, ways to open a url, open
  link options, wv, open in wv, open as wv, webview tab, wv tab.
---

# HD — Opening a URL (your options)

When a user says **"open the ti.com website"** (or any URL), HD has several paths
and a Browser Picker — but **don't hand the user the picker to decide.** Pick the
best destination *for them* by use-case and **open it directly**, then offer the
alternatives in one line. The right path depends on what they're doing — look at
it, have you drive it, keep it as a tab, or just read it. See **"Decide for the
user — DON'T hand them the picker"** below for the rule.

## The six ways

| # | Option | Best when… | What the user sees | AI drives it? |
|---|--------|-----------|--------------------|---------------|
| 1 | **Hydrogen webview tab** (aka **wv**) | the user wants the site *inside* HD, next to their work, and to keep it around | a panel/tab in the HD workspace | partly (reload/route) |
| 2 | **HD Browser Window** | a quick popout window owned by HD, not a full browser | a standalone HD-owned window | no |
| 3 | **Pup (Puppeteer Chrome)** | **you** need to act on the page — screenshot, click, scrape, fill a form, verify | a real Chrome window on their desktop | **yes, fully** |
| 4 | **Native desktop browser** | real logins/sessions, downloads, "just open it for me", auth flows | their own Chrome/Edge profile | no |
| 5 | **Browser Picker** | you're not sure, or it's an auth/OAuth link — let the user choose (5s auto-default) | a chooser dialog | n/a (routes to one of the above) |
| 6 | **curl / fetch (headless)** | you only need the *content*, not to show anything (read a datasheet, scrape JSON) | nothing — runs in the workspace | **yes** |

## "wv" = webview — the shortcut (spread it like `pup`)

**`wv` is the short alias for "webview"** — recognize it **everywhere** a user might say
"webview" (`open it in wv`, `wv tab`, `shot the wv`, `wv mode`). Treat `wv` and `webview` as
identical.

**Help it catch on:** the *first* time in a session a user types the long form **"webview"**,
open it as normal **and** add a one-line nudge — *"(btw you can just say **wv** — fewer
keystrokes)."* Say it **once**, not every time (don't nag). This is exactly how
**puppeteer → `pup`** became universal among Adom folks; `webview → wv` is the same play.
(If the user already says `wv`, they got the memo — skip the nudge.)

## How you invoke each

All of these run from inside the HD workspace. The control API base URL is the live
value in `~/.adom/hd-control-url` — `http://127.0.0.1:<dynamic>` (WSL2 mirrored
networking shares loopback with the Windows host; the port is dynamic per launch).
Read it with `BASE="$(cat ~/.adom/hd-control-url)"` then hit `"$BASE/<endpoint>"`.

**1. Webview tab (wv)** — add a web-view tab pointed at the URL (`adom-workspace-control`,
or `adom-cli hydrogen webview open-or-refresh --name <X> --url <url> --panel-id <id>`). Good
for "keep this open while we work." ⚠️ **`open-or-refresh` needs `--panel-id` to CREATE a new
tab** — without it you get *"Tab 'X' not found and --panel-id not provided"* (verified live
2026-06-14; get a panel id from `adom-cli hydrogen workspace get`). Re-running with the same
`--name` once it exists just navigates/refreshes (no panel-id needed). Same `adom-cli` on
web-Hydrogen and HD — the consistent surface.

**2 / 4 / 5. Through the Browser Picker** — the single unifying entry point. POST
the URL and HD routes it (auto-picking a sensible default after a 5-second
countdown, or showing the chooser):
```bash
BASE="$(cat ~/.adom/hd-control-url)"   # http://127.0.0.1:<dynamic>

# Auto-route (picker picks the best default in 5s — hands-free)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://www.ti.com"}' \
  "$BASE/open-url"

# Force the chooser dialog (no auto-timer — make the user pick)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://www.ti.com","force":true}' \
  "$BASE/open-url"

# Route through the picker with the FRESH-WINDOW toggle pre-checked (the picked
# native browser opens in a new --new-window that auto-foregrounds — use for
# auth/OAuth so the consent page pops to the front by itself):
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://claude.ai/","fresh":true,"force":true}' \
  "$BASE/open-url"
# …or bypass the picker and open directly+fresh in a specific browser:
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://claude.ai/","browser":"edge","profileDir":"Default","fresh":true}' \
  "$BASE/open-in-profile"
```
> ⚠️ **`/open-url` often replies `"HD timed out after 5s"` even when it SUCCEEDED**
> (verified live 2026-06-14: `{"url":"https://www.google.com"}` reported the timeout, but the
> page opened in Edge). **Don't treat that as failure** — confirm with
> `GET "$BASE/browser-picker/last-open"` → `{destination, url, fresh, ts}`. `fresh:false` =
> routed to a remembered/default destination (no picker shown — e.g. `browser:edge:Default`);
> `fresh:true` = the picker was shown. (So if every domain has a remembered default, opens are
> silent — the picker only pops for un-remembered domains.)

The picker's auto-default heuristic: `*.claude.ai`/`*.claude.com` and Adom
`/auth/intent` → the user's work browser profile; unknown/right-click/iframe →
Pup; otherwise the user's last choice for that domain. See `hd-browser-picker`.

**Fresh window (`"fresh":true`)** — the native-browser path (#4) can open the URL
either as a tab in an already-running browser (default) or as a **brand-new window/
process** (`--new-window`). A freshly-launched window **auto-foregrounds** on Windows;
a tab does not. So for **auth flows the user must complete** (Claude/Adom sign-in),
prefer `fresh:true` — the consent page comes to the front by itself, no manual focus.
The Browser Picker defaults the "Open in a fresh window" toggle ON for auth URLs.
On `/open-url`, `fresh` pre-seeds that toggle (the picker still shows; add `direct:true`
to skip it); `/open-in-profile` opens fresh directly. See `hd-browser-picker`.

**3. Pup** — open and then drive it with `adom-desktop browser_*` verbs
(`browser_open_window`, `browser_navigate`, `browser_screenshot`, `browser_eval`,
`browser_reload`, …). Either open the URL directly via Pup, or let the picker
route to Pup. See the `pup` skill for the full verb set.
```bash
adom-desktop browser_eval '{"sessionId":"default","js":"document.title"}'
```

**6. Headless content** — if you only need to *read* the page, skip the browser
entirely:
```bash
curl -sL https://www.ti.com/...   # or fetch from your own code
```

## Decide for the user — DON'T hand them the picker

**Default behavior: pick the destination by use-case and open it DIRECTLY (bypass
the picker), then give a one-line heads-up + easy undo.** Do NOT fire a plain
`POST /open-url {url}` and let the picker's generic 5-second auto-default decide —
that default is luck-of-the-draw and often wrong for the use-case (a vendor-login
site could land in Pup where the user has no login). Users don't want to make this
choice; make the smart one for them. (Mechanics: `/open-in-profile` opens a
specific native browser+profile directly; `/open-url {direct:true}` bypasses the
picker; Pup and webview-tab are direct calls. Reserve the picker only as below.)

| Use case | Open it in | How (bypass the picker) |
|---|---|---|
| **Login-likely site** — vendor/account/portal/cart: TI, Mouser, DigiKey, any "my…"/sign-in | the user's **native browser + WORK profile** (their saved login/cookies live there) | `GET /browser-profiles` → find the work profile (non-gmail) → `POST /open-in-profile {url, browser, profileDir, fresh:true}` |
| **Building/testing their own app**, or you need to drive/screenshot/scrape the page | **Pup** (AI-drivable) | open via Pup (`browser_*`) / route `/open-url {url, direct:true}` to Pup |
| **Glance at content alongside their work** | **Hydrogen webview tab** | `adom-workspace-control` add web-view tab |
| **Genuinely ambiguous, OR an OAuth/sign-in the user must complete themselves** | let them choose | `POST /open-url {url, force:true}` — the one time the picker is right |

Then say it in one line, with the undo: *"Opened TI in your Chrome work profile
(where your TI login lives) — say the word for a tab here, Pup, or a different
profile."* Decide, act, offer alternatives — don't ask first.

Example — "open the texas instruments website" (login-likely → native work profile):
```bash
BASE="$(cat ~/.adom/hd-control-url)"
curl -s "$BASE/browser-profiles"     # pick the work profile (non-gmail email)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://www.ti.com","browser":"chrome","profileDir":"<work profileDir>"}' \
  "$BASE/open-in-profile"
```

## Govern routing policy — the picker is now a true FALLBACK (HD prefs API)

The picker's per-domain memory is a first-class API (HD app behavior), so **the AI OWNS URL
routing** — the picker only pops for a domain with **no stored policy AND no direct call**.
Use this to set policy the user would otherwise click through the Manager for ("always open
DigiKey in my work profile", "stop auto-opening X in Edge").

```bash
BASE="$(cat ~/.adom/hd-control-url)"
# READ the policy map
curl -s "$BASE/browser-picker/prefs"
#   → {ok, prefs:{domains:{"<host>":{destination,label}, …}}}
# SET / override one domain
curl -s -X PUT "$BASE/browser-picker/prefs" -H 'Content-Type: application/json' \
  -d '{"domain":"digikey.com","destination":"browser:edge:Default","label":"Edge — Default"}'
# FORGET one domain  (e.g. "stop auto-opening X in Edge")
curl -s -X DELETE "$BASE/browser-picker/prefs/digikey.com"
# CLEAR all
curl -s -X DELETE "$BASE/browser-picker/prefs"
```

- **Stored value = `{destination, label}`** — NOT `profileDir`/`fresh`.
- **`destination` is an ID:**
  - **internal:** `hydrogen-tab` (a webview/wv tab) · `webview-window` · `pup-window`
  - **native:** `browser:<browser>:<dir>` — e.g. `browser:edge:Default`, `browser:chrome:Profile 1`. **The profile dir is encoded in the ID** (no separate field).
- **Discover valid native IDs** via `GET $BASE/browser-profiles` (maps each detected profile → its `browser`+`dir`); the 3 internal IDs are fixed above.
- **`fresh` is NOT stored in prefs** — it's a per-OPEN flag (`/open-url {fresh:…}` / `/open-in-profile {fresh:…}`). Don't try to persist it here.
- **Writes hit the live Manager UI immediately** (the backend writes `hd-url-routing-prefs`
  localStorage + dispatches `hd-url-routing-prefs-changed`; an open Browser Picker Manager
  re-reads at once, and re-reads on open anyway).

**Net:** for a one-off open, *decide and call the direct endpoint* (`/open-in-profile`,
`/open-url {direct:true}`, or a wv/pup call). For a *standing* preference, `PUT` the domain's
policy so even user-initiated link clicks route there silently. The picker is now only a
fallback for the genuinely-undecided.

## Related skills
- [hd-browser-picker](../hd-browser-picker/SKILL.md) — the interception layers + picker dialog behind #2/#4/#5
- `pup` — driving Pup browser windows (#3): navigate, screenshot, eval, reload
- `adom-workspace-control` — adding/managing Hydrogen webview tabs (#1)
- [hd-runtime-mode](../hd-runtime-mode/SKILL.md) — none of this changes between the WSL2 and Docker runtimes
