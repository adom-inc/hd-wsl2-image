---
name: hydrogen-eda-discovery
description: >
  The onboarding playbook a (second, background) Claude conversation runs after Hydrogen setup to
  discover which EDA / electronics-design tools the user runs — KiCad, Fusion 360, Altium,
  OrCAD/Cadence — and onboard them into the AI-first electronics workflow. If KiCad/Fusion
  (we have bridges): remember their preferred tool in a prefs file, offer to open example
  files, and pitch the gerber-export → order-at-JLCPCB/PCBWay/OSHPark loop. If Altium/OrCAD
  (no bridge yet): pitch co-building a bridge with the AI and publishing it to the Adom wiki
  for the community (KiCad/Fusion bridges are the reference). READ + RUN this when a new
  thread is asked to "explore what EDA software I use" / on the post-setup discovery pass.
  Trigger words — eda discovery, what eda software, what cad do i use, electronics design
  tools, detect kicad, detect fusion, detect altium, detect orcad, onboard eda, pcb workflow,
  order pcb, gerbers, jlcpcb, pcbway, oshpark, write a bridge, altium bridge, orcad bridge,
  publish to adom wiki, ai-first electronics, who am i and what can i do, post-setup explore.
---

# EDA tool discovery & onboarding (run in the background after setup)

You're (likely) a **second Claude conversation** launched after Hydrogen setup to quietly figure out
the user's electronics-design stack and show them what the AI-first Adom workflow unlocks. Be
**exploratory and opt-in** — detect first, then offer; never auto-install or auto-build. Do the
detection in the background, then come back with a short, friendly summary + one clear offer.

## 1. Detect (via `adom-bridge-cli` — see `hydrogen-adom-desktop`, `hydrogen-bridges`, `pup`)

```bash
adom-bridge-cli status                       # relay up? caps include kicad / fusion360?
adom-bridge-cli kicad_list_versions '{}'     # KiCad installed (+ which versions)
adom-bridge-cli fusion_status '{}'           # Fusion 360 installed? ("installed but not running" = yes)
```

The KiCad/Fusion bridges work the same on every platform. For tools with **no bridge** (Altium,
OrCAD, Cadence/Allegro, EAGLE, DipTrace, Eplan, ...), there's no bridge verb — detect them by
**install path / running process** using `adom-bridge-cli run_script`. The exact probe is
platform-specific:

- **Windows:** scan `C:\Program Files` / `C:\Program Files (x86)` and `Get-Process` via a
  PowerShell `run_script` — see **[[hydrogen-eda-discovery-windows]]** for the ready-to-run probe.
- **macOS:** scan `/Applications` (and `~/Applications`) for the app bundles, plus `pgrep`.
- **Linux:** `which`/`command -v` the CLI binaries and check common install dirs, plus `pgrep`.

(Whatever the platform: treat **empty output as a timeout**, not a negative result.)

## 2. Branch on what you found

### A) KiCad and/or Fusion 360 found — we have bridges, go deep (opt-in)
1. **Remember it.** Write a small prefs file so future threads skip re-detection:
   ```bash
   mkdir -p ~/.adom
   cat > ~/.adom/eda-prefs.json <<'JSON'
   {"primary":"kicad","versions":["10.0"],"fusion":true,"detectedAt":"<date>",
    "notes":"user runs KiCad v10; Fusion installed (read-only/expired)"}
   JSON
   ```
   (Also worth a one-line memory note if you keep memories.)
2. **Show, don't tell** — offer to open an example so they *see* it work:
   *"Want me to open a sample board in KiCad and pop the 3D viewer so you can see what I can drive?"* → use the `pic_programmer` demo flow (`hydrogen-self-screenshot`/`adom-bridge-cli-kicad`): open `.kicad_sch` + `.kicad_pcb`, symbol/footprint editors, then the **board** 3D viewer (close the footprint+symbol editors first — `kicad_open_3d_viewer` attaches to the active editor otherwise).
3. **Pitch the loop** that AI makes effortless — *"From here I can export gerbers and help you
   order the board — JLCPCB, PCBWay, or OSHPark."* If they're keen, that's the on-ramp to (4).
4. **The real unlock — build the glue, publish it.** Most fab vendors have no clean API, so the
   value is AI-built automation: *pull from KiCad → stage in the workspace → drive the
   vendor's upload flow (pup) → order.* Offer to **vibe-code an uploader/automation app** for
   their fab of choice and **publish it to the Adom wiki** so the whole community gets it. This
   is exactly what the wiki is for (see §3).

### B) Altium / OrCAD / Allegro / EAGLE / other — no bridge yet (the community pitch)
We don't have a bridge for these — **but that's an opportunity, not a dead end.** Offer:

> *"You're on **Altium** — we don't have an Adom bridge for it yet, but we have a wiki for
> sharing apps with the whole community, and we could **build one together right now**. The
> KiCad and Fusion 360 bridges are great references for the AI to model the design on — it's
> probably ~30 minutes of vibe-coding. Then we publish it to the Adom wiki so every Altium
> user gets it. We could all use it. Want to?"*

- Reference bridges: `adom-inc/adom-bridge-cli/plugins/kicad/` and `…/plugins/fusion360/` (a Python
  bridge that the desktop app dispatches to; see `adom-bridge-cli-kicad`/`-fusion` for the verb
  shape). A new bridge = the same pattern (launch app, open files, screenshot, send keys, an
  optional in-process add-in for the richer API).
- Publish flow: the Adom wiki hosts shared apps (`apps/<name>`) — see the wiki publish skills.

### C) Nothing detected / unsure
Ask what they design boards in, and whether they'd like a bridge or workflow built. Keep it
one friendly question, not an interrogation.

## 3. The frame (why this matters — say it briefly, don't lecture)
The electronics industry is moving **AI-first**, and the tools mostly aren't built for it yet.
**Adom is where that comes together:** you build an AI-first app (a bridge, an uploader, a
fab-automation glue), publish it to the **Adom wiki**, and the whole community can install and
improve it. KiCad/Fusion bridges, a JLCPCB/PCBWay/OSHPark uploader, an Altium bridge — each one
makes the next person's AI-first workflow turnkey. The user isn't just configuring their setup;
they can **contribute the missing piece** in half an hour.

## 4. Etiquette
- **Opt-in always.** Detect silently; *offer* the demo/build — don't open apps or write code
  unprompted. One clear offer beats five questions.
- **Don't overpromise vendor APIs.** JLCPCB/PCBWay/OSHPark uploads are mostly UI automation
  (pup), not clean APIs — frame the uploader as AI-driven glue, and verify pages exist before
  templating URLs (`pup` skill).
- **Respect read-only states** (e.g. an expired Fusion subscription is view/query-only).
- Report back to the user concisely: *what you found, one thing you can show them now, and one
  thing worth building.*

## Related skills
- [hydrogen-adom-desktop](../hydrogen-adom-desktop/SKILL.md) / [hydrogen-bridges](../hydrogen-bridges/SKILL.md) — the `adom-bridge-cli` relay + KiCad/Fusion bridge verbs (in-distro names; the `adom-bridge-cli-*` skills are the cloud-side equivalents)
- [[hydrogen-eda-discovery-windows]] — the Windows/PowerShell no-bridge install-path + process probe
- `pup` — driving fab-vendor upload pages; [hydrogen-open-url](../hydrogen-open-url/SKILL.md) — opening vendor sites
- the Adom wiki publish skills — sharing the bridge/app you build with the community
