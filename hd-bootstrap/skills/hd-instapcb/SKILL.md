---
name: hd-instapcb
description: >
  The playbook a (second, background) Claude conversation runs after setup to wire up the user's
  InstaPCB quoting workflow inside Hydrogen Desktop: find any InstaPCB quotes they uploaded
  earlier, bring one up in the InstaPCB quoting engine in HD, and — if they want — set up a
  live loop so KiCad design changes auto-import and the quote re-quotes on-the-fly with zero
  manual steps. Detect + report + offer first; build the watch→reload loop only on a yes. READ
  + RUN this when a thread is asked about InstaPCB quotes / "bring up my instapcb quote" / "auto
  reload my quote as I change my board". Trigger words — instapcb, insta pcb, instapcb quote,
  quoting engine, bring up my quote, reload quote, on-the-fly quote, auto quote, requote, pcb
  quote, board quote, kicad to quote, watch kicad reload, live quote, instapcb-quote app.
---

# InstaPCB quoting workflow — discover & wire the live loop (background, opt-in)

You're (likely) a **second background Claude conversation** asked to set up the user's InstaPCB
quoting loop. The dream: they tweak their KiCad board, and their InstaPCB quote **updates by
itself** — no export, no re-upload, no clicking. Get there in stages: **discover → bring up a
quote → offer the live loop → build it only on a yes.** Don't change anything until they confirm.

## 1. Discover (report, don't assume)

The InstaPCB quoting engine is the **`instapcb-quote` app** (Ray's app), surfaced inside HD as a
webview/app — it is **NOT** part of HD itself, so locate it rather than guess:

```bash
# Is the quoting app running / reachable? (check the running webviews + workspace tabs)
adom-cli hydrogen probe                          # window_mode, sse
adom-cli hydrogen workspace get                  # open tabs — is an InstaPCB/quote tab already up?
# Where did earlier uploads land? look for staged quotes/uploads:
ls -la ~/project 2>/dev/null | grep -iE "instapcb|quote|gerber"
find ~/project -maxdepth 3 -iname "*instapcb*" -o -iname "*quote*.json" -o -iname "*gerber*" 2>/dev/null | head
```
- If you can't find the app or prior quotes, **say so plainly** and ask the user where the
  InstaPCB app lives (port/URL) and where they uploaded quotes — don't fabricate a "no quotes
  found." (Unknown ≠ none.)
- Report: *which* prior quotes you found (names/ids), and whether the quoting engine is open.

## 2. Bring up a quote in the engine
Open the InstaPCB app in the user's chosen surface and load the quote they pick (see
[hd-open-url](../hd-open-url/SKILL.md) for webview-vs-pup; **wv** is the default for a tab they
keep). If the app exposes a quote-by-id URL or an import action, use it; otherwise drive the UI
(`pup` for a scriptable window). Verify it actually loaded (title/eval), don't assume `ok`.

## 3. Offer the live loop (the payoff) — build only on a yes
*"Want me to wire it so your KiCad edits flow into the quote automatically? You change the
board, I re-export and the quote refreshes — no clicking."* If yes, build the loop:

1. **Watch the KiCad design** — watch the user's `.kicad_pcb` (+ schematic) for saves. Use a
   file watcher in the workspace, or `adom-desktop watch` around a poll of the board's mtime
   (see `adom-desktop-fusion`'s `watch` wrapper for the streaming pattern).
2. **On change → produce the artifact InstaPCB needs.** Most quoting wants **gerbers** — export
   them from KiCad (kicad-cli / the PCB editor's plot), staged into `~/project`. (KiCad bridge:
   open/drive the board — see `hd-bridges`/`adom-desktop-kicad`.)
3. **Push to the quoting engine + re-quote.** Feed the new gerbers/board to the `instapcb-quote`
   app (its import/upload path) and trigger a re-quote; if it has no API, drive the upload UI via
   `pup` and reload. **Reload the quote view** so the user sees the new number appear on its own.
4. **Debounce + show state** — don't re-quote on every keystroke-save; debounce, and surface a
   small "re-quoting…" / "quote updated" status so the loop is never silently running.

This is the AI-first electronics loop in miniature: **KiCad → workspace → quote**, glued by the
AI. If it works well, it's exactly the kind of thing worth **publishing to the Adom wiki** so
every InstaPCB user gets the live loop (see [hd-eda-discovery](../hd-eda-discovery/SKILL.md) §3).

## 4. Etiquette
- **Detect + offer; don't auto-build.** The watch loop changes files / drives the app — confirm first.
- **Verify the engine + quotes exist before claiming anything** ("I found 2 quotes: …" or "I
  can't find the InstaPCB app — where is it?"). Never report a false negative.
- Keep the loop **observable + debounced**; let the user pause/stop it.
- InstaPCB is **Ray's `instapcb-quote` app**, not an HD feature — file quirks/bugs to the
  instapcb-quote feedback list, not as HD bugs.

## Related skills
- [hd-eda-discovery](../hd-eda-discovery/SKILL.md) — the sibling post-setup discovery tab (EDA tools); same detect→offer pattern + the AI-first/Adom-wiki frame
- [hd-bridges](../hd-bridges/SKILL.md) — KiCad bridge verbs (open/plot/export the board)
- `pup` — driving the InstaPCB upload/quote UI; [hd-open-url](../hd-open-url/SKILL.md) — opening the app (wv vs pup)
