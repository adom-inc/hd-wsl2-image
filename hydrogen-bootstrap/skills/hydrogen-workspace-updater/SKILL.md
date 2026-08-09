---
name: hydrogen-workspace-updater
description: "How Hydrogen keeps THIS workspace's Adom tooling up to date, and how an Adom employee ships a skill / extension / CLI to EVERY Adom workspace automatically. Use when asked \"how do I get the latest skills or tooling from Adom\", \"how are updates delivered here\", \"what's the reload banner\", \"how do I make a skill that distributes to all Adom users\", \"how do I publish tooling to every workspace\". Trigger words: workspace updater, adom-workspace-updater, latest skills, get updates, how do updates work, auto update, distribute a skill, publish to all users, ship to every workspace, reload banner."
---

# How this workspace stays up to date — and how to ship to every workspace

## TL;DR (anyone)
You don't do anything. A gentle background daemon, **`adom-workspace-updater`**, keeps this
workspace's Adom tooling current automatically. It runs **~5 minutes after the workspace
starts**, then **every ~2 hours** — low-priority and **out-of-band** (it is never part of
startup and can't slow or break it). When an update needs the editor reloaded (e.g. a new VS
Code extension landed), Hydrogen fades in a banner at the top of the editor:
**"<Tool> is ready — click to reload."** Click it. Done.

Why a daemon at all? Your workspace is imaged **once at install and never re-imaged** — so
in-place delivery is the *only* way you ever get new tooling. This daemon is that delivery.

## "How do I get the latest skills / tooling from Adom?"
You already are — automatically. To force a check now instead of waiting:
```
adom-workspace-updater --once
```
It converges this workspace to a wiki **desired-state manifest**: SHA-verified, never
downgrades, and **surgical** — it only touches the specific named tooling, never your files or
anything you installed yourself.
- Installed skill-bundle version: `cat ~/.claude/skills/.hydrogen-skills-version`
- Last run + what changed:        `cat ~/.adom/workspace-updater-status.json`

(code-server and the Claude Code extension are **baked fundamentals** that self-update — the
daemon does *not* manage them; it just notices a change and offers the reload.)

## "How do I make a skill that gets distributed to ALL Adom workspaces automatically?" (Adom employees)
1. Add it to `skills/public-facing/shared/<your-skill>/SKILL.md` in the **hydrogen-desktop** repo.
2. Publish the bundle:
   ```
   scripts/publish-tooling.sh publish-skills
   ```
   (bundles every public hd-* skill, pushes it to the `hydrogen-workspace-tooling` wiki page, bumps the version.)
3. That's it — every workspace's daemon picks it up on its next tick and extracts it into `~/.claude/skills/`.

To distribute an **extension** or a **CLI** instead, add a manifest entry then publish:
```
scripts/publish-tooling.sh add <name> --kind extension --id <publisher.name> --version X   # Open VSX
scripts/publish-tooling.sh add <name> --kind bin --url <wiki blob> --version X              # a CLI
scripts/publish-tooling.sh publish
```
Operator details (the manifest, the kinds, the visibility flow) are in the **`workspace-tooling`**
skill in the hydrogen-desktop repo.

## The reload banner
When a new version is on disk but not yet active (a daemon-installed extension, or one the
editor auto-updated), Hydrogen shows **"<Tool> is ready / has an update — click to reload"** at the
top of the editor; clicking reloads it to activate the new code. **Skills need no reload** —
Claude re-reads them itself.

---
*Meta: this very skill was delivered to your workspace by the mechanism it describes — which is
the proof that the pipeline works end to end.*
